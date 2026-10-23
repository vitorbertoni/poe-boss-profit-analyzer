import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCurrency, parseBases } from '../lib/ninja.mjs';

test('parseCurrency keeps craft currency and adds chaos', () => {
  const data = {
    items: [
      { id: 'divine', name: 'Divine Orb' },
      { id: 'alt', name: 'Orb of Alteration' },
      { id: 'mirror', name: 'Mirror of Kalandra' },
    ],
    lines: [
      { id: 'divine', primaryValue: 326.2, volumePrimaryValue: 1000 },
      { id: 'alt', primaryValue: 0.2 },
      { id: 'mirror', primaryValue: 90000 },
    ],
  };
  const rows = parseCurrency(data, 'Allflame');
  assert.deepEqual(rows.map((r) => r.name).sort(), ['Chaos Orb', 'Divine Orb', 'Orb of Alteration']);
  assert.equal(rows.find((r) => r.name === 'Divine Orb').chaos_value, 326.2);
});

test('parseBases reads size, passives and ilvl tier', () => {
  const data = {
    lines: [
      { name: '12% increased Physical Damage', baseType: 'Large Cluster Jewel', variant: '10 passives', levelRequired: 50, chaosValue: 1652, listingCount: 99 },
      { name: 'Minions deal 10% increased Damage', baseType: 'Large Cluster Jewel', variant: '8 passives', levelRequired: 84, chaosValue: 12 },
      { name: 'broken', baseType: 'Grand Spectrum', variant: '', levelRequired: 1, chaosValue: 5 },
    ],
  };
  const rows = parseBases(data, 'Allflame');
  assert.equal(rows.length, 2);
  assert.deepEqual(
    { size: rows[0].size, passives: rows[0].passives, ilvl_tier: rows[0].ilvl_tier, listing_count: rows[0].listing_count },
    { size: 'Large', passives: 10, ilvl_tier: 50, listing_count: 99 },
  );
  assert.equal(rows[1].listing_count, null);
});
