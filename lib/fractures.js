// Fractured Base Search: builds official trade site queries from data/fractures/fracture-mods.json.
// Pure functions (no DOM) so they run in the browser and in node --test.

export const PSEUDO_SUFFIXES = 'pseudo.pseudo_number_of_suffix_mods';
export const PSEUDO_PREFIXES = 'pseudo.pseudo_number_of_prefix_mods';

/** Lowest value a trade filter needs so it matches tier `tier` (1 = T1) or better on every allowed defence type. */
export function threshold(bySlotDef, defs, statIndex, tier) {
  let min = Infinity;
  for (const d of defs) {
    const tiers = bySlotDef?.[d];
    if (!tiers?.length) continue;
    const t = tiers[Math.min(tier, tiers.length) - 1];
    min = Math.min(min, t.v[statIndex][0]);
  }
  return Number.isFinite(min) ? min : null;
}

/** Highest value a worse tier than `tier` of the same mod reaches, on the allowed defence types. */
function worseMax(bySlotDef, defs, statIndex, tier) {
  let max = -Infinity;
  for (const d of defs) for (const t of (bySlotDef?.[d] || []).slice(tier)) max = Math.max(max, t.v[statIndex][1]);
  return max;
}

/** Defence types a mod can roll on, among `defs`. */
export const rollsOn = (mod, slot, defs) => defs.filter((d) => mod.slots[slot]?.[d]?.length);

/**
 * Plans the trade filters for one mod. A single-stat filter is "clean" when no lower tier of the same mod and no
 * other mod in the slot can reach its value. Mods whose every stat is ambiguous (flat hybrids such as
 * "+# to Armour and +# to Evasion Rating") need all their stats in one AND group, so they get a search of their own.
 * Returns null when the mod cannot roll on the allowed defence types.
 */
export function planMod(data, mod, slot, defs, tier, kind) {
  const on = rollsOn(mod, slot, defs);
  if (!on.length) return null;
  const bySlotDef = mod.slots[slot];
  const stats = mod.stats.map((id, i) => {
    const min = threshold(bySlotDef, on, i, tier);
    let clean = worseMax(bySlotDef, on, i, tier) < min;
    for (const [type, byDef] of Object.entries(data.competitors[slot]?.[id] || {})) {
      if (type === mod.type) continue;
      // Any base in the search counts, not only the ones this mod rolls on: the trade site cannot tell them apart.
      if (defs.some((d) => byDef[d] >= min)) clean = false;
    }
    const ids = data.stats[id]?.[kind] || [];
    return { id, min, clean, ids };
  });
  const usable = stats.filter((s) => s.ids.length);
  if (!usable.length) return null;
  const cleanStat = usable.find((s) => s.clean);
  if (cleanStat || usable.length === 1) return { mod, on, own: false, ambiguous: !cleanStat, stats: [cleanStat || usable[0]] };
  return { mod, on, own: true, ambiguous: false, stats: usable };
}

/** One filter per trade id (a stat can have several ids that the trade site shows as the same line). */
const filtersFor = (s) => s.ids.map((id) => ({ id, value: { min: s.min } }));

/**
 * Trade query bodies for one slot.
 * opts: { target, targetTier, fractures: [mod], fractureTier, maxSuffixes, maxPrefixes, base, status, maxPrice }
 * Returns { searches: [{ label, query, fractures: [plan] }], target: plan, skipped: [mod] } or { error }.
 */
export function buildSlotSearches(data, slotKey, opts) {
  const slot = data.slots.find((s) => s.key === slotKey);
  const defs = opts.base ? [slot.bases.find((b) => b.name === opts.base)?.def].filter(Boolean) : slot.defs;
  const target = planMod(data, opts.target, slotKey, defs, opts.targetTier, 'explicit');
  if (!target) return { error: `${opts.target.label} cannot roll on ${opts.base || slot.label.toLowerCase()}.` };
  // Only bases where the target can roll are worth searching, so fractures are planned on those defence types.
  const fdefs = target.on;
  const plans = [];
  const skipped = [];
  for (const m of opts.fractures) {
    const p = planMod(data, m, slotKey, fdefs, opts.fractureTier, 'fractured');
    if (p) plans.push(p);
    else skipped.push(m);
  }
  if (!plans.length) return { error: 'None of the selected fractured mods can roll together with the target here.', target, skipped };

  const common = (fractureGroup, label, fr) => {
    const stats = [
      { type: 'and', filters: [{ id: PSEUDO_SUFFIXES, value: { min: 1, max: opts.maxSuffixes } }, ...(opts.maxPrefixes ? [{ id: PSEUDO_PREFIXES, value: { max: opts.maxPrefixes } }] : [])] },
      { type: 'count', value: { min: 1 }, filters: target.stats.flatMap(filtersFor) },
      fractureGroup,
    ];
    const trade = opts.maxPrice > 0 ? { price: { max: opts.maxPrice, option: 'divine' } } : null;
    const query = {
      status: { option: opts.status || 'online' },
      ...(opts.base ? { type: opts.base } : {}),
      stats,
      filters: {
        type_filters: { filters: { category: { option: slot.category }, rarity: { option: 'rare' } } },
        misc_filters: { filters: { fractured_item: { option: 'true' }, corrupted: { option: 'false' }, mirrored: { option: 'false' }, crafted: { option: 'false' } } },
        ...(trade ? { trade_filters: { filters: trade } } : {}),
      },
    };
    return { label, query: { query, sort: { price: 'asc' } }, fractures: fr };
  };

  const searches = [];
  // A stat id can only appear once in the shared group; a second mod filtering on it gets its own search.
  const seen = new Set();
  for (const p of plans) {
    if (p.own) continue;
    const ids = p.stats.flatMap((x) => x.ids);
    if (ids.some((id) => seen.has(id))) p.own = true;
    else ids.forEach((id) => seen.add(id));
  }
  const grouped = plans.filter((p) => !p.own);
  if (grouped.length) {
    searches.push(common({ type: 'count', value: { min: 1 }, filters: grouped.flatMap((p) => p.stats.flatMap(filtersFor)) }, 'All selected fractures', grouped));
  }
  for (const p of plans.filter((x) => x.own)) {
    searches.push(common({ type: 'and', filters: p.stats.flatMap(filtersFor) }, p.mod.label, [p]));
  }
  return { searches, target, skipped };
}

/** Link that opens the search on the official trade site. */
export const tradeLink = (league, body) => `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}?q=${encodeURIComponent(JSON.stringify(body))}`;

/** Bench cost to lock the target's side before the Veiled Chaos / reroll step, by number of mods on that side. */
export function lockCost(n) {
  if (n <= 1) return '1 div (1 Suffix Modifier cannot be changed)';
  if (n === 2) return '2 div (2 Suffix Modifiers cannot be changed)';
  return '4 div + extra orbs (Suffixes cannot be changed)';
}
