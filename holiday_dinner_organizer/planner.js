// The planning engine: turns recipes + the kitchen setup into a schedule,
// a step-by-step guide, an appliance timeline, a grocery list and a tool list.
// No page code lives here, so it can be reused by the exporters.

export const APPLIANCES = {
  oven:        { label: 'Oven',            unit: 'racks',   capacity: 2, preheat: 15, sharedTemp: true },
  stovetop:    { label: 'Stovetop',        unit: 'burners', capacity: 4, preheat: 0 },
  airfryer:    { label: 'Air fryer',       unit: 'baskets', capacity: 1, preheat: 3,  sharedTemp: true },
  toasteroven: { label: 'Toaster oven',    unit: 'racks',   capacity: 1, preheat: 5,  sharedTemp: true },
  instantpot:  { label: 'Instant Pot',     unit: 'pots',    capacity: 1, preheat: 0 },
  slowcooker:  { label: 'Slow cooker',     unit: 'pots',    capacity: 1, preheat: 0 },
  sousvide:    { label: 'Sous vide',       unit: 'bags',    capacity: 4, preheat: 20, sharedTemp: true },
  grill:       { label: 'Grill',           unit: 'zones',   capacity: 2, preheat: 15 },
  smoker:      { label: 'Smoker',          unit: 'racks',   capacity: 2, preheat: 30, sharedTemp: true },
  microwave:   { label: 'Microwave',       unit: 'dishes',  capacity: 1, preheat: 0 },
  ricecooker:  { label: 'Rice cooker',     unit: 'pots',    capacity: 1, preheat: 0 },
  griddle:     { label: 'Griddle',         unit: 'zones',   capacity: 2, preheat: 5 },
};

// Places that hold food without being a scheduled appliance.
export const PLACES = { fridge: 'Fridge', freezer: 'Freezer', counter: 'Counter' };

export const BATCHES = {
  'wash produce': 'Wash produce',
  'peel': 'Peel',
  'chop vegetables': 'Chop vegetables',
  'chop herbs': 'Chop herbs',
  'mince garlic': 'Mince garlic',
  'cut bread': 'Cut bread',
  'cut meat': 'Cut meat',
  'grate cheese': 'Grate and shred',
  'zest citrus': 'Zest and juice citrus',
  'measure dry': 'Measure dry ingredients',
  'measure wet': 'Measure wet ingredients',
};

export const CATEGORIES = ['produce', 'meat', 'seafood', 'dairy', 'bakery', 'frozen', 'canned', 'pantry', 'spices', 'beverages', 'other'];

const STEP = 5;               // scheduling grid, in minutes
const SEARCH_LIMIT = 14 * 24 * 60 / STEP;
const MS_PER_MIN = 60000;

export const toMin = (value) => Math.round(new Date(value).getTime() / MS_PER_MIN);
export const fromMin = (min) => new Date(min * MS_PER_MIN);

// ---------- cleaning AI output ----------

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : fallback);
const str = (v) => (v == null ? '' : String(v).trim());
const list = (v) => (Array.isArray(v) ? v : []);

function cleanAppliance(value) {
  const key = str(value).toLowerCase().replace(/[\s_-]/g, '');
  if (!key || key === 'null' || key === 'none') return null;
  const aliases = { pressurecooker: 'instantpot', instapot: 'instantpot', stove: 'stovetop', range: 'stovetop', burner: 'stovetop', refrigerator: 'fridge' };
  const found = aliases[key] || key;
  return APPLIANCES[found] || PLACES[found] ? found : null;
}

