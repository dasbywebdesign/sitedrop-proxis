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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  if (!process.env.RESEND_API_KEY) return res.status(500).json({ ok: false, error: 'RESEND_API_KEY not set' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const to = String(body.to || '').trim();
    if (!to) return res.status(400).json({ ok: false, error: 'missing "to"' });

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
        to: [to],
        subject: body.subject || 'Invoice',
        text: body.text || '',
        // reply_to lets the client reply straight to you
        reply_to: body.reply_to || body.from || process.env.RESEND_REPLY_TO || undefined,
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
