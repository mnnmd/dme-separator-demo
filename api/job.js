// POST /api/job
// body: { upload, stem }   upload = token from /api/separate, stem = "d" | "d2" | "me" | ...
// Starts one separation job and returns { model, jobId } for polling with /api/status.
const { MODELS, HttpError, gaudio, verify, rateLimit, send, handle } = require("../lib/gaudio");

module.exports = handle(async (req, res) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST.");
  const { upload, stem } = req.body || {};
  const model = MODELS[stem];
  if (!model) throw new HttpError(400, `Unknown stem: ${stem}`);
  const { uploadId } = verify(upload);
  if (!uploadId) throw new HttpError(400, "Invalid upload token.");
  rateLimit(req, 1);
  const j = await gaudio(`/${model}/jobs`, { method: "POST", body: { audioUploadId: uploadId } });
  const jobId = j && j.resultData && j.resultData.jobId;
  if (!jobId) {
    // Surface what the API actually said so problems can be diagnosed from the page
    const detail = JSON.stringify(j).slice(0, 300);
    throw new HttpError(502, `Separation API did not start ${model}. Response: ${detail}`);
  }
  send(res, 200, { model, jobId });
});
