// Cloudflare Pages Function: GET /api/site-theme?url=https://…
// Reads a website's look (colors, fonts, roundness, logo) for Custom QR.
// Browsers can't read other sites directly, which is why this runs on the server.
//
// v4 safety (before public launch):
// - every address (and every redirect) is looked up in DNS first; private/home/internal addresses are refused
// - each visitor gets a limited number of lookups per minute and per hour
// - results are remembered for a day, so repeat lookups cost almost nothing
// - "couldn't read" answers use 422, so Cloudflare doesn't swap in its own error page
import { readSite } from '../../custom_qr/site-theme-core.js';

const MAX_HTML = 2 * 1024 * 1024;
const MAX_CSS = 800 * 1024;
const MAX_IMG = 200 * 1024;
const MAX_REDIRECTS = 5;
const MAX_SUBREQUESTS = 45; // Cloudflare free plan allows 50 per request
const LIMITS = [
  { name: 'min', seconds: 60, max: 10 },
  { name: 'hour', seconds: 3600, max: 60 },
];
const RESULT_SECONDS = 86400;
const UA = 'Mozilla/5.0 (compatible; CustomQR/1.0; +https://dana.lovellcrew.us/custom_qr/)';

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? 'public, max-age=3600' : 'no-store',
      ...extra,
    },
  });

// ---------- which addresses are private ----------
export function isPrivateIPv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = p;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 || // this-network, private, loopback, multicast/reserved
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) // benchmarking
  );
}

export function isPrivateIPv6(ip) {
  const h = ip.toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = h.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) return isPrivateIPv4(v4[1]); // ::ffff:10.0.0.1 and similar
  if (h === '::' || h === '::1') return true;
  const first = parseInt(h.split(':')[0] || '0', 16);
  return (
    (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (first & 0xff00) === 0xff00 || // multicast
    h.startsWith('64:ff9b:') || // NAT64 (can reach IPv4 inside)
    h.startsWith('::ffff:')
  );
}

export function isPublicName(hostname) {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (!h || h.includes(':') || h.startsWith('[')) return false; // raw IPv6: refuse outright
  if (h === 'localhost' || /\.(localhost|local|internal|lan|home|arpa|test|invalid)$/.test(h)) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return !isPrivateIPv4(h);
  if (!h.includes('.')) return false; // single-label names are internal
  return true;
}

// ---------- DNS lookup (Cloudflare's free DNS-over-HTTPS) ----------
const dnsMemo = new Map(); // per worker instance

