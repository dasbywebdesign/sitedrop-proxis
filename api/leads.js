// Lead Finder search proxy — real local-business search, server-side, free.
// Primary: OpenStreetMap Overpass (rich tags: website/phone/hours) via mirror
// failover with short timeouts. Fallback: Nominatim search (fast, reliable)
// normalized to the same Overpass-style shape, so the client parses one format.
//
// POST { tag:'"shop"="hairdresser"'|null, name:'barbershops', qword:'Barbershops',
//        lat:36.73, lon:-119.78, radius:8000 }
//   -> { elements:[{type:'node',lat,lon,tags:{...}}], source:'overpass'|'nominatim' }

const MIRRORS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const UA = { 'User-Agent': 'DasbySites-LeadFinder/1.0 (dasbywebdesign@gmail.com)' };

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const lat = Number(b.lat), lon = Number(b.lon);
  const radius = Math.min(Number(b.radius) || 8000, 30000);
  if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'lat/lon required' });
  const tag = typeof b.tag === 'string' && /^"[\w:]+"="[\w;|_-]+"$/.test(b.tag) ? b.tag : null;
  const name = String(b.name || '').replace(/[^a-z0-9 ]/gi, '').trim();
  const qword = String(b.qword || name || 'business').slice(0, 60);

  // --- primary: Overpass mirrors, 9s each ---
  const around = `(around:${radius},${lat},${lon})`;
  const sel = tag ? `nwr[${tag}]${around};` : `nwr["name"~"${name}",i]${around};`;
  const q = `[out:json][timeout:8];(${sel});out center 100;`;
  for (const m of MIRRORS) {
    try {
      const r = await fetch(m, {
        method: 'POST', headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(9000),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j && Array.isArray(j.elements)) return res.status(200).json({ elements: j.elements, source: 'overpass' });
    } catch (e) { /* next mirror */ }
  }

  // --- fallback: Nominatim bounded search, normalized to Overpass shape ---
  try {
    const d = 0.18; // ~20km box
    const vb = `${lon - d},${lat + d},${lon + d},${lat - d}`;
    const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=40&bounded=1&extratags=1&namedetails=1` +
      `&viewbox=${vb}&q=${encodeURIComponent(qword)}`;
    const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const rows = await r.json();
    const elements = (rows || []).filter(x => x.name || (x.namedetails && x.namedetails.name)).map(x => {
      const ex = x.extratags || {};
      return {
        type: 'node', lat: Number(x.lat), lon: Number(x.lon),
        tags: {
          name: x.name || x.namedetails.name,
          website: ex.website || ex['contact:website'] || ex.url || '',
          phone: ex.phone || ex['contact:phone'] || '',
          email: ex.email || ex['contact:email'] || '',
          opening_hours: ex.opening_hours || '',
          'addr:street': (x.display_name || '').split(',').slice(1, 3).join(',').trim(),
        },
      };
    });
    return res.status(200).json({ elements, source: 'nominatim' });
  } catch (e) {
    return res.status(502).json({ error: 'all map services unavailable: ' + String(e && e.message || e) });
  }
};
