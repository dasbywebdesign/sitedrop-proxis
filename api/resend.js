// Resend serverless proxy â€” sends the invoice email automatically (no "click send").
// The tool POSTs {to, subject, text}; this function sends it via Resend and keeps
// your API key server-side.
//
// SETUP
//   1. Create a free Resend account: https://resend.com  â†’ API Keys â†’ create one.
//   2. Verify a sending domain (or use Resend's onboarding sender for testing).
//   3. Deploy this to Vercel at  api/resend.js  with env vars:
//        RESEND_API_KEY = re_xxx
//        RESEND_FROM    = "Your Business <invoices@yourdomain.com>"   (a verified sender)
//        ALLOW_ORIGIN   = your tool's URL (or "*" while testing)
//   4. Paste the deployed URL (â€¦/api/resend) into the tool: Finance â†’ Edit Profile â†’ Resend proxy URL.
//
// After that, the invoice "Send" button emails the client directly â€” no mail app popup.

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dasby-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  // Shared-secret gate: once DASBY_KEY is set in Vercel env, every call must carry the same
  // x-dasby-key header (the tool sends it from Settings). Blocks drive-by credit burn.
  if (process.env.DASBY_KEY && req.headers['x-dasby-key'] !== process.env.DASBY_KEY) return res.status(401).json({ error: 'unauthorized' });

  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  if (!process.env.RESEND_API_KEY) return res.status(500).json({ ok: false, error: 'RESEND_API_KEY not set' });
  // Email is the worst abuse case (spam sent from OUR domain) — unlike the other endpoints,
  // sending stays HARD-LOCKED until DASBY_KEY exists. No key configured = no sends, period.
  if (!process.env.DASBY_KEY) return res.status(503).json({ ok: false, error: 'sending locked — set the DASBY_KEY env var (and enter the same key in the tool Settings) to enable' });

  // Light per-instance throttle: even with the key, cap bursts (cold-start resets are fine —
  // this is belt-and-suspenders on top of the gate, not the primary defense).
  global.__mailLog = (global.__mailLog || []).filter((t) => Date.now() - t < 3600000);
  if (global.__mailLog.length >= 30) return res.status(429).json({ ok: false, error: 'rate limit: 30 sends/hour — try again later' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const norm = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean);
    const to = norm(body.to);
    if (!to.length) return res.status(400).json({ ok: false, error: 'missing "to"' });
    if (to.length + norm(body.bcc).length > 3) return res.status(400).json({ ok: false, error: 'max 3 recipients per send (bulk sends are done one at a time, human-in-the-loop)' });
    global.__mailLog.push(Date.now());
    const bcc = norm(body.bcc);

    // Optional attachments (e.g. the invoice PDF): [{ filename, content: <base64> }]
    const attachments = Array.isArray(body.attachments)
      ? body.attachments
          .filter((a) => a && a.filename && a.content)
          .map((a) => ({ filename: String(a.filename), content: String(a.content) }))
      : undefined;

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'onboarding@resend.dev',
        to,
        subject: body.subject || 'Invoice',
        text: body.text || '',
        html: body.html || undefined,
        // reply_to lets the client reply straight to you
        reply_to: body.reply_to || body.from || process.env.RESEND_REPLY_TO || undefined,
        bcc: bcc.length ? bcc : undefined,
        attachments,
      }),
    });
    const j = await r.json();
    if (!r.ok) return res.status(200).json({ ok: false, error: (j && (j.message || j.name)) || ('HTTP ' + r.status) });
    return res.status(200).json({ ok: true, id: j.id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
