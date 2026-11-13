// Turns what we read from a website (colors, vibe, logo) into QR designs that fit it.
import { hsl } from './site-theme-core.js';

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrastOnWhite = (hex) => 1.05 / (lum(hex) + 0.05);

function fromHsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

/** Darkens a color until it is dark enough to scan on white (5:1 or more), keeping its hue. */
export function inkSafe(hex, min = 5) {
  if (contrastOnWhite(hex) >= min) return hex;
  const { h, s } = hsl(hex);
  let { l } = hsl(hex);
  let out = hex;
  while (l > 0.02 && contrastOnWhite(out) < min) { l -= 0.02; out = fromHsl(h, Math.min(1, s * 1.05), l); }
  return out;
}

const hueGap = (a, b) => { const d = Math.abs(hsl(a).h - hsl(b).h) % 360; return Math.min(d, 360 - d); };

/** Main colors of the logo, read from its pixels (works because the logo is a data URI). */
export function logoColors(dataUri) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const n = 48, cv = document.createElement('canvas');
        cv.width = cv.height = n;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, n, n);
        const px = ctx.getImageData(0, 0, n, n).data;
        const buckets = new Map();
        for (let i = 0; i < px.length; i += 4) {
          if (px[i + 3] < 200) continue;
          const hex = '#' + [px[i], px[i + 1], px[i + 2]].map((v) => (v & 0xf0 | 0x08).toString(16).padStart(2, '0')).join('');
          const { s, l } = hsl(hex);
          if (l > 0.92 || l < 0.05) continue;
          buckets.set(hex, (buckets.get(hex) || 0) + (s < 0.12 ? 0.3 : 1));
        }
        resolve([...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([hex, c]) => ({ hex, score: c / 20 })));
      } catch { resolve([]); }
    };
    img.onerror = () => resolve([]);
    img.src = dataUri;
  });
}

/** Picks the shapes that fit the site: returns them best first. */
export function vibeShapes(v) {
  const shapes = [];
  if (v.script || v.serif) shapes.push({ modules: 'flow', finders: 'lens', word: v.script ? 'flowing, like its script lettering' : 'round and elegant, like its serif lettering' });
  if (v.soft || v.radius >= 12) shapes.push({ modules: 'rounded', finders: 'rounded', word: 'soft and rounded, like its buttons' });
  if (v.sharp || (v.geometric && v.radius < 6)) shapes.push({ modules: 'square', finders: 'square', word: 'crisp and square, like its clean modern look' });
  if (v.geometric && v.radius >= 4) shapes.push({ modules: 'rounded', finders: 'rounded', word: 'modern with softened corners' });
  shapes.push({ modules: 'flow', finders: 'lens', word: 'round flowing dots' });
  shapes.push({ modules: 'square', finders: 'square', word: 'classic squares' });
  const seen = new Set();
  return shapes.filter((s) => { const k = s.modules + s.finders; return seen.has(k) ? false : seen.add(k); });
}

const share = (list) => { const t = list.reduce((a, c) => a + c.score, 0) || 1; return list.map((c) => ({ ...c, score: (10 * c.score) / t })); };
const close = (a, b) => hueGap(a, b) < 12 && Math.abs(hsl(a).l - hsl(b).l) < 0.15;

/** Builds up to 3 designs from a site reading. */
export async function siteDesigns(site) {
  // colorful colors only, from the site's CSS and its logo, each list weighted equally
  const colorful = (list) => list.filter((c) => hsl(c.hex).s >= 0.25);
  const fromSite = share(colorful(site.colors || []));
  const fromLogo = site.icon ? share(colorful(await logoColors(site.icon.dataUri))) : [];
  const merged = [];
  for (const c of [...fromSite, ...fromLogo]) {
    const hit = merged.find((m) => close(m.hex, c.hex));
    if (hit) hit.score += c.score; else merged.push({ ...c });
  }
  // a color that is already fairly dark keeps its character as ink; very light ones (yellow) turn muddy when darkened
  merged.forEach((c) => {
    if (contrastOnWhite(c.hex) < 2) c.score *= 0.35;   // very light: turns muddy when darkened
    if (hsl(c.hex).l < 0.15) c.score *= 0.4;          // nearly black: reads as plain black
  });
  let palette = merged.sort((a, b) => b.score - a.score);
  if (!palette.length) palette = (site.colors || []).slice(0, 2);
  if (!palette.length) palette = [{ hex: '#1F2937' }];

  const primary = inkSafe(palette[0].hex);
  const second = palette.slice(1).find((c) => hueGap(c.hex, palette[0].hex) > 25 && contrastOnWhite(c.hex) >= 2);
  const secondary = second ? inkSafe(second.hex) : inkSafe(fromHsl(hsl(primary).h, hsl(primary).s, Math.max(0.08, hsl(primary).l - 0.12)));
  const shapes = vibeShapes(site.vibe || {});
  const name = site.title ? site.title.split(/[|–—:-]/)[0].trim().slice(0, 28) : new URL(site.url).hostname.replace(/^www\./, '');
  const logo = site.icon ? site.icon.dataUri : null;

  const designs = {
    site1: { label: `${name}: signature`, note: `Its colors, ${shapes[0].word}${logo ? ', with its logo' : ''}`,
      inkA: primary, inkB: secondary, pupil: secondary, modules: shapes[0].modules, finders: shapes[0].finders, center: logo ? 'logo' : 'none', logo },
    site2: { label: `${name}: alternate`, note: `Its main color, ${shapes[1].word}${logo ? ', with its logo' : ''}`,
      inkA: primary, inkB: primary, pupil: secondary, modules: shapes[1].modules, finders: shapes[1].finders, center: logo ? 'logo' : 'none', logo },
    site3: { label: `${name}: simple`, note: 'Its colors with no logo: the easiest to scan from far away',
      inkA: secondary, inkB: primary, modules: shapes[0].modules, finders: shapes[0].finders, center: 'none' },
  };
  return { designs, primary, secondary, shapes };
}
