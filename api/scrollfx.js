// Scroll FX (exploded-view) proxy — powers the Dasby Sites "Scroll FX" Pro add-on.
// Runs the full pipeline server-side on your Higgsfield Cloud key so the client's
// browser never sees it: assembled still -> exploded still -> first/last-frame
// disassembly video. Returns a video URL the tool turns into a scroll-scrub section.
//
// Because a full render takes minutes (well past the 60s serverless limit), this is
// ACTION-BASED and the client polls:
//   POST { action:'create', product, parts:[], style:'exploded' }
//        -> { jobId }                       (kicks off images+video, returns immediately)
//   POST { action:'poll', jobId }
//        -> { status } | { video, poster } | { error }
//
// SETUP (Vercel env vars)
//   HF_CREDENTIALS  = KEY_ID:KEY_SECRET        (same key api/higgsfield.js already uses)
//   SFX_IMG_MODEL   = higgsfield-ai/soul/standard          (text/image-to-image model)
//   SFX_VIDEO_MODEL = <video model path>       (first/last-frame model on your plan)
//   SFX_KV_URL, SFX_KV_TOKEN                    (optional Upstash Redis REST for job state;
//                                               if unset, falls back to stateless single-call)
//   ALLOW_ORIGIN    = *
//
// NOTE: the exact video model path depends on what your Higgsfield Cloud plan exposes.
// Set SFX_VIDEO_MODEL once confirmed; until then 'create' returns { error:'video_model_unset' }
// and the tool gracefully falls back to samples / paste-a-clip.

const BASE = 'https://platform.higgsfield.ai';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function hfHeaders() {
  return { Authorization: 'Key ' + process.env.HF_CREDENTIALS, 'Content-Type': 'application/json', Accept: 'application/json' };
}
const pickUrl = (d) => (d && d.images && d.images[0] && d.images[0].url) ||
                       (d && d.image && d.image.url) ||
                       (d && d.video && d.video.url) ||
                       (d && d.videos && d.videos[0] && d.videos[0].url) ||
                       (d && d.results && d.results.raw && d.results.raw.url) || null;

// Submit a generation, return { requestId, statusUrl, done?, url? }.
async function submit(model, payload) {
  const r = await fetch(`${BASE}/${model}`, { method: 'POST', headers: hfHeaders(), body: JSON.stringify(payload) });
  let d = {}; try { d = await r.json(); } catch (_) {}
  if (!r.ok) throw new Error((d && (d.message || d.detail || d.error)) || ('HTTP ' + r.status));
  const url = pickUrl(d);
  if (d.status === 'completed' || url) return { done: true, url };
  const statusUrl = d.status_url || (d.request_id ? `${BASE}/requests/${d.request_id}/status` : null);
  if (!statusUrl) throw new Error('no_status_url');
  return { done: false, requestId: d.request_id, statusUrl };
}
// Poll one status URL to completion (bounded).
async function poll(statusUrl, budgetMs) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const st = await fetch(statusUrl, { headers: hfHeaders() });
    let cur = {}; try { cur = await st.json(); } catch (_) {}
    const s = cur && cur.status, url = pickUrl(cur);
    if (s === 'completed' || url) { if (!url) throw new Error('no_result_url'); return url; }
    if (s === 'failed' || s === 'nsfw' || s === 'canceled') throw new Error(s);
  }
  return null; // still running
}

// --- optional tiny job store (Upstash Redis REST) so 'create' can return fast ---
async function kvSet(key, val) {
  if (!process.env.SFX_KV_URL) return false;
  await fetch(`${process.env.SFX_KV_URL}/set/${encodeURIComponent(key)}?EX=3600`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.SFX_KV_TOKEN }, body: JSON.stringify(val),
  });
  return true;
}
async function kvGet(key) {
  if (!process.env.SFX_KV_URL) return null;
  const r = await fetch(`${process.env.SFX_KV_URL}/get/${encodeURIComponent(key)}`, { headers: { Authorization: 'Bearer ' + process.env.SFX_KV_TOKEN } });
  const j = await r.json().catch(() => ({}));
  try { return j && j.result ? JSON.parse(j.result) : null; } catch (_) { return null; }
}

