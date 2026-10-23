// GET /api/download?token=...
// Streams a separated stem back to the page for playback. Prefers MP3 to stay under
// the serverless response size limit; WAV is used only if the API returned no MP3.
const { HttpError, verify, handle } = require("../lib/gaudio");

module.exports = handle(async (req, res) => {
  const r = verify((req.query || {}).token);
  const url = r.mp3 || r.wav;
  if (!url) throw new HttpError(404, "No file for this result.");
  const up = await fetch(url);
  if (!up.ok) throw new HttpError(502, `Could not fetch the result (HTTP ${up.status}).`);
  const buf = Buffer.from(await up.arrayBuffer());
  if (buf.length > 4.4 * 1024 * 1024) throw new HttpError(413, "Result is too large to preview in the browser.");
  res.statusCode = 200;
  res.setHeader("Content-Type", r.mp3 ? "audio/mpeg" : "audio/wav");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.end(buf);
});
