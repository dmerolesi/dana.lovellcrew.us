// Turns a website address into a styled QR code (SVG text).
// Uses the qrcode-generator library (loaded in index.html as window.qrcode).

export const DESIGNS = {
  ocean: {
    label: 'Ocean',
    note: 'Deep blue to teal, flowing dots, round corners',
    inkA: '#0F1A3A', inkB: '#1F6F7A', modules: 'flow', finders: 'lens', center: 'none',
  },
  classic: {
    label: 'Classic',
    note: 'Plain black squares. Scans everywhere',
    inkA: '#000000', inkB: '#000000', modules: 'square', finders: 'square', center: 'none',
  },
  soft: {
    label: 'Soft',
    note: 'Deep violet with rounded squares and corners',
    inkA: '#3B1E6E', inkB: '#3B1E6E', modules: 'rounded', finders: 'rounded', center: 'none',
  },
};

const QUIET = 4;   // white border, in modules (the standard asks for 4)
const LOGO = 9;    // cleared square in the centre when a mark is shown
let uid = 0;       // each code gets its own gradient name, so several on one page don't share colors

export function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) return { ok: false, message: 'Type a website address first.' };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { return { ok: false, message: "That doesn't look like a website address. Try something like example.com." }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, message: 'Only website addresses (http or https) are supported.' };
  if (!u.hostname.includes('.') && u.hostname !== 'localhost') return { ok: false, message: 'Add the ending too, like .com or .org.' };
  return { ok: true, url: u.href };
}

function matrix(text, level) {
  const qr = window.qrcode(0, level);
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const m = [];
  for (let r = 0; r < n; r++) { m.push([]); for (let c = 0; c < n; c++) m[r].push(qr.isDark(r, c)); }
  return m;
}

const circle = (cx, cy, r) => `M${cx - r},${cy}a${r},${r} 0 1 0 ${2 * r},0a${r},${r} 0 1 0 ${-2 * r},0z`;
const rrect = (x, y, w, h, rad) =>
  `M${x + rad},${y}h${w - 2 * rad}a${rad},${rad} 0 0 1 ${rad},${rad}v${h - 2 * rad}a${rad},${rad} 0 0 1 ${-rad},${rad}` +
  `h${-(w - 2 * rad)}a${rad},${rad} 0 0 1 ${-rad},${-rad}v${-(h - 2 * rad)}a${rad},${rad} 0 0 1 ${rad},${-rad}z`;

function star(cx, cy, r) {
  // four-point star, like the Solar Star marks
  const i = r * 0.32;
  return `M${cx},${cy - r}Q${cx + i * 0.35},${cy - i * 0.35} ${cx + r},${cy}Q${cx + i * 0.35},${cy + i * 0.35} ${cx},${cy + r}` +
    `Q${cx - i * 0.35},${cy + i * 0.35} ${cx - r},${cy}Q${cx - i * 0.35},${cy - i * 0.35} ${cx},${cy - r}z`;
}

