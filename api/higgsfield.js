// Premium image generator — creates a magazine-quality photo with OpenAI's image model
// and stores it PERMANENTLY in Vercel Blob, returning a public URL.
//
// (Repurposed from the old Higgsfield proxy. Kept this filename on purpose: it stays within
//  Vercel's 12-function limit, keeps the maxDuration:60 entry in vercel.json, and the builder
//  already points at /api/higgsfield — so nothing else needs rewiring.)
//
// POST { prompt, aspect_ratio?("3:4"|"4:3"|"1:1"|"16:9"|"9:16"), quality? } -> { url, source }
//   • Uses OPENAI_IMAGE_MODEL (default "dall-e-3" — works on any OpenAI key, no org verification).
//     Set it to "gpt-image-1" once the OpenAI org is ID-verified for an even sharper result.
//   • Falls back to a free pollinations-Flux URL if the model or Blob store is unavailable,
//     so a usable image URL is ALWAYS returned (never a broken site).
// Env: OPENAI_API_KEY, BLOB_READ_WRITE_TOKEN (+ optional OPENAI_IMAGE_MODEL, OPENAI_BASE, ALLOW_ORIGIN).

const { put } = require('@vercel/blob');

const STYLE = ' — award-winning editorial photograph, natural golden-hour light, shallow depth of field, hyper-detailed, photorealistic, magazine quality; absolutely no text, letters, words, or watermark anywhere.';

function pollinations(prompt, portrait) {
  const w = portrait ? 1024 : 1536, h = portrait ? 1536 : 1024;
  return 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt + STYLE) + '?width=' + w + '&height=' + h + '&nologo=true&nofeed=true&enhance=true&model=flux';
}

// Ask an OpenAI image model for image BYTES (Buffer). Handles both return shapes — a base64 blob
// (gpt-image-1, or dall-e-3 when it obliges) or a hosted URL (dall-e-3 default) which we then fetch.
// Does NOT send response_format (some keys/proxies reject it). Throws on failure so caller can fall back.
async function openaiImageBuf(model, prompt, portrait, quality) {
  // Images can use a SEPARATE key/base from chat: set OPENAI_IMAGE_KEY / OPENAI_IMAGE_BASE to point
  // at real OpenAI even when OPENAI_BASE/OPENAI_API_KEY is an Azure or chat-only proxy for gpt-4o.
  const base = (process.env.OPENAI_IMAGE_BASE || process.env.OPENAI_BASE || 'https://api.openai.com/v1').replace(/\/$/, '');
  const key = process.env.OPENAI_IMAGE_KEY || process.env.OPENAI_API_KEY;
  const isGpt = /gpt-image/i.test(model);
  const size = isGpt ? (portrait ? '1024x1536' : '1536x1024') : (portrait ? '1024x1792' : '1792x1024');
  const payload = { model, prompt: prompt + STYLE, size, n: 1 };
  payload.quality = isGpt ? (quality === 'hd' ? 'high' : (quality || 'medium'))   // gpt-image-1: low|medium|high
                          : ((quality === 'high' || quality === 'hd') ? 'hd' : 'standard'); // dall-e-3: standard|hd
  const r = await fetch(base + '/images/generations', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(280000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || ('image HTTP ' + r.status));
  const d = j && j.data && j.data[0];
  if (d && d.b64_json) return Buffer.from(d.b64_json, 'base64');
  if (d && d.url) {
    const ir = await fetch(d.url, { signal: AbortSignal.timeout(25000) });
    if (!ir.ok) throw new Error('fetch image url ' + ir.status);
    return Buffer.from(await ir.arrayBuffer());
  }
  throw new Error('no image data in response');
}

// Flux Pro via fal.ai — returns image BYTES. Needs FAL_KEY. Throws on failure.
async function falImageBuf(model, prompt, portrait) {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY not set');
  const path = model === 'flux-pro' ? 'flux-pro/v1.1'
             : model === 'flux-pro-ultra' ? 'flux-pro/v1.1-ultra'
             : model.replace(/^fal(-ai)?\//, '');
  const r = await fetch('https://fal.run/fal-ai/' + path, {
    method: 'POST',
    headers: { Authorization: 'Key ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: prompt + STYLE, image_size: portrait ? 'portrait_4_3' : 'landscape_4_3', num_images: 1, output_format: 'png', safety_tolerance: '5' }),
    signal: AbortSignal.timeout(280000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.detail && (Array.isArray(j.detail) ? (j.detail[0] && j.detail[0].msg) : j.detail)) || j.error || ('fal HTTP ' + r.status));
  const url = j.images && j.images[0] && j.images[0].url;
  if (!url) throw new Error('no fal image url');
  const ir = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!ir.ok) throw new Error('fetch fal url ' + ir.status);
  return Buffer.from(await ir.arrayBuffer());
}

// Route to the right provider by model name.
function generateBuf(model, prompt, portrait, quality) {
  return /flux/i.test(model) ? falImageBuf(model, prompt, portrait) : openaiImageBuf(model, prompt, portrait, quality);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dasby-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  // Shared-secret gate: once DASBY_KEY is set in Vercel env, every call must carry the same
  // x-dasby-key header (the tool sends it from Settings). Blocks drive-by credit burn.
  if (process.env.DASBY_KEY && req.headers['x-dasby-key'] !== process.env.DASBY_KEY) return res.status(401).json({ error: 'unauthorized' });

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const prompt = String(body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    const portrait = /3:4|9:16|portrait/i.test(String(body.aspect_ratio || '3:4'));

    // Need a Blob store to persist images; without it, free pollinations (still usable).
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(200).json({ url: pollinations(prompt, portrait), source: 'pollinations', note: 'BLOB_READ_WRITE_TOKEN not set' });
    }

    const primary = (body.model && String(body.model)) || process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
    let buf, note = '', source = /flux/i.test(primary) ? 'flux' : 'openai';
    try {
      buf = await generateBuf(primary, prompt, portrait, body.quality);
    } catch (e1) {
      note = String((e1 && e1.message) || e1);
      // OpenAI image fallback: gpt-image-2 → gpt-image-1 if the newer id isn't on this key yet.
      if (/gpt-image/i.test(primary) && primary !== 'gpt-image-1') {
        try { buf = await openaiImageBuf('gpt-image-1', prompt, portrait, body.quality); note += ' | fell back to gpt-image-1'; }
        catch (e2) { note += ' | gpt-image-1 also failed: ' + ((e2 && e2.message) || e2); }
      }
    }
    if (!buf) return res.status(200).json({ url: pollinations(prompt, portrait), source: 'pollinations', note });

    try {
      const name = 'sitedrop-img/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.png';
      const blob = await put(name, buf, { access: 'public', contentType: 'image/png', token: process.env.BLOB_READ_WRITE_TOKEN });
      return res.status(200).json({ url: blob.url, source, note: note || undefined });
    } catch (eBlob) {
      return res.status(200).json({ url: pollinations(prompt, portrait), source: 'pollinations', note: 'blob upload failed: ' + ((eBlob && eBlob.message) || eBlob) });
    }
  } catch (e) {
    return res.status(200).json({ error: e && e.message ? e.message : 'error' });
  }
};
