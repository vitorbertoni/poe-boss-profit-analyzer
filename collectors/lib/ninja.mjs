// poe.ninja documented economy API (https://poe.ninja/docs/api). Server-side only, identified User-Agent.
export const NINJA = 'https://poe.ninja/poe1/api';
export const UA = 'poe-boss-profit-analyzer cluster collector (https://github.com/vitorbertoni/poe-boss-profit-analyzer)';

export async function getJson(url, fetchFn = fetch) {
  const res = await fetchFn(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/** First softcore challenge league (poe.ninja lists it first). */
export async function currentLeague(fetchFn) {
  const leagues = await getJson(`${NINJA}/economy/leagues`, fetchFn);
  const pick = leagues.find((l) => !/hardcore|standard|ssf|ruthless/i.test(l.name)) || leagues[0];
  if (!pick) throw new Error('no league in poe.ninja economy/leagues');
  return pick.id;
}

// Currency used by the craft engine. Matched by item name from the exchange overview.
export const CRAFT_CURRENCY = [
  'Chaos Orb',
  'Divine Orb',
  'Orb of Alteration',
  'Orb of Augmentation',
  'Orb of Transmutation',
  'Regal Orb',
  'Orb of Scouring',
  'Orb of Annulment',
  'Exalted Orb',
];

/** Parses the Currency exchange overview into rows for poe.currency_prices. */
export function parseCurrency(data, league) {
  const meta = new Map((data.items || []).map((it) => [it.id, it]));
  const rows = [];
  for (const line of data.lines || []) {
    const name = meta.get(line.id)?.name;
    if (!CRAFT_CURRENCY.includes(name)) continue;
    rows.push({ league, item_id: line.id, name, chaos_value: Number(line.primaryValue) || 0, volume: line.volumePrimaryValue ?? null });
  }
  // Chaos is the unit; the exchange may not list it as a line.
  if (!rows.some((r) => r.name === 'Chaos Orb')) rows.push({ league, item_id: 'chaos-orb', name: 'Chaos Orb', chaos_value: 1, volume: null });
  return rows;
}

const SIZE_RE = /^(Large|Medium|Small) Cluster Jewel$/;

/** Parses the ClusterJewel item overview (white bases) into rows for poe.base_prices. */
export function parseBases(data, league) {
  const rows = [];
  for (const line of data.lines || []) {
    const size = SIZE_RE.exec(line.baseType || '')?.[1];
    const passives = Number(/^(\d+) passives?$/.exec(line.variant || '')?.[1]);
    if (!size || !passives || !(line.chaosValue > 0)) continue;
    rows.push({
      league,
      size,
      enchant: line.name, // the enchant stat text, e.g. "12% increased Physical Damage"
      passives,
      ilvl_tier: Number(line.levelRequired) || 1, // poe.ninja buckets cluster bases by item level here
      chaos_value: Number(line.chaosValue),
      listing_count: line.listingCount ?? null,
    });
  }
  return rows;
}
