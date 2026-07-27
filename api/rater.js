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
const { put } = require('@vercel/blob');

// Score history per domain (last 12 rates) — enables "63 → 92 since April, here's what fixed it".
async function historyFor(host) {
  const token = process.env.BLOB_READ_WRITE_TOKEN; if (!token) return null;
  try {
    const r = await fetch('https://blob.vercel-storage.com/?prefix=' + encodeURIComponent('rater-history/' + host + '.json') + '&limit=1', { headers: { Authorization: 'Bearer ' + token } });
    const j = await r.json();
    const b = j && j.blobs && j.blobs[0];
    if (!b) return [];
    const rr = await fetch(b.url, { headers: { Authorization: 'Bearer ' + token } });
    return (await rr.json()) || [];
  } catch (e) { return null; }
}
async function saveHistory(host, entries) {
  const token = process.env.BLOB_READ_WRITE_TOKEN; if (!token) return;
  try { await put('rater-history/' + host + '.json', JSON.stringify(entries.slice(-12)), { access: 'public', contentType: 'application/json', token, addRandomSuffix: false, allowOverwrite: true }); } catch (e) {}
}

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

const MEANINGS = [
  [/content-security-policy|x-content-type|clickjack|x-frame|referrer-policy|permissions-policy|hsts|security header/i, 'A standard browser security setting is missing — browsers and Google quietly trust the site less.'],
  [/https/i, 'The browser marks this site "Not secure" — many visitors leave immediately.'],
  [/contact form|lead capture/i, 'Visitors after hours have no way to reach the business — those leads call a competitor instead.'],
  [/privacy policy/i, 'California law expects a privacy policy once a site collects names or emails; customers look for it too.'],
  [/h1 count|heading/i, 'The page doesn\u2019t clearly tell Google what it\u2019s about, which hurts local search ranking.'],
  [/structured data|json-ld/i, 'Google can\u2019t read the business details (hours, location, services) — losing rich search results competitors can get.'],
  [/meta description|title missing|title.*weak/i, 'The text Google shows under the business name in search results is missing or weak — that line is the first impression.'],
  [/open graph/i, 'Shared links (texts, Facebook) show no preview image or description — links look broken or spammy.'],
  [/robots|sitemap/i, 'Google\u2019s crawler has no map of the site — pages get found slower or not at all.'],
  [/favicon/i, 'The browser-tab icon is missing — a small polish signal customers subconsciously notice.'],
  [/copyright|out of date|abandoned/i, 'The footer shows an old year — to visitors the business looks neglected or possibly closed.'],
  [/broken|missing \(removed/i, 'Some images no longer load — like a shop window with empty frames.'],
  [/viewport|phones/i, 'The site doesn\u2019t adapt to phones — where most local searches happen.'],
  [/alt text/i, 'Images lack descriptions — hurts accessibility compliance (ADA exposure) and Google ranking.'],
  [/lang attribute/i, 'A basic accessibility setting is missing — screen readers and search engines can\u2019t identify the language.'],
  [/skip link/i, 'Keyboard and screen-reader users can\u2019t skip to the content — an accessibility (ADA) basic.'],
  [/autoplay/i, 'Media plays automatically — visitors on phones find it annoying and data-hungry.'],
  [/spam protection|honeypot/i, 'The contact form has no bot protection — the inbox fills with spam and real leads get lost.'],
  [/heavy|weight/i, 'The page is slow to load — phone visitors give up before it finishes.'],
  [/placeholder|coming soon|filler/i, 'Leftover placeholder text is still live — it reads as unfinished and unprofessional.'],
  [/ai[- ]generated|disclosure/i, 'AI-generated imagery isn\u2019t disclosed — an easy transparency and trust win.'],
  [/doesn\u2019t load|www\./i, 'Anyone typing the address the other way hits an error page and assumes the business is gone.'],
  [/encoding|mojibake/i, 'Text renders as garbage characters in places — looks broken to visitors.'],
];
function meaningFor(issue) { for (const [re, m] of MEANINGS) { if (re.test(issue)) return m; } return 'A technical issue that quietly costs trust, search ranking, or leads.'; }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dasby-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

  // Anonymous-use throttle: the public grader is open by design, but cap burst abuse
  // (PSI quota + history-blob spam). Requests carrying the DASBY_KEY are exempt.
  const keyed = process.env.DASBY_KEY && req.headers['x-dasby-key'] === process.env.DASBY_KEY;
  if (!keyed && body.op !== 'activity') {
    global.__rateLog = (global.__rateLog || []).filter((t) => Date.now() - t < 3600000);
    if (global.__rateLog.length >= 40) return res.status(429).json({ error: 'busy — try again in a little while' });
    global.__rateLog.push(Date.now());
  }

  // Private grader-activity log (Vito only — requires DASBY_KEY): domains graded + score trend.
  if (body.op === 'activity') {
    if (!process.env.DASBY_KEY || req.headers['x-dasby-key'] !== process.env.DASBY_KEY) return res.status(401).json({ error: 'unauthorized' });
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return res.status(200).json({ ok: false, error: 'no storage' });
    try {
      const lr = await fetch('https://blob.vercel-storage.com/?prefix=rater-history%2F&limit=500', { headers: { Authorization: 'Bearer ' + token } });
      const lj = await lr.json();
      const out = [];
      for (const b of (lj.blobs || []).slice(0, 200)) {
        try {
          const rr = await fetch(b.url, { headers: { Authorization: 'Bearer ' + token } });
          const hist = await rr.json();
          if (!Array.isArray(hist) || !hist.length) continue;
          const first = hist[0], last = hist[hist.length - 1];
          out.push({ domain: (b.pathname.split('/').pop() || '').replace('.json', ''), rates: hist.length,
            firstScore: first.score, lastScore: last.score, change: last.score - first.score,
            firstAt: first.at, lastAt: last.at });
        } catch (e) {}
      }
      out.sort((a, b) => b.lastAt - a.lastAt);
      return res.status(200).json({ ok: true, sites: out });
    } catch (e) { return res.status(200).json({ ok: false, error: e.message }); }
  }
  const draft = typeof body.html === 'string' && body.html.length > 0;
  let url = (body.url || '').trim();
  if (!draft && !url) return res.status(400).json({ error: 'url or html required' });
  if (!draft && !/^https?:\/\//i.test(url)) url = 'https://' + url;

  let r = null, html, final, h, apexBroken = false;
  if (draft) {
    html = body.html.slice(0, 1_500_000);
    final = '(unpublished draft)';
    h = { has: () => false, get: () => '' };
  } else {
    try {
      r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(15000) });
      html = (await r.text()).slice(0, 1_500_000);
    } catch (e) {
      // Common real-world break: apex dead but www works (or vice versa). Retry the toggled host.
      try {
        const u2 = new URL(url);
        u2.hostname = u2.hostname.startsWith('www.') ? u2.hostname.slice(4) : 'www.' + u2.hostname;
        r = await fetch(u2.href, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(15000) });
        html = (await r.text()).slice(0, 1_500_000);
        apexBroken = true; url = u2.href;
      } catch (e2) {
        return res.status(200).json({ url, error: 'unreachable: ' + (e && e.message) });
      }
    }
    final = r.url || url;
    h = r.headers;
  }
  const low = html.toLowerCase();
  const NOW = new Date().getFullYear();
  const findings = [];
  let score = 0, total = 130;
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
  const noalt = imgs.filter(i => !/alt=/i.test(i)).length; // empty alt="" is valid (decorative)
  check(5, imgs.length === 0 || noalt === 0, `${noalt}/${imgs.length} images missing alt text`, 'Alt text on every meaningful image');
  check(3, /(skip[^"<>]{0,20}(content|nav)|#main|#content)/.test(low), 'No skip link', 'Add a skip-to-content link');
  check(2, !low.includes('autoplay'), 'Autoplay media present', 'Make media click-to-play');

  // forms (10)
  const hasForm = low.includes('<form');
  check(5, hasForm, 'No inquiry/contact form (no after-hours lead capture)', 'Add a validated contact form');
  if (hasForm) {
    check(5, /(honeypot|website["'][^>]*(hidden|tabindex=["']-1))/.test(low), 'Form has no visible spam protection', 'Add a honeypot field + validation');
  } else total -= 5;

  // privacy (5) — mandated by the XENON site-audit; matters once a site collects any visitor info
  check(5, /privacy[\s-]*policy/i.test(html) || /href=["'][^"']*privac/i.test(html),
    'No privacy policy', 'Add a privacy policy page (legally expected once a site collects visitor info via forms/analytics)');

  // AI-imagery disclosure (3) — trust + emerging AI-transparency rules; graded only when AI images are present
  const aiImg = /image\.pollinations\.ai|public\.blob\.vercel-storage\.com\/sitedrop-img|fal\.media/i.test(html);
  if (aiImg) {
    check(3, /AI[-\s]generated|artificial intelligence/i.test(html),
      'AI-generated imagery is used but not disclosed anywhere',
      'Add a short disclosure line (e.g. "Some imagery on this site is AI-generated") in the footer or privacy section');
  } else total -= 3;

  // freshness / staleness (7) — a neglected-looking site quietly loses customers' trust
  const cpy = (html.match(/(?:\u00a9|&copy;|copyright)\s*(?:&\w+;\s*)?((?:19|20)\d{2})/i) || [])[1];
  check(4, !cpy || Number(cpy) >= NOW - 1,
    `Copyright still says ${cpy} — the site looks out of date/abandoned to visitors`,
    'Update the footer year (and keep it auto-updating)');
  const lowNoAttrs = low.replace(/placeholder="[^"]*"/g, '').replace(/placeholder='[^']*'/g, '');
  check(3, !/(coming soon|under construction|lorem ipsum|placeholder text|your text here|example\.com)/i.test(lowNoAttrs),
    'Placeholder text, "coming soon", or filler still live on the site',
    'Replace leftover placeholder/coming-soon content with real copy');

  // reachability (5) — one hostname variant dead (apex vs www) loses everyone who types it
  if (!draft) {
    check(5, !apexBroken, 'One version of the address doesn\u2019t load (with vs without \u201cwww.\u201d) \u2014 only ' + (final.includes('//www.') ? 'the www. version works' : 'the bare domain works'),
      'Fix DNS/SSL for the failing variant or 301-redirect it to the working one');
  } else total -= 5;

  // speed (6) — Google PageSpeed Insights (mobile). The #1 signal owners have heard of.
  let speed = null;
  if (!draft) {
    try {
      const pr = await fetch('https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=' + encodeURIComponent(final) + '&category=performance&strategy=mobile' + ((process.env.PSI_KEY || process.env.GOOGLE_PLACES_KEY) ? ('&key=' + (process.env.PSI_KEY || process.env.GOOGLE_PLACES_KEY)) : ''), { signal: AbortSignal.timeout(35000) });
      const pj = await pr.json();
      const lr = pj && pj.lighthouseResult;
      if (lr && lr.categories && lr.categories.performance) {
        speed = { score: Math.round((lr.categories.performance.score || 0) * 100),
                  lcp: (lr.audits && lr.audits['largest-contentful-paint'] && lr.audits['largest-contentful-paint'].displayValue) || '',
                  cls: (lr.audits && lr.audits['cumulative-layout-shift'] && lr.audits['cumulative-layout-shift'].displayValue) || '' };
        check(6, speed.score >= 50, `Slow on phones — Google performance score ${speed.score}/100 (LCP ${speed.lcp})`, 'Compress images, defer scripts, reduce page weight');
      } else { total -= 6; var _pe=(pj&&pj.error&&pj.error.message)||'no lighthouse data'; global.__psiErr=_pe; }
    } catch (e) { total -= 6; global.__psiErr=(e&&e.message)||'psi fetch failed'; }
  } else total -= 6;

  // link health (4) — sample internal links for 404s
  if (!draft) {
    try {
      const hosts = new URL(final).hostname;
      const linkSrcs = [...html.matchAll(/<a\b[^>]*?href=["']([^"'#]+)["']/gi)].map((m) => m[1])
        .filter((u) => !/^(mailto:|tel:|javascript:)/i.test(u))
        .map((u) => { try { return new URL(u, final).href; } catch { return null; } })
        .filter((u) => u && new URL(u).hostname === hosts).slice(0, 5);
      let deadLinks = 0;
      for (const u of linkSrcs) { try { if ((await head(u)) >= 400) deadLinks++; } catch { deadLinks++; } }
      check(4, linkSrcs.length === 0 || deadLinks === 0, `${deadLinks}/${linkSrcs.length} sampled links are broken (404s)`, 'Fix or remove dead links — they frustrate visitors and hurt SEO');
    } catch (e) { total -= 4; }
  } else total -= 4;

  // media health (10)
  if (draft) { total -= 6; } else {
  const srcs = [...html.matchAll(/<img\b[^>]*?src=["']([^"']+)/gi)].map(m => m[1]).filter(s => !s.startsWith('data:')).slice(0, 5);
  let broken = 0;
  for (const s of srcs) { try { if ((await head(new URL(s, final).href)) >= 400) broken++; } catch { broken++; } }
  check(6, srcs.length === 0 || broken === 0, `${broken}/${srcs.length} sampled images are broken/missing (removed or discontinued photos)`, 'Fix image hosting — a shop window with no pictures');
  }
  check(4, !html.includes('â€') && !html.includes('Ã©'), 'Text encoding is broken (mojibake visible)', 'Serve UTF-8 with <meta charset>');

  // weight (5)
  const kb = Math.round(html.length / 1024);
  check(5, kb < 900, `Very heavy page (~${kb}KB HTML)`, 'Trim page weight');

  const pct = Math.round(score * 100 / total);
  const band = pct >= 90 ? 'Launch-ready (90+)' : pct >= 85 ? 'Strong, minor fixes (85-89)'
    : pct >= 75 ? 'Needs revision (75-84)' : pct >= 71 ? 'Borderline (71-74)'
    : 'QUALIFIED PROSPECT — significant issues (<=70)';

  // JS-rendered sites (React/Wix/etc.) serve a near-empty HTML shell — content checks
  // (privacy link, form, h1) may be FALSE findings because the real DOM renders client-side.
  const visibleWords = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  const jsShell = visibleWords < 60 && /<script/i.test(html);

  const themeColor = ((html.match(/name=["']theme-color["'][^>]*content=["'](#[0-9a-fA-F]{3,8})/i) || [])[1]) || ((html.match(/(?:--(?:primary|brand|main|accent)[^:]*:\s*)(#[0-9a-fA-F]{6})/i) || [])[1]) || '';

  // history + what-changed attribution
  let history;
  if (!draft) {
    try {
      const host = new URL(final).hostname.replace(/^www\./, '');
      const past = await historyFor(host);
      if (past !== null) {
        const nowIssues = findings.map((f) => f.issue.replace(/\d+/g, 'N'));
        const prev = past.length ? past[past.length - 1] : null;
        if (prev) {
          history = {
            prevScore: prev.score, prevAt: prev.at, change: pct - prev.score,
            fixed: (prev.issues || []).filter((i) => !nowIssues.includes(i)).slice(0, 6),
            regressed: nowIssues.filter((i) => !(prev.issues || []).includes(i)).slice(0, 6),
            rates: past.length + 1,
          };
        }
        past.push({ at: Date.now(), score: pct, issues: nowIssues });
        await saveHistory(host, past);
      }
    } catch (e) {}
  }

  return res.status(200).json({
    url: final, draft, mechanical_score: pct, band, prospect: pct <= 70, themeColor: themeColor || undefined, history: history || undefined,
    findings: findings.sort((a, b) => b.points_lost - a.points_lost).map((f) => ({ ...f, meaning: meaningFor(f.issue) })),
    jsRendered: jsShell || undefined, speed: speed || undefined, psiError: (!speed && global.__psiErr) || undefined,
    note: (jsShell ? '⚠ This site renders client-side (JS shell) — content findings (privacy/form/h1) may be false; verify in a browser before quoting them in a pitch. SEO findings remain valid: search engines see the same thin shell. ' : '') + 'Mechanical checks only. A full XENON Studio review adds strategy, brand, design, and content judgment — this score is the floor, not the whole audit.'
  });
};
