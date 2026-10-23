// GET /api/history
// Currency + fragment prices by day of league for the last 7 softcore challenge leagues,
// built from poe.ninja data dumps. Dumps only change when a league ends, so this is cached
// at Vercel's edge for a week (and served stale while it rebuilds).

import { buildHistory } from '../lib/history.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  try {
    const payload = await buildHistory();
    res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=2592000');
    res.status(200).json(payload);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String(e.message || e) });
  }
}
