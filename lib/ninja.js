// poe.ninja PoE1 economy client. Pure ESM, no dependencies.
// Works in Node (Vercel function) and in the browser (used to capture the fallback snapshot).

export const NINJA = 'https://poe.ninja/poe1/api';
const CDN = 'https://web.poecdn.com';

export async function currentLeague(fetchFn = fetch, base = NINJA) {
  const idx = await getJson(fetchFn, `${base}/data/index-state`);
  const leagues = idx.economyLeagues || [];
  // First softcore challenge league: not Standard, not Hardcore.
  const pick = leagues.find((l) => !/hardcore|standard|ssf/i.test(l.name)) || leagues[0];
  if (!pick) throw new Error('No league found in poe.ninja index-state');
  return pick.name;
}

export async function fetchPrices(refs, league, fetchFn = fetch, base = NINJA) {
  // Group refs by endpoint + type so each category is requested once.
  const wanted = new Map(); // "x:Currency" -> Set(ids)
  for (const ref of refs) {
    const [kind, type, id] = ref.split(':');
    const key = `${kind}:${type}`;
    if (!wanted.has(key)) wanted.set(key, new Set());
    wanted.get(key).add(id);
  }
  if (!wanted.has('x:Currency')) wanted.set('x:Currency', new Set());

  const prices = {};
  let chaosPerDivine = null;
  const errors = [];

  await Promise.all(
    [...wanted].map(async ([key, ids]) => {
      const [kind, type] = key.split(':');
      const path = kind === 'x' ? 'economy/exchange/current/overview' : 'economy/stash/current/item/overview';
      const url = `${base}/${path}?league=${encodeURIComponent(league)}&type=${type}`;
      try {
        const data = await getJson(fetchFn, url);
        if (kind === 'x') {
          const meta = new Map((data.items || []).map((it) => [it.id, it]));
          if (type === 'Currency' && data.core?.rates?.divine) chaosPerDivine = 1 / data.core.rates.divine;
          for (const line of data.lines || []) {
            if (!ids.has(line.id)) continue;
            const m = meta.get(line.id) || {};
            prices[`x:${type}:${line.id}`] = {
              c: round(line.primaryValue),
              n: Math.round(line.volumePrimaryValue || 0),
              icon: icon(m.image),
            };
          }
        } else {
          for (const line of data.lines || []) {
            if (!ids.has(line.detailsId)) continue;
            prices[`s:${type}:${line.detailsId}`] = {
              c: round(line.chaosValue),
              n: line.listingCount || 0,
              icon: icon(line.icon),
            };
          }
        }
      } catch (e) {
        errors.push(`${key}: ${e.message}`);
      }
    }),
  );

  if (!chaosPerDivine) throw new Error(`Could not read divine rate. ${errors.join('; ')}`);
  return { league, chaosPerDivine: round(chaosPerDivine), updatedAt: new Date().toISOString(), prices, errors };
}

async function getJson(fetchFn, url) {
  const res = await fetchFn(url, {
    headers: { 'User-Agent': 'poe-boss-profit-analyzer (fan-made ROI calculator)', Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function icon(src) {
  if (!src) return null;
  return src.startsWith('http') ? src : `${CDN}${src}`;
}

const round = (v) => Math.round((Number(v) || 0) * 100) / 100;
