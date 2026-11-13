import { DESIGNS, normalizeUrl, renderQR, svgToCanvas, testScan } from './qr-render.js';
import { siteDesigns, inkSafe } from './site-designs.js';

const $ = (id) => document.getElementById(id);
const form = $('qr-form'), input = $('url'), err = $('url-error');
const preview = $('preview'), status = $('scan-status');
const dlPng = $('dl-png'), dlSvg = $('dl-svg');

const state = { url: null, design: 'classic', svg: null, run: 0, site: {}, siteNote: '', base: 'classic', custom: null, siteLogo: null, ownLogo: null };
const allDesigns = () => ({ ...state.site, ...DESIGNS, ...(state.custom ? { custom: state.custom } : {}) });
const SAMPLE = 'https://example.com';

// Design cards, each with a small live sample
function drawDesigns() {
  const card = ([key, d]) => `
    <label class="design">
      <input type="radio" name="design" value="${key}" ${key === state.base ? 'checked' : ''}>
      <span class="thumb" aria-hidden="true">${renderQR(state.url || SAMPLE, d).svg}</span>
      <span class="design-text"><b>${escapeHtml(d.label)}</b><span class="hint">${escapeHtml(d.note)}</span></span>
    </label>`;
  const siteCards = Object.entries(state.site);
  $('site-note').innerHTML = state.siteNote;
  $('site-designs').innerHTML = siteCards.map(card).join('');
  $('site-group').hidden = !siteCards.length && !state.siteNote;
  $('designs').innerHTML = Object.entries(DESIGNS).map(card).join('');
}

function fileName(ext) {
  const host = new URL(state.url).hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-');
  return `qr-${host}-${state.design}.${ext}`;
}

function save(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function update() {
  const run = ++state.run;
  dlPng.disabled = dlSvg.disabled = true;
  if (!state.url) return;
  const { svg } = renderQR(state.url, allDesigns()[state.design] || DESIGNS.classic);
  state.svg = svg;
  preview.innerHTML = svg;
  preview.firstChild.setAttribute('role', 'img');
  preview.firstChild.setAttribute('aria-label', `QR code that opens ${state.url}`);
  status.className = 'scan';
  status.textContent = 'Checking that it scans…';
  const read = await testScan(svg);
  if (run !== state.run) return;  // a newer code replaced this one
  if (read === undefined) {
    status.textContent = "Couldn't load the scan checker. Test it with your phone before printing.";
  } else if (read === state.url) {
    status.classList.add('ok');
    status.innerHTML = '<span aria-hidden="true">✓</span> Scans correctly: opens ' + escapeHtml(state.url);
  } else {
    status.classList.add('bad');
    status.textContent = "This one didn't scan in our test. Try the Classic design or a shorter address.";
  }
  dlPng.disabled = dlSvg.disabled = false;
}

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const res = normalizeUrl(input.value);
  if (!res.ok) {
    err.textContent = res.message;
    err.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }
  err.hidden = true;
  input.removeAttribute('aria-invalid');
  state.url = res.url;
  input.value = res.url;
  state.site = {};
  state.siteNote = '<span class="spinner" aria-hidden="true"></span> Reading your website for its colors, logo and style…';
  state.siteLogo = null;
  state.custom = null;
  if (state.base.startsWith('site')) state.base = 'classic';
  state.design = state.base;
  drawDesigns();
  fillControls();
  update();
  loadSiteDesigns(res.url);
  if (window.matchMedia('(max-width: 700px)').matches) $('result-heading').scrollIntoView({ block: 'start' });
});

document.querySelector('.design-groups').addEventListener('change', (e) => {
  if (e.target.name !== 'design') return;
  state.design = state.base = e.target.value;
  state.custom = null;
  fillControls();
  update();
});

// ---------- "Make it yours" controls ----------
const ctl = { dots: $('opt-dots'), corners: $('opt-corners'), c1: $('opt-color1'), c2: $('opt-color2'), fade: $('opt-fade'), file: $('own-image') };
const toHex6 = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : '#000000');

function fillControls() {
  const d = allDesigns()[state.base] || DESIGNS.classic;
  ctl.dots.value = d.modules;
  ctl.corners.value = d.finders;
  ctl.c1.value = toHex6(d.inkA);
  ctl.c2.value = toHex6(d.inkB);
  ctl.fade.checked = d.inkA.toLowerCase() !== d.inkB.toLowerCase();
  ctl.c2.hidden = !ctl.fade.checked;
  const mid = d.center === 'logo' ? (d.logo === state.ownLogo && state.ownLogo ? 'own' : 'site') : 'none';
  document.querySelector(`input[name="mid"][value="${mid}"]`).checked = true;
  ctl.file.hidden = mid !== 'own';
  $('mid-site').disabled = !state.siteLogo;
  $('mid-site-label').classList.toggle('disabled', !state.siteLogo);
  $('color-note').textContent = '';
}

