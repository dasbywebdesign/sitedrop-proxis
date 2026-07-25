// Yelp Fusion search proxy — a second premium data source for Lead Finder.
// Key lives server-side (YELP_KEY env), never in the browser. Until the key
// exists this returns {configured:false} and the tool skips Yelp — it activates
// the moment the env var is set.
//
// POST { term:'hvac', lat:36.73, lon:-119.78, radius?:8000, limit?:50 }
//   -> { configured:true, rows:[{name,address,website,phone,rating,reviews,lat,lon,yelp,categories}] }
//   -> { configured:false }   (no key yet)
//
// SETUP: create a Yelp developer app at https://www.yelp.com/developers/v3/manage_app
// to get an API Key, then set Vercel env var  YELP_KEY = <that key>.

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const key = process.env.YELP_KEY;
  if (!key) return res.status(200).json({ configured: false });

  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const lat = Number(b.lat), lon = Number(b.lon);
    if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'lat/lon required' });
    const term = String(b.term || 'business').slice(0, 60);
    const radius = Math.min(Math.max(Number(b.radius) || 8000, 1000), 40000); // Yelp max 40000m
    const limit = Math.min(Number(b.limit) || 50, 50);

    const u = 'https://api.yelp.com/v3/businesses/search?' +
      'term=' + encodeURIComponent(term) +
      '&latitude=' + lat + '&longitude=' + lon +
      '&radius=' + radius + '&limit=' + limit + '&sort_by=distance';
    const r = await fetch(u, { headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(200).json({ error: (j && (j.error && j.error.description)) || ('HTTP ' + r.status) });

    const rows = (j.businesses || []).map((x) => {
      const loc = x.location || {};
      const addr = (loc.display_address && loc.display_address.join(', ')) || '';
      return {
        name: x.name || '',
        address: addr,
        website: '',                       // Yelp does not expose the business's own site
        phone: x.display_phone || x.phone || '',
        rating: x.rating || null,
        reviews: x.review_count || 0,
        lat: (x.coordinates && x.coordinates.latitude) || lat,
        lon: (x.coordinates && x.coordinates.longitude) || lon,
        yelp: x.url || '',
        categories: (x.categories || []).map((c) => c.title).join(', '),
        closed: !!x.is_closed,
      };
    }).filter((x) => x.name && !x.closed);

    return res.status(200).json({ configured: true, rows });
  } catch (e) {
    return res.status(200).json({ error: e && e.message ? e.message : 'error' });
  }
};
