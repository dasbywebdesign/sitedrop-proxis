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

// Ask an OpenAI image model for a base64 PNG. Throws on any failure so the caller can fall back.
async function openaiImage(model, prompt, portrait, quality) {
  const base = (process.env.OPENAI_BASE || 'https://api.openai.com/v1').replace(/\/$/, '');
  const isGpt = /gpt-image/i.test(model);
  const size = isGpt ? (portrait ? '1024x1536' : '1536x1024') : (portrait ? '1024x1792' : '1792x1024');
  const payload = { model, prompt: prompt + STYLE, size, n: 1 };
  if (isGpt) { payload.quality = quality || 'medium'; }                 // gpt-image-1: low|medium|high
  else { payload.quality = quality === 'high' ? 'hd' : (quality || 'hd'); payload.response_format = 'b64_json'; } // dall-e-3: standard|hd
  const r = await fetch(base + '/images/generations', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(58000),
  });
  const j = await r.json().catch(() => ({}));
  const b64 = j && j.data && j.data[0] && j.data[0].b64_json;
  if (!r.ok || !b64) throw new Error((j.error && j.error.message) || ('image HTTP ' + r.status));
  return b64;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const prompt = String(body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    const portrait = /3:4|9:16|portrait/i.test(String(body.aspect_ratio || '3:4'));

    // No credentials → free pollinations image (still usable).
    if (!process.env.OPENAI_API_KEY || !process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(200).json({ url: pollinations(prompt, portrait), source: 'pollinations', note: 'OPENAI_API_KEY / BLOB_READ_WRITE_TOKEN not set' });
    }

    const primary = process.env.OPENAI_IMAGE_MODEL || 'dall-e-3';
    let b64, note = '';
    try {
      b64 = await openaiImage(primary, prompt, portrait, body.quality);
    } catch (e1) {
      note = String((e1 && e1.message) || e1);
      // If gpt-image-1 isn't available on this key (needs org verification), retry with dall-e-3.
      if (/gpt-image/i.test(primary) && /verif|access|not.*(allow|exist)|403|model/i.test(note)) {
        try { b64 = await openaiImage('dall-e-3', prompt, portrait, body.quality); note += ' | fell back to dall-e-3'; }
        catch (e2) { note += ' | dall-e-3 also failed: ' + ((e2 && e2.message) || e2); }
      }
    }
    if (!b64) return res.status(200).json({ url: pollinations(prompt, portrait), source: 'pollinations', note });

    try {
      const buf = Buffer.from(b64, 'base64');
      const name = 'sitedrop-img/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.png';
      const blob = await put(name, buf, { access: 'public', contentType: 'image/png', token: process.env.BLOB_READ_WRITE_TOKEN });
      return res.status(200).json({ url: blob.url, source: 'openai' });
    } catch (eBlob) {
      return res.status(200).json({ url: pollinations(prompt, portrait), source: 'pollinations', note: 'blob upload failed: ' + ((eBlob && eBlob.message) || eBlob) });
    }
  } catch (e) {
    return res.status(200).json({ error: e && e.message ? e.message : 'error' });
  }
};
