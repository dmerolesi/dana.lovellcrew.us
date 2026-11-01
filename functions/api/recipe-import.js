// Cloudflare Pages Function: GET /api/recipe-import?url=https://…
// Reads a recipe web page and returns its recipe as { title, servings, ingredients, steps }.
// Most recipe sites include a tidy copy of the recipe for search engines (schema.org "Recipe"
// data), so no AI is needed. Browsers can't read other sites directly, which is why this runs here.

const MAX_BYTES = 3 * 1024 * 1024;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

function isPublicHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  if (h.includes(':')) return false; // Raw IPv6 addresses
  return true;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', deg: '°', frac12: '½', frac14: '¼', frac34: '¾', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };

function cleanText(s) {
  return String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+\d*);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

const hasType = (node, type) => {
  const t = node?.['@type'];
  return Array.isArray(t) ? t.includes(type) : t === type;
};

function findRecipe(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findRecipe(item);
      if (hit) return hit;
    }
    return null;
  }
  if (hasType(node, 'Recipe')) return node;
  return findRecipe(node['@graph']) || findRecipe(node.mainEntity) || null;
}

function flattenSteps(instructions) {
  if (!instructions) return [];
  if (typeof instructions === 'string') {
    return instructions.split(/\r?\n|(?<=\.)\s{2,}/).map(cleanText).filter(Boolean);
  }
  if (Array.isArray(instructions)) return instructions.flatMap(flattenSteps);
  if (hasType(instructions, 'HowToSection')) return flattenSteps(instructions.itemListElement);
  if (instructions.text) return [cleanText(instructions.text)];
  if (instructions.name) return [cleanText(instructions.name)];
  return [];
}

function servingsFrom(recipeYield) {
  const y = Array.isArray(recipeYield) ? recipeYield[0] : recipeYield;
  return y ? cleanText(y) : '';
}

async function readLimited(res) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(Math.min(size, MAX_BYTES));
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(all);
}

export async function onRequestGet({ request }) {
  const target = new URL(request.url).searchParams.get('url');
  let url;
  try {
    url = new URL(target);
  } catch {
    return json({ error: 'That is not a full web address.' }, 400);
  }
  if (!['http:', 'https:'].includes(url.protocol) || !isPublicHost(url.hostname)) {
    return json({ error: 'That web address cannot be used.' }, 400);
  }

  let res;
  try {
    res = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StepByStepRecipes/1.0; +https://dana.lovellcrew.us/step_by_step_recipes/)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return json({ error: 'That site did not answer.' }, 502);
  }
  if (!res.ok) return json({ error: `That site said no (${res.status}).` }, 502);

  const html = await readLimited(res);
  const blocks = [...html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, raw] of blocks) {
    let data;
    try {
      data = JSON.parse(raw.trim());
    } catch {
      continue;
    }
    const recipe = findRecipe(data);
    if (!recipe) continue;
    const ingredients = (recipe.recipeIngredient || recipe.ingredients || []).map(cleanText).filter(Boolean);
    const steps = flattenSteps(recipe.recipeInstructions);
    if (!steps.length && !ingredients.length) continue;
    return json({ title: cleanText(recipe.name), servings: servingsFrom(recipe.recipeYield), ingredients, steps });
  }
  return json({ error: 'Could not find a recipe on that page.' }, 422);
}
