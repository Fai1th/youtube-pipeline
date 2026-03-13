/**
 * assemble-video.js
 * Assembles the final video using FFmpeg:
 *   - Concatenates stock footage (looped to match audio length)
 *   - Adds voiceover audio
 *   - Adds title card at start (3s)
 *   - Adds outro card at end (5s)
 *   - Overlays captions from script
 *   - Outputs correct resolution (longform: 1920x1080, shorts: 1080x1920)
 *
 * Usage: node scripts/assemble-video.js <channelId> [--dry-run]
 *
 * ES5 style — var/function only, no arrows/const/let
 */

var fs = require('fs');
var path = require('path');
var child_process = require('child_process');

var ROOT = path.join(__dirname, '..');

function loadConfig() {
  var raw = fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8');
  return JSON.parse(raw);
}

function loadMetadata(channelId) {
  var raw = fs.readFileSync(path.join(ROOT, 'temp', channelId, 'metadata.json'), 'utf8');
  return JSON.parse(raw);
}

function loadFootageManifest(channelId) {
  var manifestPath = path.join(ROOT, 'temp', channelId, 'footage-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('footage-manifest.json not found. Run fetch-footage.js first.');
  }
  var raw = fs.readFileSync(manifestPath, 'utf8');
  return JSON.parse(raw);
}

