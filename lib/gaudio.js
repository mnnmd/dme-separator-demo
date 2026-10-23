// Shared helpers for the serverless API proxy.
// The API key lives only in the server environment (GAUDIO_API_KEY) and is never sent to the browser.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const API_BASE = (process.env.GAUDIO_API_BASE || "https://restapi.gaudiolab.io/developers/api/v1").replace(/\/$/, "");

// Same stem codes and models as the Premiere plugin (main.js TRACK_MODEL_MAP)
const MODELS = {
  d: "gsep_dme_dtrack_v1",
  d2: "gsep_dme_d2track_v1",
  me: "gsep_dme_metrack_v1",
  me2: "gsep_dme_me2track_v1",
  me2_v2: "gsep_dme_me2track_v2",
  m: "gsep_dme_mtrack_v1",
  e: "gsep_dme_etrack_v1",
};
const DOWNLOAD_KEY = {
  gsep_dme_dtrack_v1: "dtrack",
  gsep_dme_d2track_v1: "d2track",
  gsep_dme_metrack_v1: "metrack",
  gsep_dme_me2track_v1: "me2track",
  gsep_dme_me2track_v2: "me2track",
  gsep_dme_mtrack_v1: "mtrack",
  gsep_dme_etrack_v1: "etrack",
};

// The only files this server will ever upload on its own
const SAMPLES = ["scene_01", "scene_02", "scene_03", "scene_04", "full"];
const MEDIA_DIR = path.join(process.cwd(), "media");

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function apiKey() {
  const k = (process.env.GAUDIO_API_KEY || "").trim();
  if (!k) throw new HttpError(500, "Server is missing GAUDIO_API_KEY.");
  return k;
}

async function gaudio(pathname, { method = "GET", body } = {}) {
  const res = await fetch(API_BASE + pathname, {
    method,
    headers: { "x-ga-apikey": apiKey(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new HttpError(502, `Separation API returned an unreadable response (HTTP ${res.status}).`); }
  if (!res.ok) throw new HttpError(502, `Separation API error ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

// Multipart upload, same three steps as the plugin
async function uploadBuffer(buffer, fileName) {
  const created = await gaudio("/files/upload-multipart/create", { method: "POST", body: { fileName, fileSize: buffer.length } });
  const d = created && created.resultData;
  const urls = d && (d.preSignedUrl || d.preSignedUrls);
  if (!d || !d.uploadId || !urls) throw new HttpError(502, "Upload could not be started.");
  const chunk = d.chunkSize || buffer.length;
  const parts = [];
  for (let i = 0; i < urls.length; i++) {
    const part = buffer.subarray(i * chunk, Math.min((i + 1) * chunk, buffer.length));
    const r = await fetch(urls[i], { method: "PUT", body: part, headers: { "Content-Length": String(part.length) } });
    if (!r.ok) throw new HttpError(502, `Upload part ${i + 1} failed (HTTP ${r.status}).`);
    parts.push({ awsETag: (r.headers.get("etag") || "").replace(/"/g, ""), partNumber: i + 1 });
  }
  await gaudio("/files/upload-multipart/complete", { method: "POST", body: { uploadId: d.uploadId, parts } });
  return d.uploadId;
}

// ---------- signed tokens for result files ----------
// The browser only ever holds an opaque token; the server checks the signature before touching any URL.
function secret() {
  return process.env.TOKEN_SECRET || crypto.createHash("sha256").update("dme-demo:" + apiKey()).digest("hex");
}
const b64u = (b) => Buffer.from(b).toString("base64url");
function sign(payload) {
  const body = b64u(JSON.stringify({ ...payload, exp: Date.now() + 1000 * 60 * 60 * 6 }));
  const mac = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function verify(token) {
  if (typeof token !== "string" || !token.includes(".")) throw new HttpError(400, "Invalid result token.");
  const [body, mac] = token.split(".");
  const want = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) throw new HttpError(400, "Invalid result token.");
  const data = JSON.parse(Buffer.from(body, "base64url").toString());
  if (data.exp < Date.now()) throw new HttpError(410, "This result has expired. Reset the demo and run it again.");
  return data;
}

// ---------- WAV trimming (PCM), used to separate part of an earlier result ----------
function trimWav(buf, startSec, endSec) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new HttpError(422, "Result is not a WAV file, so it cannot be trimmed.");
  let off = 12, fmt = null, dataOff = -1, dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4), size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") fmt = buf.subarray(off + 8, off + 8 + size);
    if (id === "data") { dataOff = off + 8; dataLen = Math.min(size, buf.length - dataOff); break; }
    off += 8 + size + (size % 2);
  }
  if (!fmt || dataOff < 0) throw new HttpError(422, "WAV file is missing its format or data section.");
  const rate = fmt.readUInt32LE(4), block = fmt.readUInt16LE(12);
  const s = Math.max(0, Math.floor(startSec * rate)) * block;
  const e = Math.min(dataLen, Math.ceil(endSec * rate) * block);
  if (e <= s) throw new HttpError(400, "Requested range is empty.");
  const data = buf.subarray(dataOff + s, dataOff + e);
  const head = Buffer.alloc(12 + 8 + fmt.length + 8);
  head.write("RIFF", 0); head.writeUInt32LE(head.length - 8 + data.length, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(fmt.length, 16); fmt.copy(head, 20);
  const d = 20 + fmt.length; head.write("data", d); head.writeUInt32LE(data.length, d + 4);
  return Buffer.concat([head, data]);
}

async function fetchBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new HttpError(502, `Could not fetch the earlier result (HTTP ${r.status}).`);
  return Buffer.from(await r.arrayBuffer());
}

// ---------- best-effort rate limit (per server instance) ----------
const hits = new Map();
function rateLimit(req, cost) {
  const limit = parseInt(process.env.JOBS_PER_IP_PER_DAY || "40", 10);
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const day = new Date().toISOString().slice(0, 10);
  const key = ip + "|" + day;
  const used = hits.get(key) || 0;
  if (used + cost > limit) throw new HttpError(429, `Daily limit reached for this demo (${limit} stem jobs per visitor). Try again tomorrow.`);
  hits.set(key, used + cost);
}

function readSample(id) {
  if (!SAMPLES.includes(id)) throw new HttpError(400, "Unknown sample.");
  return fs.readFileSync(path.join(MEDIA_DIR, `${id}.wav`));
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}
function handle(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) { send(res, e.status || 500, { error: e.status ? e.message : "Unexpected server error." }); if (!e.status) console.error(e); }
  };
}

module.exports = { MODELS, DOWNLOAD_KEY, HttpError, gaudio, uploadBuffer, sign, verify, trimWav, fetchBuffer, rateLimit, readSample, send, handle };
