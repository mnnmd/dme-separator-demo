# DME Separator · Web demo

A web version of the DME Separator Premiere Pro panel. The page shows a simulated editor with four clips preloaded. When the viewer clicks Separate, the server sends the audio to the real separation API and places the returned stems on the timeline.

```
public/index.html        Editor screen + plugin panel (UI)
public/media/            Program video, poster, preview audio for the browser
media/                   WAV sources the server uploads to the API (scene_01..04, full)
api/separate.js          Upload the source, then start one job per stem
api/status.js            Check job status; on success return a signed token
api/download.js          Send the result audio (MP3) to the page
lib/gaudio.js            API calls, multipart upload, tokens, WAV trimming, rate limit
```

The API key exists only in Vercel environment variables. The browser never sees the key or the raw result URLs.

## Deploying (about 10 minutes)

1. **Create a GitHub repo** and push this whole folder.
   ```bash
   cd dme-separator-demo
   git init && git add . && git commit -m "DME Separator web demo"
   git branch -M main
   git remote add origin https://github.com/<username>/dme-separator-demo.git
   git push -u origin main
   ```
2. On **Vercel**, go to Add New → Project and import the repo. Leave Framework Preset as **Other** and leave the build settings empty.
3. Under **Environment Variables**, add:
   | Name | Value | Required |
   |---|---|---|
   | `GAUDIO_API_KEY` | Your API key | Required |
   | `TOKEN_SECRET` | Any long random string | Recommended |
   | `JOBS_PER_IP_PER_DAY` | Daily stem-job limit per visitor (default 40) | Optional |
4. Click **Deploy**. Open the resulting URL and run one separation yourself, for example scene_02 with D only.

If you change an environment variable later, it only takes effect after a Redeploy.

## Testing locally (optional)

```bash
npm i -g vercel
echo "GAUDIO_API_KEY=your-key" > .env.local
vercel dev      # http://localhost:3000
```

## Backup results (optional, recommended)

If the API fails or does not respond during a reviewer's visit, the page looks for saved results in `public/fallback/`. When it finds them, it shows those instead and labels them on screen.

- File names: `<source>_<stem>.mp3`
  - source: `scene_01`, `scene_02`, `scene_03`, `scene_04`, `full` (full = A1 Full Track)
  - stem: `d`, `d2`, `me`, `me2`, `me2_v2`, `m`, `e`
  - Example: `public/fallback/scene_02_d.mp3`, `public/fallback/full_me.mp3`
- These are the same names the plugin produces for `media/scene_02.wav` (`scene_02_d.mp3`). Run the plugin on those files, rename the Full Track outputs to `full_<stem>.mp3`, and place them here.
- Only stems you have saved get a backup. Stems of stems (second-level separation) have no backup.

## Usage and cost

- Every Separate click creates one API job per selected stem.
- The per-visitor limit is best-effort. It lives in server memory and can reset when the server restarts. If the API dashboard lets you set a usage cap, set one there as well.
- Results (tokens) expire after 6 hours. After that, reset the demo and run it again.

## Credits

Sample footage: [Tears of Steel](https://mango.blender.org) by the Blender Foundation, licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Four shots were trimmed and joined for this demo.
