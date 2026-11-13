// Reads a website's look: main colors, fonts, roundness and logo.
// Shared by the Cloudflare helper (functions/api/site-theme.js) and the local test page.
// `get(url, kind)` fetches for us: kind 'text' -> string, kind 'bytes' -> { bytes: Uint8Array, type }.

const MAX_CSS_FILES = 4;
const MAX_CSS_CHARS = 200 * 1024;   // keep the reading quick (the free Cloudflare plan allows ~10 ms of work)
const MAX_ICON_BYTES = 200 * 1024;

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'" };
const decode = (s) => String(s || '').replace(/&(#?x?[0-9a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);

function attrs(tag) {
  const out = {};
  tag.replace(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g, (_, k, __, a, b, c) => {
    out[k.toLowerCase()] = decode(a ?? b ?? c ?? '');
  });
  return out;
}
const tags = (html, name) => (html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || []).map(attrs);
const abs = (href, base) => { try { return new URL(href, base).href; } catch { return null; } };

// ---------- colors ----------
function toHex(raw) {
  let s = raw.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
    else if (h.length === 8) { if (parseInt(h.slice(6), 16) < 200) return null; h = h.slice(0, 6); }
    else if (h.length !== 6) return null;
    return '#' + h;
  }
  m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    if (m[4] !== undefined) { const a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]); if (a < 0.8) return null; }
    return '#' + [m[1], m[2], m[3]].map((v) => Math.min(255, +v).toString(16).padStart(2, '0')).join('');
  }
  return null;
}
export function hsl(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;

// Splits CSS into { sel, body } rules in one pass (no slow patterns: the helper has a small time budget).
function rules(css) {
  const out = [];
  for (const chunk of css.split('}')) {
    const i = chunk.lastIndexOf('{');
    if (i < 0) continue;
    out.push({ sel: chunk.slice(chunk.lastIndexOf(';', i) + 1, i).trim().toLowerCase(), body: chunk.slice(i + 1) });
  }
  return out;
}

function scoreColors(css, html) {
  const score = new Map();
  const add = (raw, w) => {
    const hex = toHex(raw);
    if (!hex) return;
    const { s, l } = hsl(hex);
    if (l > 0.93 || l < 0.04) return;           // paper white and pure black say little about a brand
    const weight = w * (s < 0.12 ? 0.25 : 1);   // greys count less
    score.set(hex, (score.get(hex) || 0) + weight);
  };
  // strongest signals: what the site says its color is
  for (const m of tags(html, 'meta')) {
    const n = (m.name || m.property || '').toLowerCase();
    if (n === 'theme-color' || n === 'msapplication-tilecolor') add(m.content || '', 12);
  }
  const BRANDVAR = /--[\w-]*(primary|brand|accent|main|theme|highlight)[\w-]*\s*:\s*([^;]+)/gi;
  const KEYSEL = /button|\.btn|(^|[\s,>])a([:\s,.]|$)|\.button|header|nav/;
  for (const r of rules(css)) {
    let m;
    BRANDVAR.lastIndex = 0;
    while ((m = BRANDVAR.exec(r.body))) (m[2].match(COLOR_RE) || []).forEach((c) => add(c, 6));
    if (KEYSEL.test(r.sel)) (r.body.match(COLOR_RE) || []).forEach((c) => add(c, 2));
  }
  // everything else, once each per mention
  (css.match(COLOR_RE) || []).slice(0, 4000).forEach((c) => add(c, 1));
  (html.match(/style\s*=\s*"[^"]*"/gi) || []).forEach((st) => (st.match(COLOR_RE) || []).forEach((c) => add(c, 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([hex, sc]) => ({ hex, score: Math.round(sc * 10) / 10 }));
}

// ---------- fonts and roundness (the "vibe") ----------
const SCRIPT = /script|cursive|pacifico|dancing|satisfy|great vibes|sacramento|caveat|kalam|handlee|amatic|parisienne|allura|lobster|cookie|shadows into/i;
const SERIF = /serif(?!.*sans)|georgia|garamond|playfair|lora|merriweather|cormorant|libre baskerville|baskerville|times|cinzel|crimson|fraunces|dm serif|prata|spectral|bodoni|didot|abril/i;
const GEOMETRIC = /montserrat|futura|poppins|inter\b|roboto|helvetica|arial|raleway|oswald|bebas|archivo|work sans|manrope|space grotesk|ibm plex|mono|source sans|open sans|lato|nunito sans|dm sans|barlow|anton|league spartan/i;
const SOFT = /nunito(?! sans)|quicksand|comfortaa|varela round|fredoka|baloo|rounded|mplus rounded|kodchasan|chewy|bubblegum/i;

function readVibe(css, html) {
  const fonts = new Map();
  const addFont = (f, w) => {
    const name = f.split(',')[0].replace(/["']/g, '').trim();
    if (!name || /^(inherit|initial|unset|var\(|-apple-system|system-ui|sans-serif|serif|monospace|blinkmacsystemfont)$/i.test(name) || name.startsWith('var(')) return;
    fonts.set(name, (fonts.get(name) || 0) + w);
  };
  const HEADSEL = /h1|h2|\.logo|\.brand|\.title|header/;
  for (const r of rules(css)) {
    const m = r.body.match(/font-family\s*:\s*([^;]+)/i);
    if (m) addFont(m[1], HEADSEL.test(r.sel) ? 4 : 1);
  }
  for (const l of tags(html, 'link')) {
    const href = l.href || '';
    if (/fonts\.googleapis\.com/.test(href)) (href.match(/family=([^&:]+)/g) || []).forEach((f) => addFont(decodeURIComponent(f.slice(7)).replace(/\+/g, ' '), 3));
  }
  const top = [...fonts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n]) => n);
  const all = top.join(' | ');

  const radii = [];
  css.replace(/border-radius\s*:\s*([^;}{]+)/gi, (_, v) => {
    const first = v.trim().split(/\s+/)[0];
    if (/%$/.test(first)) radii.push(parseFloat(first) >= 30 ? 999 : 8);
    else if (/px$/.test(first)) radii.push(parseFloat(first));
    else if (/r?em$/.test(first)) radii.push(parseFloat(first) * 16);
    return '';
  });
  const nonzero = radii.filter((r) => r > 0).sort((a, b) => a - b);
  const radius = nonzero.length ? nonzero[Math.floor(nonzero.length / 2)] : 0;
  const sharpShare = radii.length ? radii.filter((r) => r <= 2).length / radii.length : 0.5;

  return {
    fonts: top,
    script: SCRIPT.test(all),
    serif: SERIF.test(all),
    soft: SOFT.test(all),
    geometric: GEOMETRIC.test(all),
    radius,
    sharp: sharpShare > 0.6,
  };
}

// ---------- logo / icon ----------
function iconCandidates(html, base) {
  // Square app icons first: wide wordmarks look tiny in the middle of a QR code.
  const host = new URL(base).hostname.replace(/^www\./, '');
  const name = host.split('.').slice(-2, -1)[0] || host;
  const list = [];
  const push = (url, score, why) => { const u = abs(url, base); if (u && !u.startsWith('data:')) list.push({ url: u, score, why }); };
  for (const l of tags(html, 'link')) {
    const rel = (l.rel || '').toLowerCase();
    if (!l.href) continue;
    if (rel.includes('apple-touch-icon')) push(l.href, 90, 'app icon');
    else if (rel.includes('mask-icon')) continue;               // one-color outline, poor in a QR
    else if (/\bicon\b/.test(rel)) {
      const size = parseInt((l.sizes || '').split('x')[0], 10) || 0;
      push(l.href, /\.svg(\?|$)/i.test(l.href) ? 85 : size >= 96 ? 80 : 50, 'site icon');
    }
  }
  for (const img of tags(html, 'img')) {
    const hay = `${img.src || ''} ${img.class || ''} ${img.alt || ''} ${img.id || ''}`.toLowerCase();
    // only the site's own logo (its name appears), not customer or partner logos
    if (img.src && /logo|brand/.test(hay) && hay.includes(name.toLowerCase())) push(img.src, 70, 'logo on the page');
  }
  push('/apple-touch-icon.png', 45, 'app icon');
  push('/favicon.ico', 30, 'site icon');
  const seen = new Set();
  return list.sort((a, b) => b.score - a.score).filter((c) => (seen.has(c.url) ? false : seen.add(c.url)));
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function fetchIcon(cands, get) {
  for (const c of cands.slice(0, 5)) {
    try {
      const r = await get(c.url, 'bytes');
      if (!r || !r.bytes || r.bytes.length < 100 || r.bytes.length > MAX_ICON_BYTES) continue;
      let type = (r.type || '').split(';')[0].trim();
      if (!/^image\//.test(type)) {
        type = /\.svg/i.test(c.url) ? 'image/svg+xml' : /\.ico/i.test(c.url) ? 'image/x-icon' : /\.jpe?g/i.test(c.url) ? 'image/jpeg' : /\.webp/i.test(c.url) ? 'image/webp' : /\.png/i.test(c.url) ? 'image/png' : '';
        if (!type) continue;
      }
      return { dataUri: `data:${type};base64,${toBase64(r.bytes)}`, source: c.why, url: c.url };
    } catch { /* try the next one */ }
  }
  return null;
}

// ---------- main ----------
export async function readSite(pageUrl, html, get) {
  const base = (tags(html, 'base')[0] || {}).href ? abs(tags(html, 'base')[0].href, pageUrl) : pageUrl;
  const title = decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '').trim();
  const siteName = (tags(html, 'meta').find((m) => (m.property || '').toLowerCase() === 'og:site_name') || {}).content || '';

  let css = (html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || []).join('\n');
  const sheets = tags(html, 'link').filter((l) => /stylesheet/i.test(l.rel || '') && l.href && !/fonts\.googleapis/.test(l.href));
  const fetched = await Promise.all(sheets.slice(0, MAX_CSS_FILES).map((l) => get(abs(l.href, base), 'text').catch(() => '')));
  const each = Math.floor(MAX_CSS_CHARS / (fetched.length + 1));
  css = [css, ...fetched].map((c) => c.slice(0, each)).join('\n');

  const colors = scoreColors(css, html);
  const vibe = readVibe(css, html);
  const icon = await fetchIcon(iconCandidates(html, base), get);
  return { url: pageUrl, title: siteName || title, colors, vibe, icon };
}
