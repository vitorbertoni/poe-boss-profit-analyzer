// Craft engine tests. Run: node --test tests/craft.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeCraft, analyzeTiers, alterationOutcomes, candidateMods, pool, notableKey } from '../lib/craft/engine.js';
import { rng } from '../lib/calc.js';

const data = JSON.parse(readFileSync(new URL('../data/clusters/cluster-mods.json', import.meta.url), 'utf8'));
const PRICES = { alt: 0.08, aug: 0.02, regal: 0.07, scour: 0.7, transmute: 0.005, exalt: Infinity, base: 5 };

// Pick a real enchant + n prefix notables that share it.
function pickTargets(size, n = 2) {
  for (const e of data.sizes[size].enchants) {
    const base = { size, enchant: e.tag, ilvl: 84 };
    const nots = candidateMods(data, base).filter((m) => m.notable && m.affix === 'prefix');
    if (nots.length >= n) return { enchant: e.tag, targets: nots.slice(0, n).map((m) => m.notable) };
  }
  throw new Error('no enchant found');
}

/**
 * Step-by-step simulation of an engine policy (same model and approximations: on a missed Exalt the jewel keeps
 * the notables it had before the Exalt). Returns the mean cost of one finished jewel, net of by-product sales
 * capped at the base they replace — the quantity the engine calls expectedCost.
 */
function simulate(r, { size, enchant, ilvl, targets, prices, values = () => 0 }, N, seed) {
  const base = { size, enchant, ilvl };
  const cands = candidateMods(data, base);
  const rand = rng(seed);
  const pick = (pl) => {
    let u = rand() * pl.total;
    for (const [m, w] of pl.mods) if ((u -= w) <= 0) return m;
    return pl.mods[pl.mods.length - 1][0];
  };
  const roll = () => {
    const first = pick(pool(base, cands, [], 'magic'));
    if (rand() >= 0.5) return [first];
    const other = pool(base, cands, [first], 'magic', first.affix === 'prefix' ? 'suffix' : 'prefix');
    return other.total ? [first, pick(other)] : [first];
  };
  const keyOf = (mods) => mods.map((m) => m.id).sort().join('&');
  const nk = (mods) => notableKey(mods.filter((m) => m.notable).map((m) => m.notable));
  const done = (mods) => targets.every((t) => mods.some((m) => m.notable === t));
  const reset = prices.scour + prices.transmute;
  const failCost = (mods) => (r.sellSets.has(nk(mods)) ? Math.max(0, prices.base + prices.transmute - values(nk(mods))) : reset);

  let total = 0;
  for (let i = 0; i < N; i++) {
    let cost = prices.base + prices.transmute;
    let item = roll();
    for (let guard = 0; guard < 1e7; guard++) {
      const pol = r.policy.get(keyOf(item));
      if (!pol) {
        cost += prices.alt;
        item = roll();
        continue;
      }
      if (pol.action === 'done') break;
      if (pol.action === 'sell') {
        cost += failCost(item);
        item = roll();
        continue;
      }
      if (pol.action === 'aug+regal') {
        cost += prices.aug;
        const aff = item[0].affix === 'prefix' ? 'suffix' : 'prefix';
        item = [...item, pick(pool(base, cands, item, 'magic', aff))];
        if (done(item)) break;
        const missing = targets.filter((t) => !item.some((m) => m.notable === t)).length;
        if (missing > 2) {
          cost += failCost(item);
          item = roll();
          continue;
        }
      }
      cost += prices.regal;
      item = [...item, pick(pool(base, cands, item, 'rare'))];
      if (done(item)) break;
      if (pol.exalt.has(nk(item))) {
        const pl = pool(base, cands, item, 'rare');
        const missingName = targets.find((t) => !item.some((m) => m.notable === t));
        if (pl.total && pl.mods.some(([m]) => m.notable === missingName)) {
          cost += prices.exalt;
          if (pick(pl).notable === missingName) break;
        }
      }
      cost += failCost(item);
      item = roll();
    }
    total += cost;
  }
  return total / N;
}

