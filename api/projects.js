// Cloud project storage for Dasby Sites — workspace-keyed, versioned saves on
// Vercel Blob. Projects survive cleared browsers and sync across devices via a
// secret workspace key (the key IS the credential — treat it like a password).
//
// POST { op:'save', ws:'<secret key>', state:{ projects,invoices,savedLeads,invFrom } }
//   -> { ok, savedAt, versions }
// POST { op:'load', ws:'<secret key>' }
//   -> { ok, state, savedAt }   (or { ok:true, state:null } for a fresh key)
//
// Design: every save writes a NEW immutable version blob (ws/<hmac>/<ts>.json);
// load reads the newest via the authoritative list API (no CDN staleness).
// Old versions pruned to the latest 10 — free restore history.
// ENV: BLOB_READ_WRITE_TOKEN (auto-provisioned by the connected Blob store).

const crypto = require('crypto');
const BLOB = 'https://blob.vercel-storage.com';
const KEEP = 10;

function ns(ws) { return crypto.createHmac('sha256', 'dasby-ws-v1').update(ws).digest('hex').slice(0, 40); }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(500).json({ ok: false, error: 'storage not configured' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { op, ws } = body;
  if (!ws || typeof ws !== 'string' || ws.length < 20) return res.status(400).json({ ok: false, error: 'invalid workspace key (min 20 chars)' });
  const prefix = `ws/${ns(ws)}/`;
  const A = { Authorization: `Bearer ${token}` };

  async function list() {
    const r = await fetch(`${BLOB}/?prefix=${encodeURIComponent(prefix)}&limit=1000`, { headers: A });
    if (!r.ok) throw new Error(`list ${r.status}`);
    const j = await r.json();
    return (j.blobs || []).sort((a, b) => b.pathname.localeCompare(a.pathname)); // newest first (ts-named)
  }

  try {
    if (op === 'save') {
      const payload = JSON.stringify(body.state || {});
      if (payload.length > 4_000_000) return res.status(413).json({ ok: false, error: 'workspace too large (4MB max)' });
      const ts = String(Date.now()).padStart(15, '0');
      const put = await fetch(`${BLOB}/${prefix}${ts}.json`, {
        method: 'PUT', body: payload,
        headers: { ...A, 'x-content-type': 'application/json', 'x-add-random-suffix': '0' }
      });
      if (!put.ok) throw new Error(`put ${put.status} ${await put.text()}`);
      // prune old versions
      const blobs = await list();
      const stale = blobs.slice(KEEP).map(b => b.url);
      if (stale.length) {
        await fetch(`${BLOB}/delete`, { method: 'POST', headers: { ...A, 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: stale }) }).catch(() => {});
      }
      return res.status(200).json({ ok: true, savedAt: Date.now(), versions: Math.min(blobs.length, KEEP) });
    }

    if (op === 'load') {
      const blobs = await list();
      if (!blobs.length) return res.status(200).json({ ok: true, state: null });
      const r = await fetch(blobs[0].url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`read ${r.status}`);
      const state = await r.json();
      const ts = parseInt(blobs[0].pathname.slice(prefix.length).replace('.json', ''), 10) || null;
      return res.status(200).json({ ok: true, state, savedAt: ts });
    }

    return res.status(400).json({ ok: false, error: 'op must be save or load' });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String(e && e.message || e) });
  }
};