/** Returns { svg, size } for a url and a design (key or design object). size = modules including the quiet zone. */
export function renderQR(url, design) {
  const d = typeof design === 'object' && design ? design : (DESIGNS[design] || DESIGNS.classic);
  const ink = `ink${++uid}`;
  const withMark = d.center === 'star' || (d.center === 'logo' && !!d.logo);
  const M = matrix(url, withMark ? 'H' : 'M');
  const N = M.length;
  const finders = [[0, 0], [0, N - 7], [N - 7, 0]];
  const inFinder = (r, c) => finders.some(([r0, c0]) => r >= r0 && r < r0 + 7 && c >= c0 && c < c0 + 7);
  const lo = Math.floor((N - LOGO) / 2);
  const inLogo = (r, c) => withMark && r >= lo && r < lo + LOGO && c >= lo && c < lo + LOGO;
  const on = (r, c) => r >= 0 && c >= 0 && r < N && c < N && M[r][c] && !inFinder(r, c) && !inLogo(r, c);

  const body = [];
  const extra = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (!on(r, c)) continue;
      if (d.modules === 'square') body.push(`M${c},${r}h1v1h-1z`);
      else {
        // round dots (or rounded squares) that flow into dark neighbours;
        // separate shapes with gaps scan badly, so neighbours are always joined
        body.push(d.modules === 'rounded' ? rrect(c, r, 1, 1, 0.3) : circle(c + 0.5, r + 0.5, 0.5));
        if (on(r, c + 1)) extra.push(`M${c + 0.5},${r}h1v1h-1z`);
        if (on(r + 1, c)) extra.push(`M${c},${r + 0.5}h1v1h-1z`);
      }
    }
  }

  const parts = [];
  if (body.length) parts.push(`<path fill="url(#${ink})" d="${body.join('')}"/>`);
  if (extra.length) parts.push(`<path fill="url(#${ink})" d="${extra.join('')}"/>`);

  const pupil = d.pupil || `url(#${ink})`;
  for (const [r0, c0] of finders) {
    const cx = c0 + 3.5, cy = r0 + 3.5;
    if (d.finders === 'lens') {
      parts.push(`<path fill="url(#${ink})" fill-rule="evenodd" d="${circle(cx, cy, 3.5)}${circle(cx, cy, 2.5)}"/>`);
      parts.push(`<circle cx="${cx}" cy="${cy}" r="1.5" fill="${pupil}"/>`);
    } else if (d.finders === 'rounded') {
      parts.push(`<path fill="url(#${ink})" fill-rule="evenodd" d="${rrect(c0, r0, 7, 7, 1.6)}${rrect(c0 + 1, r0 + 1, 5, 5, 1)}"/>`);
      parts.push(`<path fill="${pupil}" d="${rrect(c0 + 2, r0 + 2, 3, 3, 0.8)}"/>`);
    } else {
      parts.push(`<path fill="url(#${ink})" fill-rule="evenodd" d="M${c0},${r0}h7v7h-7z M${c0 + 1},${r0 + 1}v5h5v-5z"/>`);
      parts.push(`<path fill="${pupil}" d="M${c0 + 2},${r0 + 2}h3v3h-3z"/>`);
    }
  }

  if (d.center === 'logo' && d.logo) {
    // the site's own logo on a white plate in the cleared centre
    const pad = 0.6, x = lo + pad, w = LOGO - pad * 2;
    parts.push(`<path fill="#FFFFFF" d="${rrect(lo + 0.2, lo + 0.2, LOGO - 0.4, LOGO - 0.4, d.modules === 'square' ? 0.6 : 1.8)}"/>`);
    parts.push(`<image href="${d.logo}" x="${x + 0.4}" y="${x + 0.4}" width="${w - 0.8}" height="${w - 0.8}" preserveAspectRatio="xMidYMid meet"/>`);
  }
  if (d.center === 'star') {
    const cx = lo + LOGO / 2, cy = cx;
    parts.push(`<path fill="#D9A441" d="${star(cx, cy, LOGO / 2 - 0.9)}"/>`);
    parts.push(`<path fill="#D9A441" d="${star(cx + 2.6, cy - 2.6, 0.9)}"/>`);
  }

  const size = N + QUIET * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${-QUIET} ${-QUIET} ${size} ${size}" shape-rendering="geometricPrecision">` +
    `<defs><linearGradient id="${ink}" x1="0" y1="0" x2="${N}" y2="${N}" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="${d.inkA}"/><stop offset="1" stop-color="${d.inkB}"/></linearGradient></defs>` +
    `<rect x="${-QUIET}" y="${-QUIET}" width="${size}" height="${size}" fill="#FFFFFF"/>` +
    parts.join('') + '</svg>';
  return { svg, size };
}

/** Draws the SVG onto a canvas of `px` pixels. */
export function svgToCanvas(svg, px) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = px;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, px, px);
      ctx.drawImage(img, 0, 0, px, px);
      URL.revokeObjectURL(url);
      resolve(cv);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not draw the code')); };
    img.src = url;
  });
}

/** Test-scans the code the way a phone camera would. Returns the text it read, or null. */
export async function testScan(svg) {
  if (!window.jsQR) return undefined;  // checker didn't load
  // must read at a small and a large size (small = far away or a low-res camera)
  let text = null;
  for (const px of [300, 900]) {
    const cv = await svgToCanvas(svg, px);
    const data = cv.getContext('2d').getImageData(0, 0, px, px);
    const hit = window.jsQR(data.data, px, px, { inversionAttempts: 'dontInvert' });
    if (!hit) return null;
    text = hit.data;
  }
  return text;
}
