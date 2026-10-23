// POST /api/separate
// body: { source, stems: ["d","me",...] }
//   source = { type: "sample", id: "scene_01" | ... | "full" }
//          | { type: "result", token, start?, end? }   (start/end in seconds within that result file)
// Uploads the source once, then starts one job per stem. Returns the job ids for polling.
const { MODELS, HttpError, gaudio, uploadBuffer, verify, trimWav, fetchBuffer, rateLimit, readSample, send, handle } = require("../lib/gaudio");

const sampleUploads = new Map(); // warm-instance cache: sample id -> uploadId

async function uploadSource(source) {
  if (source.type === "sample") {
    if (sampleUploads.has(source.id)) return { uploadId: sampleUploads.get(source.id), cached: true };
    const id = await uploadBuffer(readSample(source.id), `${source.id}.wav`);
    sampleUploads.set(source.id, id);
    return { uploadId: id, cached: false };
  }
  if (source.type === "result") {
    const r = verify(source.token);
    const url = r.wav || r.mp3;
    if (!url) throw new HttpError(400, "Earlier result has no downloadable file.");
    let buf = await fetchBuffer(url);
    const trim = typeof source.start === "number" && typeof source.end === "number";
    if (trim) {
      if (!r.wav) throw new HttpError(422, "Only WAV results can be trimmed.");
      buf = trimWav(buf, source.start, source.end);
    }
    return { uploadId: await uploadBuffer(buf, `${r.name || "result"}.wav`), cached: false };
  }
  throw new HttpError(400, "Unknown source type.");
}

async function createJobs(uploadId, models) {
  return Promise.all(models.map(async (model) => {
    const j = await gaudio(`/${model}/jobs`, { method: "POST", body: { audioUploadId: uploadId } });
    const jobId = j && j.resultData && j.resultData.jobId;
    if (!jobId) throw new HttpError(502, `Separation API did not return a job for ${model}.`);
    return { model, jobId };
  }));
}

module.exports = handle(async (req, res) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST.");
  const { source, stems } = req.body || {};
  if (!source || !Array.isArray(stems) || !stems.length || stems.length > 7) throw new HttpError(400, "Choose between 1 and 7 stems.");
  const models = stems.map((s) => { if (!MODELS[s]) throw new HttpError(400, `Unknown stem: ${s}`); return MODELS[s]; });
  rateLimit(req, models.length);

  let up = await uploadSource(source);
  let jobs;
  try { jobs = await createJobs(up.uploadId, models); }
  catch (e) {
    // A cached upload may have expired on the API side: upload again once.
    if (!up.cached) throw e;
    sampleUploads.delete(source.id);
    up = await uploadSource(source);
    jobs = await createJobs(up.uploadId, models);
  }
  send(res, 200, { jobs: jobs.map((j, i) => ({ stem: stems[i], ...j })) });
});
