// Cluster jewel craft engine: expected cost of Alteration / Augmentation / Regal crafting.
// Pure ESM, no dependencies — runs in the browser (instant recalculation on price edits) and in Node (tests).
//
// Game rules modelled (PoE1, data from RePoE via data/clusters/cluster-mods.json):
//   - A mod can roll if its required level <= item level, its group is not already on the item, and the
//     affix limit allows it: magic 1 prefix + 1 suffix, rare jewel 2 prefixes + 2 suffixes.
//   - Weight = spawn weight × generation weight / 100. For both lists the FIRST tag the item has wins, in the
//     order the data lists them. Item tags = enchant tag, base tag (expansion_jewel_large|medium), tags added
//     by mods already on the item, and "default".
//   - Alteration rerolls a magic item into 1 or 2 mods (P_TWO_MODS, an assumption to validate). With 2 mods the
//     first is drawn from the whole pool and the second from the other affix type.
//   - Augmentation adds one mod of the missing affix type to a 1-mod magic item.
//   - Regal turns magic into rare and adds one mod.
//   - After a failed Regal, the item is reset with Scouring + Transmutation (a fresh magic roll).
//
// Strategy: roll alterations until the magic item is in a set S of "good" states, then (optionally Aug and)
// Regal. S is chosen to minimise expected cost — the pivot rule falls out of this: any state with one of the
// target notables can be worth regalling. Solved exactly with a renewal equation and Dinkelbach iteration.

export const SIZE_TAG = { Large: 'expansion_jewel_large', Medium: 'expansion_jewel_medium' };
export const LIMITS = { magic: { prefix: 1, suffix: 1 }, rare: { prefix: 2, suffix: 2 } };
export const DEFAULTS = { pTwoMods: 0.5 };

const firstMatch = (list, tags) => {
  if (!list) return 100; // no generation weights = ×1
  for (const [tag, w] of Object.entries(list)) if (tags.has(tag)) return w;
  return 0;
};

/** Mods that can ever matter for this base (positive base weight, ilvl ok). */
export function candidateMods(data, { size, enchant, ilvl }) {
  const baseTags = new Set([enchant, SIZE_TAG[size], 'default']);
  return data.mods.filter((m) => m.ilvl <= ilvl && firstMatch(m.weights, baseTags) > 0);
}

function tagsFor(base, mods) {
  const t = new Set([base.enchant, SIZE_TAG[base.size], 'default']);
  for (const m of mods) for (const a of m.addsTags || []) t.add(a);
  return t;
}

/** Weighted pool of mods that can be added to `mods` under `rarity` limits, optionally one affix type. */
export function pool(base, cands, mods, rarity, affix) {
  const tags = tagsFor(base, mods);
  const groups = new Set(mods.flatMap((m) => m.groups));
  const used = { prefix: 0, suffix: 0 };
  for (const m of mods) used[m.affix]++;
  const out = [];
  let total = 0;
  for (const m of cands) {
    if (affix && m.affix !== affix) continue;
    if (used[m.affix] >= LIMITS[rarity][m.affix]) continue;
    if (m.groups.some((g) => groups.has(g))) continue;
    const w = (firstMatch(m.weights, tags) * firstMatch(m.generationWeights, tags)) / 100;
    if (w > 0) {
      out.push([m, w]);
      total += w;
    }
  }
  return { mods: out, total };
}

const key = (mods) => mods.map((m) => m.id).sort().join('&');

/** Distribution of magic items after an Alteration: Map(key -> {p, mods}). */
export function alterationOutcomes(base, cands, pTwoMods = DEFAULTS.pTwoMods) {
  const out = new Map();
  const put = (mods, p) => {
    const k = key(mods);
    const cur = out.get(k);
    if (cur) cur.p += p;
    else out.set(k, { p, mods });
  };
  const first = pool(base, cands, [], 'magic');
  for (const [m1, w1] of first.mods) {
    const p1 = w1 / first.total;
    put([m1], (1 - pTwoMods) * p1);
    const other = m1.affix === 'prefix' ? 'suffix' : 'prefix';
    const second = pool(base, cands, [m1], 'magic', other);
    if (!second.total) {
      put([m1], pTwoMods * p1); // nothing to pair with: stays a 1-mod item
      continue;
    }
    for (const [m2, w2] of second.mods) put([m1, m2], pTwoMods * p1 * (w2 / second.total));
  }
  return out;
}

