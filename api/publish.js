// Real one-click publish — deploys a generated site to Netlify and returns the
// live URL. Powers the Publish button in Dasby Sites: the builder POSTs the
// finished HTML, this creates a real site on the connected Netlify account.
//
// POST { html: "<!DOCTYPE html>…", name: "Business Name" }
//   -> { ok, url, site_id }        (site lives at https://<slug>.netlify.app)
//
// SETUP: env NETLIFY_TOKEN = a Netlify personal access token (server-side only)
//        ALLOW_ORIGIN = the builder's URL (or * while testing)

const crypto = require('crypto');
const API = 'https://api.netlify.com/api/v1';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const token = process.env.NETLIFY_TOKEN;
  if (!token) return res.status(500).json({ ok: false, error: 'publishing not configured (NETLIFY_TOKEN missing)' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const html = body.html;
  if (!html || html.length < 100) return res.status(400).json({ ok: false, error: 'html required' });
  if (html.length > 2_000_000) return res.status(413).json({ ok: false, error: 'site too large' });

  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const slugBase = String(body.name || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'site';
  const slug = `${slugBase}-${crypto.randomBytes(3).toString('hex')}`;

  try {
    // 1. create the site
    const siteR = await fetch(`${API}/sites`, { method: 'POST', headers: H, body: JSON.stringify({ name: slug }) });
    if (!siteR.ok) throw new Error(`create site: ${siteR.status} ${await siteR.text()}`);
    const site = await siteR.json();

    // 2. announce the file digest
    const sha = crypto.createHash('sha1').update(html).digest('hex');
    const depR = await fetch(`${API}/sites/${site.id}/deploys`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ files: { '/index.html': sha } })
    });
    if (!depR.ok) throw new Error(`create deploy: ${depR.status} ${await depR.text()}`);
    const dep = await depR.json();

    // 3. upload the file content
    const upR = await fetch(`${API}/deploys/${dep.id}/files/index.html`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
      body: html
    });
    if (!upR.ok) throw new Error(`upload: ${upR.status} ${await upR.text()}`);

    const url = site.ssl_url || site.url || `https://${slug}.netlify.app`;
    return res.status(200).json({ ok: true, url, site_id: site.id });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String(e && e.message || e) });
  }
};
