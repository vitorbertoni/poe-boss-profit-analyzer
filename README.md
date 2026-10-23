# PoE Boss Profit Analyzer

Fan-made Path of Exile 1 profit tools, hosted on Vercel.

| Page | What it does |
| --- | --- |
| `/` Boss ROI | Expected value, ROI and Monte Carlo simulation for uber pinnacle bosses |
| `/invest` League Investments | How currency and fragment prices move through a league, from poe.ninja data dumps |
| `/clusters` Cluster Jewels | *In progress* — notable combos worth crafting, by market price vs expected craft cost |

## Layout

- `index.html`, `app.js` — Boss ROI page. `data/bosses.js` holds drop rates (poewiki estimates), `lib/calc.js` the EV and Monte Carlo engine.
- `invest.html`, `invest.js` — League Investments page. `lib/history.js` reads poe.ninja data dumps; served by `api/history.js`.
- `api/prices.js` + `lib/ninja.js` — live poe.ninja prices, cached at the Vercel edge for 1 hour. `data/snapshot.json` is the fallback.
- `styles.css`, `site.css` — shared styles. Plain HTML/JS, no build step.

## Deploy

Vercel project `poe-boss-profit-analyzer` (framework preset: Other, no build command).

Not affiliated with or endorsed by Grinding Gear Games.