test('alteration outcomes form a probability distribution', () => {
  const { enchant } = pickTargets('Large');
  const base = { size: 'Large', enchant, ilvl: 84 };
  const out = [...alterationOutcomes(base, candidateMods(data, base)).values()];
  const sum = out.reduce((a, s) => a + s.p, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `sum ${sum}`);
  assert.ok(out.every((s) => s.mods.filter((m) => m.affix === 'prefix').length <= 1 && s.mods.filter((m) => m.affix === 'suffix').length <= 1));
});

test('generic base-tag mods are in the pool (they carry the biggest weights)', () => {
  const { enchant } = pickTargets('Large');
  const base = { size: 'Large', enchant, ilvl: 84 };
  const pl = pool(base, candidateMods(data, base), [], 'magic');
  const generic = pl.mods.filter(([m]) => !m.notable).reduce((a, [, w]) => a + w, 0);
  assert.ok(generic / pl.total > 0.3, `generic share ${generic / pl.total}`);
});

test('item level gates notables and the 35% effect mod', () => {
  const lo = candidateMods(data, { size: 'Large', enchant: pickTargets('Large').enchant, ilvl: 50 });
  assert.ok(lo.every((m) => m.ilvl <= 50));
  assert.ok(!lo.some((m) => m.id === 'AfflictionJewelSmallPassivesHaveIncreasedEffect2'));
  const hi = candidateMods(data, { size: 'Large', enchant: pickTargets('Large').enchant, ilvl: 84 });
  assert.ok(hi.some((m) => m.id === 'AfflictionJewelSmallPassivesHaveIncreasedEffect2'));
});

test('infeasible targets are reported, not priced', () => {
  const { enchant, targets } = pickTargets('Large', 2);
  const r = analyzeCraft(data, { size: 'Large', enchant, ilvl: 84, targets: [...targets, 'Not A Real Notable'], prices: PRICES });
  assert.equal(r.feasible, false);
  // three prefix notables cannot fit (rare jewels hold 2 prefixes)
  const three = pickTargets('Large', 3);
  assert.equal(analyzeCraft(data, { size: 'Large', enchant: three.enchant, ilvl: 84, targets: three.targets, prices: PRICES }).feasible, false);
  // Medium has no suffix notables, so it never holds 3 notables
  const m3 = pickTargets('Medium', 3);
  assert.equal(analyzeCraft(data, { size: 'Medium', enchant: m3.enchant, ilvl: 84, targets: m3.targets, prices: PRICES }).feasible, false);
});

test('exact expected cost matches a step-by-step simulation (Alt/Aug/Regal)', () => {
  const args = { size: 'Medium', ...pickTargets('Medium', 1), ilvl: 84, prices: PRICES };
  const r = analyzeCraft(data, args);
  assert.equal(r.feasible, true);
  const mean = simulate(r, args, 4000, 7);
  const rel = Math.abs(mean - r.expectedCost) / r.expectedCost;
  assert.ok(rel < 0.06, `simulated ${mean.toFixed(3)} vs exact ${r.expectedCost.toFixed(3)} (${(rel * 100).toFixed(1)}%)`);
});

test('Exalted Orb step: chosen when cheap enough, lowers the cost, and matches simulation', () => {
  const args = { size: 'Large', enchant: 'affliction_elemental_damage', ilvl: 84, targets: ['Prismatic Heart', 'Widespread Destruction'] };
  const without = analyzeCraft(data, { ...args, prices: PRICES });
  const cheap = { ...PRICES, exalt: 0.3 };
  const r = analyzeCraft(data, { ...args, prices: cheap });
  assert.ok(r.expected.exalts > 0, 'exalt is used');
  assert.ok(r.expectedCost < without.expectedCost, `${r.expectedCost} < ${without.expectedCost}`);
  const mean = simulate(r, { ...args, prices: cheap }, 3000, 11);
  const rel = Math.abs(mean - r.expectedCost) / r.expectedCost;
  assert.ok(rel < 0.06, `simulated ${mean.toFixed(3)} vs exact ${r.expectedCost.toFixed(3)} (${(rel * 100).toFixed(1)}%)`);
  // a very expensive Exalt is never used
  assert.equal(analyzeCraft(data, { ...args, prices: { ...PRICES, exalt: 1e6 } }).expected.exalts, 0);
});

