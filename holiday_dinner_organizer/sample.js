// An example holiday meal, already in planner format, so people can try the app
// without an AI. Times are filled in when it's loaded.

const step = (s) => ({
  batch: null, appliance: null, temp: null, after: [], make_ahead_hours: 0,
  whole_appliance: false, raw_meat: false, tools: [], alternatives: [], ...s,
});

export function sampleMeal() {
  const year = new Date().getFullYear();
  // Thanksgiving: the fourth Thursday of November.
  const nov1 = new Date(year, 10, 1);
  let day = 1 + ((4 - nov1.getDay() + 7) % 7) + 21;
  if (new Date(year, 10, day, 14) < new Date()) {
    const next = new Date(year + 1, 10, 1);
    day = 1 + ((4 - next.getDay() + 7) % 7) + 21;
    nov1.setFullYear(year + 1);
  }
  const date = `${nov1.getFullYear()}-11-${String(day).padStart(2, '0')}`;

  return {
    title: 'Thanksgiving',
    mealTime: `${date}T14:00`,
    recipes: [
      {
        id: 'sample-rolls', sourceType: 'text', text: '', eatAt: `${date}T10:00`,
        parsed: {
          title: 'Cinnamon Rolls (refrigerated can)', servings: 8,
          ingredients: [{ name: 'refrigerated cinnamon rolls with icing', quantity: 1, unit: 'can', note: '17.5 oz', category: 'dairy' }],
          tools: ['9-inch round cake pan', 'butter knife'],
          steps: [
            step({ id: '1', text: 'Grease the pan and place the rolls in it, cinnamon side up.', minutes: 3, hands_on_minutes: 3, tools: ['9-inch round cake pan'] }),
            step({
              id: '2', text: 'Bake until golden brown, 13 to 17 minutes.', appliance: 'oven', temp: 350, minutes: 15, hands_on_minutes: 1, after: ['1'],
              alternatives: [{ appliance: 'airfryer', temp: 320, minutes: 10, hands_on_minutes: 2, note: 'From the package air fryer directions: line the basket with parchment and cook in batches if they don\'t all fit.', suggested: false }],
            }),
            step({ id: '3', text: 'Spread the icing over the warm rolls.', minutes: 2, hands_on_minutes: 2, after: ['2'], tools: ['butter knife'] }),
          ],
          notes: [],
        },
      },
      {
        id: 'sample-turkey', sourceType: 'text', text: '', eatAt: '',
        parsed: {
          title: 'Roast Turkey', servings: 12,
          ingredients: [
            { name: 'whole turkey', quantity: 14, unit: 'lb', note: 'frozen is fine', category: 'meat' },
            { name: 'butter', quantity: 4, unit: 'tbsp', note: 'softened', category: 'dairy' },
            { name: 'kosher salt', quantity: 2, unit: 'tbsp', note: '', category: 'spices' },
            { name: 'black pepper', quantity: 1, unit: 'tsp', note: '', category: 'spices' },
            { name: 'yellow onion', quantity: 1, unit: '', note: '', category: 'produce' },
            { name: 'lemon', quantity: 1, unit: '', note: '', category: 'produce' },
            { name: 'fresh thyme', quantity: 1, unit: 'bunch', note: '', category: 'produce' },
          ],
          tools: ['roasting pan with rack', 'meat thermometer', 'kitchen twine', 'aluminum foil', 'paper towels'],
          steps: [
            step({ id: '1', text: 'Thaw the turkey in its wrapper on a tray in the fridge (about 1 day for every 4 to 5 lb).', appliance: 'fridge', minutes: 4320, hands_on_minutes: 5, make_ahead_hours: 24 }),
            step({ id: '2', text: 'Cut the onion and lemon into quarters for the cavity.', batch: 'chop vegetables', minutes: 3, hands_on_minutes: 3, make_ahead_hours: 24, tools: ["chef's knife", 'cutting board'] }),
            step({ id: '3', text: 'Pat the turkey dry, rub it with butter, salt and pepper, fill the cavity with onion, lemon and thyme, and tie the legs.', minutes: 15, hands_on_minutes: 15, after: ['1', '2'], raw_meat: true, tools: ['paper towels', 'kitchen twine', 'roasting pan with rack'] }),
            step({ id: '4', text: 'Roast until the thickest part of the thigh reads 165°F, about 3½ hours. Tent with foil if the skin browns too fast.', appliance: 'oven', temp: 325, minutes: 210, hands_on_minutes: 5, after: ['3'], whole_appliance: true, tools: ['meat thermometer'] }),
            step({ id: '5', text: 'Let the turkey rest under foil.', appliance: 'counter', minutes: 30, hands_on_minutes: 2, after: ['4'], tools: ['aluminum foil'] }),
            step({ id: '6', text: 'Carve the turkey and arrange it on a platter.', minutes: 15, hands_on_minutes: 15, after: ['5'], tools: ['carving knife', 'cutting board', 'platter'] }),
          ],
          notes: [],
        },
      },
      {
        id: 'sample-stuffing', sourceType: 'text', text: '', eatAt: '',
        parsed: {
          title: 'Herb Stuffing', servings: 10,
          ingredients: [
            { name: 'crusty bread', quantity: 1, unit: 'loaf', note: 'about 1 lb, a day old', category: 'bakery' },
            { name: 'butter', quantity: 6, unit: 'tbsp', note: '', category: 'dairy' },
            { name: 'yellow onion', quantity: 1, unit: '', note: 'large', category: 'produce' },
            { name: 'celery', quantity: 3, unit: 'stalk', note: '', category: 'produce' },
            { name: 'fresh sage', quantity: 1, unit: 'bunch', note: '', category: 'produce' },
            { name: 'fresh parsley', quantity: 1, unit: 'bunch', note: '', category: 'produce' },
            { name: 'chicken broth', quantity: 2, unit: 'cup', note: '', category: 'canned' },
            { name: 'eggs', quantity: 2, unit: '', note: '', category: 'dairy' },
          ],
          tools: ['bread knife', 'large skillet', 'large mixing bowl', '9x13 baking dish', 'measuring cups', 'aluminum foil', 'whisk'],
          steps: [
            step({ id: '1', text: 'Cut the bread into 1-inch cubes and spread them out to dry.', batch: 'cut bread', minutes: 10, hands_on_minutes: 10, make_ahead_hours: 24, tools: ['bread knife', 'cutting board'] }),
            step({ id: '2', text: 'Dice the onion and celery.', batch: 'chop vegetables', minutes: 8, hands_on_minutes: 8, make_ahead_hours: 24, tools: ["chef's knife", 'cutting board'] }),
            step({ id: '3', text: 'Chop the sage and parsley.', batch: 'chop herbs', minutes: 4, hands_on_minutes: 4, make_ahead_hours: 4, tools: ["chef's knife", 'cutting board'] }),
            step({ id: '4', text: 'Melt the butter in the skillet over medium heat and cook the onion and celery until soft, 8 to 10 minutes.', appliance: 'stovetop', minutes: 10, hands_on_minutes: 6, after: ['2'], tools: ['large skillet'] }),
            step({ id: '5', text: 'Whisk the eggs into the broth. Toss the bread, vegetables, herbs and broth in the bowl, then spread in the buttered baking dish.', minutes: 8, hands_on_minutes: 8, after: ['1', '3', '4'], make_ahead_hours: 12, tools: ['large mixing bowl', 'whisk', '9x13 baking dish', 'measuring cups'] }),
            step({
              id: '6', text: 'Bake covered with foil for 20 minutes, then uncovered for 15 minutes, until golden.', appliance: 'oven', temp: 350, minutes: 35, hands_on_minutes: 2, after: ['5'], tools: ['aluminum foil'],
              alternatives: [{ appliance: 'oven', temp: 325, minutes: 45, hands_on_minutes: 2, note: 'At 325°F it takes about 10 minutes longer, so it can share the oven with something else at 325°F.', suggested: true }],
            }),
          ],
          notes: [],
        },
      },
      {
        id: 'sample-potatoes', sourceType: 'text', text: '', eatAt: '',
        parsed: {
          title: 'Mashed Potatoes', servings: 10,
          ingredients: [
            { name: 'russet potatoes', quantity: 5, unit: 'lb', note: '', category: 'produce' },
            { name: 'whole milk', quantity: 1, unit: 'cup', note: '', category: 'dairy' },
            { name: 'butter', quantity: 8, unit: 'tbsp', note: '', category: 'dairy' },
            { name: 'kosher salt', quantity: 1, unit: 'tbsp', note: '', category: 'spices' },
          ],
          tools: ['vegetable peeler', 'large pot', 'colander', 'potato masher', 'small saucepan', 'measuring cups'],
          steps: [
            step({ id: '1', text: 'Peel the potatoes, cut them into 2-inch chunks and keep them in a bowl of cold water.', batch: 'peel', minutes: 15, hands_on_minutes: 15, make_ahead_hours: 4, tools: ['vegetable peeler', "chef's knife", 'cutting board'] }),
            step({
              id: '2', text: 'Cover the potatoes with cold salted water, bring to a boil and simmer until a fork slides in easily, about 20 minutes.', appliance: 'stovetop', minutes: 30, hands_on_minutes: 3, after: ['1'], tools: ['large pot'],
              alternatives: [{ appliance: 'instantpot', minutes: 25, hands_on_minutes: 3, note: 'Pressure cook on high for 8 minutes with 1 cup of water, then quick release. This frees up a burner.', suggested: true }],
            }),
            step({ id: '3', text: 'Warm the milk and butter, drain the potatoes, and mash everything together with the salt.', appliance: 'stovetop', minutes: 10, hands_on_minutes: 10, after: ['2'], tools: ['colander', 'potato masher', 'small saucepan'] }),
          ],
          notes: [],
        },
      },
      {
        id: 'sample-beans', sourceType: 'text', text: '', eatAt: '',
        parsed: {
          title: 'Garlic Green Beans', servings: 8,
          ingredients: [
            { name: 'green beans', quantity: 2, unit: 'lb', note: '', category: 'produce' },
            { name: 'garlic', quantity: 3, unit: 'clove', note: '', category: 'produce' },
            { name: 'butter', quantity: 2, unit: 'tbsp', note: '', category: 'dairy' },
            { name: 'lemon', quantity: 1, unit: '', note: 'for zest', category: 'produce' },
            { name: 'kosher salt', quantity: null, unit: '', note: 'to taste', category: 'spices' },
          ],
          tools: ['large pot', 'colander', 'large skillet', 'tongs', 'zester'],
          steps: [
            step({ id: '1', text: 'Trim the ends off the green beans.', batch: 'chop vegetables', minutes: 8, hands_on_minutes: 8, make_ahead_hours: 24, tools: ["chef's knife", 'cutting board'] }),
            step({ id: '2', text: 'Mince the garlic.', batch: 'chop vegetables', minutes: 2, hands_on_minutes: 2, make_ahead_hours: 24, tools: ["chef's knife", 'cutting board'] }),
            step({ id: '3', text: 'Boil the beans in salted water for 4 minutes, then drain.', appliance: 'stovetop', minutes: 12, hands_on_minutes: 3, after: ['1'], tools: ['large pot', 'colander'] }),
            step({ id: '4', text: 'Melt the butter in the skillet, add the garlic and beans, and toss for 3 to 4 minutes. Finish with lemon zest and salt.', appliance: 'stovetop', minutes: 5, hands_on_minutes: 5, after: ['2', '3'], tools: ['large skillet', 'tongs', 'zester'] }),
          ],
          notes: [],
        },
      },
    ],
  };
}
