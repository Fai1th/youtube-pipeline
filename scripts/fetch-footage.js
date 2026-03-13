/**
 * fetch-footage.js
 * Downloads stock video clips from Pexels API based on topic keywords.
 * Usage: node scripts/fetch-footage.js <channelId> [--dry-run]
 *
 * Prerequisites:
 *   npm install axios
 *   Free Pexels API key at https://www.pexels.com/api/ → add to config.json
 *
 * ES5 style — var/function only, no arrows/const/let
 */

var fs = require('fs');
var path = require('path');
var http = require('http');
var https = require('https');

var ROOT = path.join(__dirname, '..');

function loadConfig() {
  var raw = fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8');
  return JSON.parse(raw);
}

function loadMetadata(channelId) {
  var metaPath = path.join(ROOT, 'temp', channelId, 'metadata.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error('metadata.json not found. Run generate-script.js first.');
  }
  var raw = fs.readFileSync(metaPath, 'utf8');
  return JSON.parse(raw);
}

function ensureFootageDir(channelId) {
  var dir = path.join(ROOT, 'temp', channelId, 'footage');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function pexelsSearchVideos(apiKey, query, orientation, perPage, callback) {
  // orientation: 'landscape' for longform, 'portrait' for shorts
  var encodedQuery = encodeURIComponent(query);
  var url = 'https://api.pexels.com/videos/search?query=' + encodedQuery +
    '&orientation=' + orientation +
    '&per_page=' + (perPage || 5) +
    '&size=medium';

  console.log('[footage] Searching Pexels: "' + query + '" (' + orientation + ')');

  var options = {
    hostname: 'api.pexels.com',
    path: '/videos/search?query=' + encodedQuery + '&orientation=' + orientation + '&per_page=' + (perPage || 5) + '&size=medium',
    method: 'GET',
    headers: {
      'Authorization': apiKey
    }
  };

  var req = https.request(options, function(res) {
    var data = '';
    res.on('data', function(chunk) { data += chunk; });
    res.on('end', function() {
      if (res.statusCode !== 200) {
        callback(new Error('Pexels API error: ' + res.statusCode + ' ' + data));
        return;
      }
      try {
        var result = JSON.parse(data);
        callback(null, result);
      } catch (e) {
        callback(new Error('Failed to parse Pexels response: ' + e.message));
      }
    });
  });

  req.on('error', function(err) {
    callback(err);
  });

  req.end();
}

function getBestVideoFile(video, isShort) {
  // For shorts: want portrait or square, HD
  // For longform: want landscape, HD (1920x1080 or better)
  var files = video.video_files || [];
  var best = null;
  var bestScore = -1;

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var w = f.width || 0;
    var h = f.height || 0;
    var score = 0;

    if (isShort) {
      // Prefer portrait (h > w)
      if (h > w) score += 100;
      // Prefer at least 720p height
      if (h >= 720) score += 50;
      if (h >= 1080) score += 25;
    } else {
      // Prefer landscape (w > h)
      if (w > h) score += 100;
      // Prefer at least 1080p width
      if (w >= 1280) score += 50;
      if (w >= 1920) score += 25;
    }

    // Prefer MP4
    if (f.file_type === 'video/mp4') score += 30;

    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }

  return best;
}

function downloadFile(url, destPath, callback) {
  var file = fs.createWriteStream(destPath);
  var protocol = url.startsWith('https') ? https : http;

  protocol.get(url, function(response) {
    // Handle redirects
    if (response.statusCode === 301 || response.statusCode === 302) {
      file.close();
      fs.unlinkSync(destPath);
      downloadFile(response.headers.location, destPath, callback);
      return;
    }

    if (response.statusCode !== 200) {
      file.close();
      fs.unlinkSync(destPath);
      callback(new Error('Download failed: HTTP ' + response.statusCode));
      return;
    }

    response.pipe(file);
    file.on('finish', function() {
      file.close(function() { callback(null); });
    });
  }).on('error', function(err) {
    fs.unlink(destPath, function() {});
    callback(err);
  });
}

