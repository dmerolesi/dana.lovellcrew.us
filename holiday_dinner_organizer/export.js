// Printing, PDF and Word downloads, and share links.
// All three documents are built from one outline (buildOutline) so they match.

import { describeEvent, formatTime, formatDay, fromMin, CATEGORIES } from './planner.js';

const PDFMAKE = 'https://cdn.jsdelivr.net/npm/pdfmake@0.3.11/build/pdfmake.min.js';
const PDFMAKE_FONTS = 'https://cdn.jsdelivr.net/npm/pdfmake@0.3.11/build/vfs_fonts.js';
const DOCX = 'https://cdn.jsdelivr.net/npm/docx@9.12.0/+esm';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// The outline: a title, intro lines, then parts made of headings, paragraphs and checklists.
export function buildOutline(state, plan) {
  const unit = state.settings.tempUnit || 'F';
  const parts = [];
  const mealMin = Math.round(new Date(state.mealTime).getTime() / 60000);

  const intro = [];
  if (Number.isFinite(mealMin)) intro.push(`Meal time: ${formatDay(mealMin)} at ${formatTime(mealMin)}`);
  for (const r of plan.recipes) {
    if (r.eatAt) {
      const m = Math.round(new Date(r.eatAt).getTime() / 60000);
      intro.push(`${r.parsed.title}: ready at ${formatTime(m)} on ${formatDay(m)}`);
    }
  }
  intro.push(`Recipes: ${plan.recipes.map((r) => r.parsed.title).join(', ')}`);

  const shopping = plan.grocery.filter((g) => !g.have);
  const grocery = { heading: 'Grocery list', blocks: [] };
  for (const cat of CATEGORIES) {
    const items = shopping.filter((g) => g.category === cat);
    if (!items.length) continue;
    grocery.blocks.push({ type: 'subheading', text: cap(cat) });
    grocery.blocks.push({ type: 'checklist', items: items.map((g) => ({ text: [g.amount, g.name].filter(Boolean).join(' '), note: g.recipes.join(', ') })) });
  }
  const have = plan.grocery.filter((g) => g.have);
  if (have.length) {
    grocery.blocks.push({ type: 'subheading', text: 'Already have' });
    grocery.blocks.push({ type: 'paragraph', text: have.map((g) => g.name).join(', ') });
  }
  parts.push(grocery);

  parts.push({
    heading: 'Tools and equipment',
    blocks: [{ type: 'checklist', items: plan.tools.map((t) => ({ text: t.name, note: t.recipes.join(', ') })) }],
  });

  const appliances = { heading: 'What goes where', blocks: [] };
  const dayOf = (m) => { const d = fromMin(m); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const allBars = plan.timeline.flatMap((r) => r.bars.filter((b) => b.kind !== 'preheat'));
  for (const day of [...new Set(allBars.map((b) => dayOf(b.s)))].sort((a, b) => a - b)) {
    appliances.blocks.push({ type: 'day', text: formatDay(day / 60000) });
    for (const row of plan.timeline) {
      const bars = row.bars.filter((b) => b.kind !== 'preheat' && dayOf(b.s) === day).sort((a, b) => a.s - b.s);
      if (!bars.length) continue;
      appliances.blocks.push({ type: 'subheading', text: row.label });
      appliances.blocks.push({ type: 'list', items: bars.map((b) => `${timeRange(b.s, b.e)}  ${b.label}${b.temp != null ? ` (${b.temp}°${unit})` : ''}`) });
    }
  }
  parts.push(appliances);

  if (plan.warnings.length) {
    parts.push({ heading: 'Heads up', blocks: [{ type: 'list', items: plan.warnings }] });
  }

  let lastDay = null;
  plan.sections.forEach((sec, i) => {
    const blocks = [];
    const day = sec.day !== lastDay ? formatDay(sec.start) : '';
    lastDay = sec.day;
    if (sec.tools.length) blocks.push({ type: 'paragraph', text: `You'll need: ${sec.tools.join(', ')}` });
    blocks.push({
      type: 'steps',
      items: sec.items.map((ev) => {
        const d = describeEvent(ev, unit);
        return { time: formatTime(ev.t), text: d.text, sub: d.sub, meta: d.meta, timer: d.timer };
      }),
    });
    if (sec.rawMeat) blocks.push({ type: 'paragraph', text: 'Raw meat: wash your hands, and wash these tools and surfaces before using them for anything else.' });
    parts.push({
      heading: `${i + 1}. ${formatTime(sec.start)} · ${sec.title}`,
      sub: sec.batch ? `Batch prep for ${sec.recipes.join(', ')}` : '',
      blocks,
      day,
      section: true,
    });
  });

  return { title: state.title || 'Holiday dinner', intro, parts };
}

function timeRange(s, e) {
  const sameDay = fromMin(s).toDateString() === fromMin(e).toDateString();
  return sameDay ? `${formatTime(s)}–${formatTime(e)}` : `${formatDay(s).split(',')[0]} ${formatTime(s)} – ${formatDay(e).split(',')[0]} ${formatTime(e)}`;
}

// ---------- print ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function outlineToHtml(outline, { pagePerSection }) {
  const block = (b) => {
    switch (b.type) {
      case 'subheading': return `<h3>${esc(b.text)}</h3>`;
      case 'day': return `<p class="p-day">${esc(b.text)}</p>`;
      case 'paragraph': return `<p>${esc(b.text)}</p>`;
      case 'list': return `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
      case 'checklist': return `<ul class="p-check">${b.items.map((i) => `<li><span class="box"></span>${esc(i.text)}${i.note ? ` <small>${esc(i.note)}</small>` : ''}</li>`).join('')}</ul>`;
      case 'steps': return `<ol class="p-steps">${b.items.map((i) => `<li><span class="box"></span><b>${esc(i.time)}</b> ${esc(i.text)}${i.meta ? ` <small>${esc(i.meta)}</small>` : ''}${i.sub.length ? `<ul>${i.sub.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ol>`;
      default: return '';
    }
  };
  return `<h1>${esc(outline.title)}</h1>${outline.intro.map((l) => `<p class="p-intro">${esc(l)}</p>`).join('')}`
    + outline.parts.map((p, i) => `<section class="p-part${pagePerSection && (p.section || i > 0) ? ' p-break' : ''}">
      ${p.day ? `<p class="p-day">${esc(p.day)}</p>` : ''}<h2>${esc(p.heading)}</h2>${p.sub ? `<p class="p-sub">${esc(p.sub)}</p>` : ''}${p.blocks.map(block).join('')}</section>`).join('');
}

export function printOutline(outline, options) {
  const root = document.getElementById('print-root');
  root.innerHTML = outlineToHtml(outline, options);
  window.print();
}

// ---------- PDF ----------

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Couldn't load the PDF tool. Check your internet connection."));
    document.head.appendChild(s);
  });
}

const checkbox = () => ({ canvas: [{ type: 'rect', x: 0, y: 2, w: 8, h: 8, lineWidth: 0.8, lineColor: '#555' }], width: 14 });

export async function downloadPdf(outline, { pagePerSection }, filename) {
  await loadScript(PDFMAKE);
  await loadScript(PDFMAKE_FONTS);
  const pdfMake = window.pdfMake;

  const block = (b) => {
    switch (b.type) {
      case 'subheading': return { text: b.text, style: 'h3' };
      case 'day': return { text: b.text, style: 'day' };
      case 'paragraph': return { text: b.text, margin: [0, 2, 0, 6] };
      case 'list': return { ul: b.items, margin: [0, 0, 0, 6] };
      case 'checklist': return { stack: b.items.map((i) => ({ columns: [checkbox(), { text: [i.text, i.note ? { text: `  ${i.note}`, style: 'note' } : ''] }], margin: [0, 1, 0, 1] })), margin: [0, 0, 0, 6] };
      case 'steps': return {
        stack: b.items.map((i) => ({
          columns: [checkbox(), { width: 52, text: i.time, bold: true }, {
            stack: [
              { text: [i.text, i.meta ? { text: `  ${i.meta}`, style: 'note' } : ''] },
              ...(i.sub.length ? [{ ul: i.sub, margin: [0, 2, 0, 0] }] : []),
            ],
          }],
          margin: [0, 3, 0, 3],
        })),
      };
      default: return '';
    }
  };

  const content = [{ text: outline.title, style: 'h1' }, ...outline.intro.map((l) => ({ text: l, style: 'intro' }))];
  outline.parts.forEach((p, i) => {
    const pageBreak = pagePerSection && (p.section || i > 0) ? 'before' : undefined;
    if (p.day) content.push({ text: p.day.toUpperCase(), style: 'dayHead', pageBreak });
    content.push({ text: p.heading, style: 'h2', pageBreak: p.day ? undefined : pageBreak, margin: p.day ? [0, 2, 0, 4] : undefined });
    if (p.sub) content.push({ text: p.sub, style: 'note', margin: [0, 0, 0, 4] });
    p.blocks.forEach((b) => content.push(block(b)));
  });

  const doc = {
    content,
    pageMargins: [48, 48, 48, 48],
    defaultStyle: { fontSize: 11, lineHeight: 1.2 },
    styles: {
      h1: { fontSize: 22, bold: true, margin: [0, 0, 0, 6] },
      h2: { fontSize: 15, bold: true, margin: [0, 14, 0, 4] },
      h3: { fontSize: 12, bold: true, margin: [0, 6, 0, 2] },
      day: { fontSize: 10, bold: true, color: '#5b5bd6', margin: [0, 6, 0, 2] },
      dayHead: { fontSize: 10, bold: true, color: '#5b5bd6', margin: [0, 18, 0, 0] },
      intro: { color: '#444', margin: [0, 0, 0, 2] },
      note: { color: '#666', fontSize: 9 },
    },
  };
  await pdfMake.createPdf(doc).download(filename);
}

// ---------- Word ----------

export async function downloadDocx(outline, { pagePerSection }, filename) {
  let d;
  try { d = await import(DOCX); } catch { throw new Error("Couldn't load the Word tool. Check your internet connection."); }
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = d;
  const kids = [];
  const p = (text, opts = {}) => new Paragraph({ children: [new TextRun(text)], ...opts });

  kids.push(new Paragraph({ text: outline.title, heading: HeadingLevel.TITLE }));
  outline.intro.forEach((l) => kids.push(p(l)));
  outline.parts.forEach((part, i) => {
    const breakBefore = !!(pagePerSection && (part.section || i > 0));
    if (part.day) kids.push(new Paragraph({ pageBreakBefore: breakBefore, spacing: { before: 240 }, children: [new TextRun({ text: part.day.toUpperCase(), bold: true, color: '5B5BD6', size: 20 })] }));
    kids.push(new Paragraph({ text: part.heading, heading: HeadingLevel.HEADING_1, pageBreakBefore: breakBefore && !part.day }));
    if (part.sub) kids.push(new Paragraph({ children: [new TextRun({ text: part.sub, italics: true })] }));
    for (const b of part.blocks) {
      if (b.type === 'subheading') kids.push(new Paragraph({ text: b.text, heading: HeadingLevel.HEADING_2 }));
      else if (b.type === 'day') kids.push(new Paragraph({ children: [new TextRun({ text: b.text, bold: true, color: '5B5BD6' })] }));
      else if (b.type === 'paragraph') kids.push(p(b.text));
      else if (b.type === 'list') b.items.forEach((t) => kids.push(new Paragraph({ text: t, bullet: { level: 0 } })));
      else if (b.type === 'checklist') {
        b.items.forEach((it) => kids.push(new Paragraph({ children: [new TextRun(`☐  ${it.text}`), ...(it.note ? [new TextRun({ text: `   ${it.note}`, color: '666666', size: 18 })] : [])] })));
      } else if (b.type === 'steps') {
        b.items.forEach((it) => {
          kids.push(new Paragraph({
            spacing: { before: 120 },
            children: [new TextRun(`☐  `), new TextRun({ text: `${it.time}  `, bold: true }), new TextRun(it.text), ...(it.meta ? [new TextRun({ text: `   ${it.meta}`, color: '666666', size: 18 })] : [])],
          }));
          it.sub.forEach((s) => kids.push(new Paragraph({ text: s, bullet: { level: 1 } })));
        });
      }
    }
  });

  const doc = new Document({ creator: 'Holiday Dinner Organizer', title: outline.title, sections: [{ children: kids }] });
  const blob = await Packer.toBlob(doc);
  saveBlob(blob, filename);
}

export function saveBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------- share links ----------
// The whole plan is compressed into the part of the link after "#", so it never
// reaches a server.

const fromB64Url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeShare(data) {
  const bytes = await pipe(new TextEncoder().encode(JSON.stringify(data)), new CompressionStream('deflate-raw'));
  let b = '';
  for (let i = 0; i < bytes.length; i += 8192) b += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function decodeShare(text) {
  const bytes = await pipe(fromB64Url(text), new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(bytes));
}
