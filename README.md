# dana.lovellcrew.us

Dana's corner of the Lovell crew site: projects, experiments, and the things I'm learning to build.

## What's here

| File | What it does |
|------|--------------|
| `index.html` | The homepage |
| `projects/index.html` | The Projects page |
| `skills/index.html` | The AI Skills page (the skills themselves live in [ai-skills](https://github.com/dmerolesi/ai-skills)) |
| `style.css` | Colors, fonts, and spacing (light and dark mode) |
| `holiday_dinner_organizer/` | Holiday Dinner Organizer: plans the prep and cooking for a big meal (step-by-step guide, appliance timeline, grocery and tool lists). Plain HTML and JavaScript, no build step. |
| `step_by_step_recipes/` | Step by Step Recipes: shows a recipe one step at a time in large text, reads it aloud, and waits for the cook. Includes accessible themes, dyslexia-friendly fonts, and timers. Shared family recipes are stored in GitHub. Plain HTML and JavaScript, no build step. |
| `functions/api/recipe-import.js` | Cloudflare Pages Function at `/api/recipe-import` that reads a recipe page's schema.org data for Step by Step Recipes' "Get recipe from link" button. |

## How it's built and hosted

Plain HTML and CSS, with no frameworks and no build step. The site is hosted on
[Cloudflare Pages](https://pages.cloudflare.com/), which publishes it automatically
whenever a change is saved to this repository.
