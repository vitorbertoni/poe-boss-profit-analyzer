import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSlotSearches, PSEUDO_SUFFIXES, tradeLink } from '../lib/fractures.js';

const data = JSON.parse(readFileSync(new URL('../data/fractures/fracture-mods.json', import.meta.url), 'utf8'));
const suppress = data.targets.find((t) => t.type === 'ChanceToSuppressSpells');
const defaults = data.fractures.filter((f) => f.on);
const opts = (o = {}) => ({ target: suppress, targetTier: 1, fractures: defaults, fractureTier: 1, maxSuffixes: 1, ...o });
const minOf = (q, id) => q.query.stats.flatMap((g) => g.filters).find((f) => f.id === id)?.value.min;

test('every slot gets a search with the T1 suppress value of that slot', () => {
  for (const slot of data.slots) {
    const r = buildSlotSearches(data, slot.key, opts());
    assert.ok(r.searches.length >= 1, slot.key);
    const q = r.searches[0].query;
    const want = slot.key === 'body_armour' ? 20 : 13; // body armour has its own, higher suppress tiers
    assert.equal(minOf(q, 'explicit.stat_3680664274'), want, slot.key);
    assert.equal(q.query.filters.type_filters.filters.category.option, slot.category);
    assert.equal(q.query.filters.misc_filters.filters.fractured_item.option, 'true');
  }
});

test('suffix count toggle sets the pseudo filter', () => {
  for (const n of [1, 2, 3]) {
    const q = buildSlotSearches(data, 'gloves', opts({ maxSuffixes: n })).searches[0].query;
    const f = q.query.stats[0].filters.find((x) => x.id === PSEUDO_SUFFIXES);
    assert.deepEqual(f.value, { min: 1, max: n });
  }
});

test('T1 life fracture threshold differs by slot; T1-T2 lowers it', () => {
  const life = 'fractured.stat_3299347043';
  const g1 = buildSlotSearches(data, 'gloves', opts()).searches[0].query;
  const b1 = buildSlotSearches(data, 'body_armour', opts()).searches[0].query;
  const g2 = buildSlotSearches(data, 'gloves', opts({ fractureTier: 2 })).searches[0].query;
  assert.ok(minOf(b1, life) > minOf(g1, life));
  assert.ok(minOf(g2, life) < minOf(g1, life));
});

test('mods that cannot roll with the target are skipped, and a base narrows the defence types', () => {
  const r = buildSlotSearches(data, 'gloves', opts());
  assert.ok(r.skipped.some((m) => m.type === 'LocalEnergyShieldPercent')); // pure ES gloves cannot roll suppress
  const slink = buildSlotSearches(data, 'gloves', opts({ base: 'Slink Gloves' }));
  assert.equal(slink.searches[0].query.query.type, 'Slink Gloves');
  assert.deepEqual(slink.target.on, ['dex_armour']);
});

test('a target that cannot roll on the slot returns an error', () => {
  const as = data.targets.find((t) => t.type === 'IncreasedAttackSpeed');
  assert.ok(buildSlotSearches(data, 'boots', opts({ target: as })).error);
});

test('flat hybrids whose stats are shared get their own AND search on body armour', () => {
  const r = buildSlotSearches(data, 'body_armour', opts());
  const own = r.searches.filter((s) => s.label !== 'All selected fractures');
  assert.ok(own.length >= 1);
  for (const s of own) assert.equal(s.query.query.stats[2].type, 'and');
});

test('trade link carries the query', () => {
  const q = buildSlotSearches(data, 'boots', opts()).searches[0].query;
  const url = tradeLink('Covens of Umbra', q);
  assert.ok(url.startsWith('https://www.pathofexile.com/trade/search/Covens%20of%20Umbra?q='));
  assert.deepEqual(JSON.parse(decodeURIComponent(url.split('?q=')[1])), q);
});

test('no stat id appears twice in one filter group', () => {
  for (const slot of data.slots)
    for (const tier of [1, 2])
      for (const s of buildSlotSearches(data, slot.key, opts({ fractureTier: tier, fractures: data.fractures })).searches || [])
        for (const g of s.query.query.stats) {
          const ids = g.filters.map((f) => f.id);
          assert.equal(new Set(ids).size, ids.length, `${slot.key} T${tier} ${s.label}`);
        }
});
