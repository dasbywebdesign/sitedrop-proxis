// XENON Website Rater proxy — grades any live website and returns a 0-100
// mechanical score with findings. Powers the "Website Rater" in SiteDrop:
// Lead Finder -> rate the lead's current site -> score <=70 auto-qualifies the
// prospect -> findings feed the proposal ("here's what's costing you customers").
//
// POST { url: "https://example.com" }
//   -> { url, mechanical_score, band, prospect, findings:[{points_lost,issue,fix}], note }
//
// Honest by design: this is the MECHANICAL score (security, SEO, accessibility
// basics, forms, media health). Strategy/brand/design judgment needs the full
// XENON Studio review — the response says so instead of faking a complete audit.
//
// SETUP: deploy at api/rater.js (vercel.json gives it maxDuration 60).
//   Env: ALLOW_ORIGIN = your tool's URL (or "*" while testing)
// Builder chat:  rater proxy https://<project>.vercel.app/api/rater

const UA = { 'User-Agent': 'Mozilla/5.0 (XENON-Rater/1.0)' };

async function head(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', headers: UA, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    if (r.status === 405) throw new Error('retry');
    return r.status;
  } catch {
    try {
      const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(8000) });
      return r.status;
    } catch { return 0; }
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const draft = typeof body.html === 'string' && body.html.length > 0;
  let url = (body.url || '').trim();
  if (!draft && !url) return res.status(400).json({ error: 'url or html required' });
  if (!draft && !/^https?:\/\//i.test(url)) url = 'https://' + url;

  let r = null, html, final, h;
  if (draft) {
    html = body.html.slice(0, 1_500_000);
    final = '(unpublished draft)';
    h = { has: () => false, get: () => '' };
  } else {
    try {
      r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(15000) });
      html = (await r.text()).slice(0, 1_500_000);
    } catch (e) {
      return res.status(200).json({ url, error: 'unreachable: ' + (e && e.message) });
    }
    final = r.url || url;
    h = r.headers;
  }
  const low = html.toLowerCase();
  const findings = [];
  let score = 0, total = 100;
  const check = (pts, ok, issue, fix) => { if (ok) score += pts; else findings.push({ points_lost: pts, issue, fix }); };

  // security (30) — skipped for unpublished drafts (no server yet)
  if (draft) { total -= 30; } else {
  check(6, final.startsWith('https'), 'Not served over HTTPS', 'Enable TLS + redirect HTTP to HTTPS');
  check(5, h.has('strict-transport-security'), 'Missing HSTS header', 'Add Strict-Transport-Security');
  check(7, h.has('content-security-policy'), 'No Content-Security-Policy', 'Add a CSP header');
  check(4, h.has('x-content-type-options'), 'Missing X-Content-Type-Options', 'Add nosniff');
  check(4, h.has('x-frame-options') || (h.get('content-security-policy') || '').includes('frame-ancestors'),
    'No clickjacking protection', 'Add frame-ancestors or X-Frame-Options');
  check(2, h.has('referrer-policy'), 'Missing Referrer-Policy', 'Add strict-origin-when-cross-origin');
  check(2, h.has('permissions-policy'), 'Missing Permissions-Policy', 'Deny camera/mic/geo by default');
  }

  // SEO (25)
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  check(4, title.trim().length >= 10 && title.trim().length <= 70, 'Page title missing/weak', 'Descriptive title with service + location');
  check(5, /name=["']description["']/i.test(html), 'No meta description', 'Add a 150-char description');
  check(4, /property=["']og:title["']/i.test(html), 'No Open Graph tags', 'Add og:title/description/image');
  check(4, low.includes('application/ld+json'), 'No structured data (JSON-LD)', 'Add LocalBusiness schema');
  check(2, /rel=["'][^"']*icon/i.test(html), 'No favicon', 'Add a favicon');
  if (draft) { total -= 6; } else {
  check(3, (await head(new URL('/robots.txt', final).href)) === 200, 'No robots.txt', 'Add robots.txt');
  check(3, (await head(new URL('/sitemap.xml', final).href)) === 200, 'No sitemap.xml', 'Add a sitemap');
  }

  // accessibility (20)
  check(3, /<html[^>]+lang=/i.test(html), 'No lang attribute', 'Set <html lang>');
  check(3, /name=["']viewport["']/i.test(html), 'No viewport meta (broken on phones)', 'Add responsive viewport meta');
  const h1s = (html.match(/<h1[\s>]/gi) || []).length;
  check(4, h1s === 1, `H1 count is ${h1s} (should be exactly 1)`, 'One H1 per page');
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  const noalt = imgs.filter(i => !/alt=["'][^"']+["']/i.test(i)).length;
  check(5, imgs.length === 0 || noalt === 0, `${noalt}/${imgs.length} images missing alt text`, 'Alt text on every meaningful image');
  check(3, /(skip[^"<>]{0,20}(content|nav)|#main|#content)/.test(low), 'No skip link', 'Add a skip-to-content link');
  check(2, !low.includes('autoplay'), 'Autoplay media present', 'Make media click-to-play');

  // forms (10)
  const hasForm = low.includes('<form');
  check(5, hasForm, 'No inquiry/contact form (no after-hours lead capture)', 'Add a validated contact form');
  if (hasForm) {
    check(5, /(honeypot|website["'][^>]*(hidden|tabindex=["']-1))/.test(low), 'Form has no visible spam protection', 'Add a honeypot field + validation');
  } else total -= 5;

  // media health (10)
  if (draft) { total -= 6; } else {
  const srcs = [...html.matchAll(/<img\b[^>]*?src=["']([^"']+)/gi)].map(m => m[1]).filter(s => !s.startsWith('data:')).slice(0, 5);
  let broken = 0;
  for (const s of srcs) { try { if ((await head(new URL(s, final).href)) >= 400) broken++; } catch { broken++; } }
  check(6, srcs.length === 0 || broken === 0, `${broken}/${srcs.length} sampled images are BROKEN (404)`, 'Fix image hosting — a shop window with no pictures');
  }
  check(4, !html.includes('â€') && !html.includes('Ã©'), 'Text encoding is broken (mojibake visible)', 'Serve UTF-8 with <meta charset>');

  // weight (5)
  const kb = Math.round(html.length / 1024);
  check(5, kb < 900, `Very heavy page (~${kb}KB HTML)`, 'Trim page weight');

  const pct = Math.round(score * 100 / total);
  const band = pct >= 90 ? 'Launch-ready (90+)' : pct >= 85 ? 'Strong, minor fixes (85-89)'
    : pct >= 75 ? 'Needs revision (75-84)' : pct >= 71 ? 'Borderline (71-74)'
    : 'QUALIFIED PROSPECT — significant issues (<=70)';

  return res.status(200).json({
    url: final, draft, mechanical_score: pct, band, prospect: pct <= 70,
    findings: findings.sort((a, b) => b.points_lost - a.points_lost),
    note: 'Mechanical checks only. A full XENON Studio review adds strategy, brand, design, and content judgment — this score is the floor, not the whole audit.'
  });
};
