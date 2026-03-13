/**
 * upload-youtube.js
 * Uploads the assembled video to YouTube via YouTube Data API v3.
 * Handles OAuth2 token management and refresh automatically.
 * Usage: node scripts/upload-youtube.js <channelId> [--dry-run]
 *
 * Prerequisites:
 *   npm install googleapis
 *
 *   For each channel:
 *   1. Go to https://console.cloud.google.com/
 *   2. Create a project → Enable YouTube Data API v3
 *   3. Create OAuth 2.0 credentials (Desktop app type)
 *   4. Download the credentials JSON
 *   5. Save to channels/<channelId>/credentials.json
 *   6. Run this script once to authorize → token.json will be saved automatically
 *
 * ES5 style — var/function only, no arrows/const/let
 */

var fs = require('fs');
var path = require('path');
var http = require('http');
var readline = require('readline');

var ROOT = path.join(__dirname, '..');

// Lazy-load googleapis to avoid crash if not installed
function getGoogleApis() {
  try {
    return require('googleapis');
  } catch (e) {
    throw new Error('googleapis not installed. Run: npm install googleapis');
  }
}

function loadConfig() {
  var raw = fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8');
  return JSON.parse(raw);
}

function loadMetadata(channelId) {
  var raw = fs.readFileSync(path.join(ROOT, 'temp', channelId, 'metadata.json'), 'utf8');
  return JSON.parse(raw);
}

function loadCredentials(channelId) {
  var credPath = path.join(ROOT, 'channels', channelId, 'credentials.json');
  if (!fs.existsSync(credPath)) {
    throw new Error(
      'No credentials found at ' + credPath + '\n' +
      'To set up:\n' +
      '  1. Go to https://console.cloud.google.com/\n' +
      '  2. Create project → Enable YouTube Data API v3\n' +
      '  3. Create OAuth2 credentials (Desktop app)\n' +
      '  4. Download JSON → save as channels/' + channelId + '/credentials.json'
    );
  }
  var raw = fs.readFileSync(credPath, 'utf8');
  return JSON.parse(raw);
}

function getTokenPath(channelId) {
  return path.join(ROOT, 'channels', channelId, 'token.json');
}

function loadToken(channelId) {
  var tokenPath = getTokenPath(channelId);
  if (fs.existsSync(tokenPath)) {
    var raw = fs.readFileSync(tokenPath, 'utf8');
    return JSON.parse(raw);
  }
  return null;
}

function saveToken(channelId, token) {
  var tokenPath = getTokenPath(channelId);
  fs.writeFileSync(tokenPath, JSON.stringify(token, null, 2), 'utf8');
  console.log('[upload] Token saved to ' + tokenPath);
}

function getAuthClient(channelId, credentials, callback) {
  var googleapis = getGoogleApis();
  var google = googleapis.google;

  var clientId, clientSecret, redirectUri;

  // Handle both "installed" and "web" credential formats
  var cred = credentials.installed || credentials.web || credentials;
  clientId = cred.client_id;
  clientSecret = cred.client_secret;
  redirectUri = (cred.redirect_uris && cred.redirect_uris[0]) || 'urn:ietf:wg:oauth:2.0:oob';

  var oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  var existingToken = loadToken(channelId);
  if (existingToken) {
    oauth2Client.setCredentials(existingToken);

    // Refresh if expired
    if (existingToken.expiry_date && existingToken.expiry_date < Date.now()) {
      console.log('[upload] Token expired, refreshing...');
      oauth2Client.refreshAccessToken(function(err, token) {
        if (err) {
          callback(new Error('Token refresh failed: ' + err.message));
          return;
        }
        saveToken(channelId, token);
        oauth2Client.setCredentials(token);
        callback(null, oauth2Client);
      });
    } else {
      callback(null, oauth2Client);
    }
    return;
  }

  // No token — need to authorize
  var SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];
  var authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES
  });

  console.log('[upload] Authorization required for channel: ' + channelId);
  console.log('[upload] Open this URL in your browser:\n');
  console.log(authUrl);
  console.log('');

  var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Enter the authorization code from the page: ', function(code) {
    rl.close();
    oauth2Client.getToken(code.trim(), function(err, token) {
      if (err) {
        callback(new Error('Authorization failed: ' + err.message));
        return;
      }
      saveToken(channelId, token);
      oauth2Client.setCredentials(token);
      callback(null, oauth2Client);
    });
  });
}

