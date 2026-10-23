import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSearch, parseDictionary, notableIndex, sharedEnchant, comboKey } from '../lib/ninja-builds.mjs';

// --- tiny protobuf encoder for fixtures ---
const vint = (n) => { const o = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; o.push(b); } while (n); return o; };
const enc = new TextEncoder();
const fv = (f, v) => [...vint(f * 8), ...vint(v)];
const fb = (f, bytes) => [...vint(f * 8 + 2), ...vint(bytes.length), ...bytes];
const fs = (f, s) => fb(f, [...enc.encode(s)]);

test('parseSearch reads total, dimensions and dictionary refs', () => {
  const entry0 = fb(3, fv(2, 50)); // index omitted = 0
  const entry2 = fb(3, [...fv(1, 2), ...fv(2, 7)]);
  const dim = fb(2, [...fs(1, 'keypassives'), ...fs(2, 'keypassive'), ...entry0, ...entry2]);
  const ref = fb(6, [...fs(1, 'keypassive'), ...fs(2, 'abc123')]);
  const buf = new Uint8Array(fb(1, [...fv(1, 999), ...dim, ...ref]));
  const r = parseSearch(buf);
  assert.equal(r.total, 999);
  assert.equal(r.dimensions.keypassives.dict, 'keypassive');
  assert.deepEqual([...r.dimensions.keypassives.counts], [[0, 50], [2, 7]]);
  assert.deepEqual(r.dictionaries.keypassive, ['abc123']);
});

test('parseDictionary decodes an NDIC container', () => {
  const names = ['Advance Guard', 'Repeater', 'Wish for Death'];
  const head = new Uint8Array(36 + 8);
  const dv = new DataView(head.buffer);
  head.set(enc.encode('NDIC'));
  dv.setUint32(4, 2, true);
  dv.setUint32(12, names.length, true);
  dv.setUint32(24, 16, true);
  dv.setUint32(28, 1, true); // one block: offset 0, index 0
  dv.setUint32(32, names.length, true);
  const lens = new Uint8Array(names.map((n) => n.length));
  const data = enc.encode(names.join(''));
  const buf = new Uint8Array([...head, ...lens, ...data]);
  assert.deepEqual(parseDictionary(buf), names);
});

test('notableIndex maps notables to sizes and enchants from the RePoE extract', () => {
  const data = JSON.parse(readFileSync(new URL('../../data/clusters/cluster-mods.json', import.meta.url), 'utf8'));
  const idx = notableIndex(data);
  const pd = idx.find((n) => n.name === 'Prodigious Defence');
  assert.ok(pd, 'Prodigious Defence present');
  assert.ok(pd.enchants.size > 0);
  assert.ok(['Large', 'Medium'].includes(pd.size));
  // two notables from the same enchant pool share it
  const mates = idx.filter((n) => n.size === pd.size && n.name !== pd.name && sharedEnchant(pd, n));
  assert.ok(mates.length > 0);
});

test('comboKey is order independent', () => {
  assert.equal(comboKey('Large', 'e', ['B', 'A']), comboKey('Large', 'e', ['A', 'B']));
});
