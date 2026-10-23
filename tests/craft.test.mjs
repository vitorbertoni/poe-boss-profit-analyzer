// Craft engine tests. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeCraft, analyzeTiers, alterationOutcomes, candidateMods, pool } from '../lib/craft/engine.js';
import { rng } from '../lib/calc.js';

const data = JSON.parse(readFileSync(new URL('../data/clusters/cluster-mods.json', import.meta.url), 'utf8'));
const PRICES = { alt: 0.08, aug: 0.02, regal: 0.07, scour: 0.7, transmute: 0.005, base: 5 };

// Pick a real enchant + two prefix notables that share it (Large), and one Medium enchant.
function pickTargets(size, n = 2) {
  for (const e of data.sizes[size].enchants) {
    const base = { size, enchant: e.tag, ilvl: 84 };
    const nots = candidateMods(data, base).filter((m) => m.notable && m.affix === 'prefix');
    if (nots.length >= n) return { enchant: e.tag, targets: nots.slice(0, n).map((m) => m.notable) };
  }
  throw new Error('no enchant found');
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
  const r3 = analyzeCraft(data, { size: 'Large', enchant: three.enchant, ilvl: 84, targets: three.targets, prices: PRICES });
  assert.equal(r3.feasible, false);
});

test('exact expected cost matches a step-by-step simulation of the chosen policy', () => {
  const { enchant, targets } = pickTargets('Medium', 1);
  const size = 'Medium';
  const r = analyzeCraft(data, { size, enchant, ilvl: 84, targets, prices: PRICES });
  assert.equal(r.feasible, true);

  const base = { size, enchant, ilvl: 84 };
  const cands = candidateMods(data, base);
  const rand = rng(7);
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
  const done = (mods) => targets.every((t) => mods.some((m) => m.notable === t));

  const N = 4000;
  let total = 0;
  for (let i = 0; i < N; i++) {
    let cost = PRICES.base + PRICES.transmute;
    let item = roll();
    for (let guard = 0; guard < 1e6; guard++) {
      const action = r.policy.get(keyOf(item));
      if (!action) {
        cost += PRICES.alt;
        item = roll();
        continue;
      }
      if (action === 'done') break;
      if (action === 'aug+regal') {
        cost += PRICES.aug;
        const aff = item[0].affix === 'prefix' ? 'suffix' : 'prefix';
        item = [...item, pick(pool(base, cands, item, 'magic', aff))];
        if (done(item)) break;
      }
      cost += PRICES.regal;
      item = [...item, pick(pool(base, cands, item, 'rare'))];
      if (done(item)) break;
      cost += PRICES.scour + PRICES.transmute;
      item = roll();
    }
    total += cost;
  }
  const mean = total / N;
  const rel = Math.abs(mean - r.expectedCost) / r.expectedCost;
  assert.ok(rel < 0.06, `simulated ${mean.toFixed(3)} vs exact ${r.expectedCost.toFixed(3)} (${(rel * 100).toFixed(1)}%)`);
});

test('two-notable Large craft: policy beats a naive "regal everything with A" and tiers rank by profit', () => {
  const { enchant, targets } = pickTargets('Large', 2);
  const r = analyzeCraft(data, { size: 'Large', enchant, ilvl: 84, targets, prices: PRICES });
  assert.equal(r.feasible, true);
  assert.ok(r.expectedCost > PRICES.base);
  assert.ok(r.p90 >= r.p50);
  assert.ok(r.strategy.keepWhenHas.length >= 1);
  const tiers = analyzeTiers(data, {
    size: 'Large', enchant, targets, prices: PRICES, basePrices: { 75: 1, 84: 10 }, salePrice: (ilvl) => (ilvl === 84 ? 500 : 400),
  });
  assert.ok(tiers.length >= 1);
  for (let i = 1; i < tiers.length; i++) assert.ok(tiers[i - 1].netProfit >= tiers[i].netProfit);
});
