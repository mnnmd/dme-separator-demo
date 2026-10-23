// POST /api/separate
// body: { source }
//   source = { type: "sample", id: "scene_01" | ... | "full" }
//          | { type: "result", token, start?, end? }   (start/end in seconds within that result file)
// Uploads the source and returns a signed upload token. Jobs are then created one stem
// at a time through /api/job, the same order the Premiere plugin uses.
const { HttpError, uploadBuffer, sign, verify, trimWav, fetchBuffer, readSample, send, handle } = require("../lib/gaudio");

async function sourceBuffer(source) {
  if (source.type === "sample") return { buf: readSample(source.id), name: source.id };
  if (source.type === "result") {
    const r = verify(source.token);
    const url = r.wav || r.mp3;
    if (!url) throw new HttpError(400, "Earlier result has no downloadable file.");
    let buf = await fetchBuffer(url);
    if (typeof source.start === "number" && typeof source.end === "number") {
      if (!r.wav) throw new HttpError(422, "Only WAV results can be trimmed.");
      buf = trimWav(buf, source.start, source.end);
    }
    return { buf, name: r.name || "result" };
  }
  throw new HttpError(400, "Unknown source type.");
}

module.exports = handle(async (req, res) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST.");
  const { source } = req.body || {};
  if (!source) throw new HttpError(400, "Missing source.");
  const { buf, name } = await sourceBuffer(source);
  const uploadId = await uploadBuffer(buf, `${name}.wav`);
  send(res, 200, { upload: sign({ uploadId }) });
});
