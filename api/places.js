// Google Places (New) search proxy — the premium data source for Lead Finder.
// Key lives server-side (GOOGLE_PLACES_KEY env), never in the browser. Until
// the key exists this returns {configured:false} and the tool silently uses
// the free OpenStreetMap path — it activates the moment the env var is set.
//
// POST { query:'barbershops in Fresno, CA', lat, lon, radius? }
//   -> { configured:true, rows:[{name,address,website,phone,rating,reviews,lat,lon}] }
//   -> { configured:false }   (no key yet)

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) return res.status(200).json({ configured: false });

  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const query = String(b.query || '').slice(0, 120);
  if (!query) return res.status(400).json({ error: 'query required' });
  const lat = Number(b.lat), lon = Number(b.lon);

  const payload = { textQuery: query, maxResultCount: 20 };
  if (isFinite(lat) && isFinite(lon)) {
    payload.locationBias = { circle: { center: { latitude: lat, longitude: lon }, radius: Math.min(Number(b.radius) || 12000, 50000) } };
  }

  try {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.websiteUri,places.rating,places.userRatingCount,places.nationalPhoneNumber,places.location',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return res.status(502).json({ configured: true, error: `google ${r.status}: ${(await r.text()).slice(0, 200)}` });
    const j = await r.json();
    const rows = (j.places || []).map(p => ({
      name: p.displayName && p.displayName.text || '',
      address: p.formattedAddress || '',
      website: p.websiteUri || '',
      phone: p.nationalPhoneNumber || '',
      rating: p.rating || null,
      reviews: p.userRatingCount || null,
      lat: p.location && p.location.latitude, lon: p.location && p.location.longitude,
    })).filter(x => x.name);
    return res.status(200).json({ configured: true, rows });
  } catch (e) {
    return res.status(502).json({ configured: true, error: String(e && e.message || e) });
  }
};
