// Turning a recipe into planner data with AI: either a prompt the user copies
// into any chatbot, or a direct call to Claude with the user's own API key.

import { APPLIANCES, PLACES, BATCHES, CATEGORIES, normalizeRecipe } from './planner.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.135.0/+esm';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (most accurate)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (cheaper)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (cheapest)' },
];

const EXAMPLE = {
  title: 'Herb Stuffing',
  servings: 8,
  ingredients: [
    { name: 'yellow onion', quantity: 1, unit: '', note: 'large', category: 'produce' },
    { name: 'butter', quantity: 6, unit: 'tbsp', note: '', category: 'dairy' },
  ],
  tools: ["chef's knife", 'cutting board', 'large skillet', '9x13 baking dish'],
  steps: [
    { id: '1', text: 'Dice the onion.', batch: 'chop vegetables', appliance: null, temp: null, minutes: 5, hands_on_minutes: 5, after: [], make_ahead_hours: 24, whole_appliance: false, raw_meat: false, tools: ["chef's knife", 'cutting board'], alternatives: [] },
    { id: '2', text: 'Melt the butter in the skillet over medium heat and cook the onion until soft, 8-10 minutes.', batch: null, appliance: 'stovetop', temp: null, minutes: 10, hands_on_minutes: 6, after: ['1'], make_ahead_hours: 0, whole_appliance: false, raw_meat: false, tools: ['large skillet'], alternatives: [] },
    { id: '3', text: 'Bake covered for 20 minutes, then uncovered for 15 minutes, until golden.', batch: null, appliance: 'oven', temp: 350, minutes: 35, hands_on_minutes: 2, after: ['2'], make_ahead_hours: 0, whole_appliance: false, raw_meat: false, tools: ['aluminum foil'], alternatives: [{ appliance: 'oven', temp: 325, minutes: 45, hands_on_minutes: 2, note: 'Bake at 325°F for about 45 minutes so it can share the oven with a 325°F roast.', suggested: true }] },
  ],
  notes: [],
};

function kitchenText(kitchen) {
  const have = Object.entries(kitchen)
    .filter(([type, cfg]) => APPLIANCES[type] && cfg.count > 0)
    .map(([type, cfg]) => `${type} (${APPLIANCES[type].label}: ${cfg.count} × ${cfg.capacity} ${APPLIANCES[type].unit})`);
  return have.length ? have.join(', ') : 'not listed';
}

function sourceText(recipe, viaApi) {
  if (recipe.sourceType === 'url') {
    return `The recipe is at this link. Open it and read the full recipe (ingredients and instructions):\n${recipe.url}`;
  }
  if (recipe.sourceType === 'file' && recipe.file && recipe.file.kind !== 'text') {
    return viaApi
      ? 'The recipe is in the attached file.'
      : `The recipe is in the file "${recipe.file.name}", which I have attached to this message. Read the full recipe from it.`;
  }
  return `Here is the recipe:\n<<<\n${recipe.text || recipe.file?.text || ''}\n>>>`;
}

