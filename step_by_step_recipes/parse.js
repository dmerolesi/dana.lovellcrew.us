// Text helpers: finding cooking times in a step, and turning pasted text into a recipe.

const WORD_NUMBERS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, sixty: 60,
};

const NUM = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|½|half(?:\s+an?)?|forty-five|${Object.keys(WORD_NUMBERS).join('|')})`;
const UNIT = String.raw`(hours?|hrs?|minutes?|mins?|seconds?|secs?)`;
const RANGE_SEP = String.raw`\s*(?:-|–|—|to|or)\s*`;
const DURATION_RE = new RegExp(
  String.raw`\b(${NUM})(?:${RANGE_SEP}(${NUM}))?\s*${UNIT}\b(\s+and\s+a\s+half)?`,
  'gi'
);

function toNumber(raw) {
  const s = raw.trim().toLowerCase();
  if (s === '½' || s.startsWith('half')) return 0.5;
  if (s in WORD_NUMBERS) return WORD_NUMBERS[s];
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return +mixed[1] + mixed[2] / mixed[3];
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return frac[1] / frac[2];
  return parseFloat(s);
}

function unitSeconds(unit) {
  const u = unit.toLowerCase();
  if (u.startsWith('h')) return 3600;
  if (u.startsWith('m')) return 60;
  return 1;
}

// Finds every cooking time in a piece of text.
// A range like "5-7 hours" uses the longer time for the timer and the shorter
// time for the "check it now" alert. "1 hour 30 minutes" is added together.
export function findDurations(text) {
  const found = [];
  let m;
  DURATION_RE.lastIndex = 0;
  while ((m = DURATION_RE.exec(text))) {
    const per = unitSeconds(m[3]);
    const half = m[4] ? 0.5 : 0;
    const first = (toNumber(m[1]) + (m[2] ? 0 : half)) * per;
    const second = m[2] ? (toNumber(m[2]) + half) * per : null;
    const item = {
      seconds: Math.round(Math.max(first, second ?? 0)),
      checkSeconds: second ? Math.round(Math.min(first, second)) : null,
      start: m.index,
      end: m.index + m[0].length,
      phrase: m[0],
    };
    const prev = found[found.length - 1];
    const gap = prev ? text.slice(prev.end, item.start) : null;
    const joinable = prev && !prev.checkSeconds && !item.checkSeconds;
    if (joinable && /^\s*(and\s*)?$/i.test(gap) && item.seconds < prev.seconds) {
      // "1 hour 30 minutes"
      prev.seconds += item.seconds;
      prev.end = item.end;
      prev.phrase = text.slice(prev.start, prev.end);
    } else if (joinable && new RegExp(`^${RANGE_SEP}$`, 'i').test(gap)) {
      // "45 minutes to 1 hour"
      prev.checkSeconds = Math.min(prev.seconds, item.seconds);
      prev.seconds = Math.max(prev.seconds, item.seconds);
      prev.end = item.end;
      prev.phrase = text.slice(prev.start, prev.end);
    } else if (item.seconds > 0) {
      found.push(item);
    }
  }
  return found;
}

export function formatDuration(seconds, { short = false } = {}) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (short) {
    if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  const parts = [];
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (s && !h) parts.push(`${s} second${s === 1 ? '' : 's'}`);
  return parts.join(' ') || '0 seconds';
}

// "Turkey, oven, 5-7 hours" -> { label: "Turkey, oven", seconds, checkSeconds }
export function parseQuickTimer(text) {
  const [d] = findDurations(text);
  if (!d) return null;
  const label = (text.slice(0, d.start) + text.slice(d.end))
    .replace(/\b(for|about|around)\b/gi, ' ')
    .replace(/[\s,]+$/g, '').replace(/^[\s,]+/g, '').replace(/\s*,\s*,\s*/g, ', ').replace(/\s{2,}/g, ' ');
  return { label: label || 'Timer', seconds: d.seconds, checkSeconds: d.checkSeconds };
}

const INGREDIENT_HEAD = /^\s*(ingredients?|you will need|what you need)\s*:?\s*$/i;
const STEP_HEAD = /^\s*(directions?|instructions?|method|steps?|preparation|how to make it)\s*:?\s*$/i;

export function cleanLine(line) {
  return line
    .replace(/^\s*(step\s*\d+\s*[:.)-]?|\d+\s*[.)]|[-*•▢□☐◦·]+)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Turns pasted recipe text into { title, ingredients, steps }.
// Looks for "Ingredients" and "Directions" headings; without them, every line is a step.
export function parseRecipeText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let title = '';
  const ingredients = [];
  const steps = [];
  let section = null;
  for (const line of lines) {
    if (!line) continue;
    if (INGREDIENT_HEAD.test(line)) { section = 'ingredients'; continue; }
    if (STEP_HEAD.test(line)) { section = 'steps'; continue; }
    if (!section && !title && !/^\s*(\d+[.)]|[-*•])/.test(line) && line.length < 80) { title = line; continue; }
    const cleaned = cleanLine(line);
    if (!cleaned) continue;
    (section === 'ingredients' ? ingredients : steps).push(cleaned);
  }
  return { title, ingredients, steps };
}

// Breaks long steps into one sentence each, so each screen holds one small action.
export function splitLongSteps(steps, maxLength = 140) {
  return steps.flatMap((step) => {
    if (step.length <= maxLength) return [step];
    return step.split(/(?<=[.!?])\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
  });
}
