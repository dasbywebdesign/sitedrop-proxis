// Lead enrichment + web search — two "fetch-the-web" jobs in one endpoint (Vercel Hobby caps
// functions at 12, so these are combined).
//
// A) ENRICH (default): POST { url, name? } -> { email, emails:[...], socials:{...} }
//    Pulls a business's real contact email + social handles from their own website.
//
// B) WEB SEARCH: POST { query, mode:'search'|'site', limit? }
//    mode:'search' -> { provider, results:[{title,url,snippet}] }
//    mode:'site'   -> { provider, website:'<best official-site URL or "">', results:[...] }
//    Finds a business's REAL website even when it's not on their Google/Yelp listing.
//    Providers: SERPER_KEY (real Google via serper.dev, 2.5k free/mo) → keyless DuckDuckGo.

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36', Accept: 'text/html' };
const JUNK = /\.(png|jpe?g|gif|webp|svg|ico|css|js)$|@(2x|3x|sentry|example|wixpress|sentry-next|godaddy)/i;
const ROLE = /^(info|contact|hello|hi|sales|office|admin|support|team|booking|appointments|service)@/i;
const DIRECTORY = /(^|\.)(yelp|facebook|instagram|twitter|x|tiktok|linkedin|youtube|yellowpages|mapquest|bbb|indeed|glassdoor|tripadvisor|nextdoor|angi|thumbtack|houzz|healthgrades|zocdoc|vitals|opencare|birdeye|manta|chamberofcommerce|dnb|bizapedia|loopnet|zillow|realtor|apartments|google|bing|duckduckgo|wikipedia|amazon|ebay|pinterest|reddit|foursquare|citysearch|superpages|dexknows|merchantcircle|expertise|threebestrated|mapcarta|cylex|hotfrog|brownbook|find-open|ezlocal|nicelocal|opendi|dentistoffices|doctor|wellness|ratemds|sharecare|webmd|whitepages|spokeo|yellowbook|trustpilot|sitejabber|insiderpages|kudzu|elocal|n49|2findlocal|americantowns|uscity|topratedlocal|patch|local|places|mapme|yellow|business|companies|listings?|directory|reviews?|allbiz|corporationwiki|buzzfile|zoominfo|apollo|crunchbase|indeed|ziprecruiter|carecredit|opendoor)\./i;
function domainMatchesName(host, name) {
  host = host.toLowerCase().replace(/^www\./, '').split('.')[0];
  const words = String(name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !/^(and|the|inc|llc|shop|store|group|center|company|services?)$/.test(w));
  return words.some((w) => host.includes(w));
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/* ---------- enrich helpers ---------- */
function extractEmails(html) {
  const found = (html.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi) || [])
    .map((e) => e.toLowerCase())
    .filter((e) => e.length < 60 && !JUNK.test(e) && !/\.(png|jpg|jpeg|gif|webp)/.test(e) && !/[^\x20-\x7e]/.test(e));
  const uniq = Array.from(new Set(found));
  uniq.sort((a, b) => (ROLE.test(b) ? 1 : 0) - (ROLE.test(a) ? 1 : 0));
  return uniq.slice(0, 6);
}
function extractSocials(html) {
  const grab = (re) => { const m = html.match(re); return m ? m[0].replace(/["'\\<> )]+$/, '') : ''; };
  const s = {
    facebook: grab(/https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9_.\-\/]+/i),
    instagram: grab(/https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9_.\-\/]+/i),
    twitter: grab(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[A-Za-z0-9_\/]+/i),
    tiktok: grab(/https?:\/\/(?:www\.)?tiktok\.com\/@?[A-Za-z0-9_.\-\/]+/i),
    linkedin: grab(/https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[A-Za-z0-9_.\-\/]+/i),
    youtube: grab(/https?:\/\/(?:www\.)?youtube\.com\/[A-Za-z0-9_@.\-\/]+/i),
  };
  ['facebook', 'instagram', 'twitter', 'tiktok', 'linkedin', 'youtube'].forEach((k) => {
    if (/(sharer|share\.php|intent|\/tr\?|plugins|\/hashtag\/)/i.test(s[k])) s[k] = '';
  });
  return s;
}
async function grab(url) {
  try {
    const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    if (!r.ok) return '';
    if (!/html|text/i.test(r.headers.get('content-type') || '')) return '';
    return (await r.text()).slice(0, 500000);
  } catch (e) { return ''; }
}
async function doEnrich(url) {
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let base; try { base = new URL(url); } catch (_) { return { error: 'bad url' }; }
  let html = await grab(url);
  let emails = extractEmails(html);
  const socials = extractSocials(html);
  if (!emails.length) {
    for (const path of ['/contact', '/contact-us', '/about', '/about-us']) {
      const h2 = await grab(base.origin + path);
      if (h2) { html += ' ' + h2; emails = extractEmails(html); const s2 = extractSocials(h2); Object.keys(s2).forEach((k) => { if (s2[k] && !socials[k]) socials[k] = s2[k]; }); if (emails.length) break; }
    }
  }
  return { email: emails[0] || '', emails, socials };
}

/* ---------- web-search helpers ---------- */
function isDirectory(url) { try { return DIRECTORY.test(new URL(url).hostname.replace(/^www\./, '')); } catch (e) { return true; } }
async function serper(q, limit) {
  const r = await fetch('https://google.serper.dev/search', { method: 'POST', headers: { 'X-API-KEY': process.env.SERPER_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ q, num: Math.min(limit || 10, 20) }), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('serper ' + r.status);
  const j = await r.json();
  return (j.organic || []).map((o) => ({ title: o.title || '', url: o.link || '', snippet: o.snippet || '' })).filter((x) => x.url);
}
function decodeDdg(href) { const m = href.match(/[?&]uddg=([^&]+)/); if (m) { try { return decodeURIComponent(m[1]); } catch (e) {} } if (href.indexOf('//') === 0) return 'https:' + href; return href; }
async function ddg(q, limit) {
  const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), { headers: UA, signal: AbortSignal.timeout(11000) });
  if (!r.ok) throw new Error('ddg ' + r.status);
  const html = await r.text(); const out = []; const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g; let m;
  while ((m = re.exec(html)) && out.length < (limit || 10)) { const url = decodeDdg(m[1]); const title = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); if (/^https?:\/\//.test(url)) out.push({ title, url, snippet: '' }); }
  return out;
}
async function brave(q, limit) {
  const r = await fetch('https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(q) + '&count=' + Math.min(limit || 10, 20), { headers: { 'X-Subscription-Token': process.env.BRAVE_KEY, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('brave ' + r.status);
  const j = await r.json();
  return ((j.web && j.web.results) || []).map((o) => ({ title: o.title || '', url: o.url || '', snippet: o.description || '' })).filter((x) => x.url);
}
async function doSearch(query, limit) {
  let results = [], provider = '';
  if (process.env.SERPER_KEY) { try { results = await serper(query, limit); provider = 'google(serper)'; } catch (e) {} }
  if (!results.length && process.env.BRAVE_KEY) { try { results = await brave(query, limit); provider = 'brave'; } catch (e) {} }
  if (!results.length) { try { results = await ddg(query, limit); provider = 'duckduckgo'; } catch (e) {} }
  return { results, provider };
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    // B) web search
    if (b.mode === 'search' || b.mode === 'site') {
      const query = String(b.query || '').trim().slice(0, 140);
      if (!query) return res.status(400).json({ error: 'query required' });
      const { results, provider } = await doSearch(query, Math.min(Number(b.limit) || 10, 20));
      if (b.mode === 'site') {
        const name = String(b.name || query);
        const nonDir = results.filter((r) => r.url && !isDirectory(r.url));
        // Prefer a domain whose name matches the business (allsmilesfresno.com for "All Smiles");
        // fall back to the top non-directory result only if it ALSO name-matches — otherwise
        // treat as "no official site found" rather than guessing a stranger's domain.
        let cand = null;
        for (const r of nonDir) { try { if (domainMatchesName(new URL(r.url).hostname, name)) { cand = r; break; } } catch (e) {} }
        return res.status(200).json({ provider, website: cand ? cand.url : '', matched: !!cand, results: results.slice(0, 6) });
      }
      return res.status(200).json({ provider, results: results.slice(0, Math.min(Number(b.limit) || 10, 20)) });
    }

    // A) enrich
    const url = String(b.url || '').trim();
    if (!url) return res.status(400).json({ error: 'url or query required' });
    return res.status(200).json(await doEnrich(url));
  } catch (e) {
    return res.status(200).json({ error: e && e.message ? e.message : 'error' });
  }
};