// Accepts whatever an AI returned and makes it safe for the planner.
export function normalizeRecipe(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('The answer is not a recipe object.');
  const steps = list(raw.steps).map((s, i) => {
    const appliance = cleanAppliance(s.appliance);
    const minutes = Math.max(1, Math.round(num(s.minutes, 5)));
    const handsDefault = APPLIANCES[appliance] || PLACES[appliance] ? Math.min(5, minutes) : minutes;
    return {
      id: str(s.id) || String(i + 1),
      text: str(s.text) || `Step ${i + 1}`,
      batch: BATCHES[str(s.batch).toLowerCase()] ? str(s.batch).toLowerCase() : null,
      appliance,
      temp: s.temp == null || s.temp === '' ? null : num(s.temp, null),
      minutes,
      hands_on_minutes: Math.min(minutes, Math.max(0, Math.round(num(s.hands_on_minutes, handsDefault)))),
      after: list(s.after).map(str).filter(Boolean),
      make_ahead_hours: Math.max(0, num(s.make_ahead_hours, 0)),
      whole_appliance: !!s.whole_appliance,
      raw_meat: !!s.raw_meat,
      tools: list(s.tools).map(str).filter(Boolean),
      alternatives: list(s.alternatives).map((a) => ({
        appliance: cleanAppliance(a.appliance),
        temp: a.temp == null || a.temp === '' ? null : num(a.temp, null),
        minutes: Math.max(1, Math.round(num(a.minutes, minutes))),
        hands_on_minutes: a.hands_on_minutes == null ? null : Math.max(0, Math.round(num(a.hands_on_minutes, 0))),
        note: str(a.note),
        suggested: !!a.suggested,
      })),
    };
  });
  const ids = new Set(steps.map((s) => s.id));
  steps.forEach((s) => { s.after = s.after.filter((a) => ids.has(a) && a !== s.id); });
  return {
    title: str(raw.title) || 'Untitled recipe',
    servings: raw.servings == null ? null : num(raw.servings, null),
    ingredients: list(raw.ingredients).map((g) => ({
      name: str(g.name),
      quantity: g.quantity == null || g.quantity === '' ? null : num(g.quantity, null),
      unit: str(g.unit),
      note: str(g.note),
      category: CATEGORIES.includes(str(g.category).toLowerCase()) ? str(g.category).toLowerCase() : 'other',
    })).filter((g) => g.name),
    tools: list(raw.tools).map(str).filter(Boolean),
    steps,
    notes: list(raw.notes).map(str).filter(Boolean),
  };
}

// ---------- scheduling ----------

function buildUnits(kitchen) {
  const units = [];
  for (const [type, cfg] of Object.entries(kitchen || {})) {
    const def = APPLIANCES[type];
    if (!def || !cfg || !(cfg.count > 0)) continue;
    for (let i = 0; i < cfg.count; i++) {
      units.push({
        id: `${type}-${i + 1}`, type, def,
        label: cfg.count > 1 ? `${def.label} ${i + 1}` : def.label,
        capacity: Math.max(1, Math.round(cfg.capacity || def.capacity)),
        intervals: [],
      });
    }
  }
  return units;
}

function startOfDay(min) {
  const d = fromMin(min);
  d.setHours(0, 0, 0, 0);
  return toMin(d);
}

function buildNodes(recipes, settings) {
  const nodes = new Map();
  for (const recipe of recipes) {
    const deadline = toMin(recipe.eatAt || settings.mealTime);
    if (!Number.isFinite(deadline)) continue;
    const dayBeforeCutoff = startOfDay(deadline) - 4 * 60; // 8 PM the night before
    const byId = new Map(recipe.parsed.steps.map((s) => [s.id, s]));
    for (const step of recipe.parsed.steps) {
      const aheadOk = settings.makeAheadDayBefore && step.make_ahead_hours >= 24;
      nodes.set(`${recipe.id}:${step.id}`, {
        id: `${recipe.id}:${step.id}`,
        recipe, step,
        members: [{ recipe, step }],
        after: step.after.map((a) => `${recipe.id}:${a}`),
        deadline,
        cap: aheadOk ? dayBeforeCutoff : null,
        batchKey: null,
        // Second stage of a bake (e.g. 425°F then 350°F): the food stays in, so no new preheat.
        continues: !!APPLIANCES[step.appliance]?.preheat && step.after.some((a) => byId.get(a)?.appliance === step.appliance),
      });
    }
  }
  return nodes;
}

