// Page code: keeps the plan in the browser, draws the three tabs, and wires up buttons.

import { APPLIANCES, buildPlan, describeEvent, formatTime, formatDay, formatDuration, fromMin, toMin, groceryKey, normalizeRecipe, CATEGORIES } from './planner.js';
import { MODELS, buildPrompt, parseAnswer, readWithClaude } from './ai.js';
import { buildOutline, printOutline, downloadPdf, downloadDocx, encodeShare, decodeShare } from './export.js';
import { sampleMeal } from './sample.js';

const STORE_KEY = 'holiday-dinner-organizer:v1';
const KEY_STORE = 'holiday-dinner-organizer:api-key';
const MAX_FILE = 15 * 1024 * 1024;

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);

function defaultMealTime() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T17:00`;
}

function freshState() {
  return {
    version: 1,
    title: 'Holiday dinner',
    mealTime: defaultMealTime(),
    kitchen: {
      oven: { count: 1, capacity: 2 },
      stovetop: { count: 1, capacity: 4 },
      microwave: { count: 1, capacity: 1 },
    },
    settings: {
      cooks: 1, tempTolerance: 25, tempUnit: 'F', makeAheadDayBefore: true, aiSuggestions: false,
      pagePerSection: false, aiMode: 'prompt', model: MODELS[0].id, rememberKey: false,
    },
    recipes: [],
    have: {},
    done: {},
  };
}

let state = load();
let apiKey = readKey();
const ui = { tab: 'kitchen', planTab: 'steps', day: null, busy: {}, plan: null };

// ---------- storage (browser only; wrapped because private windows can block it) ----------

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved && saved.version === 1) {
      const base = freshState();
      return { ...base, ...saved, settings: { ...base.settings, ...saved.settings } };
    }
  } catch { /* fall through to a fresh plan */ }
  return freshState();
}

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      // Usually a big uploaded file: keep the plan, drop file contents from storage.
      try {
        const slim = { ...state, recipes: state.recipes.map((r) => (r.file && r.file.kind !== 'text' ? { ...r, file: { ...r.file, data: null } } : r)) };
        localStorage.setItem(STORE_KEY, JSON.stringify(slim));
      } catch { /* storage unavailable */ }
    }
  }, 250);
}

function readKey() {
  try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; }
}
function writeKey() {
  try {
    if (state.settings.rememberKey && apiKey) localStorage.setItem(KEY_STORE, apiKey);
    else localStorage.removeItem(KEY_STORE);
  } catch { /* storage unavailable */ }
}

function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = 'toast'; }, isError ? 6000 : 3000);
}

// ---------- rendering ----------

function render() {
  $('#plan-title').value = state.title;
  document.querySelectorAll('[data-tab]').forEach((b) => {
    const on = b.dataset.tab === ui.tab;
    b.setAttribute('aria-selected', on);
    b.classList.toggle('active', on);
  });
  document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.id !== `tab-${ui.tab}`; });
  const count = state.recipes.filter((r) => r.parsed).length;
  $('#recipe-count').textContent = state.recipes.length ? `${count}/${state.recipes.length}` : '';
  if (ui.tab === 'kitchen') renderKitchen();
  if (ui.tab === 'recipes') renderRecipes();
  if (ui.tab === 'plan') renderPlan();
}

function renderKitchen() {
  const s = state.settings;
  const cards = Object.entries(APPLIANCES).map(([type, def]) => {
    const cfg = state.kitchen[type] || { count: 0, capacity: def.capacity };
    const on = cfg.count > 0;
    return `<div class="appliance${on ? ' on' : ''}">
      <label class="appliance-name"><input type="checkbox" data-appliance="${type}" data-prop="on" ${on ? 'checked' : ''}> ${esc(def.label)}</label>
      <div class="appliance-nums" ${on ? '' : 'hidden'}>
        <label>How many <input type="number" min="1" max="9" value="${cfg.count || 1}" data-appliance="${type}" data-prop="count"></label>
        <label>${esc(def.unit[0].toUpperCase() + def.unit.slice(1))} each <input type="number" min="1" max="12" value="${cfg.capacity || def.capacity}" data-appliance="${type}" data-prop="capacity"></label>
      </div>
    </div>`;
  }).join('');

  $('#tab-kitchen').innerHTML = `
    <div class="card">
      <h2>When are you eating?</h2>
      <label class="field">Meal time
        <input type="datetime-local" data-field="mealTime" value="${esc(state.mealTime)}">
      </label>
      <p class="hint">Each recipe can have its own time too (like breakfast rolls in the morning). Set that on the Recipes tab.</p>
    </div>

    <div class="card">
      <h2>Your appliances</h2>
      <p class="hint">Check everything you can cook with. The planner only puts one thing at a time in each spot, so enter how many racks, burners or baskets you have.</p>
      <div class="appliance-grid">${cards}</div>
    </div>

    <div class="card">
      <h2>Planning options</h2>
      <div class="settings-grid">
        <label class="field">People cooking
          <input type="number" min="1" max="6" value="${s.cooks}" data-setting="cooks">
          <span class="hint">How many hands-on tasks can happen at once.</span>
        </label>
        <label class="field">Temperature unit
          <select data-setting="tempUnit">
            <option value="F" ${s.tempUnit === 'F' ? 'selected' : ''}>°F</option>
            <option value="C" ${s.tempUnit === 'C' ? 'selected' : ''}>°C</option>
          </select>
        </label>
        <label class="field">Sharing an oven
          <span class="inline">Dishes within ± <input type="number" min="0" max="100" step="5" value="${s.tempTolerance}" data-setting="tempTolerance"> °${s.tempUnit} can share</span>
          <span class="hint">If two dishes need temperatures this close, they can go in at the same time.</span>
        </label>
      </div>
      <label class="check"><input type="checkbox" data-setting="makeAheadDayBefore" ${s.makeAheadDayBefore ? 'checked' : ''}>
        <span><b>Do make-ahead steps the day before</b><br><span class="hint">Steps that keep for a day (chopping, assembling, thawing) move to the day before so the big day is calmer.</span></span></label>
      <label class="check"><input type="checkbox" data-setting="aiSuggestions" ${s.aiSuggestions ? 'checked' : ''}>
        <span><b>Let AI suggest changes</b><br><span class="hint">The AI can suggest safe swaps, like baking at a lower temperature for longer so two dishes can share the oven, or using the air fryer instead. You'll see every suggestion in the plan. This applies to recipes read after you turn it on.</span></span></label>
    </div>
    <div class="next-row"><button class="primary" data-goto="recipes">Next: add recipes →</button></div>`;
}

function recipeSummary(r) {
  const apps = [...new Set(r.parsed.steps.map((s) => APPLIANCES[s.appliance]?.label).filter(Boolean))];
  return `${r.parsed.ingredients.length} ingredients · ${r.parsed.steps.length} steps${apps.length ? ' · ' + apps.join(', ') : ''}`;
}

function sourceEditor(r) {
  if (r.sourceType === 'url') {
    return `<label class="field">Recipe link<input type="url" placeholder="https://…" value="${esc(r.url)}" data-recipe="${r.id}" data-prop="url"></label>`;
  }
  if (r.sourceType === 'file') {
    const kind = r.file?.kind === 'text' ? 'text file' : r.file?.kind === 'pdf' ? 'PDF' : 'image';
    return `<p class="file-pill">📄 ${esc(r.file?.name || 'file')} <span class="hint">(${kind})</span></p>
      ${r.file && r.file.kind !== 'text' && !r.file.data ? '<p class="hint warn">This file is too big to keep after a reload. Upload it again if you need to re-read it.</p>' : ''}`;
  }
  return `<label class="field">Recipe text<textarea rows="6" placeholder="Paste the whole recipe: ingredients and steps." data-recipe="${r.id}" data-prop="text">${esc(r.text)}</textarea></label>`;
}

function readControls(r) {
  const s = state.settings;
  if (s.aiMode === 'api') {
    if (!apiKey) return '<p class="hint warn">Add your API key above to read recipes with Claude.</p>';
    return `<button class="primary" data-action="read-api" data-id="${r.id}" ${ui.busy[r.id] ? 'disabled' : ''}>${ui.busy[r.id] ? '<span class="spinner"></span> Reading…' : 'Read with Claude'}</button>`;
  }
  const attach = r.sourceType === 'file' && r.file?.kind !== 'text';
  return `<ol class="ai-steps">
      <li><button data-action="copy-prompt" data-id="${r.id}">Copy AI prompt</button>
        <span class="hint">Paste it into any AI chat (ChatGPT, Claude, Gemini, Copilot…).${attach ? ` <b>Attach ${esc(r.file.name)} in that chat too.</b>` : ''}${r.sourceType === 'url' ? ' Use an AI that can open links.' : ''}</span></li>
      <li><label class="field">Paste the AI's whole answer here
        <textarea rows="4" placeholder="{ &quot;title&quot;: … }" data-recipe="${r.id}" data-prop="answer">${esc(r.answer || '')}</textarea></label>
        <button class="primary" data-action="use-answer" data-id="${r.id}">Use this answer</button></li>
    </ol>`;
}

function recipeCard(r, i) {
  const eat = `<label class="field small">Ready at <span class="hint">(optional; leave blank for meal time)</span>
      <input type="datetime-local" value="${esc(r.eatAt || '')}" data-recipe="${r.id}" data-prop="eatAt"></label>`;
  const error = r.error ? `<p class="error-box">${esc(r.error)}</p>` : '';
  if (r.parsed) {
    const suggested = r.parsed.steps.flatMap((s) => s.alternatives.filter((a) => a.suggested && a.note).map((a) => a.note));
    return `<article class="card recipe parsed" style="--rc: var(--c${i % 8})">
      <header class="recipe-head"><span class="dot"></span><h3>${esc(r.parsed.title)}</h3>
        <button class="ghost danger" data-action="remove" data-id="${r.id}" aria-label="Remove ${esc(r.parsed.title)}">Remove</button></header>
      <p class="hint">${esc(recipeSummary(r))}</p>
      ${eat}
      ${r.parsed.notes.length ? `<ul class="notes">${r.parsed.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      ${suggested.length ? `<p class="hint"><b>AI suggestions${state.settings.aiSuggestions ? '' : ' (off on the Kitchen tab)'}:</b> ${suggested.map(esc).join(' ')}</p>` : ''}
      <details><summary>Steps and data</summary>
        <ol class="mini-steps">${r.parsed.steps.map((s) => `<li>${esc(s.text)} <span class="hint">${[APPLIANCES[s.appliance]?.label, s.temp != null ? s.temp + '°' : '', formatDuration(s.minutes)].filter(Boolean).join(' · ')}</span></li>`).join('')}</ol>
        <label class="field">Edit the data directly (advanced)
          <textarea rows="10" class="mono" data-json="${r.id}">${esc(JSON.stringify(r.parsed, null, 2))}</textarea></label>
        <div class="row"><button data-action="save-json" data-id="${r.id}">Save changes</button>
        <button class="ghost" data-action="reread" data-id="${r.id}">Read it again</button></div>
      </details>
      ${error}
    </article>`;
  }
  return `<article class="card recipe">
    <header class="recipe-head"><h3>Recipe ${i + 1}</h3>
      <button class="ghost danger" data-action="remove" data-id="${r.id}">Remove</button></header>
    ${sourceEditor(r)}
    ${eat}
    ${readControls(r)}
    ${error}
  </article>`;
}