export function buildPrompt(recipe, state, { viaApi = false } = {}) {
  const s = state.settings;
  const unit = s.tempUnit || 'F';
  const suggestions = s.aiSuggestions
    ? `- Also add alternatives with "suggested": true wherever a safe change would help this dish share appliances in a busy holiday kitchen, for example a lower oven temperature for a longer time, or cooking it in another appliance from the kitchen list (air fryer, toaster oven, Instant Pot, slow cooker, and so on). Explain each change in "note" in one plain sentence. Never suggest anything unsafe: keep safe internal temperatures (poultry 165°F / 74°C) and never leave perishable food in the danger zone for more than 2 hours.`
    : `- Only include alternatives that the recipe or package itself gives (for example "air fryer directions" on a package), with "suggested": false. Do not invent your own.`;

  return `You are helping someone plan a big home-cooked meal. Read the recipe below and turn it into JSON for a meal-planning app.

Reply with ONLY one JSON object: no commentary, no markdown code fences. Use exactly this shape (this example is only to show the format):
${JSON.stringify(EXAMPLE, null, 2)}

Rules:
- "title": the dish name. "servings": a number, or null if unknown.
- "ingredients": every ingredient once, with "quantity" as a number (use decimals such as 0.5, not fractions) or null for "to taste", a short "unit" (cup, tbsp, tsp, lb, oz, g, clove, can, or "" for whole items), and "category" from: ${CATEGORIES.join(', ')}.
- "tools": every tool and piece of cookware needed (knives, cutting board, measuring cups and spoons, mixing bowls, pans with sizes, thermometer, foil, and so on).
- "steps": split the recipe into small steps that each happen in one place. Write each "text" as a clear instruction someone can follow while cooking, including doneness checks (for example "until the thickest part of the thigh reads 165°F").
- "appliance": one of ${[...Object.keys(APPLIANCES), ...Object.keys(PLACES)].join(', ')}, or null for work done by hand at the counter.
- "temp": the cooking temperature in °${unit} for oven-style appliances, or null.
- "minutes": total time for the step, including waiting. "hands_on_minutes": how much of that the cook is actually busy (putting a pan in the oven is about 2).
- "after": ids of steps that must be finished first.
- "batch": for simple prep that could be done together with the same kind of prep from other recipes, one of: ${Object.keys(BATCHES).join(', ')}. Otherwise null. Prep steps with a batch should not need anything before them.
- "make_ahead_hours": how many hours ahead this step can be done and still be good (24 means it can be done the day before; 0 means do it right before the next step).
- "whole_appliance": true if the food fills the whole appliance (a large turkey fills the oven).
- "raw_meat": true if the step handles raw meat, poultry or fish.
- The cook's kitchen has: ${kitchenText(state.kitchen)}.
${suggestions}
- "notes": short warnings, for example if the servings or times had to be guessed.

${sourceText(recipe, viaApi)}`;
}

// Pull the JSON object out of whatever the chatbot replied.
export function parseAnswer(text) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error("Couldn't find the recipe data in that answer. Make sure you copied the AI's whole reply.");
  let data;
  try {
    data = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error("The answer was cut off or isn't valid JSON. Ask the AI to \"reply with only the complete JSON\" and paste it again.");
  }
  const recipe = normalizeRecipe(data);
  if (!recipe.steps.length) throw new Error('The answer has no steps. Try again, or paste the recipe as text.');
  return recipe;
}

export async function readWithClaude(recipe, state, apiKey) {
  const { default: Anthropic } = await import(SDK_URL);
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const model = state.settings.model || MODELS[0].id;

  const content = [];
  if (recipe.sourceType === 'file' && recipe.file?.kind === 'pdf') {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: recipe.file.data } });
  } else if (recipe.sourceType === 'file' && recipe.file?.kind === 'image') {
    content.push({ type: 'image', source: { type: 'base64', media_type: recipe.file.mediaType, data: recipe.file.data } });
  }
  content.push({ type: 'text', text: buildPrompt(recipe, state, { viaApi: true }) });

  const params = {
    model,
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    messages: [{ role: 'user', content }],
  };
  if (recipe.sourceType === 'url') {
    params.tools = [{ type: model === 'claude-haiku-5-5' ? 'web_fetch_20250910' : 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 }];
  }
  if (model !== 'claude-haiku-5-5') {
    // If a safety check declines the request, let the API retry on another model.
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }

  let message;
  try {
    for (let turn = 0; turn < 5; turn++) {
      message = await client.beta.messages.stream(params).finalMessage();
      if (message.stop_reason !== 'pause_turn') break;
      params.messages = [...params.messages, { role: 'assistant', content: message.content }];
    }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error("That API key didn't work. Check it on the Recipes tab.");
    if (err instanceof Anthropic.PermissionDeniedError) throw new Error("Your API key isn't allowed to use this model. Try another model.");
    if (err instanceof Anthropic.RateLimitError) throw new Error('Too many requests right now. Wait a minute and try again.');
    if (err instanceof Anthropic.BadRequestError) throw new Error(`Claude couldn't read this: ${err.message}`);
    if (err instanceof Anthropic.APIConnectionError) throw new Error("Couldn't reach Claude. Check your internet connection.");
    throw err;
  }
  if (message.stop_reason === 'refusal') throw new Error('Claude declined to read this recipe. Try pasting the recipe text instead.');
  if (message.stop_reason === 'max_tokens') throw new Error('The recipe was too long to finish. Try splitting it into two recipes.');
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return parseAnswer(text);
}