// Prep steps that use the same kind of work (and have nothing before them)
// are merged into one node so they happen together.
function batchNodes(nodes) {
  const groups = new Map();
  for (const n of nodes.values()) {
    if (!n.step.batch || n.after.length) continue;
    const bucket = n.cap != null ? `ahead-${n.cap}` : `day-${startOfDay(n.deadline)}`;
    const key = `${n.step.batch}|${bucket}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  }
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const id = `batch:${key}`;
    const tools = [...new Set(members.flatMap((m) => m.step.tools))];
    const minutes = members.reduce((t, m) => t + m.step.minutes, 0);
    const sorted = [...members].sort((a, b) => Number(a.step.raw_meat) - Number(b.step.raw_meat));
    const batch = {
      id, batchKey: members[0].step.batch,
      recipe: null,
      step: {
        id, text: BATCHES[members[0].step.batch], appliance: null, temp: null, minutes,
        hands_on_minutes: members.reduce((t, m) => t + m.step.hands_on_minutes, 0),
        tools, raw_meat: members.some((m) => m.step.raw_meat), alternatives: [], whole_appliance: false,
      },
      members: sorted.map((m) => ({ recipe: m.recipe, step: m.step, id: m.id })),
      after: [],
      deadline: Math.min(...members.map((m) => m.deadline)),
      cap: members[0].cap,
      memberIds: new Set(members.map((m) => m.id)),
    };
    for (const m of members) nodes.delete(m.id);
    for (const n of nodes.values()) {
      if (n.after.some((a) => batch.memberIds.has(a))) {
        n.after = [...new Set(n.after.map((a) => (batch.memberIds.has(a) ? id : a)))];
      }
    }
    nodes.set(id, batch);
  }
}

function maxConcurrent(intervals, s, e, weight = () => 1) {
  const inside = intervals.filter((iv) => iv.s < e && iv.e > s);
  let max = 0;
  for (const p of [s, ...inside.map((iv) => iv.s).filter((x) => x > s && x < e)]) {
    const used = inside.reduce((t, iv) => t + (iv.s <= p && iv.e > p ? weight(iv) : 0), 0);
    max = Math.max(max, used);
  }
  return max;
}

export function buildPlan(state) {
  const settings = { ...state.settings, mealTime: state.mealTime };
  const recipes = state.recipes.filter((r) => r.parsed && r.parsed.steps.length);
  const units = buildUnits(state.kitchen);
  const cookIntervals = [];
  const cooks = Math.max(1, Math.round(settings.cooks || 1));
  const tol = Math.max(0, num(settings.tempTolerance, 25));
  const warnings = [];
  const missing = new Map();

  const nodes = buildNodes(recipes, settings);
  batchNodes(nodes);
  for (const n of nodes.values()) n.dependents = [];
  for (const n of nodes.values()) {
    n.after = n.after.filter((a) => nodes.has(a));
    for (const a of n.after) nodes.get(a).dependents.push(n.id);
  }

  const cookFree = (s, e) => e <= s || maxConcurrent(cookIntervals, s, e) + 1 <= cooks;

  const unitFree = (u, s, e, temp, space, pre) => {
    for (const iv of u.intervals) {
      if (iv.e <= s - pre || iv.s >= e) continue;
      if (u.def.sharedTemp && temp != null && iv.temp != null && Math.abs(iv.temp - temp) > tol) return false;
    }
    const food = u.intervals.filter((iv) => iv.kind === 'food');
    return maxConcurrent(food, s, e, (iv) => iv.space) + space <= u.capacity;
  };

  const optionsFor = (n) => {
    const s = n.step;
    const opts = [{ appliance: s.appliance, temp: s.temp, minutes: s.minutes, hands: s.hands_on_minutes, primary: true }];
    for (const a of s.alternatives || []) {
      if (a.suggested && !settings.aiSuggestions) continue;
      opts.push({
        appliance: a.appliance, temp: a.temp, minutes: a.minutes,
        hands: Math.min(a.minutes, a.hands_on_minutes ?? s.hands_on_minutes),
        note: a.note, suggested: a.suggested, primary: false,
      });
    }
    return opts;
  };

  const findSlot = (n, opt, latestEnd) => {
    const def = APPLIANCES[opt.appliance];
    const candidates = def ? units.filter((u) => u.type === opt.appliance) : [null];
    if (!candidates.length) return null;
    let start = Math.floor((latestEnd - opt.minutes) / STEP) * STEP;
    for (let i = 0; i < SEARCH_LIMIT; i++, start -= STEP) {
      const end = start + opt.minutes;
      if (!cookFree(start, start + opt.hands)) continue;
      for (const u of candidates) {
        const space = u && n.step.whole_appliance ? u.capacity : 1;
        if (!u || unitFree(u, start, end, opt.temp, space, n.continues ? 0 : u.def.preheat || 0)) return { start, end, unit: u, opt, space };
      }
    }
    return null;
  };

  const latestEndFor = (n) => {
    let le = n.cap ?? Infinity;
    if (n.dependents.length) le = Math.min(le, ...n.dependents.map((d) => nodes.get(d).start));
    else le = Math.min(le, n.deadline);
    return le;
  };

  const pending = new Set(nodes.keys());
  while (pending.size) {
    let pick = null;
    let pickEnd = -Infinity;
    for (const id of pending) {
      const n = nodes.get(id);
      if (n.dependents.some((d) => pending.has(d))) continue;
      const le = latestEndFor(n);
      if (le > pickEnd) { pick = n; pickEnd = le; }
    }
    if (!pick) { // a loop in the recipe's "after" links: break it
      pick = nodes.get(pending.values().next().value);
      pick.dependents = pick.dependents.filter((d) => !pending.has(d));
      pickEnd = latestEndFor(pick);
    }
    pending.delete(pick.id);

    const slots = optionsFor(pick).map((opt) => findSlot(pick, opt, pickEnd)).filter(Boolean);
    let slot = null;
    if (slots.length) {
      const bestEnd = Math.max(...slots.map((s) => s.end));
      slot = slots.find((s) => s.opt.primary && s.end >= bestEnd - 10) || slots.find((s) => s.end === bestEnd);
    } else {
      // The recipe needs an appliance the kitchen doesn't have: plan it anyway, on its own row.
      const opt = optionsFor(pick)[0];
      const type = opt.appliance;
      if (!missing.has(type)) {
        missing.set(type, { id: `missing-${type}`, type, def: APPLIANCES[type], label: `${APPLIANCES[type].label} (not in your kitchen)`, capacity: 99, intervals: [], missing: true });
        warnings.push(`A recipe needs a ${APPLIANCES[type].label.toLowerCase()}, which isn't in your kitchen list. Add it on the Kitchen tab, or ask your AI for another way to cook it.`);
      }
      const u = missing.get(type);
      let start = Math.floor((pickEnd - opt.minutes) / STEP) * STEP;
      for (let i = 0; i < SEARCH_LIMIT && !cookFree(start, start + opt.hands); i++) start -= STEP;
      slot = { start, end: start + opt.minutes, unit: u, opt, space: 1 };
    }

    Object.assign(pick, { start: slot.start, end: slot.end, unit: slot.unit, opt: slot.opt, hands: slot.opt.hands, latestEnd: pickEnd });
    if (slot.unit) {
      const pre = pick.continues ? 0 : slot.unit.def.preheat || 0;
      slot.unit.intervals.push({ s: slot.start, e: slot.end, temp: slot.opt.temp, kind: 'food', space: slot.space, node: pick });
      if (pre) slot.unit.intervals.push({ s: slot.start - pre, e: slot.start, temp: slot.opt.temp, kind: 'preheat', node: pick });
    }
    if (slot.opt.hands > 0) cookIntervals.push({ s: slot.start, e: slot.start + slot.opt.hands, node: pick });
  }

  const placed = [...nodes.values()].filter((n) => Number.isFinite(n.start));

  for (const n of placed) {
    if (n.dependents.length || n.recipe == null) continue;
    const early = n.latestEnd - n.end;
    const allowed = Math.max(20, n.step.make_ahead_hours * 60);
    if (Number.isFinite(early) && early > allowed) {
      warnings.push(`${n.recipe.parsed.title} will be ready about ${formatDuration(early)} before it's needed, because the kitchen is busy. Plan to keep it warm.`);
    }
  }

  const allUnits = [...units, ...missing.values()];
  const events = buildEvents(placed, tol);
  const sections = buildSections(events);
  return {
    nodes: placed, units: allUnits, cookIntervals, cooks, events, sections, warnings,
    timeline: buildTimeline(placed, allUnits, cookIntervals, cooks),
    grocery: buildGrocery(recipes, state.have || {}),
    tools: buildTools(recipes),
    recipes,
    settings,
  };
}