const IMG = () => process.env.SFX_IMG_MODEL || 'higgsfield-ai/soul/standard';
const VIDEO = () => process.env.SFX_VIDEO_MODEL || '';

function assembledPrompt(product) {
  return `Photorealistic ${product}, perfectly centered floating on a clean light gray seamless studio background, premium product photography, soft studio lighting, ultra sharp detail, three-quarter angle, no visible brand logos`;
}
function explodedPrompt(product, parts) {
  const p = (parts && parts.length) ? parts.join(', ') : 'main components';
  return `Exploded technical teardown view of this exact ${product}: its ${p} separated and floating apart in mid-air, evenly spaced like an engineering diagram, precise clean disassembly, identical light gray seamless studio background, identical soft studio lighting, same angle, ultra sharp detail, no visible brand logos`;
}
function videoPrompt(product) {
  return `Product exploded-view teardown animation. The ${product} starts fully assembled, then smoothly comes apart into its parts as a floating engineering diagram with elegant precise motion. Camera locked and static, product centered, clean studio background, no people.`;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.HF_CREDENTIALS) return res.status(500).json({ error: 'HF_CREDENTIALS not set' });

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch (_) {}
  const action = body.action || 'create';

  try {
    if (action === 'poll') {
      const job = await kvGet('sfx:' + body.jobId);
      if (!job) return res.status(200).json({ error: 'unknown_job' });
      if (job.video) return res.status(200).json({ video: job.video, poster: job.poster || '' });
      if (job.statusUrl) {
        const url = await poll(job.statusUrl, 45000);
        if (url) { job.video = url; await kvSet('sfx:' + body.jobId, job); return res.status(200).json({ video: url, poster: job.poster || '' }); }
        return res.status(200).json({ status: 'rendering' });
      }
      return res.status(200).json({ status: 'rendering' });
    }

    // action === 'create'
    if (!VIDEO()) return res.status(200).json({ error: 'video_model_unset' });
    const product = String(body.product || '').trim();
    if (!product) return res.status(400).json({ error: 'product required' });
    const parts = Array.isArray(body.parts) ? body.parts.map(String).slice(0, 6) : [];
    const ar = '16:9';

    // 1) assembled still
    let a = await submit(IMG(), { prompt: assembledPrompt(product), aspect_ratio: ar, resolution: '720p' });
    const assembledUrl = a.done ? a.url : await poll(a.statusUrl, 45000);
    if (!assembledUrl) return res.status(200).json({ error: 'assembled_timeout' });

    // 2) exploded still (references the assembled frame)
    let e = await submit(IMG(), { prompt: explodedPrompt(product, parts), image: assembledUrl, aspect_ratio: ar, resolution: '720p' });
    const explodedUrl = e.done ? e.url : await poll(e.statusUrl, 45000);
    if (!explodedUrl) return res.status(200).json({ error: 'exploded_timeout' });

    // 3) first/last-frame disassembly video (submit, return jobId; client polls)
    const v = await submit(VIDEO(), {
      prompt: videoPrompt(product),
      start_image: assembledUrl,
      end_image: explodedUrl,
      aspect_ratio: ar,
      duration: 5,
      generate_audio: false,
    });
    if (v.done && v.url) return res.status(200).json({ video: v.url, poster: assembledUrl });

    const jobId = (v.requestId || ('j' + Math.abs(hashStr(assembledUrl + Date.now())).toString(36)));
    const stored = await kvSet('sfx:' + jobId, { statusUrl: v.statusUrl, poster: assembledUrl });
    if (!stored) {
      // No KV store configured — poll inline within the remaining budget as a best effort.
      const url = await poll(v.statusUrl, 45000);
      if (url) return res.status(200).json({ video: url, poster: assembledUrl });
      return res.status(200).json({ error: 'no_kv_store', hint: 'set SFX_KV_URL/SFX_KV_TOKEN so create can return a jobId to poll' });
    }
    return res.status(200).json({ jobId, poster: assembledUrl });
  } catch (err) {
    return res.status(200).json({ error: err && err.message ? err.message : 'error' });
  }
};

function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return h; }
