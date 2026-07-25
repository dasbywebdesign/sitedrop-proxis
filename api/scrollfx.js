// Scroll FX proxy — turns a PHOTO into a scroll-scrubbed motion clip via fal.ai (FAL_KEY).
// Rewired from the never-completed Higgsfield video path to fal's queue API, which makes
// this work end-to-end for the first time. Stateless: the jobId encodes the fal request,
// so no Redis/KV is needed.
//
//   POST { action:'create', mode:'cinematic', image:'<url or data-uri>', motion? }
//        -> { jobId, poster }        (queues a Kling image-to-video render; ~$0.35/5s clip)
//   POST { action:'create', mode:'exploded', image:'<product photo url/data-uri>', product, parts:[] }
//        -> { jobId, poster }        (synthesizes the exploded end-frame from the photo via
//                                     Flux Kontext, then queues a first→last-frame Kling render)
//   POST { action:'poll', jobId }
//        -> { status:'rendering' } | { video, poster } | { error }
//
// Env: FAL_KEY (required). Optional overrides:
//   SFX_VIDEO_MODEL  (default fal-ai/kling-video/v2.1/standard/image-to-video)
//   SFX_TAIL_MODEL   (default fal-ai/kling-video/v1.6/pro/image-to-video — supports tail_image_url)
//   SFX_EDIT_MODEL   (default fal-ai/flux-pro/kontext — image editing for the exploded frame)

const { put } = require('@vercel/blob');

const QUEUE = 'https://queue.fal.run';

// Copy a finished fal video into Vercel Blob so the URL is permanently ours (fal file
// retention isn't guaranteed forever, and client sites must never lose their hero clip).
async function persistVideo(url) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return url;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(40000) });
    if (!r.ok) return url;
    const buf = Buffer.from(await r.arrayBuffer());
    const name = 'sitedrop-sfx/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.mp4';
    const blob = await put(name, buf, { access: 'public', contentType: 'video/mp4', token: process.env.BLOB_READ_WRITE_TOKEN });
    return blob.url;
  } catch (_) { return url; }
}
const VIDEO_MODEL = () => process.env.SFX_VIDEO_MODEL || 'fal-ai/kling-video/v2.1/standard/image-to-video';
const TAIL_MODEL = () => process.env.SFX_TAIL_MODEL || 'fal-ai/kling-video/v1.6/pro/image-to-video';
const EDIT_MODEL = () => process.env.SFX_EDIT_MODEL || 'fal-ai/flux-pro/kontext';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
const H = () => ({ Authorization: 'Key ' + process.env.FAL_KEY, 'Content-Type': 'application/json' });

const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const dec = (s) => { try { return JSON.parse(Buffer.from(String(s), 'base64url').toString()); } catch (_) { return null; } };

async function falJson(r) { try { return await r.json(); } catch (_) { return {}; } }
function falErr(j, status) {
  const d = j && j.detail;
  return (Array.isArray(d) ? (d[0] && d[0].msg) : d) || (j && j.error) || ('fal HTTP ' + status);
}