function uploadVideo(channelId, dryRun, callback) {
  console.log('[upload] Channel: ' + channelId);

  var config = loadConfig();
  var channelConfig = config.channels[channelId];
  if (!channelConfig) {
    callback(new Error('Unknown channel: ' + channelId));
    return;
  }

  var metadata;
  try {
    metadata = loadMetadata(channelId);
  } catch (err) {
    callback(err); return;
  }

  var videoPath = metadata.outputPath;
  if (!videoPath || !fs.existsSync(videoPath)) {
    callback(new Error('Output video not found. Run assemble-video.js first.'));
    return;
  }

  var privacy = config.defaultPrivacy || 'private';
  var description = metadata.description || channelConfig.description || '';

  var videoTitle = channelConfig.name + ' — ' + metadata.title;
  if (videoTitle.length > 100) {
    videoTitle = videoTitle.substring(0, 97) + '...';
  }

  var uploadMeta = {
    title: videoTitle,
    description: description,
    tags: channelConfig.tags || [],
    categoryId: channelConfig.category || '22',
    privacyStatus: privacy,
    videoPath: videoPath
  };

  console.log('[upload] Title: ' + uploadMeta.title);
  console.log('[upload] Privacy: ' + uploadMeta.privacyStatus);
  console.log('[upload] Video: ' + videoPath);

  if (dryRun) {
    console.log('[upload] DRY RUN — skipping actual upload');
    console.log('[upload] Would upload:');
    console.log(JSON.stringify(uploadMeta, null, 2));
    callback(null, { id: 'DRY_RUN', url: 'https://youtube.com/watch?v=DRY_RUN' });
    return;
  }

  var credentials;
  try {
    credentials = loadCredentials(channelId);
  } catch (err) {
    callback(err); return;
  }

  var googleapis = getGoogleApis();
  var google = googleapis.google;

  getAuthClient(channelId, credentials, function(err, auth) {
    if (err) {
      callback(err); return;
    }

    var youtube = google.youtube({ version: 'v3', auth: auth });

    var fileSize = fs.statSync(videoPath).size;
    console.log('[upload] File size: ' + (fileSize / 1024 / 1024).toFixed(1) + ' MB');
    console.log('[upload] Uploading to YouTube...');

    youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: uploadMeta.title,
          description: uploadMeta.description,
          tags: uploadMeta.tags,
          categoryId: uploadMeta.categoryId,
          defaultLanguage: 'en',
          defaultAudioLanguage: 'en'
        },
        status: {
          privacyStatus: uploadMeta.privacyStatus,
          selfDeclaredMadeForKids: false
        }
      },
      media: {
        body: fs.createReadStream(videoPath)
      }
    }, function(err, response) {
      if (err) {
        callback(new Error('YouTube upload failed: ' + err.message));
        return;
      }

      var videoId = response.data.id;
      var videoUrl = 'https://www.youtube.com/watch?v=' + videoId;

      console.log('[upload] Uploaded! ID: ' + videoId);
      console.log('[upload] URL: ' + videoUrl);

      // Log to upload history
      var logPath = path.join(ROOT, 'channels', channelId, 'upload-log.json');
      var log = [];
      if (fs.existsSync(logPath)) {
        try { log = JSON.parse(fs.readFileSync(logPath, 'utf8')); } catch (e) {}
      }
      log.push({
        videoId: videoId,
        url: videoUrl,
        title: uploadMeta.title,
        topic: metadata.title,
        uploadedAt: new Date().toISOString(),
        privacy: uploadMeta.privacyStatus
      });
      fs.writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf8');

      callback(null, { id: videoId, url: videoUrl });
    });
  });
}

// ── CLI entry ──────────────────────────────────────────────────────────────────

if (require.main === module) {
  var args = process.argv.slice(2);
  var channelId = args[0];
  var dryRun = args.indexOf('--dry-run') !== -1;

  if (!channelId) {
    console.error('Usage: node scripts/upload-youtube.js <channelId> [--dry-run]');
    process.exit(1);
  }

  uploadVideo(channelId, dryRun, function(err, result) {
    if (err) {
      console.error('[upload] ERROR:', err.message);
      process.exit(1);
    }
    console.log('[upload] Done:', result);
  });
}

module.exports = { uploadVideo: uploadVideo };