function renderRecipes() {
  const s = state.settings;
  const api = s.aiMode === 'api';
  $('#tab-recipes').innerHTML = `
    <div class="card">
      <h2>How should recipes be read?</h2>
      <p class="hint">An AI turns each recipe into steps, times and a shopping list. Pick how:</p>
      <div class="choice-row">
        <label class="choice"><input type="radio" name="aiMode" value="prompt" data-setting="aiMode" ${api ? '' : 'checked'}>
          <span><b>Copy a prompt into any AI</b><br><span class="hint">Free with most AI chats. You copy, paste, and paste back.</span></span></label>
        <label class="choice"><input type="radio" name="aiMode" value="api" data-setting="aiMode" ${api ? 'checked' : ''}>
          <span><b>Use my Anthropic API key</b><br><span class="hint">One click per recipe. Costs a few cents each, billed to you.</span></span></label>
      </div>
      ${api ? `<div class="api-box">
        <label class="field">Anthropic API key
          <input type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(apiKey)}" data-key="1"></label>
        <label class="field">Model
          <select data-setting="model">${MODELS.map((m) => `<option value="${m.id}" ${s.model === m.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" data-setting="rememberKey" ${s.rememberKey ? 'checked' : ''}><span>Remember the key on this device</span></label>
        <p class="hint">Your key goes straight from this browser to Anthropic. It isn't sent anywhere else and isn't included in share links. Get a key at <a href="https://console.anthropic.com/" target="_blank" rel="noopener">console.anthropic.com</a>.</p>
      </div>` : ''}
    </div>

    <div class="recipe-list">${state.recipes.map(recipeCard).join('') || '<p class="empty">No recipes yet. Add one below, or load the example meal to see how it works.</p>'}</div>

    <div class="card add-card">
      <h2>Add a recipe</h2>
      <div class="row">
        <button data-action="add" data-type="text">＋ Paste text</button>
        <button data-action="add" data-type="url">＋ Link</button>
        <label class="button">＋ Upload file<input type="file" accept=".txt,.md,.pdf,image/*" multiple hidden data-upload="1"></label>
        <button class="ghost" data-action="sample">Load example meal</button>
      </div>
      <p class="hint">Files can be text, PDF or a photo of a recipe card.</p>
    </div>
    <div class="next-row"><button class="primary" data-goto="plan">See the plan →</button></div>`;
}

// ---------- plan tab ----------

function getPlan() {
  try {
    ui.plan = buildPlan(state);
  } catch (err) {
    console.error(err);
    ui.plan = null;
    toast(`Couldn't build the plan: ${err.message}`, true);
  }
  return ui.plan;
}

