// Lead enrichment proxy — pulls a business's real contact EMAIL and SOCIAL handles
// from their own website (server-side; the browser can't fetch third-party sites due to CORS).
//
// POST { url: 'https://business.com', name?: 'Business' }
//   -> { email, emails:[...], socials:{facebook,instagram,twitter,tiktok,linkedin,youtube} }
//   -> { error } on failure (tool falls back to its guessed email)
//
// Fetches the homepage + a couple of likely contact pages, extracts emails (prioritizing
// role addresses like info@/contact@/hello@), and social profile links. No key required.

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36', Accept: 'text/html' };
const JUNK = /\.(png|jpe?g|gif|webp|svg|ico|css|js)$|@(2x|3x|sentry|example|wixpress|sentry-next|godaddy)/i;
const ROLE = /^(info|contact|hello|hi|sales|office|admin|support|team|booking|appointments|service)@/i;

function extractEmails(html) {
  const found = (html.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi) || [])
    .map((e) => e.toLowerCase())
    .filter((e) => e.length < 60 && !JUNK.test(e) && !/\.(png|jpg|jpeg|gif|webp)/.test(e) && !/[^\x20-\x7e]/.test(e));
  const uniq = Array.from(new Set(found));
  uniq.sort((a, b) => (ROLE.test(b) ? 1 : 0) - (ROLE.test(a) ? 1 : 0)); // role addresses first
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
  // strip obvious sharer/generic links
  ['facebook', 'instagram', 'twitter', 'tiktok', 'linkedin', 'youtube'].forEach((k) => {
    if (/(sharer|share\.php|intent|\/tr\?|plugins|\/hashtag\/)/i.test(s[k])) s[k] = '';
  });
  return s;
}

async function grab(url) {
  try {
    const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    if (!r.ok) return '';
    const ct = r.headers.get('content-type') || '';
    if (!/html|text/i.test(ct)) return '';
    const t = await r.text();
    return t.slice(0, 500000);
  } catch (e) { return ''; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    let url = String(b.url || '').trim();
    if (!url) return res.status(400).json({ error: 'url required' });
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    let base;
    try { base = new URL(url); } catch (_) { return res.status(400).json({ error: 'bad url' }); }
    const origin = base.origin;

    // homepage first; then a couple of likely contact pages if we still have no email
    let html = await grab(url);
    let emails = extractEmails(html);
    const socials = extractSocials(html);
    if (!emails.length) {
      for (const path of ['/contact', '/contact-us', '/about', '/about-us']) {
        const h2 = await grab(origin + path);
        if (h2) {
          html += ' ' + h2;
          emails = extractEmails(html);
          const s2 = extractSocials(h2);
          Object.keys(s2).forEach((k) => { if (s2[k] && !socials[k]) socials[k] = s2[k]; });
          if (emails.length) break;
        }
      }
    }
    return res.status(200).json({ email: emails[0] || '', emails, socials });
  } catch (e) {
    return res.status(200).json({ error: e && e.message ? e.message : 'error' });
  }
};