const hasAll = (mods, targets) => targets.every((t) => mods.some((m) => m.notable === t));

/** P(success) of a Regal on `mods` (magic -> rare, one added mod). */
function regalSuccess(base, cands, mods, targets) {
  if (hasAll(mods, targets)) return 1;
  const pl = pool(base, cands, mods, 'rare');
  if (!pl.total) return 0;
  let p = 0;
  for (const [m, w] of pl.mods) if (hasAll([...mods, m], targets)) p += w / pl.total;
  return p;
}

/** Best way to finish a magic state: none (already done), regal, or aug + regal. */
function finishOptions(base, cands, state, targets, prices) {
  if (hasAll(state.mods, targets)) return [{ action: 'done', cost: 0, p: 1 }];
  const opts = [{ action: 'regal', cost: prices.regal, p: regalSuccess(base, cands, state.mods, targets) }];
  if (state.mods.length === 1) {
    const missing = state.mods[0].affix === 'prefix' ? 'suffix' : 'prefix';
    const aug = pool(base, cands, state.mods, 'magic', missing);
    if (aug.total) {
      let p = 0;
      let pDone = 0;
      for (const [m, w] of aug.mods) {
        const next = [...state.mods, m];
        const q = w / aug.total;
        if (hasAll(next, targets)) {
          p += q;
          pDone += q;
        } else p += q * regalSuccess(base, cands, next, targets);
      }
      // the Regal is only bought when the Aug did not already finish the item
      opts.push({ action: 'aug+regal', cost: prices.aug + (1 - pDone) * prices.regal, p });
    }
  }
  return opts.filter((o) => o.p > 0);
}

/**
 * Expected cost to craft `targets` (1–3 notable names) on a base.
 * prices (chaos): { alt, aug, regal, scour, transmute, base }.
 * Returns null-ish `feasible: false` when the targets cannot be made with alt/aug/regal on this base.
 */
