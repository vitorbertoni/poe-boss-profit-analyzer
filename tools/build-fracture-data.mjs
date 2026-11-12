#!/usr/bin/env node
// Builds data/fractures/fracture-mods.json from a RePoE export (https://github.com/repoe-fork/repoe-fork.github.io).
// Usage: node tools/build-fracture-data.mjs <repoe data dir> [out file]
// The data dir must hold mods.json, base_items.json and stat_translations.json.
//
// For each armour slot (body, helmet, gloves, boots) and each defence type (str, dex, int and the hybrids), it lists
// the tiers of the suffix "targets" and prefix "fractures" the Fractured Base Search page offers, plus every other mod
// that shares a stat with them (so the page can tell when a single-stat trade filter would also match a lower tier of
// a different mod). Trade stat ids come from RePoE's stat_translations (`trade_stats`).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [, , dir, out = 'data/fractures/fracture-mods.json'] = process.argv;
if (!dir) {
  console.error('usage: node tools/build-fracture-data.mjs <repoe data dir> [out file]');
  process.exit(1);
}
const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const mods = read('mods.json');
const bases = read('base_items.json');
const translations = read('stat_translations.json');
let patch = 'unknown';
try {
  patch = readFileSync(join(dir, '..', 'exported-version.txt'), 'utf8').trim();
} catch {}

export const SLOTS = [
  { key: 'body_armour', label: 'Body Armour', itemClass: 'Body Armour', category: 'armour.chest' },
  { key: 'helmet', label: 'Helmet', itemClass: 'Helmet', category: 'armour.helmet' },
  { key: 'gloves', label: 'Gloves', itemClass: 'Gloves', category: 'armour.gloves' },
  { key: 'boots', label: 'Boots', itemClass: 'Boots', category: 'armour.boots' },
];
const DEFS = ['str_armour', 'dex_armour', 'int_armour', 'str_dex_armour', 'str_int_armour', 'dex_int_armour', 'str_dex_int_armour'];

// Suffix mods the page can search for (the "target"), in dropdown order.
const TARGETS = [
  ['ChanceToSuppressSpells', 'Chance to Suppress Spell Damage'],
  ['FireResistance', 'Fire Resistance'],
  ['ColdResistance', 'Cold Resistance'],
  ['LightningResistance', 'Lightning Resistance'],
  ['ChaosResistance', 'Chaos Resistance'],
  ['Strength', 'Strength'],
  ['Dexterity', 'Dexterity'],
  ['Intelligence', 'Intelligence'],
  ['IncreasedAttackSpeed', 'Attack Speed'],
  ['IncreasedCastSpeed', 'Cast Speed'],
  ['IncreasedAccuracy', 'Accuracy Rating'],
  ['LifeRegeneration', 'Life Regeneration'],
  ['ItemFoundRarityIncrease', 'Item Rarity'],
  ['StunRecovery', 'Stun and Block Recovery'],
];

// Prefix mods that count as the fractured mod. `on`: ticked by default.
const FRACTURES = [
  ['IncreasedLife', 'Maximum Life', 'Life', true],
  ['LocalPhysicalDamageReductionRating', 'Flat Armour', 'Armour', true],
  ['LocalPhysicalDamageReductionRatingPercent', '% Armour', 'Armour', true],
  ['LocalEvasionRating', 'Flat Evasion', 'Evasion', true],
  ['LocalEvasionRatingIncreasePercent', '% Evasion', 'Evasion', true],
  ['LocalEnergyShield', 'Flat Energy Shield', 'Energy Shield', true],
  ['LocalEnergyShieldPercent', '% Energy Shield', 'Energy Shield', true],
  ['LocalArmourAndEvasion', '% Armour and Evasion', 'Hybrid defences', true],
  ['LocalArmourAndEnergyShield', '% Armour and Energy Shield', 'Hybrid defences', true],
  ['LocalEvasionAndEnergyShield', '% Evasion and Energy Shield', 'Hybrid defences', true],
  ['LocalArmourAndEvasionAndEnergyShield', '% Armour, Evasion and Energy Shield', 'Hybrid defences', true],
  ['LocalBaseArmourAndEvasionRating', 'Flat Armour + Evasion', 'Hybrid defences', true],
  ['LocalBaseArmourAndEnergyShield', 'Flat Armour + Energy Shield', 'Hybrid defences', true],
  ['LocalBaseEvasionRatingAndEnergyShield', 'Flat Evasion + Energy Shield', 'Hybrid defences', true],
  ['LocalBaseArmourAndLife', 'Flat Armour + Life', 'Small hybrids', false],
  ['LocalBaseEvasionRatingAndLife', 'Flat Evasion + Life', 'Small hybrids', false],
  ['LocalBaseEnergyShieldAndLife', 'Flat Energy Shield + Life', 'Small hybrids', false],
  ['LocalBaseEnergyShieldAndMana', 'Flat Energy Shield + Mana', 'Small hybrids', false],
  ['LocalPhysicalDamageReductionRatingAndStunRecoveryPercent', '% Armour + Stun Recovery', 'Small hybrids', false],
  ['LocalEvasionRatingAndStunRecoveryIncreasePercent', '% Evasion + Stun Recovery', 'Small hybrids', false],
  ['LocalEnergyShieldAndStunRecoveryPercent', '% Energy Shield + Stun Recovery', 'Small hybrids', false],
  ['LocalArmourAndEvasionAndStunRecovery', '% Armour and Evasion + Stun Recovery', 'Small hybrids', false],
  ['LocalArmourAndEnergyShieldAndStunRecovery', '% Armour and ES + Stun Recovery', 'Small hybrids', false],
  ['LocalEvasionAndEnergyShieldAndStunRecovery', '% Evasion and ES + Stun Recovery', 'Small hybrids', false],
  ['LocalArmourAndEvasionAndEnergyShieldAndStunRecovery', '% Armour, Evasion and ES + Stun Recovery', 'Small hybrids', false],
];