test('by-products: priced misses are sold, lower the cost, and match simulation', () => {
  const args = { size: 'Large', enchant: 'affliction_elemental_damage', ilvl: 84, targets: ['Prismatic Heart', 'Widespread Destruction'] };
  // every other pair with Prismatic Heart or Widespread Destruction sells for 4.8c: selling + a new 5c base
  // (0.205c) beats a reset (0.705c), but the sale does not cover the base (no surplus)
  const values = (k) => {
    const n = k.split('+');
    return n.length === 2 && (n.includes('Prismatic Heart') || n.includes('Widespread Destruction')) ? 4.8 : 0;
  };
  const plain = analyzeCraft(data, { ...args, prices: PRICES });
  const r = analyzeCraft(data, { ...args, prices: PRICES, values });
  assert.ok(r.expected.byproductsSold > 0, 'some misses are sold');
  assert.ok(r.expectedCost < plain.expectedCost, `${r.expectedCost} < ${plain.expectedCost}`);
  assert.equal(r.byproductSurplus, 0);
  const off = analyzeCraft(data, { ...args, prices: PRICES, values, sellByproducts: false });
  assert.equal(off.expected.byproductsSold, 0);
  const mean = simulate(r, { ...args, prices: PRICES, values }, 3000, 13);
  const rel = Math.abs(mean - r.expectedCost) / r.expectedCost;
  assert.ok(rel < 0.06, `simulated ${mean.toFixed(3)} vs exact ${r.expectedCost.toFixed(3)} (${(rel * 100).toFixed(1)}%)`);
});

test('profitable by-products count as surplus, not as a reason to never finish', () => {
  const args = { size: 'Large', enchant: 'affliction_elemental_damage', ilvl: 84, targets: ['Prismatic Heart', 'Widespread Destruction'] };
  const values = (k) => (k.split('+').length === 2 && k.includes('Prismatic Heart') && k !== notableKey(args.targets) ? 50 : 0);
  const r = analyzeCraft(data, { ...args, prices: PRICES, values });
  assert.equal(r.feasible, true);
  assert.ok(r.expectedCost >= PRICES.base, 'cost never goes below the base');
  assert.ok(r.byproductSurplus > 0);
  assert.ok(r.perDraw.pSuccess > 0);
});

test('3-notable Large craft: feasible with 2 prefix + 1 suffix, costs more than its pair, Exalt helps', () => {
  const pair = ['Prismatic Heart', 'Widespread Destruction'];
  const triple = ['Blanketed Snow', 'Prismatic Heart', 'Widespread Destruction'];
  const args = { size: 'Large', enchant: 'affliction_cold_damage', ilvl: 84 };
  const p2 = analyzeCraft(data, { ...args, targets: pair, prices: { ...PRICES, exalt: 3.6 } });
  const p3 = analyzeCraft(data, { ...args, targets: triple, prices: PRICES });
  const p3x = analyzeCraft(data, { ...args, targets: triple, prices: { ...PRICES, exalt: 3.6 } });
  assert.equal(p3.feasible, true);
  assert.ok(p3.expectedCost > p2.expectedCost);
  assert.ok(p3x.expectedCost <= p3.expectedCost);
  assert.ok(p3x.p90 >= p3x.p50);
});

test('a pair craft that lands on a priced 3-notable jewel counts the jackpot', () => {
  const args = { size: 'Large', enchant: 'affliction_cold_damage', ilvl: 84, targets: ['Prismatic Heart', 'Widespread Destruction'] };
  const values = (k) => (k === notableKey(args.targets) ? 10 : k === notableKey([...args.targets, 'Blanketed Snow']) ? 1000 : 0);
  const r = analyzeCraft(data, { ...args, prices: PRICES, values });
  assert.equal(r.targetPrice, 10);
  assert.ok(r.jackpot > 0 && r.expectedSale > 10);
});

test('tiers rank by profit', () => {
  const { enchant, targets } = pickTargets('Large', 2);
  const tiers = analyzeTiers(data, {
    size: 'Large', enchant, targets, prices: PRICES, basePrices: { 75: 1, 84: 10 }, salePrice: (ilvl) => (ilvl === 84 ? 500 : 400),
  });
  assert.ok(tiers.length >= 1);
  for (let i = 1; i < tiers.length; i++) assert.ok(tiers[i - 1].netProfit >= tiers[i].netProfit);
});
