import {
  loadSettings, saveSettings, DEFAULT_SETTINGS, loadStorageConfig, saveStorageConfig, DEFAULT_STORAGE,
  makeStore, loadCachedRecipes, cacheRecipes, loadProgress, saveProgress, newId,
  exportRecipes, readRecipeFile, makeSetupLink, readSetupLink,
} from './storage.js';
import { findDurations, formatDuration, parseQuickTimer, parseRecipeText, splitLongSteps, cleanLine } from './parse.js';
import { canSpeak, canListen, speak, stopSpeaking, getVoices, onVoicesChanged, onSpeakingChange, startListening } from './speech.js';
import { getTimers, addTimer, removeTimer, remaining, onTimersChange, onTimerAlert, unlockSound, startChime, stopChime } from './timers.js';
import { SAMPLE_RECIPE } from './sample.js';

const app = document.getElementById('app');
const alertBox = document.getElementById('alert');
const toastBox = document.getElementById('toast');

const state = {
  settings: loadSettings(),
  storageCfg: loadStorageConfig(),
  store: null,
  recipes: [],
  sync: { status: 'loading', at: null, message: '' },
  view: { name: 'home' },
  draft: null,
  search: '',
  alerts: [],
};
state.store = makeStore(state.storageCfg);

const FONTS = {
  atkinson: { label: 'Atkinson Hyperlegible (low vision)', css: "'Atkinson Hyperlegible', system-ui, sans-serif" },
  lexend: { label: 'Lexend (easier reading)', css: "'Lexend', system-ui, sans-serif" },
  opendyslexic: { label: 'OpenDyslexic (dyslexia)', css: "'OpenDyslexic', 'Comic Sans MS', sans-serif" },
  system: { label: "This device's usual font", css: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
};

const THEMES = {
  dark: 'Bright on black (high contrast)',
  light: 'Dark on cream (high contrast)',
  warm: 'Warm and soft (low glare)',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(message) {
  toastBox.textContent = message;
  toastBox.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => toastBox.classList.remove('show'), 4000);
}

// ---------- Settings ----------

function applySettings() {
  const s = state.settings;
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.style.setProperty('--font', FONTS[s.font]?.css || FONTS.atkinson.css);
  root.style.setProperty('--step-size', `${s.textSize}px`);
  root.style.setProperty('--letter', `${s.letterSpacing}em`);
  root.style.setProperty('--word', `${s.wordSpacing}em`);
  root.style.setProperty('--line', s.lineHeight);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim());
}

function updateSetting(key, value) {
  state.settings[key] = value;
  saveSettings(state.settings);
  applySettings();
}

// ---------- Recipes ----------

const sortRecipes = (list) => [...list].sort((a, b) => a.title.localeCompare(b.title));

async function loadRecipes({ quiet = false } = {}) {
  if (!quiet) state.sync = { ...state.sync, status: 'loading' };
  try {
    state.recipes = sortRecipes(await state.store.load());
    cacheRecipes(state.recipes, state.store.label);
    state.sync = { status: 'ok', at: Date.now(), message: '' };
  } catch (err) {
    const cached = loadCachedRecipes(state.store.label);
    if (cached) state.recipes = sortRecipes(cached.recipes);
    state.sync = { status: 'error', at: cached?.at ?? null, message: err.message || 'Could not load recipes.' };
  }
  if (state.view.name === 'home') render();
}

async function changeRecipes(change, message) {
  const next = await state.store.apply(change, message);
  state.recipes = sortRecipes(next);
  cacheRecipes(state.recipes, state.store.label);
  state.sync = { status: 'ok', at: Date.now(), message: '' };
}

const findRecipe = (id) => state.recipes.find((r) => r.id === id);

// ---------- Views ----------

function go(view) {
  stopSpeaking();
  state.view = view;
  render();
  window.scrollTo(0, 0);
}

function render() {
  const v = state.view;
  const html = {
    home: renderHome,
    cook: renderCook,
    edit: renderEdit,
    settings: renderSettings,
    join: renderJoin,
    quickTimer: renderQuickTimer,
  }[v.name]();
  app.innerHTML = html;
  app.dataset.view = v.name;
  afterRender[v.name]?.();
  updateCookHelpers();
}

function timersStrip() {
  const timers = getTimers();
  if (!timers.length) return '<div id="timers" class="timers" hidden></div>';
  return `<div id="timers" class="timers" role="region" aria-label="Timers">${timers.map(timerChip).join('')}</div>`;
}

function timerChip(t) {
  const left = remaining(t);
  const done = left === 0;
  return `<div class="timer-chip ${done ? 'done' : ''}" data-timer="${t.id}">
    <span class="timer-label">${esc(t.label)}</span>
    <span class="timer-time" data-timer-time="${t.id}">${done ? 'Done!' : formatDuration(left, { short: true })}</span>
    <button class="btn small" data-action="remove-timer" data-id="${t.id}" aria-label="Cancel timer for ${esc(t.label)}">${done ? 'Clear' : 'Cancel'}</button>
  </div>`;
}

function syncLine() {
  const s = state.sync;
  const where = esc(state.store.label);
  if (s.status === 'loading') return `<p class="sync">Loading recipes…</p>`;
  if (s.status === 'error') {
    return `<p class="sync warn" role="status">${esc(s.message)}${s.at ? ' Showing the recipes saved on this device.' : ''}
      <button class="btn small" data-action="refresh">Try again</button></p>`;
  }
  return `<p class="sync">Recipes from ${where}. <button class="btn link" data-action="refresh">Check for new recipes</button></p>`;
}