export function analyzeCraft(data, { size, enchant, ilvl, targets, prices, pTwoMods = DEFAULTS.pTwoMods }) {
  const base = { size, enchant, ilvl };
  const cands = candidateMods(data, base);
  const reachable = targets.every((t) => cands.some((m) => m.notable === t));
  const prefixTargets = targets.filter((t) => cands.find((m) => m.notable === t)?.affix === 'prefix').length;
  if (!reachable || targets.length > 3 || prefixTargets > 2 || targets.length - prefixTargets > 1)
    return { feasible: false, reason: !reachable ? 'a target notable cannot roll on this base / item level' : 'too many notables of one affix type' };

  const outcomes = [...alterationOutcomes(base, cands, pTwoMods).values()];
  const reset = prices.scour + prices.transmute;
  // per state: best finishing option for a given E (lower criterion is better)
  const states = outcomes.map((s) => ({ ...s, opts: finishOptions(base, cands, s, targets, prices) })).filter((s) => s.opts.length);
  if (!states.length) return { feasible: false, reason: 'no magic roll leads to the target' };

  // Dinkelbach: include state s with option o iff (o.cost + (1-o.p)·reset − alt) / o.p < E.
  let E = Infinity;
  let chosen = [];
  for (let iter = 0; iter < 100; iter++) {
    chosen = [];
    for (const s of states) {
      let best = null;
      for (const o of s.opts) {
        const crit = (o.cost + (1 - o.p) * reset - prices.alt) / o.p;
        if (crit < E && (!best || crit < best.crit)) best = { ...o, crit };
      }
      if (best) chosen.push({ s, o: best });
    }
    if (!chosen.length) {
      // E = ∞ first pass includes everything with p > 0, so this only happens on numerical edge cases
      return { feasible: false, reason: 'no viable strategy' };
    }
    const pIn = chosen.reduce((a, c) => a + c.s.p, 0);
    const num = chosen.reduce((a, c) => a + c.s.p * (c.o.cost + (1 - c.o.p) * reset), 0) + (1 - pIn) * prices.alt;
    const den = chosen.reduce((a, c) => a + c.s.p * c.o.p, 0);
    const next = num / den;
    if (Math.abs(next - E) < 1e-9 * Math.max(1, next)) {
      E = next;
      break;
    }
    E = next;
  }

  // Per-draw outcome mix (for counts and the cost distribution).
  const pProceed = chosen.reduce((a, c) => a + c.s.p, 0);
  const pSuccess = chosen.reduce((a, c) => a + c.s.p * c.o.p, 0); // per draw
  const pFail = pProceed - pSuccess;
  const drawsExpected = 1 / pSuccess;
  const regalShare = chosen.reduce((a, c) => a + c.s.p * (c.o.action === 'done' ? 0 : c.o.action === 'regal' ? 1 : c.o.cost - prices.aug > 0 ? (c.o.cost - prices.aug) / prices.regal : 0), 0);
  const augShare = chosen.reduce((a, c) => a + c.s.p * (c.o.action === 'aug+regal' ? 1 : 0), 0);
  const expected = {
    alterations: (1 - pProceed) * drawsExpected,
    resets: pFail * drawsExpected,
    augs: augShare * drawsExpected,
    regals: regalShare * drawsExpected,
  };
  const fixed = prices.base + prices.transmute; // white base + first magic roll
  const expectedCost = fixed + E;

  // Cost distribution: draws until success ~ Geometric(pSuccess); non-success draws split alt vs failed proceed.
  const costNo = prices.alt;
  const costFail = pFail > 0 ? chosen.reduce((a, c) => a + c.s.p * (1 - c.o.p) * (c.o.cost + reset), 0) / pFail : 0;
  const costWin = chosen.reduce((a, c) => a + c.s.p * c.o.p * c.o.cost, 0) / pSuccess;
  const quantile = (q) => {
    const n = Math.max(1, Math.ceil(Math.log(1 - q) / Math.log(1 - pSuccess))); // draws by quantile q
    const k = n - 1;
    const share = pFail / (1 - pSuccess || 1);
    return fixed + costWin + k * (share * costFail + (1 - share) * costNo);
  };

  const proceedNotables = [...new Set(chosen.flatMap((c) => c.s.mods.filter((m) => targets.includes(m.notable)).map((m) => m.notable)))];
  const usesAug = chosen.some((c) => c.o.action === 'aug+regal');
  return {
    feasible: true,
    targets,
    base,
    expectedCost,
    craftCost: E,
    p50: quantile(0.5),
    p90: quantile(0.9),
    perDraw: { pProceed, pSuccess },
    expected,
    policy: new Map(chosen.map((c) => [key(c.s.mods), c.o.action])), // state key -> action (used by tests/sim)
    strategy: {
      proceedStates: chosen.length,
      keepWhenHas: proceedNotables,
      usesAug,
      label: describe(targets, proceedNotables, usesAug, chosen.some((c) => c.o.action === 'done')),
    },
  };
}

function describe(targets, keep, usesAug, canFinishMagic) {
  const pivot = keep.length > 1 ? `any of ${keep.join(' / ')}` : keep[0] || 'the right mods';
  const step = usesAug ? 'Aug if one affix is open, then Regal' : 'Regal';
  return `Alt until the jewel has ${pivot}; ${canFinishMagic && targets.length <= 2 ? 'stop if it already has every target, else ' : ''}${step}. Scour + Transmute on a miss.`;
}

/** Runs analyzeCraft for each item level tier that has a base price, sorted by expected net profit. */
export function analyzeTiers(data, { size, enchant, targets, prices, basePrices, salePrice, tiers = [1, 50, 68, 75, 84], pTwoMods }) {
  const rows = [];
  for (const ilvl of tiers) {
    const bp = basePrices[ilvl];
    if (bp == null) continue;
    const r = analyzeCraft(data, { size, enchant, ilvl, targets, prices: { ...prices, base: bp }, pTwoMods });
    if (!r.feasible) continue;
    const sale = typeof salePrice === 'function' ? salePrice(ilvl) : salePrice;
    rows.push({ ilvl, ...r, salePrice: sale ?? null, netProfit: sale != null ? sale - r.expectedCost : null });
  }
  return rows.sort((a, b) => (b.netProfit ?? -Infinity) - (a.netProfit ?? -Infinity) || a.expectedCost - b.expectedCost);
}
