import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearch, parseRates, queueFromStats, parseListing, hashSeller } from '../lib/mercs.mjs';

// Trimmed from a real fetch result (Standard, Nov 2026).
const RESULT = {
  id: 'abc123',
  listing: { indexed: '2026-11-11T20:05:31Z', price: { type: '~b/o', amount: 55, currency: 'chrome' }, account: { name: 'Someone#1234' } },
  item: {
    baseType: 'Mercenary Warrant',
    properties: [
      { name: '', values: [['Draxir, the Crusher', 0]], displayMode: 0 },
      { name: '', values: [], displayMode: 4 },
      { name: 'Build', values: [['Infamous Smoulderstrike', 0]], displayMode: 0 },
      { name: 'Mercenary Level', values: [['83', 0]], displayMode: 0, type: 78 },
    ],
    mercenarySkills: [
      { hash: 32391, name: 'Punishment', supports: [{ hash: 3263, name: 'Greater Curse Effect', tier: 3 }] },
      { hash: 13235, name: 'Anger' },
    ],
  },
};
const RATES = { chaos: 1, chrome: 0.5, divine: 800 };

test('parseListing reads class, infamous flag, level, skills and converts the price', () => {
  const row = parseListing(RESULT, { league: 'Standard', rates: RATES });
  assert.equal(row.build, 'Smoulderstrike');
  assert.equal(row.infamous, true);
  assert.equal(row.merc_name, 'Draxir, the Crusher');
  assert.equal(row.level, 83);
  assert.equal(row.price_chaos, 27.5);
  assert.equal(row.price_div, 27.5 / 800);
  assert.deepEqual(row.skills, [
    { name: 'Punishment', supports: [{ name: 'Greater Curse Effect', tier: 3 }] },
    { name: 'Anger', supports: [] },
  ]);
  assert.equal(row.seller, hashSeller('Someone#1234'));
  assert.notEqual(row.seller, 'Someone#1234');
});

test('parseListing keeps unknown currencies unpriced and skips non-warrants', () => {
  const odd = { ...RESULT, listing: { ...RESULT.listing, price: { amount: 3, currency: 'mystery' } } };
  assert.equal(parseListing(odd, { league: 'S', rates: RATES }).price_div, null);
  assert.equal(parseListing({ ...RESULT, item: { ...RESULT.item, baseType: 'Chaos Orb' } }, { league: 'S', rates: RATES }), null);
  assert.equal(parseListing(null, { league: 'S', rates: RATES }), null);
});

test('buildSearch: newest instant-buyout warrants, optional stat and chaos floor', () => {
  const q = buildSearch({ stat: 'mercenary.support_1', minChaos: 799.6 });
  assert.equal(q.query.type, 'Mercenary Warrant');
  assert.equal(q.query.status.option, 'securable');
  assert.deepEqual(q.query.stats, [{ type: 'and', filters: [{ id: 'mercenary.support_1' }] }]);
  assert.equal(q.query.filters.trade_filters.filters.price.min, 800);
  assert.deepEqual(q.sort, { indexed: 'desc' });
  assert.equal(buildSearch().query.stats, undefined);
});

test('parseRates uses the core divine rate and trade ids', () => {
  const r = parseRates({ core: { rates: { divine: 0.00125 } }, lines: [{ id: 'chrome', primaryValue: 0.4 }, { id: 'divine', primaryValue: 790 }, { id: 'x', primaryValue: 0 }] });
  assert.equal(r.divine, 800);
  assert.equal(r.chrome, 0.4);
  assert.equal(r.chaos, 1);
  assert.equal(r.x, undefined);
});

test('queueFromStats ranks Gilded supports first', () => {
  const rows = queueFromStats({ result: [{ id: 'mercenary', entries: [
    { id: 'mercenary.skill_1', text: 'Spark' },
    { id: 'mercenary.support_2', text: 'Gilded Heft (Tier 3)' },
    { id: 'mercenary.support_3', text: 'Chain (Tier 3)' },
    { id: 'mercenary.support_4', text: 'Chain (Tier 1)' },
  ] }] }, 'L');
  assert.deepEqual(rows.map((r) => [r.stat_id, r.kind, r.priority]), [
    ['mercenary.skill_1', 'skill', 1], ['mercenary.support_2', 'support', 3], ['mercenary.support_3', 'support', 2], ['mercenary.support_4', 'support', 1],
  ]);
});
