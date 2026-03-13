/**
 * run-all.js
 * Runs the full pipeline for all 8 channels in sequence.
 * Usage: node scripts/run-all.js [--dry-run] [--skip-upload]
 *
 * Channels run one at a time (sequential) to avoid rate limiting.
 * A summary report is printed at the end.
 *
 * ES5 style — var/function only, no arrows/const/let
 */

var runChannel = require('./run-channel').runChannel;

var ALL_CHANNELS = [
  'stoic',
  'darkhistory',
  'psychfacts',
  'sciexplained',
  'truecrime',
  'technews',
  'lifehacks',
  'mythology'
];

// Delay between channels to avoid hitting API rate limits
var DELAY_BETWEEN_CHANNELS_MS = 5000;

function delay(ms, callback) {
  setTimeout(callback, ms);
}

function runAll(opts, callback) {
  var dryRun = opts.dryRun || false;
  var skipUpload = opts.skipUpload || false;

  var results = [];
  var errors = [];
  var channelIndex = 0;
  var overallStart = Date.now();

  console.log('');
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   YOUTUBE PIPELINE — ALL 8 CHANNELS        ║');
  console.log('╚════════════════════════════════════════════╝');
  if (dryRun) console.log('  ⚡ DRY RUN MODE');
  console.log('  Channels: ' + ALL_CHANNELS.join(', '));
  console.log('');

  function processNext() {
    if (channelIndex >= ALL_CHANNELS.length) {
      printSummary();
      callback(null, { results: results, errors: errors });
      return;
    }

    var channelId = ALL_CHANNELS[channelIndex];
    channelIndex++;

    console.log('');
    console.log('══════════════════════════════════════════════');
    console.log('  Channel ' + channelIndex + '/' + ALL_CHANNELS.length + ': ' + channelId.toUpperCase());
    console.log('══════════════════════════════════════════════');

    runChannel(channelId, { dryRun: dryRun, skipUpload: skipUpload }, function(err, result) {
      if (err) {
        console.error('  ❌ ' + channelId + ' FAILED: ' + err.message);
        errors.push({ channelId: channelId, error: err.message });
      } else {
        results.push(result);
      }

      // Wait before next channel
      if (channelIndex < ALL_CHANNELS.length) {
        console.log('  Waiting ' + (DELAY_BETWEEN_CHANNELS_MS / 1000) + 's before next channel...');
        delay(DELAY_BETWEEN_CHANNELS_MS, processNext);
      } else {
        processNext();
      }
    });
  }

  processNext();

  function printSummary() {
    var totalTime = ((Date.now() - overallStart) / 1000 / 60).toFixed(1);

    console.log('');
    console.log('╔════════════════════════════════════════════╗');
    console.log('║   PIPELINE COMPLETE — SUMMARY              ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log('  Total time: ' + totalTime + ' minutes');
    console.log('  Succeeded: ' + results.length + '/' + ALL_CHANNELS.length);
    console.log('  Failed:    ' + errors.length + '/' + ALL_CHANNELS.length);
    console.log('');

    if (results.length > 0) {
      console.log('  ✅ Successful:');
      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        var uploadInfo = r.upload ? ' → ' + r.upload.url : ' (not uploaded)';
        console.log('     ' + r.channelId + ': "' + r.topic + '"' + uploadInfo);
      }
    }

    if (errors.length > 0) {
      console.log('');
      console.log('  ❌ Errors:');
      for (var j = 0; j < errors.length; j++) {
        var e = errors[j];
        console.log('     ' + e.channelId + ': ' + e.error);
      }
    }

    console.log('');
  }
}

// ── CLI entry ──────────────────────────────────────────────────────────────────

if (require.main === module) {
  var args = process.argv.slice(2);
  var dryRun = args.indexOf('--dry-run') !== -1;
  var skipUpload = args.indexOf('--skip-upload') !== -1;

  runAll({ dryRun: dryRun, skipUpload: skipUpload }, function(err, summary) {
    if (err) {
      console.error('Fatal error:', err.message);
      process.exit(1);
    }
    if (summary.errors.length === ALL_CHANNELS.length) {
      process.exit(1); // All failed
    }
  });
}

module.exports = { runAll: runAll };