// Queue a job on a fal model. Returns { requestId }.
async function queueSubmit(model, payload) {
  const r = await fetch(`${QUEUE}/${model}`, { method: 'POST', headers: H(), body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
  const j = await falJson(r);
  if (!r.ok) throw new Error(falErr(j, r.status));
  if (!j.request_id) throw new Error('no request_id from fal');
  return { requestId: j.request_id };
}
// Check a queued job. Returns { done, url?, failed? }.
// NOTE: fal's queue API serves status/result under the ROOT app alias (first two path
// segments, e.g. "fal-ai/kling-video") — NOT the full submit subpath. Polling the subpath
// 404s silently, which made completed jobs read as "rendering" forever.
async function queueCheck(model, requestId) {
  const root = model.split('/').slice(0, 2).join('/');
  const s = await fetch(`${QUEUE}/${root}/requests/${requestId}/status`, { headers: H(), signal: AbortSignal.timeout(20000) });
  const sj = await falJson(s);
  const st = (sj.status || '').toUpperCase();
  if (st === 'COMPLETED') {
    const r = await fetch(`${QUEUE}/${root}/requests/${requestId}`, { headers: H(), signal: AbortSignal.timeout(20000) });
    const j = await falJson(r);
    const url = (j.video && j.video.url) || (j.videos && j.videos[0] && j.videos[0].url) || (j.images && j.images[0] && j.images[0].url) || null;
    return url ? { done: true, url } : { done: true, failed: 'completed_without_url' };
  }
  if (st === 'FAILED' || st === 'CANCELLED' || st === 'ERROR') return { done: true, failed: st.toLowerCase() };
  if (!st && s.status === 404) return { done: true, failed: 'status_404' };
  return { done: false };
}
// Run a fal model SYNCHRONOUSLY (short jobs like image edits). Returns first image url.
async function runSync(model, payload) {
  const r = await fetch(`https://fal.run/${model}`, { method: 'POST', headers: H(), body: JSON.stringify(payload), signal: AbortSignal.timeout(50000) });
  const j = await falJson(r);
  if (!r.ok) throw new Error(falErr(j, r.status));
  const url = (j.images && j.images[0] && j.images[0].url) || (j.image && j.image.url) || null;
  if (!url) throw new Error('no edit image url');
  return url;
}

function cinematicPrompt(motion) {
  return String(motion || '').trim() ||
    'Subtle cinematic motion: a slow, smooth camera push-in; natural ambient movement (light shifting, foliage or fabric gently moving); the subject holds naturally. Elegant, calm, premium. No cuts, no zoom bursts, no text.';
}
function explodedFramePrompt(product, parts) {
  const p = (parts && parts.length) ? parts.join(', ') : 'its main components';
  return `Exploded technical teardown view of this exact ${product || 'product'}: ${p} separated and floating apart in mid-air, evenly spaced like a precision engineering diagram, same background, same lighting, same camera angle as the original photo, ultra sharp, no text or labels`;
}
function explodedVideoPrompt(product) {
  return `Product exploded-view teardown animation: the ${product || 'product'} starts fully assembled and smoothly comes apart into floating, evenly spaced parts. Camera locked and static, elegant precise engineering motion, no people, no text.`;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.FAL_KEY) return res.status(200).json({ error: 'FAL_KEY not set' });

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch (_) {}
  const action = body.action || 'create';

  try {
    if (action === 'poll') {
      const job = dec(body.jobId);
      if (!job || !job.m || !job.r) return res.status(200).json({ error: 'bad_job' });
      const c = await queueCheck(job.m, job.r);
      if (!c.done) return res.status(200).json({ status: 'rendering' });
      if (c.failed) return res.status(200).json({ error: c.failed });
      return res.status(200).json({ video: await persistVideo(c.url), poster: job.p || '' });
    }

    // action === 'create'
    const image = String(body.image || '').trim();
    if (!image) return res.status(400).json({ error: 'image required (url or data-uri)' });
    const mode = body.mode === 'exploded' ? 'exploded' : 'cinematic';

    if (mode === 'cinematic') {
      // Optional body.model overrides the default (e.g. a turbo tier when the standard queue is deep).
      const vm = (body.model && /^fal-ai\/[a-z0-9/._-]+$/i.test(String(body.model))) ? String(body.model) : VIDEO_MODEL();
      const { requestId } = await queueSubmit(vm, {
        prompt: cinematicPrompt(body.motion),
        image_url: image,
        duration: '5',
      });
      // Don't embed a huge data-uri poster inside the job token — the client already has the image.
      const poster = image.length < 2000 ? image : '';
      return res.status(200).json({ jobId: enc({ m: vm, r: requestId, p: poster }), poster });
    }

    // exploded: synthesize the end frame from the photo, then first→last-frame video
    const product = String(body.product || '').trim();
    const parts = Array.isArray(body.parts) ? body.parts.map(String).slice(0, 6) : [];
    const explodedUrl = await runSync(EDIT_MODEL(), {
      prompt: explodedFramePrompt(product, parts),
      image_url: image,
      output_format: 'png',
    });
    const { requestId } = await queueSubmit(TAIL_MODEL(), {
      prompt: explodedVideoPrompt(product),
      image_url: image,
      tail_image_url: explodedUrl,
      duration: '5',
    });
    const poster = image.length < 2000 ? image : '';
    return res.status(200).json({ jobId: enc({ m: TAIL_MODEL(), r: requestId, p: poster }), poster, exploded: explodedUrl });
  } catch (err) {
    return res.status(200).json({ error: err && err.message ? err.message : 'error' });
  }
};
