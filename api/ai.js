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
    const model = process.env.OPENAI_MODEL || 'gpt-4o';

    // ---- AI full-page: the model authors a complete, bespoke, ADA-compliant HTML page ----
    if (task === 'fullpage') {
      const sysFP = [
        'You are an award-winning web designer. Output ONLY a complete, self-contained HTML5 document',
        '(<!DOCTYPE html> … </html>) for this local business\'s landing page — no markdown fences, no commentary.',
        'Use Tailwind via <script src="https://cdn.tailwindcss.com"></script> plus a tailwind.config <script> that defines a',
        'coordinated brand palette and font pairing. Load fonts from Google Fonts. Use Lucide icons via',
        '<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"></script>. Render EACH icon as <i data-lucide="<valid-lucide-name>"></i> (valid Lucide names ONLY — e.g. wrench, car, gauge, disc, shield-check, phone, clock, map-pin, star, check; NEVER a CSS class like "lucide-tire" and NEVER an invented name), and call lucide.createIcons() in a script at the END of body (after the DOM exists), not in head.',
        'HEAD & SEO (REQUIRED — these are all GRADED by a quality gate; include EVERY one): <html lang="en">; a descriptive UNIQUE <title> "<Business Name> — <primary service> in <city>"; <meta name="description" content="a specific ~150-char summary">; <meta name="viewport" content="width=device-width, initial-scale=1">; <meta name="robots" content="index, follow">; OPEN GRAPH tags (og:title, og:description, og:type="website", and og:image set to the hero image URL if one was provided); a FAVICON via <link rel="icon" href="data:image/svg+xml,<url-encoded simple lettermark SVG in the brand color>">; and JSON-LD structured data — a <script type="application/ld+json"> with @type LocalBusiness including name, description, telephone, address (streetAddress/addressLocality/addressRegion/postalCode from the given address), url, and image.',
        '',
        'DESIGN SYSTEM (follow closely):',
        '• PALETTE: pick a COORDINATED 4-5 color system DERIVED FROM THE INDUSTRY & BRAND — a deep primary, a readable mid-tone secondary',
        '  (NOT a near-white silver/metallic — eyebrows and small text in the secondary must pass contrast on a light background),',
        '  a soft accent, a WARM off-white background (never pure #fff), and a soft-black ink. Not a single accent.',
        '  NEVER fall back to a generic default like bootstrap blue (#007bff/#0d6efd), material indigo (#3F51B5), or purple —',
        '  those instantly read as an un-designed template. Commit to a palette that fits the trade (e.g. tire/auto → charcoal +',
        '  safety-red + amber; landscaping → forest-green + stone + sand; spa → sage + cream + warm taupe; law → navy + brass + ivory).',
        '  For automotive/trades/fitness go BOLD and SATURATED — a confident signature (racing red, safety orange, electric blue) plus a bright accent (gold/amber) over NEAR-BLACK surfaces; use full-bleed near-black sections for drama. Do not mute it.',
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
        '• BUTTON SHAPE matches the brand personality: SHARP squared (rounded-none/rounded-md), uppercase, bold, with a hover COLOR-INVERSION (e.g. black→signature-color) for automotive/industrial/trades/fitness; soft rounded-full pills for wellness/beauty/food/kids. Pick ONE and use it consistently.',
        '• BRANDED DEPTH — layer at least 3 of: an offset solid color block sitting behind the hero/feature image; an oversized faint outline circle bleeding off a section edge; a floating badge/info card overlapping an image corner; a per-section texture (dot-grid or 45° stripes at ~5% opacity); a thin multi-color accent bar across the top of a dark section; numbered process steps joined by a gradient connector line. This layering is what separates a real site from a flat template.',
        '• CARDS rounded (match button family), tasteful shadows, smooth scroll, and subtle hover transitions (lift + border/color change) everywhere.',
        '• MOTION: add a .animate-on-scroll fade-up revealed by an IntersectionObserver, and honor prefers-reduced-motion.',
        '',
        'CONTENT: write real, specific, warm copy for THIS business (named packages/prices, local references, real-sounding',
        'testimonials with names) — never lorem ipsum. IMAGERY: use the provided image URLs if any. For any OTHER image (about, gallery, testimonial avatars) build a pollinations URL:',
        'https://image.pollinations.ai/prompt/<url-encoded scene>?width=1200&height=1500&nologo=true&nofeed=true&enhance=true&model=flux — and write a RICH, specific, photographic scene (subject + setting + golden-hour lighting + 35mm/50mm lens + shallow depth of field + "editorial magazine-quality photograph, hyper-detailed" + "no text no watermark"). Descriptive prompts = far better images. For testimonial avatars use a real portrait scene ("candid editorial portrait of a warm smiling <persona>, natural light, shallow depth of field, no text").',
        '',
        'QUALITY GATE (REQUIRED — graded): EXACTLY ONE <h1> on the entire page (the hero headline; every other heading is h2/h3/h4 — do NOT use a second h1). Footer copyright MUST render the CURRENT year via inline script: © <script>document.write(new Date().getFullYear())</script> — never a hard-coded past year. Include a real PRIVACY notice: a footer "Privacy Policy" link to a short privacy section/statement on the page (id="privacy") covering what info the contact form collects and that it is not shared.',
        'ACCESSIBILITY (required): semantic landmarks (header/nav/main/footer), exactly one <h1>, a <label> for every form field,',
        'text contrast >= 4.5:1 against its background, visible :focus-visible outlines, descriptive alt text on every image,',
        'and a @media (prefers-reduced-motion: reduce) block that disables animation/transition.',
        '',
        'FORM COPY (REQUIRED): any validation/error message must be specific, constructive, and human — NEVER "Invalid input" or a raw code. Use setCustomValidity or inline helper text, e.g. email invalid → "Please enter a valid email like name@example.com"; empty required field → "Please add your name so we can reply". Friendly, not robotic or blaming. Place the message right next to the field it refers to.',
        'RESPONSIVE (REQUIRED — non-negotiable): the site MUST look perfect on phone, tablet, AND desktop. Include <meta name="viewport" content="width=device-width, initial-scale=1">.',
        'Use responsive Tailwind prefixes (sm: md: lg:) on every multi-column layout — grids collapse to one column on mobile, font sizes scale down (use clamp() or responsive text classes), padding shrinks on small screens.',
        'EVERY max-width content container MUST carry horizontal padding (e.g. px-5 sm:px-6) so text and buttons never touch the screen edge on a phone. The hero headline must scale on mobile (clamp or text-4xl sm:text-5xl lg:text-6xl), never a fixed huge size that overflows.',
        'The nav MUST have a WORKING mobile hamburger menu: put the mobile links in their own container with id="mobile-menu" class="hidden ..."; the hamburger button onclick toggles ONLY that container — document.getElementById("mobile-menu").classList.toggle("hidden") — then swaps the menu/x icon and re-runs lucide.createIcons(). NEVER toggle the button’s own wrapper or a desktop-only div. It must actually open and show the links when tapped on a 375px screen. No horizontal scrolling at any width. Tap targets >= 44px. Images use max-width:100% and never overflow.',
        '',
        'REQUIRED SECTIONS (include ALL, in this order — do not skip any):',
        '1. Sticky header nav: a LOGO LOCKUP (a rounded-square monogram badge with the business initials in the brand primary, OR a small relevant inline-SVG mark, set NEXT TO the business name — never the bare name alone), anchor links, a tap-to-call phone (tel: link) if a phone is given, and a filled primary CTA. Echo a smaller lockup in the footer.',
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
      const FLAGSHIP = [
        'FLAGSHIP (PREMIUM) BUILD: this is the top-tier build — one LONG, dense, magazine-quality single page that must look like it cost $5,000+.',
        'HERO must be a TWO-COLUMN split: left = a small rating/eyebrow pill, a large headline (light weight, with 1–2 emphasis words italicized in an accent color), a lead paragraph, two CTAs, and a small meta row (location · a trust point). Right = the hero image in a LARGE rounded (rounded-3xl/[2rem]) frame, WITH two small FLOATING CARDS overlapping its corners (e.g. a “★ 5.0 Google Reviews” card and a live-detail card like “Next class · 6:30 AM” or “Open Today”). This floating-card-over-rounded-image hero is the signature of a premium build — always include it.',
        'SIGNATURE DEVICES (include most): service cards each = an icon inside a filled rounded-square (that shifts color/rotates on hover) + title + description + a small meta row; a STATS band of 3–4 big numbers where cards ALTERNATE between white and filled brand-color backgrounds; TESTIMONIALS as 3 cards each with a round avatar + name + star row, with ONE card offset (mt-8) and/or filled in a brand color for rhythm; an ABOUT section on a filled brand-color background with an image carrying an offset “Est. YYYY” badge and 2 small credential cards; a CONTACT section on a DARK gradient background with soft blurred color-blob glows behind, a GLASSMORPHISM form (translucent bg + backdrop-blur + border) beside stacked glass info cards (address/phone/hours/rating); a rich multi-column FOOTER with grouped links, small social icons, a dynamic-year copyright, and an italic tagline.',
        'DEPTH & MOTION: layer soft blurred color-blob glows (blur-3xl, low opacity) behind hero/about/contact for calm brands, or hard geometric shapes for bold brands. Add a .animate-on-scroll fade-up (translateY+opacity) revealed by an IntersectionObserver, honoring prefers-reduced-motion. Hover-lift every card.',
        'Write MORE copy per section (2–4 real, specific sentences) with local detail and named packages/prices. Depth, polish, and length over brevity.',
      ].join('\n');
      const sysFinal = body.multipage ? (sysFP + '\n\n' + MULTIPAGE) : (body.premium ? (sysFP + '\n\n' + FLAGSHIP) : sysFP);
      const userFP = 'BUSINESS:\n' + JSON.stringify(biz, null, 2) +
        '\nINDUSTRY: ' + String(body.industry || '') +
        '\nIMAGE URLS (use these for the hero/gallery if present): ' + JSON.stringify(body.images || []) +
        '\nREFINEMENT INSTRUCTION (optional): ' + String(body.instruction || '');
      const callLLM = (m) => fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: m, temperature: 0.8, max_tokens: (body.multipage || body.premium) ? 16000 : 14000, messages: [{ role: 'system', content: sysFinal }, { role: 'user', content: userFP }] }),
      });
      let rFP = await callLLM(model);
      let jFP = await rFP.json();
      // If the flagship model isn't available on this key (and OPENAI_MODEL wasn't explicitly set),
      // gracefully fall back to gpt-4o-mini so generation never hard-fails on a model-access error.
      if (!rFP.ok && !process.env.OPENAI_MODEL && model !== 'gpt-4o-mini' && /model|does not exist|not found|access|unsupported|not allowed|deprecat/i.test((jFP.error && jFP.error.message) || '')) {
        rFP = await callLLM('gpt-4o-mini'); jFP = await rFP.json();
      }
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

      // 4a) Lucide icons: the model often calls lucide.createIcons() in <head> (before the body
      //     exists, so nothing renders). Ensure a post-DOM call so correctly-authored icons appear.
      if (/lucide/i.test(html) && !/DOMContentLoaded[\s\S]{0,80}createIcons/i.test(html)) {
        html = html.replace(/<\/body>/i, '<script>document.addEventListener("DOMContentLoaded",function(){try{lucide.createIcons()}catch(e){}})</' + 'script></body>');
      }

      // 4a2) Lucide: the model invents icon names that don't exist (tire/brake/oil…) → blank icons.
      //      Remap the common invalid ones to real Lucide icons so no icon slot renders empty.
      const ICON_FIX = { tire: 'circle-dot', tires: 'circle-dot', wheel: 'circle-dot', brake: 'disc', brakes: 'disc', 'brake-disc': 'disc', oil: 'droplet', 'oil-can': 'droplet', alignment: 'move-horizontal', align: 'move-horizontal', 'align-vertical': 'move-horizontal', patch: 'wrench', engine: 'settings', tuneup: 'wrench', 'tune-up': 'wrench', 'spark-plug': 'zap', sparkplug: 'zap', mechanic: 'wrench', repair: 'wrench', tool: 'wrench', tools: 'wrench', battery: 'battery-charging', coolant: 'thermometer', exhaust: 'wind', suspension: 'move-vertical', diagnostic: 'activity', diagnostics: 'activity', inspection: 'clipboard-check', scissors: 'scissors', haircut: 'scissors', dumbbell: 'dumbbell', plumbing: 'wrench', electrical: 'zap', paint: 'paint-bucket', roofing: 'home', landscaping: 'trees', cleaning: 'sparkles' };
      html = html.replace(/data-lucide="([^"]+)"/gi, (m, n) => 'data-lucide="' + (ICON_FIX[String(n).toLowerCase()] || n) + '"');

      // 4b) Tailwind uses "gray", not "grey" — the model sometimes writes bg-grey-100 etc., which is
      //     an unknown class that renders as no background (flat white sections). Normalize.
      html = html.replace(/\b(bg|text|border|from|via|to|ring|divide|placeholder|fill|stroke)-grey-/g, '$1-gray-');

      // 5) FONT INSURANCE: the #1 "looks like a template" tell is a page that renders in system Arial.
      //    Two failure modes: (a) the model names fonts in its Tailwind config / CSS but never LOADS
      //    them, or (b) it names none at all. Fix (a) by loading exactly the fonts it chose (preserving
      //    its design), and (b) by injecting an industry-appropriate pairing bound to headings/body.
      if (!/fonts\.googleapis\.com/i.test(html)) {
        const preconnect = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>';
        const fam = (n) => n.replace(/ /g, '+');
        // Whitelist of common Google Font families we can safely load on demand.
        const WL = ['Merriweather', 'Poppins', 'Oswald', 'Inter', 'Playfair Display', 'Montserrat', 'Lora', 'Roboto', 'Raleway', 'Nunito Sans', 'Nunito', 'Source Sans 3', 'Work Sans', 'Rubik', 'Karla', 'Manrope', 'DM Sans', 'DM Serif Display', 'Cormorant Garamond', 'Fraunces', 'Bebas Neue', 'Archivo', 'Libre Baskerville', 'Space Grotesk', 'Josefin Sans', 'Quicksand', 'Mulish', 'Barlow', 'PT Serif', 'Bitter', 'Teko', 'Anton', 'Cinzel', 'Marcellus', 'Sora', 'Outfit', 'Figtree', 'Plus Jakarta Sans', 'Epilogue'];
        const used = WL.filter((f) => new RegExp('[\'"\\s\\[(]' + f.replace(/ /g, '[ +]') + '[\'"\\],)]', 'i').test(html)).slice(0, 3);
        if (used.length) {
          // (a) The model chose fonts but forgot to load them — load exactly those (no :wght, so a
          //     family that lacks a requested weight can never 400 the whole stylesheet).
          const link = preconnect + '<link href="https://fonts.googleapis.com/css2?' + used.map((f) => 'family=' + fam(f)).join('&') + '&display=swap" rel="stylesheet">';
          html = html.replace(/<\/head>/i, link + '</head>');
        } else {
          // (b) No fonts named anywhere — inject an industry-appropriate pairing and bind it.
          const ind = String(body.industry || biz.type || '').toLowerCase();
          let disp = 'Oswald', bod = 'Inter', fb = 'sans-serif'; // condensed/industrial default (auto, trades, fitness, tire)
          if (/law|attorney|account|financ|consult|real ?estate|realt|insur|medic|dental|clinic|wealth|advisor/.test(ind)) { disp = 'Playfair Display'; bod = 'Source Sans 3'; fb = 'serif'; }
          else if (/salon|spa|beauty|boutique|florist|wedding|photo|interior|jewel|aesthetic|nail|hair/.test(ind)) { disp = 'Cormorant Garamond'; bod = 'Nunito Sans'; fb = 'serif'; }
          else if (/restaurant|food|grill|bar\b|brew|pizza|taco|kitchen|cafe|coffee|bakery|bistro|catering/.test(ind)) { disp = 'Fraunces'; bod = 'Inter'; fb = 'serif'; }
          const link = preconnect + '<link href="https://fonts.googleapis.com/css2?family=' + fam(disp) + ':wght@500;600;700&family=' + fam(bod) + ':wght@300;400;500;600;700&display=swap" rel="stylesheet">';
          const css = '<style>h1,h2,h3,h4,.font-display,.font-serif{font-family:"' + disp + '",' + fb + '}body{font-family:"' + bod + '",system-ui,-apple-system,sans-serif}</style>';
          html = html.replace(/<\/head>/i, link + css + '</head>');
        }
      }

      // 5b) TRADE TYPE TREATMENT: for automotive/trades/fitness the benchmark look is a BOLD CONDENSED
      //     font in UPPERCASE with tight tracking (Oswald-poster energy). Enforce it deterministically
      //     for those industries so headings stop reading as a soft, generic serif.
      const indL = String(body.industry || biz.type || '').toLowerCase();
      const TRADES = /tire|auto|car\b|vehicle|mechanic|repair|garage|body ?shop|detail|hvac|plumb|electric|roofing|constru|contractor|landscap|fitness|gym|crossfit|weld|tow|fabricat|machin|excavat|paving|concrete|fencing|mover|moving|pest|locksmith|glass|paint/;
      const WELLNESS = /yoga|pilates|medita|mindful|wellness|\bspa\b|massage|salon|beauty|aesthetic|reiki|therap|acupunctur|holistic|retreat|wax|facial|skincare|chiropract/;
      if (TRADES.test(indL)) {
        // Bold, condensed, UPPERCASE — the industrial "poster" look (auto/trades/gym).
        const treat = '<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&display=swap" rel="stylesheet"><style>h1,h2,h3,h4,.font-display,.font-heading,.font-serif{font-family:"Oswald",system-ui,sans-serif!important;text-transform:uppercase;letter-spacing:.01em;line-height:1.05}</style>';
        html = html.replace(/<\/head>/i, treat + '</head>');
      } else if (WELLNESS.test(indL)) {
        // Elegant, airy, light serif in normal case — the calm spa/yoga look.
        const treat = '<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500&display=swap" rel="stylesheet"><style>h1,h2,h3,h4,.font-display,.font-heading,.font-serif{font-family:"Fraunces",Georgia,serif!important;font-weight:400;letter-spacing:-.01em;text-transform:none}h1{font-weight:300}</style>';
        html = html.replace(/<\/head>/i, treat + '</head>');
      }

      // 6) Brand primary (from the model's Tailwind config) drives the logo mark + texture below.
      const pm = html.match(/primary\s*:\s*['"](#[0-9a-fA-F]{3,8})['"]/);
      const primary = pm ? pm[1] : '#1a1a1a';
      const hexA = (h, a) => { const m = /^#?([0-9a-f]{6})$/i.exec(h) || /^#?([0-9a-f]{3})$/i.exec(h); if (!m) return 'rgba(0,0,0,' + a + ')'; let s = m[1]; if (s.length === 3) s = s.split('').map((c) => c + c).join(''); const n = parseInt(s, 16); return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; };

      // 7) LOGO LOCKUP: pair a monogram badge with the business name in the header when there's no
      //    real image logo — the "designed brand mark" that separates a real site from a template.
      try {
        const hMatch = html.match(/<header[\s\S]*?<\/header>/i);
        const nameStr = String(biz.name || '').trim();
        const initials = nameStr ? ((nameStr.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')) || nameStr[0].toUpperCase()) : '';
        // Only inject if the model did NOT already build a brand mark (image, a "logo"-classed
        // element, an icon, or a standalone monogram of the initials) — else we double up badges.
        const hasMark = hMatch && (
          /<img\b/i.test(hMatch[0]) ||
          /class="[^"]*\blogo\b/i.test(hMatch[0]) ||
          /data-lucide="(?!menu)[a-z][a-z-]*"/i.test(hMatch[0]) ||        // any icon logo other than the hamburger
          />\s*[A-Z]{2,4}\s*</.test(hMatch[0]) ||                          // a standalone monogram like "GF"/"WT"
          (initials && new RegExp('>\\s*' + initials + '\\s*<').test(hMatch[0]))
        );
        if (hMatch && nameStr && !hasMark && hMatch[0].indexOf(nameStr) >= 0) {
          const badge = '<span aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;width:2.2rem;height:2.2rem;border-radius:.6rem;background:' + primary + ';color:#fff;font-weight:800;font-size:.85rem;line-height:1;flex:0 0 auto">' + initials + '</span>';
          const lockup = '<span style="display:inline-flex;align-items:center;gap:.55rem">' + badge + '<span>' + nameStr + '</span></span>';
          const newHdr = hMatch[0].replace(nameStr, () => lockup);
          html = html.replace(hMatch[0], () => newHdr);
        }
      } catch (e) {}

      // 8) PHONE + TEXTURE insurance: guarantee it looks right on a cell phone (no horizontal scroll,
      //    no edge-to-edge text, headline scales down) and add a subtle dot-grid depth like sitedrop.
      const polish = '<style>'
        + 'html,body{overflow-x:hidden;max-width:100%}img{max-width:100%;height:auto}*{min-width:0}'
        + 'body{background-image:radial-gradient(' + hexA(primary, 0.05) + ' 1px,transparent 1px);background-size:22px 22px}'
        + '@media (max-width:640px){'
        + 'h1{font-size:clamp(1.9rem,8vw,2.75rem);line-height:1.12;word-break:break-word}'
        + '.max-w-7xl,.max-w-6xl,.max-w-5xl,.max-w-4xl,.max-w-3xl,.max-w-2xl,.max-w-xl,.max-w-lg,.max-w-md{padding-left:1.1rem;padding-right:1.1rem}'
        + '.text-6xl,.text-7xl,.text-8xl{font-size:2.5rem;line-height:1.1}'
        + '}</style>';
      html = html.replace(/<\/head>/i, polish + '</head>');

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
