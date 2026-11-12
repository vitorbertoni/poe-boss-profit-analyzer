// Mercenary Warrant helpers: trade search bodies, listing parsing, currency conversion, search queue.
// Observed Nov 2026 (3.29): a warrant's fetch result has properties "Build" (class, "Infamous " prefix when
// infamous) and "Mercenary Level", plus item.mercenarySkills = [{name, supports: [{name, tier}]}]. Every skill
// and support is a trade stat in the "mercenary" group (mercenary.skill_N / mercenary.support_N).
// poe.ninja's exchange overview uses the same currency ids as the trade site (chaos, divine, chrome, alch, ...).
import { createHash } from 'node:crypto';

export const WARRANT = 'Mercenary Warrant';

/**
 * Search body: instant-buyout warrants, newest listings first. stat: one mercenary stat id the warrant must have.
 * minChaos: price floor in chaos equivalent (the trade site converts other currencies itself).
 */
export function buildSearch({ stat = null, minChaos = null } = {}) {
  const query = { status: { option: 'securable' }, type: WARRANT };
  if (stat) query.stats = [{ type: 'and', filters: [{ id: stat }] }];
  if (minChaos) query.filters = { trade_filters: { filters: { price: { min: Math.round(minChaos) } } } };
  return { query, sort: { indexed: 'desc' } };
}

/** Price-band sweeps that run every time, so expensive warrants are sampled even when cheap dumps dominate. */
export const SWEEPS = [
  { stat_id: 'sweep:all', label: 'Newest warrants', minDiv: null },
  { stat_id: 'sweep:1div', label: 'Newest warrants ≥ 1 div', minDiv: 1 },
  { stat_id: 'sweep:10div', label: 'Newest warrants ≥ 10 div', minDiv: 10 },
];

/** chaos per unit for every currency in poe.ninja's Currency exchange overview, keyed by trade currency id. */
export function parseRates(data) {
  const rates = { chaos: 1 };
  for (const l of data?.lines || []) if (Number(l.primaryValue) > 0) rates[l.id] = Number(l.primaryValue);
  const perChaos = Number(data?.core?.rates?.divine);
  if (perChaos > 0) rates.divine = 1 / perChaos; // the core rate is the most liquid quote
  return rates;
}

/** Queue rows for every mercenary skill / support stat. Gilded supports first: they are the rare, priced ones. */
export function queueFromStats(statsJson, league) {
  const group = (statsJson.result || []).find((g) => g.id === 'mercenary');
  const rows = [];
  for (const e of group?.entries || []) {
    const kind = e.id.startsWith('mercenary.support_') ? 'support' : e.id.startsWith('mercenary.skill_') ? 'skill' : null;
    if (!kind) continue;
    const priority = kind === 'support' ? (/^Gilded /.test(e.text) ? 3 : /\(Tier 3\)$/.test(e.text) ? 2 : 1) : 1;
    rows.push({ league, stat_id: e.id, label: e.text, kind, priority });
  }
  return rows;
}

export const hashSeller = (name) => createHash('sha256').update(String(name || '')).digest('hex').slice(0, 32);

const prop = (item, name) => item?.properties?.find((p) => p.name === name)?.values?.[0]?.[0] ?? null;

/** One fetch result -> merc_listings row, or null when it is not a priced warrant. */
export function parseListing(result, { league, rates }) {
  const item = result?.item;
  const price = result?.listing?.price;
  if (!item || item.baseType !== WARRANT || !price || !(price.amount > 0)) return null;
  const buildRaw = String(prop(item, 'Build') || '').trim();
  if (!buildRaw) return null;
  const infamous = /^Infamous\s+/i.test(buildRaw);
  const nameProp = item.properties?.find((p) => p.name === '' && p.values?.length);
  const rate = rates[price.currency];
  const chaos = rate ? price.amount * rate : null;
  return {
    league,
    item_id: result.id,
    seller: hashSeller(result.listing?.account?.name),
    build: buildRaw.replace(/^Infamous\s+/i, ''),
    infamous,
    merc_name: nameProp?.values?.[0]?.[0] ?? null,
    level: Number(prop(item, 'Mercenary Level')) || null,
    price_amount: price.amount,
    price_currency: price.currency,
    price_chaos: chaos,
    price_div: chaos != null && rates.divine ? chaos / rates.divine : null,
    skills: (item.mercenarySkills || []).map((s) => ({
      name: s.name,
      supports: (s.supports || []).map((x) => ({ name: x.name, ...(x.tier ? { tier: x.tier } : {}) })),
    })),
    indexed_at: result.listing?.indexed ?? null,
  };
}
