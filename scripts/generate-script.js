/**
 * generate-script.js
 * Generates a video script for a given channel using the topic queue + template system.
 * Usage: node scripts/generate-script.js <channelId> [--dry-run]
 *
 * ES5 style — var/function only, no arrows/const/let
 */

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');

function loadConfig() {
  var raw = fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8');
  return JSON.parse(raw);
}

function loadTopics(channelId) {
  var topicsPath = path.join(ROOT, 'channels', channelId, 'topics.json');
  var raw = fs.readFileSync(topicsPath, 'utf8');
  return JSON.parse(raw);
}

function saveTopics(channelId, topicsData) {
  var topicsPath = path.join(ROOT, 'channels', channelId, 'topics.json');
  fs.writeFileSync(topicsPath, JSON.stringify(topicsData, null, 2), 'utf8');
}

function ensureTempDir(channelId) {
  var dir = path.join(ROOT, 'temp', channelId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// ── Template builders per channel ─────────────────────────────────────────────

function buildStoicScript(topic) {
  var lines = [];
  lines.push('--- IRONMIND | Daily Stoic Wisdom ---');
  lines.push('');
  lines.push('[INTRO]');
  lines.push(topic.title + '.');
  lines.push('');
  lines.push('[PHILOSOPHER]');
  lines.push('Today\'s wisdom comes from ' + (topic.philosopher || 'the Stoics') + '.');
  lines.push('');
  lines.push('[QUOTE]');
  lines.push('"' + topic.quote + '"');
  lines.push('');
  lines.push('[BODY]');
  lines.push(topic.body);
  lines.push('');
  lines.push('[TAKEAWAY]');
  lines.push('Take this with you:');
  lines.push(topic.takeaway);
  lines.push('');
  lines.push('[OUTRO]');
  lines.push('Subscribe to Ironmind for daily Stoic wisdom. A new lesson, every single day.');
  return lines.join('\n');
}

function buildDarkHistoryScript(topic) {
  var lines = [];
  lines.push('--- THE BLACK LEDGER ---');
  lines.push('');
  lines.push('[HOOK]');
  lines.push('History has a dark side. What you are about to hear is true.');
  lines.push(topic.title + '.');
  lines.push('');
  lines.push('[BODY]');
  lines.push(topic.body || generateBodyPlaceholder(topic.title, 'dark history'));
  lines.push('');
  lines.push('[CONTEXT]');
  lines.push('This chapter of history is largely forgotten. But forgetting history means repeating it.');
  lines.push('');
  lines.push('[OUTRO]');
  lines.push('Subscribe to The Black Ledger. Every video is a page of history they did not want you to read.');
  return lines.join('\n');
}

function buildPsychFactsScript(topic) {
  var lines = [];
  lines.push('--- BRAIN GLITCH | 60-Second Psychology ---');
  lines.push('');
  lines.push('[HOOK - 5 seconds]');
  lines.push('Did you know ' + (topic.hook || topic.title) + '?');
  lines.push('');
  lines.push('[FACT - 15 seconds]');
  lines.push('Here is the science: ' + (topic.fact || ''));
  lines.push('');
  lines.push('[EXPLANATION - 30 seconds]');
  lines.push('The reason this happens: ' + (topic.explanation || ''));
  lines.push('');
  lines.push('[CTA - 10 seconds]');
  lines.push('Now you know. Follow Brain Glitch for more psychology facts that will change how you see the world.');
  return lines.join('\n');
}

function buildSciExplainedScript(topic) {
  var lines = [];
  lines.push('--- FISSION | Science in 60 Seconds ---');
  lines.push('');
  lines.push('[HOOK - 5 seconds]');
  lines.push(topic.hook || topic.title + '.');
  lines.push('');
  lines.push('[FACT - 15 seconds]');
  lines.push(topic.fact || '');
  lines.push('');
  lines.push('[EXPLANATION - 30 seconds]');
  lines.push(topic.explanation || '');
  lines.push('');
  lines.push('[CTA - 10 seconds]');
  lines.push('That is the science. Subscribe to Fission for science explained fast, every day.');
  return lines.join('\n');
}

function buildTrueCrimeScript(topic) {
  var lines = [];
  lines.push('--- COLD FILES ---');
  lines.push('');
  lines.push('[SAFETY NOTE - DO NOT READ ALOUD]');
  lines.push('All cases in Cold Files involve convicted perpetrators only.');
  lines.push('');
  lines.push('[HOOK]');
  lines.push(topic.title + '.');
  lines.push('This is not a cold case. This is a closed one. But the details have never been told like this.');
  lines.push('');
  lines.push('[BODY]');
  lines.push(topic.body || generateBodyPlaceholder(topic.title, 'true crime'));
  lines.push('');
  lines.push('[RESOLUTION]');
  lines.push(topic.resolution || 'The case was ultimately solved and the perpetrator was convicted.');
  lines.push('');
  lines.push('[OUTRO]');
  lines.push('Subscribe to Cold Files. Every case is closed. Every story is real.');
  lines.push('');
  lines.push('[LEGAL FOOTER - INCLUDE IN DESCRIPTION ONLY]');
  lines.push('This content is for educational and entertainment purposes only. All information is sourced from publicly available records.');
  return lines.join('\n');
}

function buildTechNewsScript(topic) {
  var lines = [];
  lines.push('--- THE STACK | AI & Tech Weekly ---');
  lines.push('');
  lines.push('[INTRO]');
  lines.push('This week in tech: ' + topic.title + '.');
  lines.push('');
  lines.push('[CONTEXT]');
  lines.push(topic.context || generateBodyPlaceholder(topic.title, 'technology and AI'));
  lines.push('');
  lines.push('[ANALYSIS]');
  lines.push(topic.analysis || 'Here is what this means for the industry and for you.');
  lines.push('');
  lines.push('[WHAT TO WATCH]');
  lines.push('Keep an eye on this space. The next development is already in motion.');
  lines.push('');
  lines.push('[OUTRO]');
  lines.push('That is The Stack. Hit subscribe for your weekly dose of AI and tech, every week, no fluff.');
  return lines.join('\n');
}

function buildLifeHacksScript(topic) {
  var lines = [];
  lines.push('--- UNBLOCKED | Student Life Hacks in 60s ---');
  lines.push('');
  lines.push('[HOOK - 5 seconds]');
  lines.push(topic.hook || topic.title + '.');
  lines.push('');
  lines.push('[THE HACK - 20 seconds]');
  lines.push(topic.fact || '');
  lines.push('');
  lines.push('[WHY IT WORKS - 25 seconds]');
  lines.push(topic.explanation || '');
  lines.push('');
  lines.push('[CTA - 10 seconds]');
  lines.push('Try it today. Subscribe to Unblocked for a new student life hack every single day.');
  return lines.join('\n');
}

function buildMythologyScript(topic) {
  var lines = [];
  lines.push('--- THE OLD GODS ---');
  lines.push('');
  lines.push('[COLD OPEN]');
  lines.push(topic.hook || topic.title + '.');
  lines.push('');
  lines.push('[PANTHEON]');
  lines.push('This is a story from ' + (topic.pantheon || 'ancient mythology') + '.');
  lines.push('');
  lines.push('[THE MYTH]');
  lines.push(topic.body || generateBodyPlaceholder(topic.title, 'mythology'));
  lines.push('');
  lines.push('[WHAT IT MEANS]');
  lines.push(topic.meaning || 'Every myth survived for a reason. This one has been telling us something for thousands of years.');
  lines.push('');
  lines.push('[OUTRO]');
  lines.push('Subscribe to The Old Gods. New myth. Every video.');
  return lines.join('\n');
}

function generateBodyPlaceholder(title, niche) {
  return '[BODY CONTENT FOR: ' + title + ']\n' +
    '[Research this ' + niche + ' topic and expand with 3-5 detailed paragraphs.]\n' +
    '[Target length: 800-1200 words for longform, 100-150 words for shorts.]';
}

// ── Template dispatcher ────────────────────────────────────────────────────────

var TEMPLATE_MAP = {
  'stoic': buildStoicScript,
  'darkhistory': buildDarkHistoryScript,
  'psychfacts': buildPsychFactsScript,
  'sciexplained': buildSciExplainedScript,
  'truecrime': buildTrueCrimeScript,
  'technews': buildTechNewsScript,
  'lifehacks': buildLifeHacksScript,
  'mythology': buildMythologyScript
};

function generateScript(channelId, dryRun) {
  console.log('[generate-script] Channel: ' + channelId);

  var config = loadConfig();
  var channelConfig = config.channels[channelId];
  if (!channelConfig) {
    throw new Error('Unknown channel: ' + channelId);
  }

  var topicsData = loadTopics(channelId);
  var topics = topicsData.topics;
  if (!topics || topics.length === 0) {
    throw new Error('No topics found for channel: ' + channelId);
  }

  // Pop the first topic, rotate to end
  var topic = topics.shift();
  topics.push(topic);

  console.log('[generate-script] Topic: ' + topic.title);

  var builder = TEMPLATE_MAP[channelId];
  if (!builder) {
    throw new Error('No template builder for channel: ' + channelId);
  }

  var scriptText = builder(topic);

  // Add universal description footer to script metadata
  var metadata = {
    channelId: channelId,
    channelName: channelConfig.name,
    title: topic.title,
    keywords: topic.keywords || [],
    format: channelConfig.format,
    voiceId: channelConfig.voiceId,
    tags: channelConfig.tags,
    category: channelConfig.category,
    description: channelConfig.description + config.descriptionFooter,
    generatedAt: new Date().toISOString()
  };

  if (!dryRun) {
    // Save script to temp dir
    var tempDir = ensureTempDir(channelId);
    fs.writeFileSync(path.join(tempDir, 'script.txt'), scriptText, 'utf8');
    fs.writeFileSync(path.join(tempDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
    // Rotate the topic queue
    saveTopics(channelId, topicsData);
    console.log('[generate-script] Script saved to temp/' + channelId + '/script.txt');
  } else {
    console.log('[generate-script] DRY RUN — script not saved, topic queue not rotated');
    console.log('');
    console.log('=== GENERATED SCRIPT ===');
    console.log(scriptText);
    console.log('');
    console.log('=== METADATA ===');
    console.log(JSON.stringify(metadata, null, 2));
  }

  return { topic: topic, script: scriptText, metadata: metadata };
}

// ── CLI entry ──────────────────────────────────────────────────────────────────

if (require.main === module) {
  var args = process.argv.slice(2);
  var channelId = args[0];
  var dryRun = args.indexOf('--dry-run') !== -1;

  if (!channelId) {
    console.error('Usage: node scripts/generate-script.js <channelId> [--dry-run]');
    console.error('Channels: stoic, darkhistory, psychfacts, sciexplained, truecrime, technews, lifehacks, mythology');
    process.exit(1);
  }

  try {
    generateScript(channelId, dryRun);
  } catch (err) {
    console.error('[generate-script] ERROR:', err.message);
    process.exit(1);
  }
}

module.exports = { generateScript: generateScript };