function downloadClips(apiKey, keywords, isShort, footageDir, maxClips, callback) {
  // Try each keyword until we have enough clips
  var clips = [];
  var keywordIndex = 0;
  var orientation = isShort ? 'portrait' : 'landscape';

  function tryNextKeyword() {
    if (clips.length >= maxClips || keywordIndex >= keywords.length) {
      callback(null, clips);
      return;
    }

    var keyword = keywords[keywordIndex];
    keywordIndex++;

    pexelsSearchVideos(apiKey, keyword, orientation, maxClips - clips.length + 2, function(err, result) {
      if (err) {
        console.warn('[footage] Pexels search failed for "' + keyword + '":', err.message);
        // Throttle on error
        setTimeout(tryNextKeyword, 1000);
        return;
      }

      var videos = result.videos || [];
      console.log('[footage] Found ' + videos.length + ' videos for "' + keyword + '"');

      var downloadIndex = 0;

      function downloadNext() {
        if (downloadIndex >= videos.length || clips.length >= maxClips) {
          // Throttle between keyword searches
          setTimeout(tryNextKeyword, 500);
          return;
        }

        var video = videos[downloadIndex];
        downloadIndex++;

        var fileInfo = getBestVideoFile(video, isShort);
        if (!fileInfo || !fileInfo.link) {
          downloadNext();
          return;
        }

        var clipNum = clips.length + 1;
        var destPath = path.join(footageDir, 'clip' + clipNum + '.mp4');

        console.log('[footage] Downloading clip ' + clipNum + ' (' + (fileInfo.width || '?') + 'x' + (fileInfo.height || '?') + ')...');

        downloadFile(fileInfo.link, destPath, function(err) {
          if (err) {
            console.warn('[footage] Download failed:', err.message);
            downloadNext();
            return;
          }

          clips.push({
            path: destPath,
            width: fileInfo.width,
            height: fileInfo.height,
            duration: video.duration,
            keyword: keyword,
            pexelsId: video.id
          });

          console.log('[footage] Clip ' + clipNum + ' saved: ' + path.basename(destPath));
          downloadNext();
        });
      }

      downloadNext();
    });
  }

  tryNextKeyword();
}

function fetchFootage(channelId, dryRun, callback) {
  console.log('[footage] Channel: ' + channelId);

  var config = loadConfig();
  var channelConfig = config.channels[channelId];

  if (!channelConfig) {
    callback(new Error('Unknown channel: ' + channelId));
    return;
  }

  var apiKey = config.pexelsApiKey;
  if (!apiKey || apiKey === 'YOUR_PEXELS_API_KEY') {
    callback(new Error('Pexels API key not set in config.json. Get a free key at https://www.pexels.com/api/'));
    return;
  }

  var metadata;
  try {
    metadata = loadMetadata(channelId);
  } catch (err) {
    callback(err);
    return;
  }

  var isShort = channelConfig.format === 'shorts';
  var maxClips = isShort ? 3 : 5;
  var keywords = metadata.keywords || channelConfig.tags || ['nature', 'city', 'abstract'];

  console.log('[footage] Format: ' + (isShort ? 'shorts (portrait)' : 'longform (landscape)'));
  console.log('[footage] Keywords: ' + keywords.join(', '));
  console.log('[footage] Target clips: ' + maxClips);

  if (dryRun) {
    console.log('[footage] DRY RUN — would search Pexels for:');
    for (var i = 0; i < keywords.length; i++) {
      console.log('  - "' + keywords[i] + '" (' + (isShort ? 'portrait' : 'landscape') + ')');
    }
    callback(null, []);
    return;
  }

  var footageDir = ensureFootageDir(channelId);

  // Clean existing footage
  var existing = fs.readdirSync(footageDir);
  for (var j = 0; j < existing.length; j++) {
    fs.unlinkSync(path.join(footageDir, existing[j]));
  }

  downloadClips(apiKey, keywords, isShort, footageDir, maxClips, function(err, clips) {
    if (err) {
      callback(err);
      return;
    }

    if (clips.length === 0) {
      callback(new Error('No footage downloaded. Check API key and keywords.'));
      return;
    }

    // Save footage manifest
    var manifest = {
      channelId: channelId,
      clips: clips,
      isShort: isShort,
      downloadedAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(ROOT, 'temp', channelId, 'footage-manifest.json'),
      JSON.stringify(manifest, null, 2), 'utf8');

    console.log('[footage] Downloaded ' + clips.length + ' clips');
    callback(null, clips);
  });
}

// ── CLI entry ──────────────────────────────────────────────────────────────────

if (require.main === module) {
  var args = process.argv.slice(2);
  var channelId = args[0];
  var dryRun = args.indexOf('--dry-run') !== -1;

  if (!channelId) {
    console.error('Usage: node scripts/fetch-footage.js <channelId> [--dry-run]');
    process.exit(1);
  }

  fetchFootage(channelId, dryRun, function(err, clips) {
    if (err) {
      console.error('[footage] ERROR:', err.message);
      process.exit(1);
    }
    console.log('[footage] Done. Clips:', (clips || []).length);
  });
}

module.exports = { fetchFootage: fetchFootage };
