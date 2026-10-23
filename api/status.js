// GET /api/status?model=gsep_dme_dtrack_v1&jobId=...&name=scene_01_d
// Returns { status: "processing" | "success" | "failed", token? }.
// On success the result URLs are wrapped in a signed token so the browser never sees or chooses raw URLs.
const { MODELS, DOWNLOAD_KEY, HttpError, gaudio, sign, send, handle } = require("../lib/gaudio");

module.exports = handle(async (req, res) => {
  const { model, jobId, name } = req.query || {};
  if (!Object.values(MODELS).includes(model)) throw new HttpError(400, "Unknown model.");
  // Accept whatever id format the API uses; only reject characters that could change the request path
  if (!jobId || String(jobId).length > 512 || /[\/?#\s\\]/.test(String(jobId))) throw new HttpError(400, "Invalid job id.");
  const j = await gaudio(`/${model}/jobs/${encodeURIComponent(jobId)}`);
  const d = (j && j.resultData) || {};
  if (d.status === "failed") return send(res, 200, { status: "failed" });
  if (d.status !== "success") return send(res, 200, { status: d.status || "processing" });
  const urls = d.downloadUrl && d.downloadUrl[DOWNLOAD_KEY[model]];
  if (!urls) throw new HttpError(502, "Job finished but no download link was returned.");
  send(res, 200, { status: "success", token: sign({ wav: urls.wav || null, mp3: urls.mp3 || null, name: String(name || "result").slice(0, 80) }) });
});