// ---------- the step-by-step guide ----------

const recipeTitle = (r) => r.parsed.title || r.title || 'Recipe';
const tempText = (t, unit) => (t == null ? '' : `${t}°${unit || 'F'}`);

function applianceLine(n, unitLabel) {
  const bits = [];
  if (n.unit) bits.push(n.unit.label);
  else if (PLACES[n.opt.appliance]) bits.push(PLACES[n.opt.appliance]);
  if (n.opt.temp != null) bits.push(tempText(n.opt.temp, unitLabel));
  if (n.end - n.start >= 1) bits.push(formatDuration(n.end - n.start));
  return bits.join(' · ');
}

function buildEvents(placed, tol) {
  const events = [];
  const placedById = new Map(placed.map((n) => [n.id, n]));
  for (const n of placed) {
    const key = n.batchKey ? n.id : `recipe:${n.recipe.id}`;
    const pre = n.continues ? 0 : n.unit?.def?.preheat || 0;
    if (n.unit && (pre || n.continues)) {
      const warm = n.unit.intervals.find((iv) => iv.kind === 'food' && iv.node !== n && iv.s < n.start && iv.e >= n.start - pre
        && (n.continues || iv.temp == null || n.opt.temp == null || Math.abs(iv.temp - n.opt.temp) <= tol));
      if (!warm) events.push({ t: n.start - pre, kind: 'preheat', key, node: n });
      else if (warm.temp != null && n.opt.temp != null && warm.temp !== n.opt.temp) {
        if (warm.e > n.start) events.push({ t: n.start, kind: 'share', key, node: n, from: warm.temp });
        else events.push({ t: Math.max(warm.e, n.start - 5), kind: 'adjust', key, node: n, from: warm.temp });
      }
    }
    events.push({ t: n.start, kind: 'do', key, node: n });
    const passive = n.end - n.start - n.hands;
    const longWait = !n.unit && passive > 6 * 60; // e.g. thawing: the next step is the reminder
    const carriesOn = n.unit && n.dependents?.some((d) => placedById.get(d)?.continues && placedById.get(d).unit === n.unit && placedById.get(d).start === n.end);
    if (passive >= 5 && !longWait && !carriesOn && (n.unit || PLACES[n.opt.appliance])) events.push({ t: n.end, kind: 'done', key, node: n });
  }
  const order = { done: 0, preheat: 1, adjust: 2, share: 3, do: 4 };
  events.sort((a, b) => a.t - b.t || order[a.kind] - order[b.kind]);
  return events;
}

