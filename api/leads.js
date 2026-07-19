// Lead Finder search proxy — runs OpenStreetMap Overpass queries server-side.
// Browsers get blocked/CORS-limited by public Overpass servers; this proxy
// queries them from the server with mirror failover and returns clean JSON.
//
// POST { q: "[out:json][timeout:25];(nwr[...](around:...);)..." } -> Overpass JSON
// Guardrails: query must be an [out:json] Overpass query, size-capped.

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const q = String(body.q || '');
  if (!q.startsWith('[out:json]') || q.length > 4000) return res.status(400).json({ error: 'invalid query' });

  let lastErr = null;
  for (const m of MIRRORS) {
    try {
      const r = await fetch(m, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'DasbySites-LeadFinder/1.0' },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(25000),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      return res.status(200).json(j);
    } catch (e) { lastErr = e; }
  }
  return res.status(502).json({ error: 'all map mirrors unavailable: ' + String(lastErr && lastErr.message || lastErr) });
};
