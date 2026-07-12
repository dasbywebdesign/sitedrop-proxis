// AI copywriter serverless proxy — writes and edits landing-page copy with a real LLM.
// Your OpenAI (or OpenAI-compatible) key stays server-side; the browser only talks to this.
//
// The tool POSTs one of two shapes:
//   { task:"copy", prompt:"<what the user typed>", business:{name,type,desc,services,...} }
//   { task:"edit", instruction:"make the hero punchier", business:{...current fields...} }
// This returns JSON the tool applies directly:
//   copy -> { tagline, desc, cta, services:[...] }
//   edit -> { name?, tagline?, desc?, cta?, phone?, email?, address?, hours?, services?[], accent?"#hex", message }
//
// SETUP
//   1. Get an API key: https://platform.openai.com/api-keys  (or any OpenAI-compatible endpoint).
//   2. Deploy this to Vercel at  api/ai.js  with env vars:
//        OPENAI_API_KEY = sk-...
//        OPENAI_MODEL   = gpt-4o-mini            (optional; default below)
//        OPENAI_BASE    = https://api.openai.com/v1  (optional; override for Azure/OpenRouter/etc.)
//        ALLOW_ORIGIN   = your tool's URL (or "*" while testing)
//   3. In the Builder chat, type:  ai proxy https://<project>.vercel.app/api/ai
//
// If the model is unreachable the tool falls back to its built-in local copy — nothing breaks.

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const task = ['edit', 'fullpage'].includes(body.task) ? body.task : 'copy';
    const biz = body.business || {};
    const base = (process.env.OPENAI_BASE || 'https://api.openai.com/v1').replace(/\/$/, '');
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    // ---- AI full-page: the model authors a complete, bespoke, ADA-compliant HTML page ----
    if (task === 'fullpage') {
      const sysFP = [
        'You are an award-winning web designer. Output ONLY a complete, self-contained HTML5 document',
        '(<!DOCTYPE html> … </html>) for this local business\'s landing page — no markdown fences, no commentary.',
        'Use Tailwind via <script src="https://cdn.tailwindcss.com"></script> plus a tailwind.config <script> that defines a',
        'coordinated brand palette and font pairing. Load fonts from Google Fonts. Use Lucide icons via',
        '<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"></script> and call lucide.createIcons().',
        '',
        'DESIGN SYSTEM (follow closely):',
        '• PALETTE: pick a COORDINATED 4-5 color system fitting the industry — a deep primary, a metallic/secondary,',
        '  a soft accent, a WARM off-white background (never pure #fff), and a soft-black ink. Not a single accent.',
        '• FONTS: pair a display serif for headings with a geometric sans for body (or a bold condensed sans + clean sans',
        '  for energetic industries). Headings use the serif; body uses the sans.',
        '• RHYTHM: alternate section backgrounds light→dark→light (e.g. warm-ivory, then a deep primary section) for drama.',
        '  Generous vertical padding (py-24 to py-32). Max content width ~max-w-6xl, centered.',
        '• SECTION HEADERS formula: a tiny uppercase letter-spaced (tracking-[0.3em]) eyebrow in the secondary color, then a',
        '  large serif <h2> with ONE italicized emphasis word in an accent color, then a short ~6rem divider line, then a lead paragraph.',
        '• HERO: full-bleed background image at ~40% opacity with a gradient overlay fading from the bg color into the primary;',
        '  an eyebrow flanked by two short decorative lines; a big serif headline with 1-2 words italicized in accent/secondary colors;',
        '  two pill (rounded-full) CTAs (one filled primary, one outlined) with a hover lift and an arrow icon; a 3-up stat row inside the hero.',
        '• DEPTH: layer images with an offset colored panel behind them and a small floating quote/badge card overlapping a corner.',
        '• GALLERY: an asymmetric bento grid (grid-cols-12 with uneven col-spans), images with group-hover:scale-110 zoom and a',
        '  caption that fades in on hover; one tile can be a gradient CTA card instead of a photo.',
        '• TESTIMONIALS: place on a dark section with blurred color-glow blobs behind; use glassmorphism cards',
        '  (translucent bg, backdrop-blur, subtle border), a quote icon, italic serif quotes, and a star rating row.',
        '• CARDS rounded-2xl, BUTTONS rounded-full, tasteful shadows, smooth scroll, and subtle hover transitions everywhere.',
        '• MOTION: add a .animate-on-scroll fade-up revealed by an IntersectionObserver, and honor prefers-reduced-motion.',
        '',
        'CONTENT: write real, specific, warm copy for THIS business (named packages/prices, local references, real-sounding',
        'testimonials with names) — never lorem ipsum. IMAGERY: use the provided image URLs if any, otherwise',
        'https://image.pollinations.ai/prompt/<url-encoded scene>?width=1200&height=800&nologo=true with vivid industry-specific scenes.',
        '',
        'ACCESSIBILITY (required): semantic landmarks (header/nav/main/footer), exactly one <h1>, a <label> for every form field,',
        'text contrast >= 4.5:1 against its background, visible :focus-visible outlines, descriptive alt text on every image,',
        'and a @media (prefers-reduced-motion: reduce) block that disables animation/transition.',
      ].join('\n');
      const userFP = 'BUSINESS:\n' + JSON.stringify(biz, null, 2) +
        '\nINDUSTRY: ' + String(body.industry || '') +
        '\nIMAGE URLS (use these if present): ' + JSON.stringify(body.images || []) +
        '\nREFINEMENT INSTRUCTION (optional): ' + String(body.instruction || '');
      const rFP = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature: 0.8, max_tokens: 8000, messages: [{ role: 'system', content: sysFP }, { role: 'user', content: userFP }] }),
      });
      const jFP = await rFP.json();
      if (!rFP.ok) return res.status(200).json({ error: (jFP.error && jFP.error.message) || ('HTTP ' + rFP.status) });
      let html = (jFP.choices && jFP.choices[0] && jFP.choices[0].message && jFP.choices[0].message.content) || '';
      html = html.replace(/^\s*```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
      if (!/<\/html>/i.test(html)) return res.status(200).json({ error: 'model did not return a full page' });
      return res.status(200).json({ result: { html } });
    }

    const sys = task === 'edit'
      ? 'You edit a small-business landing page. You are given the current field values and a plain-English instruction. Return ONLY a JSON object with just the fields that should change. Allowed keys: name, type, tagline, desc, cta, phone, email, address, hours, services (array of short strings), accent (a #hex color), and message (a one-line friendly confirmation of what you changed). Do not include unchanged fields. Keep tagline under 8 words, desc under 40 words, cta 2-4 words.'
      : 'You are a senior conversion copywriter for local small businesses. Given a business brief, write punchy, specific, trustworthy website copy. Return ONLY a JSON object with keys: tagline (under 8 words), desc (1-2 sentences, under 40 words, benefit-led, no clichés like "we strive"), cta (2-4 words), services (array of 3-6 short service names). No markdown, no extra keys.';

    const user = task === 'edit'
      ? 'CURRENT FIELDS:\n' + JSON.stringify(biz, null, 2) + '\n\nINSTRUCTION: ' + String(body.instruction || '')
      : 'BRIEF: ' + String(body.prompt || '') + '\n\nPARSED FIELDS:\n' + JSON.stringify(biz, null, 2);

    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      }),
    });
    const j = await r.json();
    if (!r.ok) return res.status(200).json({ error: (j.error && j.error.message) || ('HTTP ' + r.status) });

    let out = {};
    try { out = JSON.parse(j.choices[0].message.content); } catch (_) { return res.status(200).json({ error: 'bad model output' }); }
    return res.status(200).json({ result: out });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