function buildSections(events) {
  const sections = [];
  let current = null;
  for (const ev of events) {
    if (!current || current.key !== ev.key) {
      const n = ev.node;
      const recipes = n.batchKey ? [...new Set(n.members.map((m) => recipeTitle(m.recipe)))] : [recipeTitle(n.recipe)];
      current = {
        key: ev.key, start: ev.t, items: [], tools: new Set(), rawMeat: false,
        batch: !!n.batchKey,
        title: n.batchKey ? n.step.text : recipeTitle(n.recipe),
        recipes,
        recipeIds: n.batchKey ? [...new Set(n.members.map((m) => m.recipe.id))] : [n.recipe.id],
      };
      sections.push(current);
    }
    current.items.push(ev);
    if (ev.kind === 'do') {
      ev.node.step.tools.forEach((t) => current.tools.add(t));
      if (ev.node.step.raw_meat) current.rawMeat = true;
    }
    current.end = ev.t;
  }
  return sections.map((s) => ({ ...s, tools: [...s.tools], day: startOfDay(s.start) }));
}

// Plain-text lines for one guide event; used by the page and every export.
export function describeEvent(ev, unitLabel) {
  const n = ev.node;
  const u = n.unit;
  switch (ev.kind) {
    case 'preheat':
      return { text: `Preheat the ${u.label.toLowerCase()}${n.opt.temp != null ? ` to ${tempText(n.opt.temp, unitLabel)}` : ''}.`, sub: [] };
    case 'adjust':
      return { text: `Change the ${u.label.toLowerCase()} from ${tempText(ev.from, unitLabel)} to ${tempText(n.opt.temp, unitLabel)}.`, sub: [] };
    case 'share':
      return { text: `Leave the ${u.label.toLowerCase()} at ${tempText(ev.from, unitLabel)}: close enough to ${tempText(n.opt.temp, unitLabel)} to share. Start checking for doneness a few minutes ${ev.from > n.opt.temp ? 'early' : 'late'}.`, sub: [] };
    case 'done': {
      const what = n.batchKey ? n.step.text : recipeTitle(n.recipe);
      if (!u) return { text: `${what}: “${n.step.text.replace(/\.$/, '')}” is done.`, sub: [], timer: true };
      const on = ['stovetop', 'grill', 'griddle'].includes(u.type) ? 'on' : 'in';
      return { text: `Time's up: check the ${what.toLowerCase()} ${on} the ${u.label.toLowerCase()}.`, sub: [], timer: true };
    }
    default: {
      const sub = [];
      if (n.batchKey) {
        return {
          text: `${n.step.text} for ${[...new Set(n.members.map((m) => recipeTitle(m.recipe)))].join(', ')}:`,
          sub: n.members.map((m) => `${m.step.text} (${recipeTitle(m.recipe)})`),
          meta: formatDuration(n.end - n.start),
        };
      }
      if (!n.opt.primary) {
        const from = APPLIANCES[n.step.appliance]?.label || PLACES[n.step.appliance] || 'the original method';
        const to = n.unit?.label || PLACES[n.opt.appliance] || 'another method';
        const how = [tempText(n.opt.temp, unitLabel), formatDuration(n.opt.minutes)].filter(Boolean).join(' for ');
        sub.push(`${n.opt.suggested ? 'AI suggestion' : 'Swap'}: use the ${to.toLowerCase()} instead of the ${from.toLowerCase()}${how ? ` (${how})` : ''}, because the ${from.toLowerCase()} is busy.${n.opt.note ? ' ' + n.opt.note : ''}`);
      }
      return { text: n.step.text, sub, meta: applianceLine(n, unitLabel), swapped: !n.opt.primary, suggested: !!n.opt.suggested };
    }
  }
}

