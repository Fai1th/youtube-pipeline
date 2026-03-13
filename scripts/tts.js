/**
 * tts.js
 * Text-to-speech voiceover generation using edge-tts (Microsoft Edge TTS, free).
 * Falls back to gTTS if edge-tts fails.
 * Usage: node scripts/tts.js <channelId> [--dry-run]
 *
 * Prerequisites:
 *   pip install edge-tts
 *   pip install gtts  (fallback)
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

function ensureTempDir(channelId) {
  var dir = path.join(ROOT, 'temp', channelId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function loadScript(channelId) {
  var scriptPath = path.join(ROOT, 'temp', channelId, 'script.txt');
  if (!fs.existsSync(scriptPath)) {
    throw new Error('Script not found at ' + scriptPath + '. Run generate-script.js first.');
  }
  return fs.readFileSync(scriptPath, 'utf8');
}

function cleanScriptForTTS(scriptText) {
  // Remove section headers like [HOOK], [BODY], etc.
  // Remove lines that are marked DO NOT READ ALOUD
  // Remove --- banners
  var lines = scriptText.split('\n');
  var cleaned = [];
  var skipNext = false;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();

    // Skip banner lines
    if (line.match(/^---/)) continue;

    // Skip lines that are bracketed section headers
    if (line.match(/^\[.*\]$/)) {
      // Check if this is a DO NOT READ ALOUD note
      if (line.indexOf('DO NOT READ') !== -1 || line.indexOf('SAFETY NOTE') !== -1 ||
          line.indexOf('LEGAL FOOTER') !== -1) {
        skipNext = true;
      }
      continue;
    }

    // Skip lines after a DO NOT READ marker
    if (skipNext) {
      skipNext = false;
      continue;
    }

    // Skip empty lines (TTS handles pacing via punctuation)
    if (line === '') continue;

    cleaned.push(line);
  }

  return cleaned.join(' ');
}

function runEdgeTTS(text, voiceId, outputPath, callback) {
  // edge-tts has a character limit per call — split if needed
  var MAX_CHARS = 3000;

  if (text.length <= MAX_CHARS) {
    runEdgeTTSChunk(text, voiceId, outputPath, callback);
    return;
  }

  // Split into chunks at sentence boundaries
  var chunks = splitIntoChunks(text, MAX_CHARS);
  var chunkFiles = [];
  var tempDir = path.dirname(outputPath);
  var chunkIndex = 0;

  function processNextChunk() {
    if (chunkIndex >= chunks.length) {
      // Concatenate all chunks
      concatenateAudioFiles(chunkFiles, outputPath, function(err) {
        // Clean up chunk files
        for (var j = 0; j < chunkFiles.length; j++) {
          try { fs.unlinkSync(chunkFiles[j]); } catch (e) {}
        }
        callback(err);
      });
      return;
    }

    var chunkFile = path.join(tempDir, 'chunk_' + chunkIndex + '.mp3');
    chunkFiles.push(chunkFile);
    runEdgeTTSChunk(chunks[chunkIndex], voiceId, chunkFile, function(err) {
      if (err) {
        callback(err);
        return;
      }
      chunkIndex++;
      processNextChunk();
    });
  }

  processNextChunk();
}

function runEdgeTTSChunk(text, voiceId, outputPath, callback) {
  // Write text to a temp file to avoid command-line length limits
  var tempTextFile = outputPath + '.tmp.txt';
  fs.writeFileSync(tempTextFile, text, 'utf8');

  var cmd = 'python -m edge_tts --voice ' + voiceId + ' --file "' + tempTextFile + '" --write-media "' + outputPath + '"';

  console.log('[tts] Running edge-tts: voice=' + voiceId);

  child_process.exec(cmd, { timeout: 120000 }, function(err, stdout, stderr) {
    try { fs.unlinkSync(tempTextFile); } catch (e) {}

    if (err) {
      console.error('[tts] edge-tts error:', stderr || err.message);
      callback(err);
      return;
    }
    callback(null);
  });
}

function runGTTSFallback(text, outputPath, callback) {
  // gTTS fallback — lower quality but reliable
  var tempTextFile = outputPath + '.tmp.txt';
  fs.writeFileSync(tempTextFile, text, 'utf8');

  // gTTS outputs MP3
  var cmd = 'python -m gtts.cli -f "' + tempTextFile + '" -o "' + outputPath + '"';

  console.log('[tts] Falling back to gTTS...');

  child_process.exec(cmd, { timeout: 120000 }, function(err, stdout, stderr) {
    try { fs.unlinkSync(tempTextFile); } catch (e) {}

    if (err) {
      console.error('[tts] gTTS error:', stderr || err.message);
      callback(err);
      return;
    }
    callback(null);
  });
}

function splitIntoChunks(text, maxChars) {
  var chunks = [];
  var sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  var current = '';

  for (var i = 0; i < sentences.length; i++) {
    var sentence = sentences[i];
    if ((current + sentence).length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  return chunks;
}

function concatenateAudioFiles(files, outputPath, callback) {
  if (files.length === 1) {
    fs.copyFileSync(files[0], outputPath);
    callback(null);
    return;
  }

  // Use ffmpeg to concatenate audio files
  var listFile = outputPath + '.filelist.txt';
  var listContent = files.map(function(f) { return 'file \'' + f.replace(/\\/g, '/') + '\''; }).join('\n');
  fs.writeFileSync(listFile, listContent, 'utf8');

  var cmd = 'ffmpeg -y -f concat -safe 0 -i "' + listFile + '" -acodec copy "' + outputPath + '"';

  child_process.exec(cmd, { timeout: 120000 }, function(err, stdout, stderr) {
    try { fs.unlinkSync(listFile); } catch (e) {}
    if (err) {
      callback(new Error('ffmpeg concat failed: ' + stderr));
      return;
    }
    callback(null);
  });
}

function generateVoiceover(channelId, dryRun, callback) {
  console.log('[tts] Channel: ' + channelId);

  var config = loadConfig();
  var channelConfig = config.channels[channelId];
  if (!channelConfig) {
    callback(new Error('Unknown channel: ' + channelId));
    return;
  }

  var voiceId = channelConfig.voiceId;
  var tempDir = ensureTempDir(channelId);
  var outputPath = path.join(tempDir, 'voice.mp3');

  var scriptText;
  try {
    scriptText = loadScript(channelId);
  } catch (err) {
    callback(err);
    return;
  }

  var cleanText = cleanScriptForTTS(scriptText);
  console.log('[tts] Script length (chars): ' + cleanText.length);
  console.log('[tts] Voice: ' + voiceId);

  if (dryRun) {
    console.log('[tts] DRY RUN — TTS not executed');
    console.log('[tts] Clean script preview (first 500 chars):');
    console.log(cleanText.substring(0, 500) + '...');
    callback(null, outputPath);
    return;
  }

  runEdgeTTS(cleanText, voiceId, outputPath, function(err) {
    if (err) {
      console.log('[tts] edge-tts failed, trying gTTS fallback...');
      runGTTSFallback(cleanText, outputPath, function(err2) {
        if (err2) {
          callback(new Error('Both edge-tts and gTTS failed. Install with: pip install edge-tts gtts'));
          return;
        }
        console.log('[tts] gTTS voiceover saved to: ' + outputPath);
        callback(null, outputPath);
      });
      return;
    }
    console.log('[tts] Voiceover saved to: ' + outputPath);
    callback(null, outputPath);
  });
}

// ── CLI entry ──────────────────────────────────────────────────────────────────

if (require.main === module) {
  var args = process.argv.slice(2);
  var channelId = args[0];
  var dryRun = args.indexOf('--dry-run') !== -1;

  if (!channelId) {
    console.error('Usage: node scripts/tts.js <channelId> [--dry-run]');
    process.exit(1);
  }

  generateVoiceover(channelId, dryRun, function(err, outputPath) {
    if (err) {
      console.error('[tts] ERROR:', err.message);
      process.exit(1);
    }
    console.log('[tts] Done:', outputPath || '(dry run)');
  });
}

module.exports = { generateVoiceover: generateVoiceover };
