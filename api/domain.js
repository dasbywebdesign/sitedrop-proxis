// Domain expiry lookup — free, no API key. Uses RDAP (the modern WHOIS) to
// return a domain's expiration date so Dasby can catch renewals before they lapse.
//
// POST { domain: "example.com" } -> { domain, expires: "2027-03-01T...", daysLeft, registrar }
// or   { domains: ["a.com","b.com"] } -> { results: [ {domain,expires,daysLeft,registrar,error?} ] }

async function lookup(domain) {
  const d = String(domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!d || !d.includes('.')) return { domain: d, error: 'invalid domain' };
  try {
    const r = await fetch('https://rdap.org/domain/' + encodeURIComponent(d), {
      headers: { 'Accept': 'application/rdap+json' }, redirect: 'follow', signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return { domain: d, error: 'lookup failed (' + r.status + ')' };
    const j = await r.json();
    const ev = (j.events || []).find(e => /expiration/i.test(e.eventAction));
    const expires = ev ? ev.eventDate : null;
    let registrar = '';
    const reg = (j.entities || []).find(e => (e.roles || []).includes('registrar'));
    if (reg && reg.vcardArray) { const fn = reg.vcardArray[1].find(x => x[0] === 'fn'); if (fn) registrar = fn[3]; }
    const daysLeft = expires ? Math.round((new Date(expires) - Date.now()) / 86400000) : null;
    return { domain: d, expires, daysLeft, registrar };
  } catch (e) {
    return { domain: d, error: String(e && e.message || e) };
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  if (Array.isArray(b.domains)) {
    const results = [];
    for (const d of b.domains.slice(0, 50)) { results.push(await lookup(d)); }
    return res.status(200).json({ results });
  }
  if (b.domain) return res.status(200).json(await lookup(b.domain));
  return res.status(400).json({ error: 'domain or domains[] required' });
};