const spawnWeight = (m, tags) => {
  for (const w of m.spawn_weights || []) if (tags.has(w.tag)) return w.weight; // first match wins
  return 0;
};

// Trade ids per game stat, from RePoE's translations. A stat can map to several ids (e.g. Suppress has two).
const tradeIds = new Map(); // stat -> { explicit: Set, fractured: Set, text }
for (const t of translations) {
  if (t.ids.length !== 1 || !t.trade_stats) continue;
  const entry = tradeIds.get(t.ids[0]) || { explicit: new Set(), fractured: new Set(), text: null };
  for (const s of t.trade_stats) {
    if (s.type === 'explicit' || s.type === 'fractured') entry[s.type].add(s.id);
    if (s.type === 'explicit' && !entry.text) entry.text = s.text;
  }
  tradeIds.set(t.ids[0], entry);
}

const wanted = new Map([...TARGETS.map(([t]) => [t, 'suffix']), ...FRACTURES.map(([t]) => [t, 'prefix'])]);
const families = {}; // type -> { slot -> { def -> tiers } }
const statsOf = {}; // type -> [stat ids]
const others = {}; // slot -> stat -> { type -> max }
const slotDefs = {};
const slotBases = {};

for (const slot of SLOTS) {
  const released = Object.values(bases).filter((b) => b.item_class === slot.itemClass && b.domain === 'item' && b.release_state === 'released');
  slotDefs[slot.key] = DEFS.filter((d) => released.some((b) => b.tags.includes(d)));
  slotBases[slot.key] = released
    .filter((b) => b.tags.includes('top_tier_base_item_type'))
    .map((b) => ({ name: b.name, def: DEFS.find((d) => b.tags.includes(d)), level: b.drop_level }))
    .filter((b) => b.def)
    .sort((a, b) => DEFS.indexOf(a.def) - DEFS.indexOf(b.def) || a.level - b.level);

  for (const def of slotDefs[slot.key]) {
    const tags = new Set([slot.key, def, 'armour', 'top_tier_base_item_type', 'default']);
    for (const m of Object.values(mods)) {
      if (m.domain !== 'item' || m.is_essence_only) continue;
      if (m.generation_type !== 'prefix' && m.generation_type !== 'suffix') continue;
      if (spawnWeight(m, tags) <= 0) continue;
      const stats = m.stats.filter((s) => tradeIds.has(s.id));
      const affix = wanted.get(m.type);
      if (affix === m.generation_type) {
        statsOf[m.type] ||= m.stats.map((s) => s.id);
        const bySlot = (families[m.type] ||= {});
        const tiers = ((bySlot[slot.key] ||= {})[def] ||= []);
        tiers.push({ ilvl: m.required_level, v: statsOf[m.type].map((id) => {
          const s = m.stats.find((x) => x.id === id);
          return [s.min, s.max];
        }) });
      }
      for (const s of stats) {
        const byStat = ((others[slot.key] ||= {})[s.id] ||= {});
        byStat[m.type] ||= {};
        byStat[m.type][def] = Math.max(byStat[m.type][def] ?? -Infinity, s.max);
      }
    }
  }
}

// Tiers: T1 first (highest item level, then highest values).
for (const bySlot of Object.values(families))
  for (const byDef of Object.values(bySlot))
    for (const tiers of Object.values(byDef)) tiers.sort((a, b) => b.ilvl - a.ilvl || b.v[0][1] - a.v[0][1]);

const usedStats = new Set(Object.values(statsOf).flat());
const stats = {};
for (const id of usedStats) {
  const t = tradeIds.get(id);
  if (!t) continue;
  stats[id] = { text: t.text, explicit: [...t.explicit].sort(), fractured: [...t.fractured].sort() };
}
// Keep only the "other mods" index for stats the page filters on.
const competitors = {};
for (const [slot, byStat] of Object.entries(others)) {
  competitors[slot] = {};
  for (const id of usedStats) if (byStat[id]) competitors[slot][id] = byStat[id];
}

const pack = (list, extra) =>
  list
    .filter(([type]) => families[type])
    .map(([type, label, ...rest]) => ({ type, label, ...extra(rest), stats: statsOf[type], slots: families[type] }));

const result = {
  source: 'RePoE',
  patch,
  slots: SLOTS.map((s) => ({ ...s, defs: slotDefs[s.key], bases: slotBases[s.key] })),
  stats,
  targets: pack(TARGETS, () => ({})),
  fractures: pack(FRACTURES, ([group, on]) => ({ group, on })),
  competitors,
};
const missing = [...TARGETS, ...FRACTURES].filter(([t]) => !families[t]).map(([t]) => t);
const noTrade = [...usedStats].filter((id) => !stats[id] || !stats[id].explicit.length || !stats[id].fractured.length);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result) + '\n');
console.log(`patch ${patch}: ${result.targets.length} targets, ${result.fractures.length} fractures -> ${out}`);
if (missing.length) console.log('not found in RePoE:', missing.join(', '));
if (noTrade.length) console.log('stats without explicit/fractured trade ids:', noTrade.join(', '));