function recipeColor(recipeId) {
  const i = state.recipes.findIndex((r) => r.id === recipeId);
  return i === -1 ? 'var(--batch)' : `var(--c${i % 8})`;
}

function renderPlan() {
  const ready = state.recipes.filter((r) => r.parsed);
  if (!ready.length) {
    $('#tab-plan').innerHTML = `<div class="card empty-plan"><h2>Nothing to plan yet</h2>
      <p>Add at least one recipe and have it read, and your plan will show up here.</p>
      <div class="row"><button class="primary" data-goto="recipes">Add recipes</button><button class="ghost" data-action="sample">Load example meal</button></div></div>`;
    return;
  }
  const plan = getPlan();
  if (!plan) return;
  const waiting = state.recipes.length - ready.length;
  const tabs = [['steps', 'Steps'], ['timeline', 'Timeline'], ['grocery', 'Groceries'], ['tools', 'Tools']];
  $('#tab-plan').innerHTML = `
    <div class="card toolbar">
      <div class="row">
        <button data-action="print">🖨 Print</button>
        <button data-action="pdf" ${ui.busy.pdf ? 'disabled' : ''}>${ui.busy.pdf ? '<span class="spinner"></span> ' : ''}Download PDF</button>
        <button data-action="docx" ${ui.busy.docx ? 'disabled' : ''}>${ui.busy.docx ? '<span class="spinner"></span> ' : ''}Download Word (.docx)</button>
      </div>
      <label class="check"><input type="checkbox" data-setting="pagePerSection" ${state.settings.pagePerSection ? 'checked' : ''}><span>Put each section on its own page</span></label>
    </div>
    ${waiting ? `<p class="notice">${waiting} recipe${waiting > 1 ? 's haven\'t' : ' hasn\'t'} been read yet, so ${waiting > 1 ? 'they\'re' : 'it\'s'} not in this plan.</p>` : ''}
    ${plan.warnings.length ? `<div class="notice warn"><b>Heads up</b><ul>${plan.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
    <nav class="subtabs" role="tablist">${tabs.map(([id, label]) => `<button role="tab" data-plantab="${id}" aria-selected="${ui.planTab === id}" class="${ui.planTab === id ? 'active' : ''}">${label}</button>`).join('')}</nav>
    <div id="plan-body"></div>`;
  const body = $('#plan-body');
  if (ui.planTab === 'steps') body.innerHTML = stepsHtml(plan);
  if (ui.planTab === 'timeline') body.innerHTML = timelineHtml(plan);
  if (ui.planTab === 'grocery') body.innerHTML = groceryHtml(plan);
  if (ui.planTab === 'tools') body.innerHTML = toolsHtml(plan);
}

const eventKey = (ev) => `${ev.kind}|${ev.node.id}`;

function stepsHtml(plan) {
  const unit = state.settings.tempUnit;
  let lastDay = null;
  return plan.sections.map((sec, i) => {
    const dayHead = sec.day !== lastDay ? `<h2 class="day-head">${esc(formatDay(sec.start))}</h2>` : '';
    lastDay = sec.day;
    const color = sec.batch ? 'var(--batch)' : recipeColor(sec.recipeIds[0]);
    const items = sec.items.map((ev) => {
      const d = describeEvent(ev, unit);
      const k = eventKey(ev);
      const done = !!state.done[k];
      return `<li class="step${done ? ' done' : ''}${d.timer ? ' timer' : ''}${d.suggested ? ' suggested' : ''}">
        <label><input type="checkbox" data-done="${esc(k)}" ${done ? 'checked' : ''}>
        <span class="time">${esc(formatTime(ev.t))}</span>
        <span class="what">${d.timer ? '⏰ ' : ''}${esc(d.text)}${d.meta ? ` <span class="meta">${esc(d.meta)}</span>` : ''}
        ${d.sub.length ? `<ul>${d.sub.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}</span></label></li>`;
    }).join('');
    return `${dayHead}<section class="card section" style="--rc:${color}">
      <header><span class="sec-num">${i + 1}</span><div><h3>${esc(sec.title)}</h3>
        <p class="hint">${esc(formatTime(sec.start))}${sec.batch ? ` · batch prep for ${esc(sec.recipes.join(', '))}` : ''}</p></div></header>
      ${sec.tools.length ? `<p class="tools-line"><b>You'll need:</b> ${esc(sec.tools.join(', '))}</p>` : ''}
      <ol class="steps">${items}</ol>
      ${sec.rawMeat ? '<p class="raw-note">🧼 Raw meat: wash your hands, tools and surfaces before using them for anything else.</p>' : ''}
    </section>`;
  }).join('');
}

function timelineHtml(plan) {
  const days = [...new Set(plan.timeline.flatMap((r) => r.bars.map((b) => {
    const d = fromMin(b.s); d.setHours(0, 0, 0, 0); return toMin(d);
  })))].sort((a, b) => a - b);
  const mealDay = (() => { const d = new Date(state.mealTime); d.setHours(0, 0, 0, 0); return toMin(d); })();
  if (!days.includes(ui.day)) ui.day = days.includes(mealDay) ? mealDay : days[days.length - 1];
  const dayStart = ui.day;
  const dayEnd = dayStart + 24 * 60;
  const inDay = (b) => b.e > dayStart && b.s < dayEnd;
  const bars = plan.timeline.flatMap((r) => r.bars.filter(inDay));
  let from = Math.max(dayStart, Math.min(...bars.map((b) => b.s)));
  let to = Math.min(dayEnd, Math.max(...bars.map((b) => b.e)));
  from = Math.floor(from / 60) * 60;
  to = Math.max(from + 120, Math.ceil(to / 60) * 60);
  const PX = 2.4; // pixels per minute
  const width = (to - from) * PX;
  const LANE = 34;

  const ticks = [];
  for (let m = from; m <= to; m += 60) ticks.push(`<span class="tick" style="left:${(m - from) * PX}px">${esc(formatTime(m))}</span>`);

  const rows = plan.timeline.map((row) => {
    const rb = row.bars.filter(inDay);
    const lanes = row.lanes || 1;
    const html = rb.map((b) => {
      const s = Math.max(b.s, from);
      const e = Math.min(b.e, to);
      const color = b.recipeId ? recipeColor(b.recipeId) : 'var(--batch)';
      const tip = `${b.label}: ${formatTime(b.s)}–${formatTime(b.e)}${b.detail ? '\n' + b.detail : ''}`;
      return `<div class="bar ${b.kind}" style="left:${(s - from) * PX}px;width:${Math.max(4, (e - s) * PX)}px;top:${b.lane * LANE + 4}px;--rc:${color}" title="${esc(tip)}" tabindex="0">
        <span>${esc(b.kind === 'preheat' ? '' : b.label)}</span></div>`;
    }).join('');
    return `<div class="tl-row${row.missing ? ' missing' : ''}" style="height:${lanes * LANE + 8}px">
      <div class="tl-label">${esc(row.label)}</div>
      <div class="tl-track" style="width:${width}px">${html}</div></div>`;
  }).join('');

  const legend = plan.recipes.map((r) => `<span class="legend-item"><span class="dot" style="--rc:${recipeColor(r.id)}"></span>${esc(r.parsed.title)}</span>`).join('')
    + '<span class="legend-item"><span class="dot" style="--rc:var(--batch)"></span>Batch prep</span><span class="legend-item"><span class="dot hatch"></span>Preheating</span>';

  return `<div class="card">
    ${days.length > 1 ? `<div class="day-chips">${days.map((d) => `<button data-day="${d}" class="${d === ui.day ? 'active' : ''}">${esc(formatDay(d))}</button>`).join('')}</div>` : `<h3>${esc(formatDay(ui.day))}</h3>`}
    <p class="hint">Each row is an appliance. Hover or tap a bar for details. Scroll sideways to see the whole day.</p>
    <div class="timeline"><div class="tl-inner">
      <div class="tl-row tl-axis"><div class="tl-label"></div><div class="tl-track" style="width:${width}px">${ticks.join('')}</div></div>
      ${rows}
    </div></div>
    <div class="legend">${legend}</div>
  </div>`;
}

function groceryHtml(plan) {
  const groups = CATEGORIES.map((cat) => {
    const items = plan.grocery.filter((g) => g.category === cat && !g.have);
    if (!items.length) return '';
    return `<h3>${esc(cat[0].toUpperCase() + cat.slice(1))}</h3><ul class="checklist">${items.map((g) => `<li>
      <label><input type="checkbox" data-have="${esc(g.key)}"><span><b>${esc(g.name)}</b>${g.amount ? ` · ${esc(g.amount)}` : ''}
      <span class="hint">${esc(g.recipes.join(', '))}${g.notes.length ? ' · ' + esc(g.notes.join('; ')) : ''}</span></span></label></li>`).join('')}</ul>`;
  }).join('');
  const have = plan.grocery.filter((g) => g.have);
  return `<div class="card">
    <div class="row space"><p class="hint">Check off anything you already have. It moves to the bottom and stays off the printed list.</p>
    <button data-action="copy-list">Copy list</button></div>
    ${groups || '<p class="empty">You have everything!</p>'}
    ${have.length ? `<h3>Already have</h3><ul class="checklist have">${have.map((g) => `<li><label><input type="checkbox" checked data-have="${esc(g.key)}"><span>${esc(g.name)}</span></label></li>`).join('')}</ul>` : ''}
  </div>`;
}

function toolsHtml(plan) {
  return `<div class="card"><p class="hint">Everything the recipes call for. Pull it out before you start.</p>
    <ul class="checklist">${plan.tools.map((t) => `<li><label><input type="checkbox"><span><b>${esc(t.name)}</b> <span class="hint">${esc(t.recipes.join(', '))}</span></span></label></li>`).join('')}</ul></div>`;
}

// ---------- actions ----------

function findRecipe(id) { return state.recipes.find((r) => r.id === id); }

function addRecipe(type, extra = {}) {
  const r = { id: uid(), sourceType: type, text: '', url: '', file: null, eatAt: '', parsed: null, answer: '', error: '', ...extra };
  state.recipes.push(r);
  save();
  return r;
}

async function readFile(file) {
  if (file.size > MAX_FILE) throw new Error(`${file.name} is too big (over 15 MB).`);
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    return { name: file.name, kind: 'pdf', mediaType: 'application/pdf', data: await toBase64(file) };
  }
  if (file.type.startsWith('image/')) {
    return { name: file.name, kind: 'image', mediaType: file.type, data: await toBase64(file) };
  }
  return { name: file.name, kind: 'text', text: await file.text() };
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = () => reject(new Error(`Couldn't read ${file.name}.`));
    fr.readAsDataURL(file);
  });
}