function renderHome() {
  const s = state.settings;
  const progress = loadProgress();
  const q = state.search.trim().toLowerCase();
  const list = q ? state.recipes.filter((r) => r.title.toLowerCase().includes(q)) : state.recipes;
  const cards = list.map((r) => {
    const p = progress[r.id];
    const resume = p && p.step > 0 && p.step <= r.steps.length;
    return `<li><button class="recipe-card" data-action="open-recipe" data-id="${r.id}">
      <span class="recipe-title">${esc(r.title)}</span>
      <span class="recipe-meta">${r.steps.length} step${r.steps.length === 1 ? '' : 's'}${r.servings ? ` · Serves ${esc(r.servings)}` : ''}</span>
      ${resume ? `<span class="badge">Pick up at step ${p.step}</span>` : ''}
    </button></li>`;
  }).join('');

  const empty = state.recipes.length
    ? (q ? `<p class="empty">No recipes match “${esc(state.search)}”.</p>` : '')
    : `<div class="empty">
        <p>No recipes yet.</p>
        ${s.showEditing ? `<button class="btn" data-action="add-sample">Add an example recipe to try</button>` : ''}
      </div>`;

  return `
    <header class="topbar home-top">
      <h1>${s.cookName ? `Hi, ${esc(s.cookName)}` : 'Step by Step Recipes'}</h1>
      <button class="btn" data-action="go-settings">Settings</button>
    </header>
    ${timersStrip()}
    <main>
      ${state.recipes.length > 6 ? `<label class="search"><span class="sr-only">Find a recipe</span>
        <input type="search" id="search" placeholder="Find a recipe" value="${esc(state.search)}" autocomplete="off"></label>` : ''}
      <ul class="recipe-grid">${cards}</ul>
      ${empty}
      <div class="action-row">
        <button class="btn big" data-action="quick-timer">Set a timer</button>
        ${s.showEditing && state.store.canEdit ? `<button class="btn big" data-action="new-recipe">Add a recipe</button>` : ''}
      </div>
      ${syncLine()}
    </main>`;
}

// ----- Cook mode -----

function cookPages(recipe) {
  const pages = [];
  if (recipe.ingredients?.length) pages.push({ kind: 'ingredients' });
  recipe.steps.forEach((text, i) => pages.push({ kind: 'step', text, number: i + 1 }));
  pages.push({ kind: 'done' });
  return pages;
}

