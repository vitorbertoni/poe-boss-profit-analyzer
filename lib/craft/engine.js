// Cluster jewel craft engine: expected cost of Alteration / Augmentation / Regal (+ Exalted Orb) crafting.
// Pure ESM, no dependencies — runs in the browser (instant recalculation on price edits) and in Node (tests).
//
// Game rules modelled (PoE1, data from RePoE via data/clusters/cluster-mods.json):
//   - A mod can roll if its required level <= item level, its group is not already on the item, and the
//     affix limit allows it: magic 1 prefix + 1 suffix, rare jewel 2 prefixes + 2 suffixes. All Large suffix
//     notables share one group, so a Large jewel holds at most 3 notables (2 prefix + 1 suffix); Medium has no
//     suffix notables, so at most 2.
//   - Weight = spawn weight × generation weight / 100. For both lists the FIRST tag the item has wins, in the
//     order the data lists them. Item tags = enchant tag, base tag (expansion_jewel_large|medium), tags added
//     by mods already on the item, and "default".
//   - Alteration rerolls a magic item into 1 or 2 mods (pTwoMods, an assumption to validate). With 2 mods the
//     first is drawn from the whole pool and the second from the other affix type.
//   - Augmentation adds one mod of the missing affix type to a 1-mod magic item.
//   - Regal turns magic into rare and adds one mod. Exalted Orb adds one mod to a rare with an open slot.
//   - A failed attempt is either reset (Scouring + Transmutation, same base) or, when its notables form a combo
//     with a market price, sold — then a new base is bought (base + Transmutation).
//
// Strategy (solved, not hand-written): roll Alterations until the magic jewel is in a good state, then Aug and/or
// Regal; after the Regal, Exalt when exactly one target is missing and it is worth it; sell or reset failures.
// Each choice minimises the expected net cost (currency + bases − by-product sales) until a jewel with every
// target notable is made. Solved exactly by policy iteration on a renewal equation: E = A(π) / (1 − B(π)).
// Approximation: when an Exalt misses, the jewel is valued by the notables it had before the Exalt.

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

export const stateKey = (mods) => mods.map((m) => m.id).sort().join('&');
/** Key of a notable set, same order as combo keys ("A+B+C", sorted). */
export const notableKey = (names) => [...names].sort().join('+');
const notablesOf = (mods) => mods.filter((m) => m.notable).map((m) => m.notable);
/** notableKey of `have` plus one more notable, memoised per context (hot path). */
function keyPlus(ctx, have, haveKey, name) {
  const ck = `${haveKey}|${name}`;
  let k = ctx.keys.get(ck);
  if (k === undefined) {
    k = notableKey([...have, name]);
    ctx.keys.set(ck, k);
  }
  return k;
}

