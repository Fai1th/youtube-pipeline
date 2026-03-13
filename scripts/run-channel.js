/**
 * run-channel.js
 * Master runner for a single channel: generate → TTS → footage → assemble → upload
 * Usage: node scripts/run-channel.js <channelId> [--dry-run] [--skip-upload] [--skip-footage]
 *
 * Flags:
 *   --dry-run       Run entire pipeline in dry-run mode (no files written, no API calls)
 *   --skip-upload   Generate and assemble but don't upload to YouTube
 *   --skip-footage  Use previously downloaded footage (skip Pexels API call)
 *
 * ES5 style — var/function only, no arrows/const/let
 */

var path = require('path');
var fs = require('fs');

var ROOT = path.join(__dirname, '..');

var generateScript = require('./generate-script').generateScript;
var generateVoiceover = require('./tts').generateVoiceover;
var fetchFootage = require('./fetch-footage').fetchFootage;
var assembleVideo = require('./assemble-video').assembleVideo;
var uploadVideo = require('./upload-youtube').uploadVideo;

var VALID_CHANNELS = ['stoic', 'darkhistory', 'psychfacts', 'sciexplained', 'truecrime', 'technews', 'lifehacks', 'mythology'];

function runChannel(channelId, opts, callback) {
  var dryRun = opts.dryRun || false;
  var skipUpload = opts.skipUpload || false;
  var skipFootage = opts.skipFootage || false;

  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║  YOUTUBE PIPELINE — ' + channelId.toUpperCase().padEnd(16) + '║');
  console.log('╚══════════════════════════════════════╝');
  if (dryRun) console.log('  ⚡ DRY RUN MODE');
  console.log('');

  var startTime = Date.now();

  // ─────────────────────────────────────────────────────────
  // STEP 1: Generate script
  // ─────────────────────────────────────────────────────────
  console.log('▶ [1/5] Generating script...');
  var scriptResult;
  try {
    scriptResult = generateScript(channelId, dryRun);
  } catch (err) {
    callback(new Error('[Step 1 - Script] ' + err.message));
    return;
  }
  console.log('✓ Script ready: ' + scriptResult.topic.title);
  console.log('');

  // ─────────────────────────────────────────────────────────
  // STEP 2: Generate voiceover
  // ─────────────────────────────────────────────────────────
  console.log('▶ [2/5] Generating voiceover (TTS)...');
  generateVoiceover(channelId, dryRun, function(err, voicePath) {
    if (err) {
      callback(new Error('[Step 2 - TTS] ' + err.message));
      return;
    }
    console.log('✓ Voiceover ready');
    console.log('');

    // ─────────────────────────────────────────────────────────
    // STEP 3: Fetch stock footage
    // ─────────────────────────────────────────────────────────
    console.log('▶ [3/5] Fetching stock footage from Pexels...');

    if (skipFootage && !dryRun) {
      var manifestPath = path.join(ROOT, 'temp', channelId, 'footage-manifest.json');
      if (fs.existsSync(manifestPath)) {
        console.log('  (--skip-footage: using existing footage)');
        proceedToAssembly();
        return;
      }
    }

    fetchFootage(channelId, dryRun, function(err, clips) {
      if (err) {
        callback(new Error('[Step 3 - Footage] ' + err.message));
        return;
      }
      console.log('✓ Footage ready: ' + (clips ? clips.length : 0) + ' clips');
      console.log('');
      proceedToAssembly();
    });

    function proceedToAssembly() {
      // ─────────────────────────────────────────────────────────
      // STEP 4: Assemble video
      // ─────────────────────────────────────────────────────────
      console.log('▶ [4/5] Assembling video with FFmpeg...');
      assembleVideo(channelId, dryRun, function(err, outputPath) {
        if (err) {
          callback(new Error('[Step 4 - Assembly] ' + err.message));
          return;
        }
        console.log('✓ Video assembled: ' + (outputPath || '(dry run)'));
        console.log('');

        if (skipUpload || dryRun) {
          if (dryRun) {
            console.log('  (dry run: upload skipped)');
          } else {
            console.log('  (--skip-upload: skipping YouTube upload)');
          }
          finish(null, null, outputPath);
          return;
        }

        // ─────────────────────────────────────────────────────────
        // STEP 5: Upload to YouTube
        // ─────────────────────────────────────────────────────────
        console.log('▶ [5/5] Uploading to YouTube...');
        uploadVideo(channelId, dryRun, function(err, result) {
          if (err) {
            callback(new Error('[Step 5 - Upload] ' + err.message));
            return;
          }
          console.log('✓ Uploaded: ' + (result ? result.url : '(dry run)'));
          console.log('');
          finish(null, result, outputPath);
        });
      });
    }
  });

  function finish(err, uploadResult, outputPath) {
    if (err) {
      callback(err);
      return;
    }
    var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║  ✅ PIPELINE COMPLETE (' + elapsed + 's)' + ' '.repeat(Math.max(0, 14 - elapsed.length)) + '║');
    console.log('╚══════════════════════════════════════╝');
    if (outputPath) console.log('  Video: ' + outputPath);
    if (uploadResult) console.log('  YouTube: ' + uploadResult.url);
    console.log('');

    callback(null, {
      channelId: channelId,
      topic: scriptResult.topic.title,
      outputPath: outputPath,
      upload: uploadResult,
      elapsed: elapsed
    });
  }
}

// ── CLI entry ──────────────────────────────────────────────────────────────────

if (require.main === module) {
  var args = process.argv.slice(2);
  var channelId = args[0];
  var dryRun = args.indexOf('--dry-run') !== -1;
  var skipUpload = args.indexOf('--skip-upload') !== -1;
  var skipFootage = args.indexOf('--skip-footage') !== -1;

  if (!channelId) {
    console.error('Usage: node scripts/run-channel.js <channelId> [options]');
    console.error('');
    console.error('Channels: ' + VALID_CHANNELS.join(', '));
    console.error('');
    console.error('Options:');
    console.error('  --dry-run       Full dry run (no files written)');
    console.error('  --skip-upload   Generate & assemble only (no YouTube upload)');
    console.error('  --skip-footage  Reuse previously downloaded footage');
    process.exit(1);
  }

  if (VALID_CHANNELS.indexOf(channelId) === -1) {
    console.error('Unknown channel: ' + channelId);
    console.error('Valid channels: ' + VALID_CHANNELS.join(', '));
    process.exit(1);
  }

  runChannel(channelId, { dryRun: dryRun, skipUpload: skipUpload, skipFootage: skipFootage }, function(err, result) {
    if (err) {
      console.error('');
      console.error('❌ PIPELINE ERROR: ' + err.message);
      process.exit(1);
    }
  });
}

module.exports = { runChannel: runChannel };