function wordSpans(text, durations) {
  let out = '';
  const re = /\S+/g;
  let m;
  let last = 0;
  while ((m = re.exec(text))) {
    out += esc(text.slice(last, m.index));
    const inTime = durations.some((d) => m.index >= d.start && m.index < d.end);
    out += `<span class="w${inTime ? ' time' : ''}" data-i="${m.index}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

function timerLabel(recipe, durationPhrase, stepText) {
  const short = stepText.replace(durationPhrase, '').replace(/[.,;:]+\s*$/, '').trim();
  const words = short.split(/\s+/).slice(0, 5).join(' ');
  return `${recipe.title}: ${words}${short.split(/\s+/).length > 5 ? '…' : ''}`;
}

function renderCook() {
  const recipe = findRecipe(state.view.id);
  if (!recipe) return `<main><p class="empty">This recipe is no longer here.</p><button class="btn big" data-action="go-home">Back to recipes</button></main>`;
  const pages = cookPages(recipe);
  const i = Math.min(state.view.page, pages.length - 1);
  const page = pages[i];
  const stepCount = recipe.steps.length;
  let body = '';
  let heading = '';

  if (page.kind === 'ingredients') {
    heading = 'What you need';
    body = `<ul class="ingredients">${recipe.ingredients.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  } else if (page.kind === 'step') {
    heading = `Step ${page.number} of ${stepCount}`;
    const durations = findDurations(page.text);
    const timerButtons = durations.map((d) => {
      const label = timerLabel(recipe, d.phrase, page.text);
      const running = getTimers().find((t) => t.label === label && remaining(t) > 0);
      if (running) return `<p class="timer-note">Timer running: <span data-timer-time="${running.id}">${formatDuration(remaining(running), { short: true })}</span> left</p>`;
      const check = d.checkSeconds && state.settings.checkAlert ? `<span class="hint">I'll remind you to check at ${formatDuration(d.checkSeconds)}.</span>` : '';
      return `<button class="btn timer-btn" data-action="start-step-timer" data-seconds="${d.seconds}" data-check="${d.checkSeconds ?? ''}" data-label="${esc(label)}">
        Start timer: ${formatDuration(d.seconds)} ${check}</button>`;
    }).join('');
    body = `<p class="step-text" id="step-text">${wordSpans(page.text, durations)}</p>${timerButtons}`;
  } else {
    heading = 'All done!';
    body = `<p class="step-text">You finished ${esc(recipe.title)}. Enjoy!</p>
      <div class="action-row"><button class="btn big" data-action="go-home">Back to recipes</button>
      <button class="btn big" data-action="cook-restart">Start over</button></div>`;
  }

  const pct = Math.round((i / (pages.length - 1)) * 100);
  return `
    <header class="topbar cook-top">
      <button class="btn" data-action="go-home">Recipes</button>
      <h1 class="cook-title">${esc(recipe.title)}</h1>
      <span class="top-right"><span id="listen-status" class="listen" hidden></span>
      ${state.settings.showEditing && state.store.canEdit ? `<button class="btn" data-action="edit-recipe" data-id="${recipe.id}">Edit</button>` : ''}</span>
    </header>
    ${timersStrip()}
    <main class="cook">
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Progress"><span style="width:${pct}%"></span></div>
      <h2 class="step-heading" tabindex="-1" id="step-heading">${heading}</h2>
      <div class="step-body" aria-live="polite">${body}</div>
    </main>
    <nav class="cook-nav" aria-label="Step controls">
      <button class="btn nav-btn" data-action="cook-back" ${i === 0 ? 'disabled' : ''}>◀ Back</button>
      ${canSpeak && page.kind !== 'done' ? `<button class="btn nav-btn" data-action="cook-read">🔊 Read again</button>` : ''}
      ${page.kind !== 'done' ? `<button class="btn nav-btn primary" data-action="cook-next">${i === pages.length - 2 ? 'Finish ✓' : 'Next ▶'}</button>` : ''}
    </nav>`;
}

function spokenText(recipe, page) {
  if (page.kind === 'ingredients') return `Here's what you need. ${recipe.ingredients.join('. ')}.`;
  if (page.kind === 'step') return page.text;
  return '';
}

function readCurrentPage() {
  const recipe = findRecipe(state.view.id);
  if (!recipe || !canSpeak) return;
  const page = cookPages(recipe)[state.view.page];
  const text = spokenText(recipe, page);
  const spans = [...document.querySelectorAll('#step-text .w')];
  const clear = () => spans.forEach((s) => s.classList.remove('reading'));
  speak(text, {
    rate: state.settings.speechRate,
    voiceURI: state.settings.voiceURI,
    onWord: state.settings.highlightWords && page.kind === 'step'
      ? (idx) => {
          clear();
          const span = spans.filter((s) => +s.dataset.i <= idx).pop();
          span?.classList.add('reading');
        }
      : null,
    onEnd: clear,
  });
}

function cookGoto(page) {
  const recipe = findRecipe(state.view.id);
  const pages = cookPages(recipe);
  const next = Math.max(0, Math.min(page, pages.length - 1));
  stopSpeaking();
  state.view = { ...state.view, page: next };
  const progress = loadProgress();
  const stepNum = pages[next].kind === 'step' ? pages[next].number : pages[next].kind === 'done' ? 0 : 0;
  if (stepNum) progress[recipe.id] = { step: stepNum, page: next, at: Date.now() };
  else if (pages[next].kind === 'done') delete progress[recipe.id];
  saveProgress(progress);
  render();
  document.getElementById('step-heading')?.focus({ preventScroll: true });
  if (state.settings.autoRead && pages[next].kind !== 'done') readCurrentPage();
}

// Voice commands and keeping the screen awake only run while cooking.
let listener = null;
let wakeLock = null;

function updateCookHelpers() {
  const cooking = state.view.name === 'cook';
  if (cooking && state.settings.voiceCommands && canListen && !listener) {
    listener = startListening((cmd) => {
      if (state.view.name !== 'cook') return;
      if (cmd === 'next') cookGoto(state.view.page + 1);
      if (cmd === 'back') cookGoto(state.view.page - 1);
      if (cmd === 'repeat') readCurrentPage();
      if (cmd === 'stop') stopSpeaking();
    }, (status) => {
      const el = document.getElementById('listen-status');
      if (!el) return;
      el.hidden = status === 'off';
      el.textContent = status === 'blocked' ? 'Microphone is off' : '🎤 Listening';
    });
  } else if ((!cooking || !state.settings.voiceCommands) && listener) {
    listener.stop();
    listener = null;
  }
  const el = document.getElementById('listen-status');
  if (el && listener) { el.hidden = false; el.textContent = '🎤 Listening'; }

  if (cooking && state.settings.keepAwake && !wakeLock && navigator.wakeLock) {
    navigator.wakeLock.request('screen').then((l) => {
      wakeLock = l;
      l.addEventListener('release', () => { wakeLock = null; });
    }).catch(() => {});
  } else if (!cooking && wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

onSpeakingChange((on) => {
  if (!listener) return;
  if (on) listener.pause();
  else setTimeout(() => listener?.resume(), 400);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') updateCookHelpers();
});

// ----- Quick timer -----

function renderQuickTimer() {
  const text = state.view.text || '';
  const parsed = text ? parseQuickTimer(text) : null;
  const preview = parsed
    ? `<p class="preview">${esc(parsed.label)}: <strong>${formatDuration(parsed.seconds)}</strong>${parsed.checkSeconds && state.settings.checkAlert ? `, with a reminder to check at ${formatDuration(parsed.checkSeconds)}` : ''}.</p>`
    : text ? `<p class="preview warn">Add how long, like “20 minutes” or “5 to 7 hours”.</p>` : '';
  return `
    <header class="topbar"><button class="btn" data-action="go-home">Back</button><h1>Set a timer</h1><span></span></header>
    <main class="narrow">
      <label class="field"><span>What are you timing, and for how long?</span>
        <input id="quick-text" type="text" value="${esc(text)}" placeholder="Turkey, oven, 5 to 7 hours" autocomplete="off" enterkeyhint="go">
      </label>
      ${canListen ? `<button class="btn" data-action="quick-listen">🎤 Say it instead</button>` : ''}
      <div id="quick-preview">${preview}</div>
      <div class="preset-row">
        ${[5, 10, 15, 20, 30, 45, 60].map((m) => `<button class="btn" data-action="quick-preset" data-min="${m}">${m < 60 ? `${m} min` : '1 hour'}</button>`).join('')}
      </div>
      <button class="btn big primary" data-action="quick-start">Start timer</button>
    </main>`;
}

// ----- Editor -----

function blankRecipe() {
  return { id: newId(), title: '', servings: '', ingredients: [], steps: [''], source: '' };
}

function renderEdit() {
  const d = state.draft;
  const isNew = !findRecipe(d.id);
  const steps = d.steps.map((text, i) => {
    const durations = findDurations(text);
    const info = durations.map((x) => `⏱ Timer: ${formatDuration(x.seconds)}${x.checkSeconds ? `, check at ${formatDuration(x.checkSeconds)}` : ''}`).join(' · ');
    return `<li class="step-edit">
      <label class="field"><span>Step ${i + 1}</span>
        <textarea data-step="${i}" rows="3">${esc(text)}</textarea></label>
      <p class="hint" data-step-info="${i}">${info}</p>
      <div class="step-tools">
        <button class="btn small" data-action="step-up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move step ${i + 1} up">↑ Up</button>
        <button class="btn small" data-action="step-down" data-i="${i}" ${i === d.steps.length - 1 ? 'disabled' : ''} aria-label="Move step ${i + 1} down">↓ Down</button>
        <button class="btn small" data-action="step-add-after" data-i="${i}">+ Add step after</button>
        <button class="btn small danger" data-action="step-remove" data-i="${i}" aria-label="Remove step ${i + 1}">Remove</button>
      </div>
    </li>`;
  }).join('');

  return `
    <header class="topbar"><button class="btn" data-action="cancel-edit">Cancel</button><h1>${isNew ? 'Add a recipe' : 'Edit recipe'}</h1>
      <button class="btn primary" data-action="save-recipe">Save</button></header>
    <main class="narrow editor">
      <details class="import" ${isNew ? 'open' : ''}>
        <summary>Fill in from a website or pasted text</summary>
        <label class="field"><span>Recipe web address</span>
          <input id="import-url" type="url" placeholder="https://…" autocomplete="off" inputmode="url"></label>
        <button class="btn" data-action="import-url">Get recipe from link</button>
        <label class="field"><span>Or paste the whole recipe</span>
          <textarea id="import-text" rows="6" placeholder="Paste the recipe here. Lines under “Ingredients” become the ingredient list and lines under “Directions” become steps."></textarea></label>
        <button class="btn" data-action="import-text">Fill in from this text</button>
      </details>

      <label class="field"><span>Recipe name</span>
        <input id="f-title" type="text" value="${esc(d.title)}" autocomplete="off"></label>
      <label class="field"><span>Serves (optional)</span>
        <input id="f-servings" type="text" value="${esc(d.servings)}" autocomplete="off"></label>
      <label class="field"><span>Ingredients (one per line)</span>
        <textarea id="f-ingredients" rows="6">${esc(d.ingredients.join('\n'))}</textarea></label>

      <h2>Steps</h2>
      <p class="hint">Keep each step to one action. Times like “20 minutes” or “5 to 7 hours” get a timer button.</p>
      <ol class="steps-edit">${steps}</ol>
      <div class="action-row">
        <button class="btn" data-action="step-add">+ Add a step</button>
        <button class="btn" data-action="split-steps">Split long steps into sentences</button>
      </div>

      <div class="action-row end">
        ${isNew ? '' : `<button class="btn danger" data-action="delete-recipe">Delete this recipe</button>`}
        <button class="btn big primary" data-action="save-recipe">Save recipe</button>
      </div>
    </main>`;
}

function readDraftFields() {
  const d = state.draft;
  if (!d) return;
  const v = (id) => document.getElementById(id)?.value;
  if (v('f-title') !== undefined) d.title = v('f-title');
  if (v('f-servings') !== undefined) d.servings = v('f-servings');
  if (v('f-ingredients') !== undefined) d.ingredients = v('f-ingredients').split('\n').map(cleanLine).filter(Boolean);
  document.querySelectorAll('textarea[data-step]').forEach((t) => { d.steps[+t.dataset.step] = t.value; });
}

function fillDraft({ title, servings, ingredients, steps, source }) {
  const d = state.draft;
  if (title) d.title = title;
  if (servings) d.servings = String(servings);
  if (ingredients?.length) d.ingredients = ingredients;
  if (steps?.length) d.steps = steps;
  if (source) d.source = source;
}

// ----- Settings -----

function option(value, label, current) {
  return `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`;
}

function check(key, label, hint = '') {
  return `<label class="check"><input type="checkbox" data-setting="${key}" ${state.settings[key] ? 'checked' : ''}>
    <span>${label}${hint ? `<span class="hint">${hint}</span>` : ''}</span></label>`;
}

function range(key, label, min, max, step, format) {
  return `<label class="field"><span>${label}: <output data-out="${key}">${format(state.settings[key])}</output></span>
    <input type="range" data-setting="${key}" min="${min}" max="${max}" step="${step}" value="${state.settings[key]}"></label>`;
}

const fmt = {
  textSize: (v) => `${v}`,
  letterSpacing: (v) => (+v === 0 ? 'normal' : `+${Math.round(v * 100)}%`),
  wordSpacing: (v) => (+v === 0 ? 'normal' : `+${Math.round(v * 100)}%`),
  lineHeight: (v) => `${(+v).toFixed(1)}×`,
  speechRate: (v) => (+v < 0.75 ? 'very slow' : +v < 0.95 ? 'slow' : +v < 1.15 ? 'normal' : 'fast'),
};

function renderSettings() {
  const s = state.settings;
  const c = state.storageCfg;
  const voices = getVoices();
  return `
    <header class="topbar"><button class="btn" data-action="go-home">Done</button><h1>Settings</h1><span></span></header>
    <main class="narrow settings">
      <section>
        <h2>How it looks</h2>
        <div class="preview-box"><p class="step-text sample">Put the turkey in the oven for 5 to 7 hours.</p></div>
        <label class="field"><span>Colors</span>
          <select data-setting="theme">${Object.entries(THEMES).map(([k, l]) => option(k, l, s.theme)).join('')}</select></label>
        <label class="field"><span>Font</span>
          <select data-setting="font">${Object.entries(FONTS).map(([k, f]) => option(k, f.label, s.font)).join('')}</select></label>
        ${range('textSize', 'Step text size', 24, 96, 2, fmt.textSize)}
        ${range('letterSpacing', 'Space between letters', 0, 0.3, 0.02, fmt.letterSpacing)}
        ${range('wordSpacing', 'Space between words', 0, 0.6, 0.05, fmt.wordSpacing)}
        ${range('lineHeight', 'Space between lines', 1.3, 2.4, 0.1, fmt.lineHeight)}
        <button class="btn small" data-action="reset-look">Put these back to normal</button>
      </section>

      <section>
        <h2>Reading aloud</h2>
        ${canSpeak ? `
          ${check('autoRead', 'Read each step aloud when it appears')}
          ${check('highlightWords', 'Highlight each word as it is read', 'Works on most devices, but not all.')}
          ${range('speechRate', 'Speed', 0.5, 1.3, 0.05, fmt.speechRate)}
          <label class="field"><span>Voice</span>
            <select data-setting="voiceURI">${option('', 'Device default', s.voiceURI)}${voices.map((v) => option(v.voiceURI, v.name, s.voiceURI)).join('')}</select></label>
          <button class="btn" data-action="test-voice">🔊 Try the voice</button>
          <p class="hint">Turn the device volume up. The words always stay on the screen too.</p>
        ` : '<p class="hint">This browser cannot read aloud.</p>'}
        ${canListen
          ? check('voiceCommands', 'Listen for “next”, “back” and “repeat” while cooking', 'Uses the microphone. Works best in a quiet kitchen.')
          : '<p class="hint">Voice commands are not available in this browser. The buttons always work.</p>'}
      </section>

      <section>
        <h2>Timers</h2>
        ${check('checkAlert', 'For times like “5 to 7 hours”, remind me to check at the shorter time', 'The timer itself always runs to the longer time.')}
        ${check('flashAlerts', 'Flash the screen when a timer goes off', 'Flashes slowly, once a second.')}
      </section>

      <section>
        <h2>This device</h2>
        <label class="field"><span>Cook's name (shown as “Hi, …”)</span>
          <input type="text" data-setting="cookName" value="${esc(s.cookName)}" autocomplete="off"></label>
        ${check('showEditing', 'Show buttons for adding and changing recipes', 'Turn this off for a simpler screen on the cook’s device.')}
        ${check('keepAwake', 'Keep the screen on while cooking')}
      </section>

      <section>
        <h2>Where recipes are kept</h2>
        <label class="check"><input type="radio" name="mode" value="local" ${c.mode === 'local' ? 'checked' : ''}>
          <span>On this device only<span class="hint">Free and private. Use Back up / Load below to move recipes to another device.</span></span></label>
        <label class="check"><input type="radio" name="mode" value="github" ${c.mode === 'github' ? 'checked' : ''}>
          <span>Shared through GitHub<span class="hint">Free. Family members can add recipes from their own phones, and they appear on every connected device.</span></span></label>
        <div id="github-fields" ${c.mode === 'github' ? '' : 'hidden'}>
          <label class="field"><span>GitHub account name</span><input id="g-owner" type="text" value="${esc(c.owner)}" autocomplete="off" autocapitalize="none"></label>
          <label class="field"><span>Repository name</span><input id="g-repo" type="text" value="${esc(c.repo)}" autocomplete="off" autocapitalize="none"></label>
          <label class="field"><span>Branch</span><input id="g-branch" type="text" value="${esc(c.branch)}" autocomplete="off" autocapitalize="none"></label>
          <label class="field"><span>File name</span><input id="g-path" type="text" value="${esc(c.path)}" autocomplete="off" autocapitalize="none"></label>
          <label class="field"><span>Access key (only on devices that add recipes)</span>
            <input id="g-token" type="password" value="${esc(c.token)}" autocomplete="off" placeholder="github_pat_…"></label>
          <p class="hint">Make a fine-grained personal access token on GitHub that can only reach this one repository, with “Contents: Read and write”. It is kept on this device only. Devices without a key can read a public repository but can't add recipes.</p>
        </div>
        <button class="btn" data-action="save-storage">Save and connect</button>
      </section>

      ${c.mode === 'github' && c.owner && c.repo ? `
      <section>
        <h2>Set up another device</h2>
        <p class="hint">Makes a link that connects another device to these recipes. Open it on that device. The access key is never included.</p>
        <label class="field"><span>Cook's name on that device</span><input id="link-name" type="text" autocomplete="off"></label>
        <label class="check"><input id="link-simple" type="checkbox" checked><span>Hide the editing buttons on that device</span></label>
        <button class="btn" data-action="make-link">Make setup link</button>
        <div id="link-out"></div>
      </section>` : ''}

      <section>
        <h2>Back up</h2>
        <div class="action-row">
          <button class="btn" data-action="export">Back up recipes to a file</button>
          <label class="btn file-btn">Load recipes from a file<input type="file" id="import-file" accept="application/json,.json"></label>
        </div>
      </section>
    </main>`;
}

function renderJoin() {
  const j = state.view.join;
  return `
    <header class="topbar"><span></span><h1>Connect this device</h1><span></span></header>
    <main class="narrow">
      <p class="step-text">Use the recipes from <strong>${esc(j.owner)}/${esc(j.repo)}</strong> on this device?</p>
      ${j.name ? `<p>This device will say “Hi, ${esc(j.name)}”.</p>` : ''}
      <div class="action-row">
        <button class="btn big primary" data-action="join-yes">Yes, connect</button>
        <button class="btn big" data-action="join-no">No thanks</button>
      </div>
    </main>`;
}

const afterRender = {
  edit() {
    document.getElementById('f-title')?.focus({ preventScroll: true });
  },
  quickTimer() {
    const input = document.getElementById('quick-text');
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  },
};

// ---------- Timer alerts ----------

onTimersChange(() => {
  const strip = document.getElementById('timers');
  if (!strip) return;
  const timers = getTimers();
  if (strip.children.length !== timers.length) {
    strip.outerHTML = timersStrip();
    return;
  }
  for (const t of timers) {
    const left = remaining(t);
    document.querySelectorAll(`[data-timer-time="${t.id}"]`).forEach((el) => {
      el.textContent = left ? formatDuration(left, { short: true }) : 'Done!';
    });
    document.querySelector(`[data-timer="${t.id}"]`)?.classList.toggle('done', left === 0);
  }
});

onTimerAlert((a) => {
  state.alerts.push(a);
  if (state.alerts.length === 1) showAlert();
});

function showAlert() {
  const a = state.alerts[0];
  if (!a) {
    alertBox.hidden = true;
    alertBox.className = '';
    document.body.classList.remove('alerting');
    stopChime();
    return;
  }
  const t = a.timer;
  const done = a.kind === 'done';
  const left = formatDuration(Math.round((t.endAt - Date.now()) / 1000));
  const title = done ? `${t.label}: time’s up!` : `Time to check: ${t.label}`;
  const detail = done ? 'The timer is finished.' : `It might be ready now. The timer keeps going, with up to ${left} left.`;
  alertBox.innerHTML = `<div class="alert-inner" role="alertdialog" aria-modal="true" aria-labelledby="alert-title" aria-describedby="alert-detail">
    <p class="alert-icon" aria-hidden="true">${done ? '⏰' : '👀'}</p>
    <h2 id="alert-title">${esc(title)}</h2>
    <p id="alert-detail">${esc(detail)}</p>
    <button class="btn big primary" data-action="dismiss-alert">OK, got it</button>
  </div>`;
  alertBox.hidden = false;
  alertBox.className = state.settings.flashAlerts ? 'flash' : '';
  document.body.classList.add('alerting');
  alertBox.querySelector('button').focus();
  startChime();
  if (canSpeak) setTimeout(() => speak(`${title}. ${detail}`, { rate: state.settings.speechRate, voiceURI: state.settings.voiceURI }), 1800);
}

// ---------- Actions ----------

const actions = {
  'go-home': () => go({ name: 'home' }),
  'go-settings': () => go({ name: 'settings' }),
  refresh: () => { render(); loadRecipes(); },
  'remove-timer': (el) => removeTimer(el.dataset.id),

  'open-recipe': (el) => {
    const recipe = findRecipe(el.dataset.id);
    const saved = loadProgress()[recipe.id];
    const pages = cookPages(recipe);
    const page = saved && saved.page < pages.length - 1 ? saved.page : 0;
    state.view = { name: 'cook', id: recipe.id, page };
    render();
    if (state.settings.autoRead) readCurrentPage();
  },
  'cook-next': () => cookGoto(state.view.page + 1),
  'cook-back': () => cookGoto(state.view.page - 1),
  'cook-read': () => readCurrentPage(),
  'cook-restart': () => cookGoto(0),
  'start-step-timer': (el) => {
    addTimer({ label: el.dataset.label, seconds: +el.dataset.seconds, checkSeconds: +el.dataset.check || null, withCheck: state.settings.checkAlert });
    render();
    toast(`Timer started: ${formatDuration(+el.dataset.seconds)}`);
  },

  'quick-timer': () => go({ name: 'quickTimer', text: '' }),
  'quick-preset': (el) => {
    const input = document.getElementById('quick-text');
    const label = (input.value.replace(/\d.*$/, '').replace(/[,\s]+$/, '') || 'Timer');
    state.view.text = `${label}, ${el.dataset.min} minutes`;
    render();
  },
  'quick-listen': (el) => {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new Rec();
    rec.lang = navigator.language || 'en-US';
    el.textContent = '🎤 Listening…';
    rec.onresult = (e) => {
      state.view.text = e.results[0][0].transcript;
      render();
    };
    rec.onend = () => { el.textContent = '🎤 Say it instead'; };
    rec.start();
  },
  'quick-start': () => {
    const parsed = parseQuickTimer(state.view.text || document.getElementById('quick-text').value);
    if (!parsed) return toast('Add how long, like “20 minutes”.');
    addTimer({ ...parsed, withCheck: state.settings.checkAlert });
    go({ name: 'home' });
    toast(`Timer started: ${formatDuration(parsed.seconds)}`);
  },

  'new-recipe': () => { state.draft = blankRecipe(); go({ name: 'edit' }); },
  'edit-recipe': (el) => { state.draft = structuredClone(findRecipe(el.dataset.id)); go({ name: 'edit' }); },
  'cancel-edit': () => { state.draft = null; go({ name: 'home' }); },
  'step-add': () => { readDraftFields(); state.draft.steps.push(''); render(); document.querySelector(`textarea[data-step="${state.draft.steps.length - 1}"]`)?.focus(); },
  'step-add-after': (el) => { readDraftFields(); const i = +el.dataset.i; state.draft.steps.splice(i + 1, 0, ''); render(); document.querySelector(`textarea[data-step="${i + 1}"]`)?.focus(); },
  'step-remove': (el) => { readDraftFields(); state.draft.steps.splice(+el.dataset.i, 1); if (!state.draft.steps.length) state.draft.steps.push(''); render(); },
  'step-up': (el) => { readDraftFields(); const i = +el.dataset.i; const s = state.draft.steps; [s[i - 1], s[i]] = [s[i], s[i - 1]]; render(); },
  'step-down': (el) => { readDraftFields(); const i = +el.dataset.i; const s = state.draft.steps; [s[i + 1], s[i]] = [s[i], s[i + 1]]; render(); },
  'split-steps': () => { readDraftFields(); state.draft.steps = splitLongSteps(state.draft.steps); render(); toast('Long steps were split.'); },
  'import-text': () => {
    readDraftFields();
    const text = document.getElementById('import-text').value;
    if (!text.trim()) return toast('Paste a recipe first.');
    const parsed = parseRecipeText(text);
    fillDraft({ ...parsed, steps: splitLongSteps(parsed.steps) });
    render();
    toast('Filled in. Please check each step.');
  },
  'import-url': async (el) => {
    readDraftFields();
    const url = document.getElementById('import-url').value.trim();
    if (!/^https?:\/\//i.test(url)) return toast('Paste a full web address starting with https://');
    el.disabled = true;
    el.textContent = 'Getting recipe…';
    try {
      const res = await fetch(`/api/recipe-import?url=${encodeURIComponent(url)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'That site could not be read.');
      fillDraft({ ...data, steps: splitLongSteps(data.steps || []), source: url });
      render();
      toast('Filled in. Please check each step.');
    } catch (err) {
      el.disabled = false;
      el.textContent = 'Get recipe from link';
      toast(`${err.message} You can paste the recipe text instead.`);
    }
  },
  'save-recipe': async (el) => {
    readDraftFields();
    const d = state.draft;
    d.title = d.title.trim();
    d.steps = d.steps.map((s) => s.trim()).filter(Boolean);
    if (!d.title) return toast('Give the recipe a name.');
    if (!d.steps.length) return toast('Add at least one step.');
    d.updatedAt = new Date().toISOString();
    el.disabled = true;
    try {
      await changeRecipes((list) => [...list.filter((r) => r.id !== d.id), d], `Save recipe: ${d.title}`);
      state.draft = null;
      go({ name: 'home' });
      toast(`Saved “${d.title}”.`);
    } catch (err) {
      el.disabled = false;
      toast(err.message);
    }
  },
  'delete-recipe': async () => {
    const d = state.draft;
    if (!confirm(`Delete “${d.title}”? This removes it from every connected device.`)) return;
    try {
      await changeRecipes((list) => list.filter((r) => r.id !== d.id), `Delete recipe: ${d.title}`);
      state.draft = null;
      go({ name: 'home' });
      toast('Recipe deleted.');
    } catch (err) {
      toast(err.message);
    }
  },
  'add-sample': async () => {
    try {
      await changeRecipes((list) => [...list, { ...structuredClone(SAMPLE_RECIPE), id: newId() }], 'Add example recipe');
      render();
    } catch (err) {
      toast(err.message);
    }
  },

  'reset-look': () => {
    for (const k of ['textSize', 'letterSpacing', 'wordSpacing', 'lineHeight']) state.settings[k] = DEFAULT_SETTINGS[k];
    saveSettings(state.settings);
    applySettings();
    render();
  },
  'test-voice': () => speak('Put the turkey in the oven. Then press Next when you are ready.', { rate: state.settings.speechRate, voiceURI: state.settings.voiceURI }),
  'save-storage': async (el) => {
    const mode = document.querySelector('input[name="mode"]:checked')?.value || 'local';
    const v = (id) => document.getElementById(id)?.value.trim() || '';
    const cfg = mode === 'github'
      ? { mode, owner: v('g-owner'), repo: v('g-repo'), branch: v('g-branch') || 'main', path: v('g-path') || 'recipes.json', token: v('g-token') }
      : { ...state.storageCfg, mode: 'local' };
    if (mode === 'github' && (!cfg.owner || !cfg.repo)) return toast('Fill in the account and repository names.');
    el.disabled = true;
    state.storageCfg = cfg;
    saveStorageConfig(cfg);
    state.store = makeStore(cfg);
    state.recipes = [];
    await loadRecipes({ quiet: true });
    el.disabled = false;
    toast(state.sync.status === 'ok' ? `Connected. ${state.recipes.length} recipe${state.recipes.length === 1 ? '' : 's'} found.` : state.sync.message);
    render();
  },
  'make-link': async () => {
    const extras = {};
    const name = document.getElementById('link-name').value.trim();
    if (name) extras.name = name;
    if (document.getElementById('link-simple').checked) extras.simple = true;
    const link = makeSetupLink(state.storageCfg, extras);
    document.getElementById('link-out').innerHTML = `<p class="link-box">${esc(link)}</p>
      <div class="action-row"><button class="btn" data-action="copy-link" data-link="${esc(link)}">Copy link</button>
      ${navigator.share ? `<button class="btn" data-action="share-link" data-link="${esc(link)}">Send link…</button>` : ''}</div>`;
  },
  'copy-link': async (el) => {
    try { await navigator.clipboard.writeText(el.dataset.link); toast('Link copied.'); } catch { toast('Could not copy. Press and hold the link to copy it.'); }
  },
  'share-link': (el) => navigator.share({ title: 'Step by Step Recipes', url: el.dataset.link }).catch(() => {}),
  export: () => exportRecipes(state.recipes),

  'join-yes': async () => {
    const j = state.view.join;
    const cfg = { ...DEFAULT_STORAGE, mode: 'github', owner: j.owner, repo: j.repo, branch: j.branch || 'main', path: j.path || 'recipes.json' };
    state.storageCfg = cfg;
    saveStorageConfig(cfg);
    state.store = makeStore(cfg);
    state.recipes = [];
    if (j.name) updateSetting('cookName', j.name);
    if (j.simple) updateSetting('showEditing', false);
    history.replaceState(null, '', location.pathname + location.search);
    go({ name: 'home' });
    loadRecipes();
  },
  'join-no': () => {
    history.replaceState(null, '', location.pathname + location.search);
    go({ name: 'home' });
  },

  'dismiss-alert': () => {
    const a = state.alerts.shift();
    stopChime();
    stopSpeaking();
    if (a?.kind === 'done') removeTimer(a.timer.id);
    showAlert();
  },
};

document.addEventListener('click', (e) => {
  unlockSound();
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) {
    e.preventDefault();
    fn(el);
  }
});

// Long-press a recipe (or right-click) to edit it, so the cook's main screen stays simple.
let pressTimer = null;
document.addEventListener('pointerdown', (e) => {
  const card = e.target.closest('.recipe-card');
  if (!card || !state.settings.showEditing || !state.store.canEdit) return;
  pressTimer = setTimeout(() => {
    pressTimer = null;
    card.dataset.suppress = '1';
    actions['edit-recipe'](card);
  }, 700);
});
['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => document.addEventListener(t, () => clearTimeout(pressTimer)));
document.addEventListener('click', (e) => {
  const card = e.target.closest('.recipe-card');
  if (card?.dataset.suppress) { e.stopImmediatePropagation(); delete card.dataset.suppress; }
}, true);
document.addEventListener('contextmenu', (e) => {
  const card = e.target.closest('.recipe-card');
  if (card && state.settings.showEditing && state.store.canEdit) {
    e.preventDefault();
    actions['edit-recipe'](card);
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'search') {
    state.search = el.value;
    const pos = el.selectionStart;
    render();
    const again = document.getElementById('search');
    again.focus();
    again.setSelectionRange(pos, pos);
    return;
  }
  if (el.id === 'quick-text') {
    state.view.text = el.value;
    const parsed = parseQuickTimer(el.value);
    const holder = document.getElementById('quick-preview');
    holder.innerHTML = parsed
      ? `<p class="preview">${esc(parsed.label)}: <strong>${formatDuration(parsed.seconds)}</strong>${parsed.checkSeconds && state.settings.checkAlert ? `, with a reminder to check at ${formatDuration(parsed.checkSeconds)}` : ''}.</p>`
      : el.value ? `<p class="preview warn">Add how long, like “20 minutes” or “5 to 7 hours”.</p>` : '';
    return;
  }
  if (el.dataset.step !== undefined) {
    const i = +el.dataset.step;
    state.draft.steps[i] = el.value;
    const info = document.querySelector(`[data-step-info="${i}"]`);
    if (info) info.textContent = findDurations(el.value).map((x) => `⏱ Timer: ${formatDuration(x.seconds)}${x.checkSeconds ? `, check at ${formatDuration(x.checkSeconds)}` : ''}`).join(' · ');
    return;
  }
  const key = el.dataset.setting;
  if (!key) return;
  const value = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
  updateSetting(key, value);
  const out = document.querySelector(`[data-out="${key}"]`);
  if (out) out.textContent = fmt[key](value);
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.name === 'mode') document.getElementById('github-fields').hidden = el.value !== 'github';
  if (el.dataset.setting && el.tagName === 'SELECT') render();
  if (el.id === 'import-file' && el.files[0]) {
    try {
      const incoming = await readRecipeFile(el.files[0]);
      await changeRecipes((list) => {
        const ids = new Set(incoming.map((r) => r.id));
        return [...list.filter((r) => !ids.has(r.id)), ...incoming];
      }, 'Load recipes from a file');
      toast(`Loaded ${incoming.length} recipe${incoming.length === 1 ? '' : 's'}.`);
    } catch (err) {
      toast(err.message || 'That file could not be read.');
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target.id === 'quick-text' && e.key === 'Enter') actions['quick-start']();
  if (state.view.name !== 'cook' || e.target.matches('input, textarea, select')) return;
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); cookGoto(state.view.page + 1); }
  if (e.key === 'ArrowLeft') cookGoto(state.view.page - 1);
});

onVoicesChanged(() => state.view.name === 'settings' && render());

// Check for recipes others have added, every few minutes while the home screen is showing.
setInterval(() => {
  if (state.view.name === 'home' && document.visibilityState === 'visible') loadRecipes({ quiet: true });
}, 3 * 60 * 1000);

// ---------- Start ----------

applySettings();
const join = readSetupLink();
if (join?.owner && join?.repo) state.view = { name: 'join', join };
const cached = loadCachedRecipes(state.store.label);
if (cached) state.recipes = sortRecipes(cached.recipes);
render();
loadRecipes();
if (getTimers().length) document.dispatchEvent(new Event('visibilitychange'));
