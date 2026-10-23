// GET /api/prices[?league=Name]
// Fetches every price the calculator needs from poe.ninja and returns a compact payload.
// Cached at Vercel's edge for 1 hour (poe.ninja itself updates roughly hourly).

import { collectRefs } from '../data/bosses.js';
import { currentLeague, fetchPrices } from '../lib/ninja.js';

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const league = url.searchParams.get('league') || (await currentLeague());
    const payload = await fetchPrices(collectRefs(), league);
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json(payload);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String(e.message || e) });
  }
}