// ---------- timeline ----------

function laneUp(bars) {
  const laneEnds = [];
  for (const b of bars.sort((a, c) => a.s - c.s)) {
    let lane = laneEnds.findIndex((end) => end <= b.s);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = b.e;
    b.lane = lane;
  }
  return Math.max(1, laneEnds.length);
}

function buildTimeline(placed, units, cookIntervals, cooks) {
  const label = (n) => (n.batchKey ? n.step.text : recipeTitle(n.recipe));
  const recipeId = (n) => (n.batchKey ? null : n.recipe.id);
  const rows = [];
  const cookBars = cookIntervals.map((iv) => ({ s: iv.s, e: iv.e, label: label(iv.node), detail: iv.node.batchKey ? '' : iv.node.step.text, recipeId: recipeId(iv.node), kind: 'hands' }));
  rows.push({ id: 'cook', label: cooks > 1 ? `You (${cooks} cooks)` : 'You (hands-on)', bars: cookBars });
  for (const u of units) {
    rows.push({
      id: u.id, label: u.label, missing: !!u.missing,
      bars: u.intervals.filter((iv) => iv.kind === 'food' || iv.kind === 'preheat').map((iv) => ({
        s: iv.s, e: iv.e, kind: iv.kind, recipeId: recipeId(iv.node), temp: iv.temp,
        label: iv.kind === 'preheat' ? 'Preheat' : label(iv.node),
        detail: [iv.temp != null ? `${iv.temp}°` : '', iv.node.step.text].filter(Boolean).join(' · '),
      })),
    });
  }
  const passive = placed.filter((n) => !n.unit && PLACES[n.opt.appliance] && n.end - n.start - n.hands >= 5);
  if (passive.length) {
    rows.push({ id: 'places', label: 'Counter & fridge', bars: passive.map((n) => ({ s: n.start, e: n.end, kind: 'food', recipeId: recipeId(n), label: label(n), detail: `${PLACES[n.opt.appliance]} · ${n.step.text}` })) });
  }
  // Hide the preheat-only rows' empty appliances.
  const shown = rows.filter((r) => r.id === 'cook' || r.bars.length);
  shown.forEach((r) => { r.lanes = laneUp(r.bars.filter((b) => b.kind !== 'preheat')); r.bars.filter((b) => b.kind === 'preheat').forEach((b) => { b.lane = 0; }); });
  return shown;
}

