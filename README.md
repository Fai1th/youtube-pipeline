# YouTube Pipeline 🎬

Fully automated faceless YouTube channel pipeline for **8 channels**. Generates scripts, synthesizes voiceovers, sources stock footage, assembles videos with FFmpeg, and uploads to YouTube — all free.

## Channels

| Channel | Folder | Format | Voice |
|---------|--------|--------|-------|
| **Ironmind** | `stoic` | Longform 3-5min | GuyNeural |
| **The Black Ledger** | `darkhistory` | Longform 8-12min | GuyNeural |
| **Brain Glitch** | `psychfacts` | Shorts 60s | JennyNeural |
| **Fission** | `sciexplained` | Shorts 60s | JennyNeural |
| **Cold Files** | `truecrime` | Longform 10-15min | GuyNeural |
| **The Stack** | `technews` | Longform 5min | DavisNeural |
| **Unblocked** | `lifehacks` | Shorts 60s | JennyNeural |
| **The Old Gods** | `mythology` | Longform 8-12min | GuyNeural |

---

## Setup

### 1. Install Node dependencies

```bash
cd youtube-pipeline
npm install
```

### 2. Install Python TTS tools

```bash
pip install edge-tts
pip install gtts        # fallback only
```

Test edge-tts works:
```bash
python -m edge_tts --voice en-US-GuyNeural --text "Hello world" --write-media test.mp3
```

### 3. Get a free Pexels API key

1. Go to [pexels.com/api](https://www.pexels.com/api/)
2. Create a free account → request API access
3. Copy your API key
4. Open `config.json` and replace `YOUR_PEXELS_API_KEY` with your key

**Free tier limits:** 200 requests/hour, 20,000/month — plenty for 8 videos/day.

### 4. Set up YouTube channels (one-time per channel)

For **each** of the 8 channels:

1. **Create the YouTube channel** (or use an existing Google account with YouTube)

2. **Enable YouTube Data API v3:**
   - Go to [console.cloud.google.com](https://console.cloud.google.com)
   - Create a new project (e.g., "YouTube Pipeline")
   - Search for "YouTube Data API v3" → Enable it

3. **Create OAuth 2.0 credentials:**
   - Go to APIs & Services → Credentials
   - Create Credentials → OAuth 2.0 Client ID
   - Application type: **Desktop app**
   - Download the JSON file

4. **Save credentials:**
   ```
   channels/stoic/credentials.json       ← rename your downloaded file
   channels/darkhistory/credentials.json
   channels/psychfacts/credentials.json
   channels/sciexplained/credentials.json
   channels/truecrime/credentials.json
   channels/technews/credentials.json
   channels/lifehacks/credentials.json
   channels/mythology/credentials.json
   ```

5. **First run authorization** (one-time per channel):
   ```bash
   node scripts/upload-youtube.js stoic
   ```
   It will print a URL. Open it, authorize the app, paste the code back. Token is saved automatically to `channels/stoic/token.json`.

6. **Add YouTube Channel IDs** to `config.json`:
   - Go to your YouTube channel → About → Share → Copy channel link
   - Extract the channel ID (starts with `UC...`)
   - Add to `config.channels.stoic.youtubeChannelId`

---

## Running the Pipeline

### Single channel
```bash
node scripts/run-channel.js stoic
```

### All 8 channels
```bash
node scripts/run-all.js
```

### Dry run (test without writing files or uploading)
```bash
node scripts/run-channel.js stoic --dry-run
node scripts/run-all.js --dry-run
```

### Generate & assemble only (skip YouTube upload)
```bash
node scripts/run-channel.js stoic --skip-upload
```

### Individual steps
```bash
node scripts/generate-script.js stoic
node scripts/tts.js stoic
node scripts/fetch-footage.js stoic
node scripts/assemble-video.js stoic
node scripts/upload-youtube.js stoic
```

---

## Privacy Settings

Videos are uploaded as **private** by default so you can review before publishing.

To change the default, edit `config.json`:
```json
"defaultPrivacy": "private"   ← change to "public" when ready
```

You can also publish from YouTube Studio manually after reviewing.

---

## Output Structure

```
output/
  stoic/
    Marcus_Aurelius_on_dealing_with_difficult_2025-01-15T10-30-00.mp4
  darkhistory/
    The_Radium_Girls_women_who_glowed_2025-01-15T10-45-00.mp4
  ...

channels/
  stoic/
    topics.json           ← 30-topic rotating queue
    credentials.json      ← gitignored (your OAuth credentials)
    token.json            ← gitignored (auto-managed OAuth token)
    upload-log.json       ← history of all uploads (video ID, URL, title)
```

---

## Video Format

**Longform channels** (stoic, darkhistory, truecrime, technews, mythology):
- Resolution: 1920×1080 (16:9)
- Codec: H.264 + AAC
- Structure: 3s title card → footage + voiceover → 5s outro

**Shorts channels** (psychfacts, sciexplained, lifehacks):
- Resolution: 1080×1920 (9:16)
- Max duration: 60s
- Same structure, portrait crop

---

## Legal & Safety Rules

All channels follow these rules automatically:

1. **Every video description includes:**
   > *This content is for educational and entertainment purposes only. All information is sourced from publicly available records.*
   > *Background music via YouTube Audio Library (free, no Content ID claims).*

2. **Cold Files (true crime):** Only covers cases with convicted perpetrators — no speculation on living unproven suspects. See `channels/truecrime/topics.json` → `safetyNote`.

3. **Ironmind (stoic):** Uses paraphrased public-domain translations (pre-1928) to avoid modern copyright claims. See `config.json` → `safetyNote`.

4. **Music:** All music references point to [YouTube Audio Library](https://studio.youtube.com/channel/UCmusic) — royalty-free, no Content ID claims.

---

## Topic Queues

Each channel has 30 pre-loaded topics in `channels/<id>/topics.json`. Topics rotate automatically — the first topic moves to the end after each video is generated, so you cycle through them indefinitely.

To add new topics, just append to the `topics` array in the JSON file.

---

## Troubleshooting

**edge-tts not found:**
```bash
pip install edge-tts
# Or try:
pip3 install edge-tts
python -m edge_tts --help
```

**FFmpeg not found:**
- Ensure FFmpeg is installed and on your PATH: `ffmpeg -version`
- Windows: Download from [ffmpeg.org](https://ffmpeg.org/download.html) → add to PATH

**Pexels API 401:**
- Check your API key in `config.json`

**YouTube upload 403:**
- Make sure YouTube Data API v3 is enabled in your Google Cloud project
- Delete `token.json` and re-authorize if credentials changed

**No footage downloaded:**
- Some keywords return no portrait/landscape videos — the script tries all keywords in order
- Try broader keywords in `metadata.json` or `topics.json`

---

## Architecture

```
run-all.js
  └─ run-channel.js (x8, sequential)
       ├─ generate-script.js   → temp/{channel}/script.txt + metadata.json
       ├─ tts.js               → temp/{channel}/voice.mp3
       ├─ fetch-footage.js     → temp/{channel}/footage/clip1.mp4 ...
       ├─ assemble-video.js    → output/{channel}/VideoTitle_timestamp.mp4
       └─ upload-youtube.js    → channels/{channel}/upload-log.json
```

---

*Built by Fai1th. All APIs used are free tier.*