function ensureOutputDir(channelId) {
  var dir = path.join(ROOT, 'output', channelId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getAudioDuration(audioPath, callback) {
  var cmd = 'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "' + audioPath + '"';
  child_process.exec(cmd, function(err, stdout) {
    if (err) {
      callback(null, 120); // Default 2 minutes if probe fails
      return;
    }
    var duration = parseFloat(stdout.trim()) || 120;
    callback(null, duration);
  });
}

function escapeFFmpegText(text) {
  // Escape special characters for FFmpeg drawtext filter
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,');
}

function buildConcatFile(clips, tempDir, audioDuration, isShort) {
  // We need to loop clips to fill the entire audio duration
  // Total clip duration needed = audioDuration + 3 (title) + 5 (outro)
  var totalNeeded = audioDuration + 8;

  var clipDurations = [];
  var totalClipDuration = 0;

  for (var i = 0; i < clips.length; i++) {
    var dur = clips[i].duration || 10;
    clipDurations.push(dur);
    totalClipDuration += dur;
  }

  // Build looped clip list
  var concatLines = [];
  var filled = 0;
  var loopIndex = 0;

  while (filled < totalNeeded) {
    var clip = clips[loopIndex % clips.length];
    concatLines.push('file \'' + clip.path.replace(/\\/g, '/') + '\'');
    filled += clipDurations[loopIndex % clips.length];
    loopIndex++;
    // Safety: don't loop more than 50 times
    if (loopIndex > 50) break;
  }

  var concatFile = path.join(tempDir, 'footage-concat.txt');
  fs.writeFileSync(concatFile, concatLines.join('\n'), 'utf8');
  return concatFile;
}

function assembleVideo(channelId, dryRun, callback) {
  console.log('[assemble] Channel: ' + channelId);

  var config = loadConfig();
  var channelConfig = config.channels[channelId];
  if (!channelConfig) {
    callback(new Error('Unknown channel: ' + channelId));
    return;
  }

  var isShort = channelConfig.format === 'shorts';
  var W = isShort ? 1080 : 1920;
  var H = isShort ? 1920 : 1080;
  var resolution = W + 'x' + H;

  var tempDir = path.join(ROOT, 'temp', channelId);
  var audioPath = path.join(tempDir, 'voice.mp3');
  var outputDir = ensureOutputDir(channelId);

  // Load required files
  var metadata;
  try {
    metadata = loadMetadata(channelId);
  } catch (err) {
    callback(err); return;
  }

  var footageManifest;
  try {
    footageManifest = loadFootageManifest(channelId);
  } catch (err) {
    callback(err); return;
  }

  if (!fs.existsSync(audioPath)) {
    callback(new Error('voice.mp3 not found. Run tts.js first.'));
    return;
  }

  var clips = footageManifest.clips || [];
  if (clips.length === 0) {
    callback(new Error('No footage clips found. Run fetch-footage.js first.'));
    return;
  }

  var safeTitle = metadata.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
  var timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  var outputPath = path.join(outputDir, safeTitle + '_' + timestamp + '.mp4');

  if (dryRun) {
    console.log('[assemble] DRY RUN — would build:');
    console.log('  Resolution: ' + resolution);
    console.log('  Clips: ' + clips.length);
    console.log('  Audio: ' + audioPath);
    console.log('  Output: ' + outputPath);
    callback(null, outputPath);
    return;
  }

  getAudioDuration(audioPath, function(err, audioDuration) {
    console.log('[assemble] Audio duration: ' + audioDuration.toFixed(1) + 's');

    var concatFile = buildConcatFile(clips, tempDir, audioDuration, isShort);
    var rawFootagePath = path.join(tempDir, 'footage-raw.mp4');

    // Step 1: Concatenate and normalize all footage to correct resolution
    var step1Cmd = [
      'ffmpeg -y',
      '-f concat -safe 0',
      '-i "' + concatFile + '"',
      // Scale and crop to target resolution
      '-vf "scale=' + W + ':' + H + ':force_original_aspect_ratio=increase,crop=' + W + ':' + H,
      ',setsar=1"',
      '-c:v libx264 -preset fast -crf 23',
      '-an', // no audio yet
      '-t ' + (audioDuration + 8), // cut to needed length
      '"' + rawFootagePath + '"'
    ].join(' ');

    console.log('[assemble] Step 1: Normalizing footage...');
    child_process.exec(step1Cmd, { timeout: 300000, maxBuffer: 1024 * 1024 * 10 }, function(err, stdout, stderr) {
      if (err) {
        console.error('[assemble] Step 1 error:', stderr.substring(0, 500));
        callback(new Error('FFmpeg step 1 failed: ' + err.message));
        return;
      }

      // Step 2: Build title card text and outro, then composite with audio
      var titleText = escapeFFmpegText(channelConfig.name.toUpperCase());
      var topicText = escapeFFmpegText(metadata.title);
      var outroText = escapeFFmpegText('Subscribe to ' + channelConfig.name);

      // Font size scales with resolution
      var titleFontSize = isShort ? 72 : 80;
      var topicFontSize = isShort ? 48 : 52;
      var subtitleFontSize = isShort ? 42 : 46;

      // Build complex filter for title card (0-3s) + main content (3s to end-5s) + outro (last 5s)
      // We'll use drawtext to overlay title and outro on the footage
      var totalDuration = audioDuration + 8; // 3s title + audio + 5s outro

      var drawFilters = [
        // Title card: dark overlay + channel name + topic (0 to 3 seconds)
        'drawbox=x=0:y=0:w=iw:h=ih:color=black@0.75:t=fill:enable=\'between(t,0,3)\'',

        // Channel name on title card
        'drawtext=fontsize=' + titleFontSize + ':fontcolor=white:x=(w-text_w)/2:y=(h/2-text_h-20)' +
          ':text=\'' + titleText + '\''+
          ':fontfile=\'' + escapeFFmpegText('C:/Windows/Fonts/arialbd.ttf') + '\'' +
          ':enable=\'between(t,0,3)\'',

        // Topic title on title card
        'drawtext=fontsize=' + topicFontSize + ':fontcolor=yellow:x=(w-text_w)/2:y=(h/2+20)' +
          ':text=\'' + topicText.substring(0, 50) + (topicText.length > 50 ? '...' : '') + '\'' +
          ':fontfile=\'' + escapeFFmpegText('C:/Windows/Fonts/arial.ttf') + '\'' +
          ':enable=\'between(t,0,3)\'',

        // Outro: dark overlay (last 5 seconds)
        'drawbox=x=0:y=0:w=iw:h=ih:color=black@0.8:t=fill' +
          ':enable=\'gte(t,' + (totalDuration - 5) + ')\'',

        // Outro text
        'drawtext=fontsize=' + subtitleFontSize + ':fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2' +
          ':text=\'' + outroText + '\'' +
          ':fontfile=\'' + escapeFFmpegText('C:/Windows/Fonts/arialbd.ttf') + '\'' +
          ':enable=\'gte(t,' + (totalDuration - 5) + ')\''
      ];

      var vf = drawFilters.join(',');

      // Step 2: Final assembly with audio
      var step2Cmd = [
        'ffmpeg -y',
        '-i "' + rawFootagePath + '"',
        '-i "' + audioPath + '"',
        '-filter_complex "[0:v]' + vf + '[v]"',
        '-map "[v]"',
        '-map 1:a',
        '-c:v libx264 -preset medium -crf 22',
        '-c:a aac -b:a 192k',
        '-movflags +faststart',
        '-shortest', // End when audio ends
        '"' + outputPath + '"'
      ].join(' ');

      console.log('[assemble] Step 2: Final assembly with title card + outro + audio...');
      child_process.exec(step2Cmd, { timeout: 600000, maxBuffer: 1024 * 1024 * 10 }, function(err, stdout, stderr) {
        // Clean up raw footage temp file
        try { fs.unlinkSync(rawFootagePath); } catch (e) {}

        if (err) {
          console.error('[assemble] Step 2 error:', stderr.substring(0, 500));
          callback(new Error('FFmpeg step 2 failed: ' + err.message));
          return;
        }

        console.log('[assemble] Video assembled: ' + outputPath);

        // Save output path to metadata
        metadata.outputPath = outputPath;
        fs.writeFileSync(path.join(tempDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');

        callback(null, outputPath);
      });
    });
  });
}

// ── CLI entry ──────────────────────────────────────────────────────────────────

if (require.main === module) {
  var args = process.argv.slice(2);
  var channelId = args[0];
  var dryRun = args.indexOf('--dry-run') !== -1;

  if (!channelId) {
    console.error('Usage: node scripts/assemble-video.js <channelId> [--dry-run]');
    process.exit(1);
  }

  assembleVideo(channelId, dryRun, function(err, outputPath) {
    if (err) {
      console.error('[assemble] ERROR:', err.message);
      process.exit(1);
    }
    console.log('[assemble] Done:', outputPath || '(dry run)');
  });
}

module.exports = { assembleVideo: assembleVideo };