// ---------- grocery list and tools ----------

const UNIT_ALIASES = {
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp', tbl: 'tbsp', T: 'tbsp',
  teaspoon: 'tsp', teaspoons: 'tsp', tsps: 'tsp', t: 'tsp',
  cups: 'cup', c: 'cup', pound: 'lb', pounds: 'lb', lbs: 'lb', ounce: 'oz', ounces: 'oz',
  gram: 'g', grams: 'g', kilogram: 'kg', kilograms: 'kg', milliliter: 'ml', milliliters: 'ml', mL: 'ml',
  liter: 'l', liters: 'l', L: 'l', cloves: 'clove', cans: 'can', stalks: 'stalk', bunches: 'bunch',
  sticks: 'stick', pinches: 'pinch', packages: 'package', pkg: 'package', slices: 'slice', heads: 'head',
};
const normUnit = (u) => { const t = str(u).replace(/\.$/, ''); return UNIT_ALIASES[t] || UNIT_ALIASES[t.toLowerCase()] || t.toLowerCase(); };

const COUNTABLE = { clove: 'cloves', stalk: 'stalks', can: 'cans', bunch: 'bunches', cup: 'cups', stick: 'sticks', slice: 'slices', head: 'heads', package: 'packages', loaf: 'loaves', pinch: 'pinches', jar: 'jars', bag: 'bags', box: 'boxes' };
const plural = (u, q) => (q > 1 && COUNTABLE[u] ? COUNTABLE[u] : u);

export function groceryKey(name) {
  return str(name).toLowerCase().replace(/\s+/g, ' ');
}

// The shape below ({ key, name, category, amounts, recipes, have }) is what a
// pantry tracker or grocery-cart connector will read and write later.
export function buildGrocery(recipes, have) {
  const map = new Map();
  for (const r of recipes) {
    for (const g of r.parsed.ingredients) {
      const key = groceryKey(g.name);
      if (!map.has(key)) map.set(key, { key, name: g.name, category: g.category, amounts: new Map(), loose: false, recipes: new Set(), notes: new Set() });
      const item = map.get(key);
      const unit = normUnit(g.unit);
      if (g.quantity == null) item.loose = true;
      else item.amounts.set(unit, (item.amounts.get(unit) || 0) + g.quantity);
      item.recipes.add(recipeTitle(r));
      if (g.note) item.notes.add(g.note);
    }
  }
  const items = [...map.values()].map((i) => ({
    key: i.key, name: i.name, category: i.category,
    amount: [...[...i.amounts].map(([u, q]) => `${formatQty(q)}${u ? ' ' + plural(u, q) : ''}`), ...(i.loose && i.amounts.size ? ['a little more'] : [])].join(' + '),
    recipes: [...i.recipes], notes: [...i.notes], have: !!have[i.key],
  }));
  items.sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.name.localeCompare(b.name));
  return items;
}

export function buildTools(recipes) {
  const map = new Map();
  const add = (name, recipe) => {
    const key = str(name).toLowerCase();
    if (!key) return;
    if (!map.has(key)) map.set(key, { name: str(name), recipes: new Set() });
    map.get(key).recipes.add(recipe);
  };
  for (const r of recipes) {
    r.parsed.tools.forEach((t) => add(t, recipeTitle(r)));
    r.parsed.steps.forEach((s) => s.tools.forEach((t) => add(t, recipeTitle(r))));
  }
  return [...map.values()].map((t) => ({ name: t.name, recipes: [...t.recipes] })).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- formatting ----------

const FRACTIONS = [[0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾']];
export function formatQty(q) {
  const whole = Math.floor(q + 1e-9);
  const rest = q - whole;
  if (rest < 0.04) return String(whole);
  const frac = FRACTIONS.find(([v]) => Math.abs(v - rest) < 0.04);
  if (frac) return `${whole || ''}${frac[1]}`;
  return String(Math.round(q * 100) / 100);
}

export function formatDuration(min) {
  min = Math.round(min);
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  return `${Math.round(min / 60 / 24 * 10) / 10} days`;
}

export function formatTime(min) {
  return fromMin(min).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatDay(min) {
  return fromMin(min).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}