/** Distribution of magic items after an Alteration: Map(key -> {p, mods}). */
export function alterationOutcomes(base, cands, pTwoMods = DEFAULTS.pTwoMods) {
  const out = new Map();
  const put = (mods, p) => {
    const k = stateKey(mods);
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

// ---------- outcome enumeration (price independent) ----------

/** Rare-pool weight tables per tag set: per-mod weight, total per affix, total per (group, affix). */
function rareTables(base, cands) {
  const cache = new Map();
  return (mods) => {
    const tags = tagsFor(base, mods);
    const k = [...tags].sort().join(',');
    let t = cache.get(k);
    if (!t) {
      const w = new Map();
      const total = { prefix: 0, suffix: 0 };
      const group = new Map();
      for (const m of cands) {
        const x = (firstMatch(m.weights, tags) * firstMatch(m.generationWeights, tags)) / 100;
        if (!(x > 0)) continue;
        w.set(m, x);
        total[m.affix] += x;
        for (const g of m.groups) {
          const e = group.get(g) || { prefix: 0, suffix: 0 };
          e[m.affix] += x;
          group.set(g, e);
        }
      }
      cache.set(k, (t = { w, total, group }));
    }
    return t;
  };
}

/** Total weight a rare item `mods` can still roll (Regal / Exalted Orb pool). */
function openWeight(t, mods) {
  const used = { prefix: 0, suffix: 0 };
  const groups = new Set();
  for (const m of mods) {
    used[m.affix]++;
    for (const g of m.groups) groups.add(g);
  }
  let W = 0;
  for (const aff of ['prefix', 'suffix']) {
    if (used[aff] >= LIMITS.rare[aff]) continue;
    let x = t.total[aff];
    for (const g of groups) x -= t.group.get(g)?.[aff] || 0;
    W += x;
  }
  return { W, used, groups };
}

function makeLeaves() {
  return { success: new Map(), fail: new Map(), exalt: new Map() };
}
const addTo = (map, k, p) => map.set(k, (map.get(k) || 0) + p);

/**
 * Adds the outcomes of a Regal on magic item `mods` (reached with probability w0) to `leaves`:
 * success (all targets), exalt (exactly one target missing and it can still roll: {P, Pq}), or fail.
 * Leaves are keyed by the jewel's notable set.
 */
function regalLeaves(ctx, mods, w0, leaves) {
  const { cands, targets, targetMods, table } = ctx;
  const t = table(mods);
  const { W } = openWeight(t, mods);
  const have = notablesOf(mods);
  const haveKey = notableKey(have);
  if (!(W > 0)) {
    addTo(leaves.fail, haveKey, w0);
    return;
  }
  const missing = targetMods.filter((tm) => !mods.includes(tm));
  const used = { prefix: 0, suffix: 0 };
  const groups = new Set();
  for (const m of mods) {
    used[m.affix]++;
    for (const g of m.groups) groups.add(g);
  }
  if (missing.length >= 2) {
    // only a notable can change the outcome; every other mod leaves a failure with the same notables
    let pNotable = 0;
    for (const m of ctx.notableCands) {
      if (used[m.affix] >= LIMITS.rare[m.affix] || m.groups.some((g) => groups.has(g))) continue;
      const w = t.w.get(m) || 0;
      if (!(w > 0)) continue;
      const p = (w0 * w) / W;
      pNotable += p;
      exaltOrFail(ctx, [...mods, m], keyPlus(ctx, have, haveKey, m.notable), p, leaves);
    }
    if (w0 - pNotable > 1e-15) addTo(leaves.fail, haveKey, w0 - pNotable);
    return;
  }
  // exactly one target missing: every addition matters for the Exalt odds (grouped by affix + mod group)
  let plainFail = 0;
  const plainByGroup = new Map(); // (affix|group) -> {w, mod} for exalt odds when exactly one target is missing
  for (const m of cands) {
    if (used[m.affix] >= LIMITS.rare[m.affix] || m.groups.some((g) => groups.has(g))) continue;
    const w = t.w.get(m) || 0;
    if (!(w > 0)) continue;
    const p = (w0 * w) / W;
    if (m.notable) {
      const R = [...mods, m];
      const k = keyPlus(ctx, have, haveKey, m.notable);
      if (hasAll(R, targets)) addTo(leaves.success, k, p);
      else exaltOrFail(ctx, R, k, p, leaves);
    } else if (missing.length === 1) {
      const k = `${m.affix}|${m.groups.join(',')}`;
      const e = plainByGroup.get(k);
      if (e) e.w += p;
      else plainByGroup.set(k, { w: p, mod: m });
    } else plainFail += p;
  }
  if (plainFail) addTo(leaves.fail, haveKey, plainFail);
  for (const { w, mod } of plainByGroup.values()) exaltOrFail(ctx, [...mods, mod], haveKey, w, leaves);
}

/** A rare jewel R that is not finished: exalt-able (one target missing, slot open) or a failure. */
function exaltOrFail(ctx, R, k, p, leaves) {
  const missing = ctx.targetMods.filter((tm) => !R.includes(tm));
  if (missing.length === 1) {
    const tm = missing[0];
    const t = ctx.table(R);
    const { W, used, groups } = openWeight(t, R);
    const q = used[tm.affix] < LIMITS.rare[tm.affix] && !tm.groups.some((g) => groups.has(g)) && W > 0 ? (t.w.get(tm) || 0) / W : 0;
    if (q > 0) {
      const e = leaves.exalt.get(k) || { P: 0, Pq: 0 };
      e.P += p;
      e.Pq += p * q;
      leaves.exalt.set(k, e);
      return;
    }
  }
  addTo(leaves.fail, k, p);
}

const hasAll = (mods, targets) => targets.every((t) => mods.some((m) => m.notable === t));

/**
 * Price-independent part (the slow one): every magic roll, the ways to finish it and their outcomes.
 * Cache the result per (base, ilvl, targets); solveCraft() re-prices it in milliseconds.
 */
export function prepareCraft(data, { size, enchant, ilvl, targets, pTwoMods = DEFAULTS.pTwoMods }) {
  const base = { size, enchant, ilvl };
  const cands = candidateMods(data, base);
  const targetMods = targets.map((t) => cands.find((m) => m.notable === t));
  const prefixTargets = targetMods.filter((m) => m?.affix === 'prefix').length;
  if (targetMods.some((m) => !m)) return { feasible: false, base, targets, reason: 'a target notable cannot roll on this base / item level' };
  if (targets.length > 3 || prefixTargets > LIMITS.rare.prefix || targets.length - prefixTargets > 1)
    return { feasible: false, base, targets, reason: 'too many notables of one affix type' };

  const ctx = { cands, notableCands: cands.filter((m) => m.notable), targets, targetMods, table: rareTables(base, cands), keys: new Map() };
  const states = [];
  for (const s of alterationOutcomes(base, cands, pTwoMods).values()) {
    const have = notablesOf(s.mods);
    const missing = targetMods.filter((tm) => !s.mods.includes(tm)).length;
    const options = [];
    if (missing === 0) options.push({ action: 'done', augs: 0, regals: 0, leaves: { success: new Map([[notableKey(have), 1]]), fail: new Map(), exalt: new Map() } });
    else {
      // a Regal adds 1 mod and an Exalt 1 more: anything missing more than 2 targets cannot finish
      if (missing <= 2) {
        const leaves = makeLeaves();
        regalLeaves(ctx, s.mods, 1, leaves);
        options.push({ action: 'regal', augs: 0, regals: 1, leaves });
      }
      if (s.mods.length === 1 && missing <= 3) {
        const aff = s.mods[0].affix === 'prefix' ? 'suffix' : 'prefix';
        const aug = pool(base, cands, s.mods, 'magic', aff);
        if (aug.total) {
          const leaves = makeLeaves();
          let regals = 0;
          for (const [m, w] of aug.mods) {
            const q = w / aug.total;
            const next = [...s.mods, m];
            const left = targetMods.filter((tm) => !next.includes(tm)).length;
            if (left === 0) addTo(leaves.success, notableKey(notablesOf(next)), q);
            else if (left <= 2) {
              regalLeaves(ctx, next, q, leaves);
              regals += q;
            } else addTo(leaves.fail, notableKey(notablesOf(next)), q); // not worth a Regal: stop here
          }
          if (leaves.success.size || leaves.exalt.size || regals) options.push({ action: 'aug+regal', augs: 1, regals, leaves });
        }
      }
      // sell the magic jewel as it is (only matters when its notables form a priced combo)
      if (have.length >= 2) options.push({ action: 'sell', augs: 0, regals: 0, leaves: { success: new Map(), fail: new Map([[notableKey(have), 1]]), exalt: new Map() } });
    }
    states.push({ key: stateKey(s.mods), p: s.p, mods: s.mods, options });
  }
  // compile leaves into flat arrays over a shared table of notable-set keys (fast re-pricing in solveCraft)
  const keys = [];
  const index = new Map();
  const wonKey = new Map();
  const won = (k) => {
    let w = wonKey.get(k);
    if (w === undefined) wonKey.set(k, (w = idx(notableKey([...new Set([...k.split('+').filter(Boolean), ...targets])]))));
    return w;
  };
  const idx = (k) => {
    let i = index.get(k);
    if (i === undefined) {
      i = keys.length;
      keys.push(k);
      index.set(k, i);
    }
    return i;
  };
  for (const s of states) {
    for (const o of s.options) {
      const L = o.leaves;
      o.fail = { k: Int32Array.from([...L.fail.keys()], idx), P: Float64Array.from(L.fail.values()) };
      o.succ = { k: Int32Array.from([...L.success.keys()], idx), P: Float64Array.from(L.success.values()) };
      const ex = [...L.exalt];
      o.ex = {
        k: Int32Array.from(ex, ([k]) => idx(k)),
        P: Float64Array.from(ex, ([, e]) => e.P),
        Pq: Float64Array.from(ex, ([, e]) => e.Pq),
        won: Int32Array.from(ex, ([k]) => won(k)),
      };
      delete o.leaves;
    }
  }
  return { feasible: true, base, targets, targetKey: notableKey(targets), keys, states };
}

/**
 * Expected cost to craft `targets` (1–3 notable names) on a base.
 * prices (chaos): { alt, aug, regal, scour, transmute, exalt, base }.
 * opts.values(notableKey) -> chaos: market price of a jewel with exactly those notables (0 / undefined if unknown).
 * opts.sellByproducts: sell failed jewels whose notables are worth more than a reset (default true).
 */
export function analyzeCraft(data, { size, enchant, ilvl, targets, prices, pTwoMods = DEFAULTS.pTwoMods, values, sellByproducts }) {
  return solveCraft(prepareCraft(data, { size, enchant, ilvl, targets, pTwoMods }), prices, { values, sellByproducts });
}

export function solveCraft(prep, prices, { values = () => 0, sellByproducts = true } = {}) {
  if (!prep.feasible) return prep;
  const { base, targets, targetKey, keys } = prep;
  const exaltPrice = prices.exalt ?? Infinity;
  const reset = prices.scour + prices.transmute;
  const newBase = prices.base + prices.transmute;
  const value = (k) => Math.max(0, Number(values(k)) || 0);
  // Cost of a failed jewel with notable set k: reset it, or sell it and buy a new base. The sale only offsets
  // the new base (floor 0) for the decisions; anything above that is reported as a surplus, not chased —
  // otherwise a profitable by-product would make "never finish" look optimal (that combo has its own row).
  const n = keys.length;
  const val = new Float64Array(n);
  const fc = new Float64Array(n);
  const surplusOf = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = keys[i];
    val[i] = k.includes('+') ? value(k) : 0; // only combos of 2+ notables have a price
    const v = sellByproducts ? val[i] : 0;
    fc[i] = v > 0 ? Math.min(reset, Math.max(0, newBase - v)) : reset;
    surplusOf[i] = fc[i] < reset ? Math.max(0, v - newBase) : 0;
  }

  // J = a + b·E for an option under the current E (b = probability the attempt does not finish the jewel)
  const evalOption = (o, E) => {
    let a = o.augs * prices.aug + o.regals * prices.regal;
    let b = 0;
    const F = o.fail;
    for (let i = 0; i < F.k.length; i++) {
      a += F.P[i] * fc[F.k[i]];
      b += F.P[i];
    }
    const X = o.ex;
    for (let i = 0; i < X.k.length; i++) {
      const P = X.P[i];
      const Pq = X.Pq[i];
      const f = fc[X.k[i]];
      if (exaltPrice * P < Pq * (f + E)) {
        a += P * exaltPrice + (P - Pq) * f;
        b += P - Pq;
      } else {
        a += P * f;
        b += P;
      }
    }
    return [a, b];
  };

  let E = 1e12;
  const states = prep.states;
  const chosen = new Array(states.length);
  const ca = new Float64Array(states.length);
  const cb = new Float64Array(states.length);
  for (let iter = 0; iter < 200; iter++) {
    let A = 0;
    let B = 0;
    for (let i = 0; i < states.length; i++) {
      const s = states[i];
      let bo = null;
      let ba = prices.alt;
      let bb = 1;
      for (const o of s.options) {
        const [a, b] = evalOption(o, E);
        if (a + b * E < ba + bb * E - 1e-12) {
          bo = o;
          ba = a;
          bb = b;
        }
      }
      chosen[i] = bo;
      ca[i] = ba;
      cb[i] = bb;
      A += s.p * ba;
      B += s.p * bb;
    }
    if (!(1 - B > 1e-15)) return { feasible: false, base, targets, reason: 'no magic roll leads to the target' };
    const next = A / (1 - B);
    const done = Math.abs(next - E) <= 1e-9 * Math.max(1, Math.abs(next));
    E = next;
    if (done) break;
  }

  // ---- per-draw summary of the final policy ----
  const targetPrice = value(targetKey) || null;
  const per = { alt: 0, aug: 0, regal: 0, exalt: 0, reset: 0, sold: 0, credit: 0, surplus: 0, success: 0, saleValue: 0, cost: 0 };
  const policy = new Map();
  const sellSets = new Set();
  const byproducts = new Map(); // notable set -> expected sales per draw
  const keep = new Set();
  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    const o = chosen[i];
    per.cost += s.p * ca[i];
    if (!o) {
      per.alt += s.p;
      continue;
    }
    const exalted = new Set();
    per.aug += s.p * o.augs;
    per.regal += s.p * o.regals;
    for (const nm of notablesOf(s.mods)) if (targets.includes(nm)) keep.add(nm);
    const fail = (ki, P) => {
      if (fc[ki] < reset) {
        per.sold += s.p * P;
        per.credit += s.p * P * val[ki];
        per.surplus += s.p * P * surplusOf[ki];
        sellSets.add(keys[ki]);
        byproducts.set(ki, (byproducts.get(ki) || 0) + s.p * P);
      } else per.reset += s.p * P;
    };
    for (let j = 0; j < o.succ.k.length; j++) {
      const P = o.succ.P[j];
      per.success += s.p * P;
      per.saleValue += s.p * P * (val[o.succ.k[j]] || targetPrice || 0);
    }
    for (let j = 0; j < o.fail.k.length; j++) fail(o.fail.k[j], o.fail.P[j]);
    const X = o.ex;
    for (let j = 0; j < X.k.length; j++) {
      const P = X.P[j];
      const Pq = X.Pq[j];
      if (exaltPrice * P < Pq * (fc[X.k[j]] + E)) {
        exalted.add(keys[X.k[j]]);
        per.exalt += s.p * P;
        per.success += s.p * Pq;
        per.saleValue += s.p * Pq * (val[X.won[j]] || targetPrice || 0);
        fail(X.k[j], P - Pq);
      } else fail(X.k[j], P);
    }
    policy.set(s.key, { action: o.action, exalt: exalted });
  }
  const pSuccess = per.success; // per draw
  const draws = 1 / pSuccess;
  const fixed = prices.base + prices.transmute; // white base + first magic roll
  const expectedCost = fixed + E;
  const expectedSale = targetPrice == null && per.saleValue === 0 ? null : per.saleValue / pSuccess;
  // Cost distribution: draws until success ~ Geometric(pSuccess), each draw costing per.cost on average.
  const quantile = (q) => fixed + Math.max(1, Math.ceil(Math.log(1 - q) / Math.log(1 - Math.min(pSuccess, 1 - 1e-12)))) * per.cost;
  const usesAug = chosen.some((o) => o?.action === 'aug+regal');
  const usesExalt = per.exalt > 0;
  const sellsMagic = chosen.some((o) => o?.action === 'sell');
  const surplus = per.surplus * draws;

  return {
    feasible: true,
    targets,
    base,
    expectedCost, // currency + bases, minus by-product sales up to the base they replace
    craftCost: E,
    byproductSurplus: surplus, // by-product sales above the base they replace (extra profit per target jewel)
    netCost: expectedCost - surplus,
    targetPrice,
    expectedSale,
    jackpot: expectedSale != null && targetPrice != null ? expectedSale - targetPrice : 0,
    expectedProfit: expectedSale != null ? expectedSale - expectedCost + surplus : null,
    p50: quantile(0.5),
    p90: quantile(0.9),
    perDraw: { pSuccess, pProceed: 1 - per.alt },
    expected: {
      alterations: per.alt * draws,
      augs: per.aug * draws,
      regals: per.regal * draws,
      exalts: per.exalt * draws,
      resets: per.reset * draws,
      byproductsSold: per.sold * draws,
      byproductCredit: per.credit * draws,
    },
    byproducts: [...byproducts]
      .map(([ki, p]) => ({ notables: keys[ki].split('+'), perJewel: p * draws, value: val[ki] }))
      .sort((x, y) => y.perJewel * y.value - x.perJewel * x.value),
    policy,
    sellSets,
    strategy: {
      keepWhenHas: [...keep],
      usesAug,
      usesExalt,
      sellsByproducts: per.sold > 0,
      label: describe(targets, [...keep], usesAug, usesExalt, per.sold > 0, sellsMagic),
    },
  };
}

function describe(targets, keep, usesAug, usesExalt, sells, sellsMagic) {
  const pivot = keep.length > 1 ? `any of ${keep.join(' / ')}` : keep[0] || 'the right mods';
  const parts = [`Alt until the jewel has ${pivot}`];
  parts.push(usesAug ? 'Aug if one affix is open, then Regal' : 'then Regal');
  if (usesExalt) parts.push(`Exalt when only one ${targets.length === 3 ? 'notable' : 'target'} is missing`);
  const end = sells ? `Sell misses that land on a priced combo${sellsMagic ? ' (even before the Regal)' : ''}; Scour + Transmute the rest.` : 'Scour + Transmute on a miss.';
  return `${parts.join('; ')}. ${end}`;
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