function applyControls() {
  const base = allDesigns()[state.base] || DESIGNS.classic;
  const mid = document.querySelector('input[name="mid"]:checked')?.value || 'none';
  ctl.file.hidden = mid !== 'own';
  ctl.c2.hidden = !ctl.fade.checked;
  const a = inkSafe(ctl.c1.value), b = ctl.fade.checked ? inkSafe(ctl.c2.value) : a;
  const changed = a !== ctl.c1.value.toLowerCase() || (ctl.fade.checked && b !== ctl.c2.value.toLowerCase());
  $('color-note').textContent = changed ? 'A color was too light to scan, so it is shown a little darker.' : '';
  const logo = mid === 'site' ? state.siteLogo : mid === 'own' ? state.ownLogo : null;
  state.custom = {
    ...base, label: 'My design', note: 'Your own choices',
    modules: ctl.dots.value, finders: ctl.corners.value,
    inkA: a, inkB: b, pupil: ctl.fade.checked ? b : undefined,
    center: logo ? 'logo' : 'none', logo,
  };
  state.design = 'custom';
  update();
}

for (const el of [ctl.dots, ctl.corners, ctl.c1, ctl.c2, ctl.fade]) el.addEventListener('input', applyControls);
document.querySelectorAll('input[name="mid"]').forEach((r) => r.addEventListener('change', () => {
  if (r.value === 'own' && !state.ownLogo) { ctl.file.hidden = false; ctl.file.click(); }
  applyControls();
}));
ctl.file.addEventListener('change', () => {
  const f = ctl.file.files[0];
  if (!f) return;
  // shrink the image to 256 px so the code stays small and quick to check
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const n = 256, cv = document.createElement('canvas');
      cv.width = cv.height = n;
      const k = Math.min(n / img.width, n / img.height);
      cv.getContext('2d').drawImage(img, (n - img.width * k) / 2, (n - img.height * k) / 2, img.width * k, img.height * k);
      state.ownLogo = cv.toDataURL('image/png');
      applyControls();
    };
    img.onerror = () => { $('color-note').textContent = "That image couldn't be opened. Try a PNG or JPG."; };
    img.src = reader.result;
  };
  reader.readAsDataURL(f);
});
$('opt-reset').addEventListener('click', () => { state.custom = null; state.design = state.base; fillControls(); update(); });

dlSvg.addEventListener('click', () => {
  save(new Blob([state.svg], { type: 'image/svg+xml' }), fileName('svg'));
});

dlPng.addEventListener('click', async () => {
  // 2400 px = 2 inches wide at 1200 dpi, or 8 inches at 300 dpi
  const cv = await svgToCanvas(state.svg, 2400);
  cv.toBlob((blob) => save(blob, fileName('png')), 'image/png');
});

// ---------- reading the person's own website ----------
async function readSiteTheme(url) {
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    // local testing: same reading code, fetched through the test server
    const { readSite } = await import('./site-theme-core.js');
    const via = (u) => '/__fetch?url=' + encodeURIComponent(u);
    const page = await fetch(via(url));
    if (!page.ok) throw new Error("We couldn't read that website. It may block visitors like us.");
    const get = async (u, kind) => {
      const r = await fetch(via(u));
      if (!r.ok) throw new Error('fetch failed');
      return kind === 'bytes' ? { bytes: new Uint8Array(await r.arrayBuffer()), type: r.headers.get('content-type') || '' } : r.text();
    };
    return readSite(page.headers.get('x-final-url') || url, await page.text(), get);
  }
  const res = await fetch('/api/site-theme?url=' + encodeURIComponent(url));
  const data = await res.json().catch(() => ({ error: "We couldn't read that website." }));
  if (!res.ok || data.error) throw new Error(data.error || "We couldn't read that website.");
  return data;
}

async function loadSiteDesigns(url) {
  try {
    const site = await readSiteTheme(url);
    if (state.url !== url) return;
    const { designs } = await siteDesigns(site);
    state.site = designs;
    const host = escapeHtml(new URL(site.url).hostname.replace(/^www\./, ''));
    state.siteNote = `Made from <b>${host}</b>: its colors${site.icon ? ', its logo' : ''} and a dot style that fits its look.` +
      (site.icon ? ' Use a logo only if the website is yours or you have permission.' : '');
    state.siteLogo = site.icon ? site.icon.dataUri : null;
    state.design = state.base = 'site1';
    state.custom = null;
  } catch (e) {
    if (state.url !== url) return;
    state.site = {};
    state.siteNote = `${escapeHtml(e.message || "We couldn't read that website.")} The designs below still work.`;
  }
  drawDesigns();
  fillControls();
  update();
}

// Start from a link like ?url=example.com
const start = new URLSearchParams(location.search).get('url');
drawDesigns();
fillControls();
if (start) { input.value = start; form.requestSubmit(); }
