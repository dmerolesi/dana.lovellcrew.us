# dana.lovellcrew.us

Dana's projects site: small apps, printables, and AI skills, built in the Solar Star Solutions style.

Live at **https://dana.lovellcrew.us**

## What's here

| Path | What it is |
|------|------------|
| `index.html` | Homepage |
| `projects/` | Projects page, with a card for each project |
| `projects/meal-matrix/` | Meal Matrix: 21 printable mix-and-match dinner sheets (PDF) |
| `skills/` | AI Skills page (the skills themselves live in [ai-skills](https://github.com/dmerolesi/ai-skills)) |
| `holiday_dinner_organizer/` | Holiday Dinner Organizer: plans prep and cooking for a big meal (step-by-step guide, appliance timeline, grocery and tool lists) |
| `step_by_step_recipes/` | Step by Step Recipes: shows and reads a recipe aloud one step at a time, with big text and timers. Each visitor's recipes stay in their own browser unless they connect their own GitHub file |
| `custom_qr/` | Custom QR: makes a QR code in a website's own colors and logo, and checks that it scans |
| `functions/api/recipe-import.js` | Pages Function at `/api/recipe-import`: reads a recipe page's schema.org data for "Get recipe from link" |
| `functions/api/site-theme.js` | Pages Function at `/api/site-theme`: reads a site's public colors and logo for Custom QR (rate-limited) |
| `404.html` | Page-not-found page |
| `solar-star.css`, `theme.js` | Shared Solar Star theme: colors, fonts, day/night mode |
| `style.css` | Page layout |
| `assets/` | Banners, logo and icons |
| `_headers` | Security headers (Content Security Policy and more) |

## How it's built and hosted

Plain HTML, CSS and JavaScript, with no frameworks and no build step. Hosted on
[Cloudflare Pages](https://pages.cloudflare.com/), which publishes the site automatically
whenever a change is pushed to `main`.

## Privacy

No accounts, ads or tracking. Apps save your data in your own browser. Holiday Dinner only
sends a recipe to an AI service if you add your own API key.

© 2026 Solar Star Solutions
