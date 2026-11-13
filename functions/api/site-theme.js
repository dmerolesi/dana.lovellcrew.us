// Cloudflare Pages Function: GET /api/site-theme?url=https://…
// Reads a website's look (colors, fonts, roundness, logo) for Custom QR.
// Browsers can't read other sites directly, which is why this runs on the server.
import { readSite } from '../../custom_qr/site-theme-core.js';

const MAX_HTML = 2 * 1024 * 1024;
const MAX_CSS = 800 * 1024;
const MAX_IMG = 200 * 1024;
const UA = 'Mozilla/5.0 (compatible; CustomQR/1.0; +https://dana.lovellcrew.us/custom_qr/)';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });

function isPublicHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  if (h.includes(':')) return false; // raw IPv6
  return true;
}

async function fetchLimited(url, limit, accept) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol) || !isPublicHost(u.hostname)) throw new Error('blocked');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(u.href, { headers: { 'User-Agent': UA, Accept: accept }, redirect: 'follow', signal: ctrl.signal });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > limit) throw new Error('too big');
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > limit) throw new Error('too big');
    return { bytes: buf, type: res.headers.get('content-type') || '', finalUrl: res.url || u.href };
  } finally {
    clearTimeout(timer);
  }
}

const get = async (url, kind) => {
  if (kind === 'bytes') return fetchLimited(url, MAX_IMG, 'image/*');
  const r = await fetchLimited(url, MAX_CSS, 'text/css,*/*;q=0.1');
  return new TextDecoder().decode(r.bytes);
};

export async function onRequestGet({ request }) {
  const target = new URL(request.url).searchParams.get('url');
  let u;
  try { u = new URL(target); } catch { return json({ error: 'That is not a website address.' }, 400); }
  if (!/^https?:$/.test(u.protocol) || !isPublicHost(u.hostname)) return json({ error: 'Only public websites can be read.' }, 400);

  let page;
  try {
    page = await fetchLimited(u.href, MAX_HTML, 'text/html,application/xhtml+xml');
  } catch {
    return json({ error: "We couldn't read that website. It may block visitors like us." }, 502);
  }
  if (!/html/i.test(page.type)) return json({ error: "That address isn't a web page." }, 422);

  const html = new TextDecoder().decode(page.bytes);
  try {
    return json(await readSite(page.finalUrl, html, get));
  } catch {
    return json({ error: "We couldn't make sense of that website's design." }, 500);
  }
}
