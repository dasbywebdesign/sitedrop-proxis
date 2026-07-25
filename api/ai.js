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
        'HEAD & SEO (REQUIRED — these are all GRADED by a quality gate; include EVERY one): <html lang="en">; a descriptive UNIQUE <title> "<Business Name> — <primary service> in <city>"; <meta name="description" content="a specific ~150-char summary">; <meta name="viewport" content="width=device-width, initial-scale=1">; <meta name="robots" content="index, follow">; OPEN GRAPH tags (og:title, og:description, og:type="website", and og:image set to the hero image URL if one was provided); a FAVICON via <link rel="icon" href="data:image/svg+xml,<url-encoded simple lettermark SVG in the brand color>">; and JSON-LD structured data — a <script type="application/ld+json"> with @type LocalBusiness including name, description, telephone, address (streetAddress/addressLocality/addressRegion/postalCode from the given address), url, and image.',
        '',
        'DESIGN SYSTEM (follow closely):',
        '• PALETTE: pick a COORDINATED 4-5 color system fitting the industry — a deep primary, a metallic/secondary,',
        '  a soft accent, a WARM off-white background (never pure #fff), and a soft-black ink. Not a single accent.',
        '• FONTS: pair a display serif for headings with a geometric sans for body (or a bold condensed sans + clean sans',
        '  for energetic industries). Headings use the serif; body uses the sans.',
        '• TYPE SCALE (use ONE modular scale — do NOT invent one-off sizes): base body 16px (1rem), ratio 1.25 (major third). Named tiers, mapped by role:',
        '  display (hero headline) ~clamp(2.6rem,6vw,3.05rem) · h1 clamp(2rem,5vw,2.44rem) · h2 clamp(1.6rem,4vw,1.95rem) · h3 1.56rem · h4 1.25rem · body-large 1.125rem · body 1rem · small 0.8rem · caption 0.7rem (uppercase eyebrows use caption + letter-spacing).',
        '  Every text element must use the tier that fits its role — no arbitrary sizes; headings responsive via clamp().',
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
        'QUALITY GATE (REQUIRED — graded): EXACTLY ONE <h1> on the entire page (the hero headline; every other heading is h2/h3/h4 — do NOT use a second h1). Footer copyright MUST render the CURRENT year via inline script: © <script>document.write(new Date().getFullYear())</script> — never a hard-coded past year. Include a real PRIVACY notice: a footer "Privacy Policy" link to a short privacy section/statement on the page (id="privacy") covering what info the contact form collects and that it is not shared.',
        'ACCESSIBILITY (required): semantic landmarks (header/nav/main/footer), exactly one <h1>, a <label> for every form field,',
        'text contrast >= 4.5:1 against its background, visible :focus-visible outlines, descriptive alt text on every image,',
        'and a @media (prefers-reduced-motion: reduce) block that disables animation/transition.',
        '',
        'FORM COPY (REQUIRED): any validation/error message must be specific, constructive, and human — NEVER "Invalid input" or a raw code. Use setCustomValidity or inline helper text, e.g. email invalid → "Please enter a valid email like name@example.com"; empty required field → "Please add your name so we can reply". Friendly, not robotic or blaming. Place the message right next to the field it refers to.',
        'RESPONSIVE (REQUIRED — non-negotiable): the site MUST look perfect on phone, tablet, AND desktop. Include <meta name="viewport" content="width=device-width, initial-scale=1">.',
        'Use responsive Tailwind prefixes (sm: md: lg:) on every multi-column layout — grids collapse to one column on mobile, font sizes scale down (use clamp() or responsive text classes), padding shrinks on small screens.',
        'The nav MUST have a working mobile hamburger menu (a button that toggles the links) that appears under md: and hides the desktop link row. No horizontal scrolling at any width. Tap targets >= 44px. Images use max-width:100% and never overflow.',
        '',
        'REQUIRED SECTIONS (include ALL, in this order — do not skip any):',
        '1. Sticky header nav: logo/business name, anchor links, a tap-to-call phone (tel: link) if a phone is given, and a filled primary CTA.',
        '2. Hero (per the HERO spec above) with the business name/tagline and two CTAs; the first CTA is Call (tel:) if a phone exists.',
        '3. Trust bar: 3-5 small badge/stat cards (e.g. license #, "Fully Insured", star rating if given, years, "24/7"). Use real given data only.',
        '4. Services: a grid of 3-6 cards, each with a Lucide icon, a real service name, and one specific benefit sentence.',
        '5. "How it works": a numbered 3-4 step process (01–04) with short titles and descriptions.',
        '6. About/trust: a two-column section building credibility with specific, believable local detail.',
        '7. Testimonials: 2-3 real-sounding reviews with names; if a rating is given, show it prominently.',
        '8. FAQ: 3-5 question/answer pairs relevant to the business.',
        '9. Contact: prominent phone (tel:), address, and hours, PLUS a WORKING <form> with labeled Name, Email, and Message fields,',
        '   a hidden honeypot field, and a submit button. onsubmit MUST preventDefault, then show a polished TOAST confirmation and reset the form.',
        '   The toast is a small fixed-position, auto-dismissing (after ~4s), accessible (role="status", aria-live="polite") notification reading "Message sent ✓ — we\'ll reply within one business day", styled to match the site palette with a success check icon. Include a tiny self-contained toast() helper + styles. Optionally also open the mailto to the business email if one is given. The form + toast MUST be present.',
        '10. Footer: business name, one-line description, grouped nav links, contact block, and a © line with the current year.',
        '',
        'QUALITY BAR: this must look like a $3,000+ custom site — not a template. Vary section backgrounds, use real imagery, generous spacing,',
        'and specific copy. If the business has NO website yet, treat this as a pitch that must instantly impress the owner.',
      ].join('\n');
      const MULTIPAGE = [
        'MULTI-PAGE ARCHITECTURE (REQUIRED for this build): produce ONE self-contained HTML file that behaves as a real multi-page website.',
        '• Wrap each page in <section class="page" data-page="home|services|about|contact"> … </section>. CSS: .page{display:none} .page.active{display:block}. Home starts active.',
        '• The sticky header nav has links with data-nav="home|services|about|contact" plus the primary CTA (data-nav="contact"). Style the active nav link.',
        '• Include a router <script> (vanilla, no libraries): clicking any [data-nav] hides all .page, adds .active to the matching one, marks the active nav link, scrolls to top (window.scrollTo(0,0)), sets location.hash, and re-runs lucide.createIcons(); on DOMContentLoaded honor location.hash (default "home").',
        '• The footer sits OUTSIDE the .page wrappers (shown on every page) and its links also use data-nav.',
        'PAGES & CONTENT (each page must be a COMPLETE, richly designed page — not a stub):',
        '  • home — hero (per HERO spec), trust bar, a 3–4 item services preview with a "View all services" link (data-nav="services"), a testimonials teaser, and a bold CTA band.',
        '  • services — a page header, the FULL services grid (every service, icon + specific benefit), the "How it works" 01–04 process, and a short FAQ.',
        '  • about — a page header, the story/credibility two-column, credential/trust badges, and a values or "why choose us" grid.',
        '  • contact — a page header, prominent phone (tel:), address and hours, AND the WORKING contact <form> (labeled Name/Email/Message + hidden honeypot; submit preventDefaults, shows the polished accessible "Message sent ✓" toast and resets the form), plus a service-area note.',
        'Keep markup efficient (favor Tailwind utility classes over long custom CSS) so the ENTIRE multi-page document is returned complete and never truncated. Always close </html>.',
      ].join('\n');
      const sysFinal = body.multipage ? (sysFP + '\n\n' + MULTIPAGE) : sysFP;
      const userFP = 'BUSINESS:\n' + JSON.stringify(biz, null, 2) +
        '\nINDUSTRY: ' + String(body.industry || '') +
        '\nIMAGE URLS (use these for the hero/gallery if present): ' + JSON.stringify(body.images || []) +
        '\nREFINEMENT INSTRUCTION (optional): ' + String(body.instruction || '');
      const rFP = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature: 0.8, max_tokens: body.multipage ? 16000 : 14000, messages: [{ role: 'system', content: sysFinal }, { role: 'user', content: userFP }] }),
      });
      const jFP = await rFP.json();
      if (!rFP.ok) return res.status(200).json({ error: (jFP.error && jFP.error.message) || ('HTTP ' + rFP.status) });
      let html = (jFP.choices && jFP.choices[0] && jFP.choices[0].message && jFP.choices[0].message.content) || '';
      html = html.replace(/^\s*```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
      if (!/<\/html>/i.test(html)) return res.status(200).json({ error: 'model did not return a full page' });

      // --- Deterministic XENON-gate compliance (LLMs are unreliable on strict structural rules) ---
      // 1) EXACTLY ONE <h1>: keep the first, demote the rest to <h2>.
      const firstH1 = html.search(/<h1[\s>]/i);
      if (firstH1 >= 0) {
        const fc = html.indexOf('</h1>', firstH1);
        if (fc >= 0) html = html.slice(0, fc + 5) + html.slice(fc + 5).replace(/<h1(\b[^>]*)>/gi, '<h2$1>').replace(/<\/h1>/gi, '</h2>');
      }
      // 2) JSON-LD LocalBusiness — inject if the model skipped it.
      if (!/application\/ld\+json/i.test(html)) {
        const ld = { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: biz.name || 'Business' };
        if (biz.desc) ld.description = String(biz.desc).slice(0, 300);
        if (biz.phone) ld.telephone = String(biz.phone);
        if (biz.address) ld.address = String(biz.address);
        if (biz.email) ld.email = String(biz.email);
        if (body.images && body.images[0]) ld.image = String(body.images[0]);
        html = html.replace(/<\/head>/i, '<script type="application/ld+json">' + JSON.stringify(ld) + '</' + 'script></head>');
      }
      // 3) Head insurance: viewport / description / robots / Open Graph / favicon if any are missing.
      const nm = String(biz.name || 'Business').replace(/"/g, '&quot;');
      const desc = String(biz.desc || (biz.type ? nm + ' — ' + biz.type : nm)).replace(/"/g, '&quot;').slice(0, 155);
      const inji = [];
      if (!/name="viewport"/i.test(html)) inji.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
      if (!/name="description"/i.test(html)) inji.push('<meta name="description" content="' + desc + '">');
      if (!/name="robots"/i.test(html)) inji.push('<meta name="robots" content="index, follow">');
      if (!/property="og:title"/i.test(html)) inji.push('<meta property="og:title" content="' + nm + '"><meta property="og:description" content="' + desc + '"><meta property="og:type" content="website">');
      if (!/rel="icon"/i.test(html)) { const ltr = (nm[0] || 'B').toUpperCase(); inji.push('<link rel="icon" href="data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#111"/><text x="32" y="44" font-size="34" text-anchor="middle" fill="#fff" font-family="Georgia">' + ltr + '</text></svg>') + '">'); }
      if (inji.length) html = html.replace(/<\/head>/i, inji.join('') + '</head>');
      // 4) Privacy notice — inject a compact one if missing (the gate checks for it).
      if (!/privacy/i.test(html)) {
        const pv = '<section id="privacy" style="max-width:820px;margin:0 auto;padding:36px 24px;font-size:13px;line-height:1.65;opacity:.72"><h2 style="font-size:16px;margin-bottom:8px">Privacy Policy</h2><p>We respect your privacy. Any information you submit through our contact form (name, email, message) is used solely to respond to your inquiry — it is never sold, rented, or shared with third parties. Contact us anytime to update or remove your information.</p></section>';
        html = /<\/footer>/i.test(html) ? html.replace(/<footer/i, pv + '<footer') : (/<\/body>/i.test(html) ? html.replace(/<\/body>/i, pv + '</body>') : html + pv);
      }

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
