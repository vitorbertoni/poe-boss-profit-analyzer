import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexStats, enchantOption, buildQuery, parseRules, limiter, summarize, rateTable } from '../lib/trade.mjs';

const STATS = {
  result: [
    { id: 'explicit', entries: [{ id: 'explicit.stat_1', text: '1 Added Passive Skill is Prismatic Heart' }, { id: 'explicit.stat_9', text: '+# to Strength' }] },
    { id: 'enchant', entries: [
      { id: 'enchant.stat_3948993189|11', text: 'Added Small Passive Skills grant: 10% increased Elemental Damage' },
      { id: 'enchant.stat_3948993189|2', text: 'Added Small Passive Skills grant: Staff Attacks deal 12% increased Damage with Hits and Ailments\nAdded Small Passive Skills grant: Mace or Sceptre Attacks deal 12% increased Damage with Hits and Ailments' },
    ] },
  ],
};

test('indexStats maps notables and multi-line enchants', () => {
  const idx = indexStats(STATS);
  assert.equal(idx.notables.get('Prismatic Heart'), 'explicit.stat_1');
  assert.equal(enchantOption(idx, { text: ['10% increased Elemental Damage'] }), 11);
  // RePoE lists these lines in the opposite order to the trade site
  assert.equal(enchantOption(idx, { text: ['Mace or Sceptre Attacks deal 12% increased Damage with Hits and Ailments', 'Staff Attacks deal 12% increased Damage with Hits and Ailments'] }), 2);
  assert.equal(enchantOption(idx, { text: ['nope'] }), null);
});

test('buildQuery asks for instant buyout, uncorrupted, ilvl tier and fixed passives', () => {
  const q = buildQuery({ size: 'Large', enchantOption: 11, notableStats: ['explicit.stat_1', 'explicit.stat_2'], tier: 75 });
  assert.equal(q.query.status.option, 'securable');
  assert.equal(q.query.type, 'Large Cluster Jewel');
  assert.deepEqual(q.query.filters.misc_filters.filters.ilvl, { min: 75, max: 83 });
  assert.equal(q.query.stats[0].filters.length, 4);
  assert.deepEqual(buildQuery({ size: 'Medium', enchantOption: 1, notableStats: [], tier: 84 }).query.filters.misc_filters.filters.ilvl, { min: 84 });
});

test('limiter stays under half of each rule and respects server pressure', async () => {
  let t = 0;
  const waits = [];
  const lim = limiter({ now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; } });
  const h = new Map([['x-rate-limit-ip', '8:10:60'], ['x-rate-limit-ip-state', '0:10:0']]);
  const headers = { get: (k) => h.get(k) };
  for (let i = 0; i < 5; i++) { await lim.before('s'); lim.after('s', headers); }
  // first call: no rules known yet; then max 4 per 10s -> the 5th call must wait
  assert.ok(t >= 10000, `elapsed ${t}`);
  // server says the IP is busy (4 of 8 used by someone else) -> wait a full period
  h.set('x-rate-limit-ip-state', '4:10:0');
  const before = t;
  lim.after('s', headers);
  await lim.before('s');
  assert.ok(t - before >= 10000);
  assert.deepEqual(parseRules('8:10:60,15:60:120')[1], { a: 15, period: 60, c: 120 });
});

test('summarize converts currencies and drops bait prices', () => {
  const rates = rateTable([{ name: 'Divine Orb', chaos_value: 300 }]);
  const L = (amount, currency) => ({ listing: { price: { amount, currency } } });
  const s = summarize([L(1, 'chaos'), L(100, 'chaos'), L(120, 'chaos'), L(0.5, 'divine'), L(1, 'divine'), L(3, 'mirror')], rates);
  assert.equal(s.sample_n, 4); // 1c dropped as bait, mirror has no rate
  assert.equal(s.min_chaos, 100);
  assert.equal(s.median_n_chaos, 150);
});