function hasSource(r) {
  if (r.sourceType === 'url') return /^https?:\/\/\S+\.\S+/.test(r.url.trim());
  if (r.sourceType === 'file') return !!r.file && (r.file.kind === 'text' ? !!r.file.text : true);
  return r.text.trim().length > 20;
}

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch {
    window.prompt('Copy this:', text);
  }
}

async function shareLink() {
  const data = {
    v: 1, title: state.title, mealTime: state.mealTime, kitchen: state.kitchen,
    settings: { ...state.settings, rememberKey: false, aiMode: 'prompt' },
    recipes: state.recipes.filter((r) => r.parsed).map((r) => ({ id: r.id, sourceType: r.sourceType === 'url' ? 'url' : 'text', url: r.url || '', eatAt: r.eatAt, parsed: r.parsed })),
    have: state.have,
  };
  if (!data.recipes.length) return toast('Read at least one recipe before sharing.', true);
  const code = await encodeShare(data);
  const url = `${location.origin}${location.pathname}#plan=${code}`;
  await copyText(url, 'Share link copied. Anyone with the link can open a copy of this plan.');
}

async function openSharedLink() {
  const m = location.hash.match(/^#plan=(.+)$/);
  if (!m) return;
  try {
    const data = await decodeShare(m[1]);
    const replace = !state.recipes.length || window.confirm(`Open the shared plan "${data.title}"? This replaces the plan saved on this device.`);
    if (replace) {
      const base = freshState();
      state = {
        ...base, title: data.title || base.title, mealTime: data.mealTime || base.mealTime,
        kitchen: data.kitchen || base.kitchen, settings: { ...base.settings, ...data.settings },
        recipes: (data.recipes || []).map((r) => ({ id: r.id || uid(), sourceType: r.sourceType || 'text', text: '', url: r.url || '', file: null, eatAt: r.eatAt || '', parsed: normalizeRecipe(r.parsed), answer: '', error: '' })),
        have: data.have || {},
      };
      ui.tab = 'plan';
      save();
    }
  } catch (err) {
    console.error(err);
    toast("That share link couldn't be opened. It may have been cut off when it was copied.", true);
  }
  history.replaceState(null, '', location.pathname);
}

function fileName(ext) {
  return `${(state.title || 'holiday-dinner').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'holiday-dinner'}.${ext}`;
}

async function exportAs(kind) {
  const plan = ui.plan || getPlan();
  if (!plan) return;
  const outline = buildOutline(state, plan);
  const opts = { pagePerSection: state.settings.pagePerSection };
  if (kind === 'print') return printOutline(outline, opts);
  ui.busy[kind] = true;
  renderPlan();
  try {
    if (kind === 'pdf') await downloadPdf(outline, opts, fileName('pdf'));
    else await downloadDocx(outline, opts, fileName('docx'));
  } catch (err) {
    console.error(err);
    toast(err.message || 'The download failed.', true);
  } finally {
    ui.busy[kind] = false;
    renderPlan();
  }
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('button, [data-tab]');
  if (!el) return;
  if (el.dataset.tab) { ui.tab = el.dataset.tab; render(); return; }
  if (el.dataset.goto) { ui.tab = el.dataset.goto; render(); window.scrollTo(0, 0); return; }
  if (el.dataset.plantab) { ui.planTab = el.dataset.plantab; renderPlan(); return; }
  if (el.dataset.day) { ui.day = Number(el.dataset.day); renderPlan(); return; }

  const r = el.dataset.id ? findRecipe(el.dataset.id) : null;
  switch (el.dataset.action) {
    case 'add': {
      addRecipe(el.dataset.type);
      render();
      const cards = document.querySelectorAll('.recipe-list .recipe');
      cards[cards.length - 1]?.querySelector('textarea, input')?.focus();
      break;
    }
    case 'remove':
      if (r && (!r.parsed || window.confirm(`Remove ${r.parsed.title} from this meal?`))) {
        state.recipes = state.recipes.filter((x) => x !== r);
        save(); render();
      }
      break;
    case 'sample': {
      if (state.recipes.length && !window.confirm('Replace your current recipes with the example meal?')) break;
      const s = sampleMeal();
      Object.assign(state, { title: s.title, mealTime: s.mealTime, recipes: s.recipes.map((x) => ({ text: '', url: '', file: null, answer: '', error: '', ...x })), have: {}, done: {} });
      state.kitchen.airfryer = state.kitchen.airfryer?.count ? state.kitchen.airfryer : { count: 1, capacity: 1 };
      ui.tab = 'plan'; ui.planTab = 'steps';
      save(); render();
      toast('Example meal loaded. An air fryer was added to your kitchen for the cinnamon rolls.');
      break;
    }
    case 'copy-prompt':
      if (!hasSource(r)) { toast('Add the recipe first: paste the text, a link, or a file.', true); break; }
      await copyText(buildPrompt(r, state), 'Prompt copied. Paste it into your AI chat.');
      break;
    case 'use-answer':
      try {
        r.parsed = parseAnswer(r.answer);
        r.error = '';
        r.answer = '';
        toast(`Got it: ${r.parsed.title}.`);
      } catch (err) {
        r.error = err.message;
      }
      save(); render();
      break;
    case 'read-api':
      if (!hasSource(r)) { toast('Add the recipe first: paste the text, a link, or a file.', true); break; }
      if (r.sourceType === 'file' && r.file.kind !== 'text' && !r.file.data) { toast('Upload the file again first.', true); break; }
      ui.busy[r.id] = true; r.error = ''; render();
      try {
        r.parsed = await readWithClaude(r, state, apiKey);
        toast(`Got it: ${r.parsed.title}.`);
      } catch (err) {
        console.error(err);
        r.error = err.message || 'Something went wrong.';
      } finally {
        ui.busy[r.id] = false;
        save(); render();
      }
      break;
    case 'save-json': {
      const ta = document.querySelector(`[data-json="${r.id}"]`);
      try {
        r.parsed = normalizeRecipe(JSON.parse(ta.value));
        r.error = '';
        toast('Saved.');
      } catch (err) {
        r.error = `That isn't valid recipe data: ${err.message}`;
      }
      save(); render();
      break;
    }
    case 'reread':
      if (!hasSource(r)) { r.sourceType = 'text'; r.text = ''; }
      r.parsed = null; save(); render();
      break;
    case 'print': case 'pdf': case 'docx':
      exportAs(el.dataset.action);
      break;
    case 'copy-list': {
      const plan = ui.plan;
      const text = CATEGORIES.map((cat) => {
        const items = plan.grocery.filter((g) => g.category === cat && !g.have);
        return items.length ? `${cat.toUpperCase()}\n${items.map((g) => `- ${g.name}${g.amount ? ` (${g.amount})` : ''}`).join('\n')}` : '';
      }).filter(Boolean).join('\n\n');
      await copyText(text, 'Grocery list copied.');
      break;
    }
    case 'share':
      shareLink().catch((err) => toast(`Couldn't make a link: ${err.message}`, true));
      break;
    default:
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'plan-title') { state.title = t.value; save(); return; }
  if (t.dataset.key) { apiKey = t.value.trim(); writeKey(); return; }
  if (t.dataset.recipe && ['text', 'url', 'answer'].includes(t.dataset.prop)) {
    findRecipe(t.dataset.recipe)[t.dataset.prop] = t.value;
    save();
  }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.field === 'mealTime') { state.mealTime = t.value; save(); return; }
  if (t.dataset.recipe && t.dataset.prop === 'eatAt') { findRecipe(t.dataset.recipe).eatAt = t.value; save(); return; }
  if (t.dataset.key) { renderRecipes(); return; }

  if (t.dataset.appliance) {
    const type = t.dataset.appliance;
    const def = APPLIANCES[type];
    const cfg = state.kitchen[type] || { count: 0, capacity: def.capacity };
    if (t.dataset.prop === 'on') cfg.count = t.checked ? Math.max(1, cfg.count || 1) : 0;
    else cfg[t.dataset.prop] = Math.max(1, Math.round(Number(t.value) || 1));
    state.kitchen[type] = cfg;
    save(); renderKitchen();
    return;
  }

  if (t.dataset.setting) {
    const k = t.dataset.setting;
    const s = state.settings;
    if (t.type === 'checkbox') s[k] = t.checked;
    else if (t.type === 'number') s[k] = Number(t.value) || 0;
    else s[k] = t.value;
    if (k === 'tempUnit') s.tempTolerance = s.tempUnit === 'C' ? 15 : 25;
    if (k === 'rememberKey') writeKey();
    save();
    if (ui.tab === 'kitchen' && ['tempUnit'].includes(k)) renderKitchen();
    if (ui.tab === 'recipes' && ['aiMode'].includes(k)) renderRecipes();
    if (ui.tab === 'plan') renderPlan();
    return;
  }

  if (t.dataset.done) {
    if (t.checked) state.done[t.dataset.done] = true;
    else delete state.done[t.dataset.done];
    t.closest('.step')?.classList.toggle('done', t.checked);
    save();
    return;
  }

  if (t.dataset.have) {
    if (t.checked) state.have[t.dataset.have] = true;
    else delete state.have[t.dataset.have];
    save(); renderPlan();
    return;
  }

  if (t.dataset.upload) {
    const files = [...t.files];
    for (const f of files) {
      try {
        const file = await readFile(f);
        addRecipe('file', { file });
      } catch (err) {
        toast(err.message, true);
      }
    }
    render();
  }
});

window.addEventListener('hashchange', () => openSharedLink().then(render));

// Data shape for future pantry and grocery-cart connectors.
window.holidayDinner = {
  groceryList: () => (ui.plan || getPlan())?.grocery.map(({ key, name, amount, category, recipes, have }) => ({ key, name, amount, category, recipes, have })) || [],
  markHave: (names) => { names.forEach((n) => { state.have[groceryKey(n)] = true; }); save(); render(); },
};

await openSharedLink();
if (state.recipes.some((r) => r.parsed) && ui.tab === 'kitchen') ui.tab = 'plan';
render();