async function resolvesPublic(hostname, budget) {
  const h = hostname.toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return !isPrivateIPv4(h);
  if (dnsMemo.has(h)) return dnsMemo.get(h);
  const ask = async (type) => {
    budget.use();
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(h)}&type=${type}`, {
      headers: { Accept: 'application/dns-json' },
    });
    if (!r.ok) throw new Error('dns failed');
    const d = await r.json();
    return (d.Answer || []).filter((x) => x.type === 1 || x.type === 28).map((x) => x.data);
  };
  const [a, aaaa] = await Promise.all([ask('A'), ask('AAAA')]);
  const all = [...a, ...aaaa];
  const ok = all.length > 0 && all.every((ip) => (ip.includes(':') ? !isPrivateIPv6(ip) : !isPrivateIPv4(ip)));
  dnsMemo.set(h, ok);
  return ok;
}

async function checkUrl(u, budget) {
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new Error('blocked');
  if (u.port && !['80', '443'].includes(u.port)) throw new Error('blocked');
  if (!isPublicName(u.hostname)) throw new Error('blocked');
  if (!(await resolvesPublic(u.hostname, budget))) throw new Error('blocked');
}

// ---------- fetching, with every redirect checked ----------
function makeBudget() {
  let used = 0;
  return { use() { if (++used > MAX_SUBREQUESTS) throw new Error('too many requests'); } };
}

async function fetchLimited(url, limit, accept, budget) {
  let u = new URL(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    for (let hop = 0; ; hop++) {
      await checkUrl(u, budget);
      budget.use();
      const res = await fetch(u.href, { headers: { 'User-Agent': UA, Accept: accept }, redirect: 'manual', signal: ctrl.signal });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        if (hop >= MAX_REDIRECTS) throw new Error('too many redirects');
        u = new URL(res.headers.get('location'), u);
        continue;
      }
      if (!res.ok) throw new Error(`status ${res.status}`);
      const len = Number(res.headers.get('content-length') || 0);
      if (len > limit) throw new Error('too big');
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length > limit) throw new Error('too big');
      return { bytes: buf, type: res.headers.get('content-type') || '', finalUrl: u.href };
    }
  } finally {
    clearTimeout(timer);
  }
}

// ---------- per-visitor limit (Cloudflare's free cache; no setup) ----------
const memoCounts = new Map(); // backup when the cache isn't available

async function overLimit(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const cache = typeof caches !== 'undefined' && caches.default;
  for (const { name, seconds, max } of LIMITS) {
    const slot = Math.floor(Date.now() / 1000 / seconds);
    const key = `https://custom-qr.limit/${name}/${encodeURIComponent(ip)}/${slot}`;
    let n = 0;
    try {
      if (cache) {
        const hit = await cache.match(key);
        n = hit ? Number(await hit.text()) || 0 : 0;
      } else n = memoCounts.get(key) || 0;
    } catch { n = memoCounts.get(key) || 0; }
    if (n >= max) return seconds;
    memoCounts.set(key, n + 1);
    if (memoCounts.size > 5000) memoCounts.clear();
    try {
      if (cache) await cache.put(key, new Response(String(n + 1), { headers: { 'Cache-Control': `max-age=${seconds * 2}` } }));
    } catch { /* limit still works per instance */ }
  }
  return 0;
}

// ---------- the endpoint ----------
export async function onRequestGet({ request, waitUntil }) {
  const target = new URL(request.url).searchParams.get('url');
  let u;
  try { u = new URL(target); } catch { return json({ error: 'That is not a website address.' }, 400); }
  if (!/^https?:$/.test(u.protocol) || !isPublicName(u.hostname)) return json({ error: 'Only public websites can be read.' }, 400);

  // Same site asked recently? Answer from memory (doesn't count against the limit).
  const cache = typeof caches !== 'undefined' && caches.default;
  const resultKey = `https://custom-qr.result/?url=${encodeURIComponent(u.href)}`;
  if (cache) {
    try {
      const hit = await cache.match(resultKey);
      if (hit) return json(await hit.json());
    } catch { /* read it fresh */ }
  }

  const wait = await overLimit(request);
  if (wait) {
    return json({ error: 'Too many websites in a short time. Wait a minute and try again; the designs below still work.' }, 429, {
      'Retry-After': String(wait),
    });
  }

  const budget = makeBudget();
  let page;
  try {
    page = await fetchLimited(u.href, MAX_HTML, 'text/html,application/xhtml+xml', budget);
  } catch (e) {
    if (e.message === 'blocked') return json({ error: 'Only public websites can be read.' }, 400);
    return json({ error: "We couldn't read that website. It may block visitors like us." }, 422);
  }
  if (!/html/i.test(page.type)) return json({ error: "That address isn't a web page." }, 422);

  const get = async (url, kind) => {
    if (kind === 'bytes') return fetchLimited(url, MAX_IMG, 'image/*', budget);
    const r = await fetchLimited(url, MAX_CSS, 'text/css,*/*;q=0.1', budget);
    return new TextDecoder().decode(r.bytes);
  };

  let result;
  try {
    result = await readSite(page.finalUrl, new TextDecoder().decode(page.bytes), get);
  } catch {
    return json({ error: "We couldn't make sense of that website's design." }, 422);
  }
  if (cache) {
    const save = cache
      .put(resultKey, new Response(JSON.stringify(result), { headers: { 'Cache-Control': `max-age=${RESULT_SECONDS}` } }))
      .catch(() => {});
    if (waitUntil) waitUntil(save);
  }
  return json(result);
}
