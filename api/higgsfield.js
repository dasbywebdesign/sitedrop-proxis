// Higgsfield image proxy â€” generates a professional image from a text prompt and
// returns its URL. Holds your Higgsfield Cloud API credentials server-side so the
// website builder can request pro images automatically (the browser never sees the key).
//
// The tool POSTs {prompt, aspect_ratio?} and gets back {url}.
//
// SETUP
//   1. Create a Higgsfield Cloud account: https://cloud.higgsfield.ai  â†’ Dashboard â†’ API
//      â†’ create a key. You get a KEY_ID and KEY_SECRET.
//   2. Deploy this to Vercel at  api/higgsfield.js  (same project as your other proxies).
//      Because it uses the official SDK, also add the package.json in this folder so
//      Vercel installs the dependency (@higgsfield/client).
//   3. Project Settings â†’ Environment Variables:
//        HF_CREDENTIALS = KEY_ID:KEY_SECRET      (the two joined with a colon)
//        ALLOW_ORIGIN   = your site's origin (or "*" while testing)
//   4. In the Builder chat, type:  higgsfield proxy https://<project>.vercel.app/api/higgsfield
//
// Each image costs Higgsfield credits (~1 credit). If the key is missing or a call
// fails, the builder falls back to its free placeholder images â€” nothing breaks.

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.HF_CREDENTIALS) return res.status(500).json({ error: 'HF_CREDENTIALS not set' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const prompt = String(body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    const aspect_ratio = String(body.aspect_ratio || '1:1');

    // Official Higgsfield SDK v2 (ESM) â€” loaded via dynamic import from this CommonJS fn.
    const { createHiggsfieldClient } = await import('@higgsfield/client/v2');
    const client = createHiggsfieldClient({
      credentials: process.env.HF_CREDENTIALS, // "KEY_ID:KEY_SECRET"
      maxPollTime: 55000,
      pollInterval: 2500,
    });

    const jobSet = await client.subscribe('flux-pro/kontext/max/text-to-image', {
      input: {
        prompt: prompt + ', professional commercial photography, high quality, clean, well lit',
        aspect_ratio,
        safety_tolerance: 2,
      },
      withPolling: true,
    });

    if (!jobSet.isCompleted) {
      return res.status(200).json({ error: jobSet.isNsfw ? 'nsfw' : (jobSet.isFailed ? 'failed' : 'not_ready') });
    }
    const job = (jobSet.jobs || [])[0];
    const url = job && job.results && job.results.raw && job.results.raw.url;
    if (!url) return res.status(200).json({ error: 'no_result_url' });
    return res.status(200).json({ url });
  } catch (e) {
    return res.status(200).json({ error: e && e.message ? e.message : 'error' });
  }
};
