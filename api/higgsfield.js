// Higgsfield image proxy — generates a professional image from a text prompt and
// returns its URL. Talks to the Higgsfield Cloud REST API directly (no SDK) and
// polls the status endpoint itself, so it works reliably on serverless.
//
// SETUP
//   1. Higgsfield Cloud account: https://cloud.higgsfield.ai → Dashboard → API → create a key.
//      You get a KEY_ID and KEY_SECRET.
//   2. Deploy at  api/higgsfield.js  (with the root vercel.json giving it maxDuration 60).
//   3. Env vars:  HF_CREDENTIALS = KEY_ID:KEY_SECRET   and   ALLOW_ORIGIN = *
//   4. Builder chat:  higgsfield proxy https://<project>.vercel.app/api/higgsfield
//
// POST { prompt, aspect_ratio? } -> { url } (or { error }). Each image costs ~1 credit.

const MODEL = 'higgsfield-ai/soul/standard';           // flagship text-to-image
const BASE = 'https://platform.higgsfield.ai';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.HF_CREDENTIALS) return res.status(500).json({ error: 'HF_CREDENTIALS not set' });

  const auth = 'Key ' + process.env.HF_CREDENTIALS; // "Key KEY_ID:KEY_SECRET"
  const headers = { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' };

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const prompt = String(body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    const aspect_ratio = String(body.aspect_ratio || '1:1');

    // 1) Submit the generation
    const sub = await fetch(`${BASE}/${MODEL}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: prompt + ', professional commercial photography, high quality, clean, well lit',
        aspect_ratio,
        resolution: '720p',
      }),
    });
    let data;
    try { data = await sub.json(); } catch (_) { data = {}; }
    if (!sub.ok) return res.status(200).json({ error: (data && (data.message || data.detail || data.error)) || ('HTTP ' + sub.status) });

    const pickUrl = (d) => (d && d.images && d.images[0] && d.images[0].url) ||
                           (d && d.image && d.image.url) ||
                           (d && d.results && d.results.raw && d.results.raw.url) || null;

    // 2) Already done?
    if (data.status === 'completed' || pickUrl(data)) {
      const url = pickUrl(data);
      return url ? res.status(200).json({ url }) : res.status(200).json({ error: 'no_result_url' });
    }

    // 3) Poll the status URL until completed (bounded to stay under the 60s function limit)
    const statusUrl = data.status_url || (data.request_id ? `${BASE}/requests/${data.request_id}/status` : null);
    if (!statusUrl) return res.status(200).json({ error: 'no_status_url' });

    const deadline = Date.now() + 50000;
    let cur = data;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      const st = await fetch(statusUrl, { headers });
      try { cur = await st.json(); } catch (_) { cur = {}; }
      const s = cur && cur.status;
      if (s === 'completed' || pickUrl(cur)) { const u = pickUrl(cur); return u ? res.status(200).json({ url: u }) : res.status(200).json({ error: 'no_result_url' }); }
      if (s === 'failed' || s === 'nsfw' || s === 'canceled') return res.status(200).json({ error: s });
    }
    return res.status(200).json({ error: 'timeout' });
  } catch (e) {
    return res.status(200).json({ error: e && e.message ? e.message : 'error' });
  }
};
