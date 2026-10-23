#!/usr/bin/env node
// Builds data/clusters/cluster-mods.json from a RePoE export (https://github.com/repoe-fork/repoe-fork.github.io).
// Usage: node tools/build-cluster-data.mjs <repoe data dir> [out file]
// The data dir must hold cluster_jewels.json and mods.json (English export, top-level `data/`).
// Only Large and Medium cluster jewels are kept (MVP scope); Small enchants are skipped.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [, , dir, out = 'data/clusters/cluster-mods.json'] = process.argv;
if (!dir) {
  console.error('usage: node tools/build-cluster-data.mjs <repoe data dir> [out file]');
  process.exit(1);
}

const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const clusters = read('cluster_jewels.json');
const mods = read('mods.json');
let patch = 'unknown';
try {
  patch = readFileSync(join(dir, '..', 'exported-version.txt'), 'utf8').trim();
} catch {}

const SIZES = ['Large', 'Medium'];
const SIZE_TAGS = ['expansion_jewel_large', 'expansion_jewel_medium']; // base item tags
const sizes = {};
const enchantSize = new Map(); // enchant tag -> size
for (const c of Object.values(clusters)) {
  if (!SIZES.includes(c.size)) continue;
  sizes[c.size] = {
    minPassives: c.min_skills,
    maxPassives: c.max_skills,
    enchants: c.passive_skills
      .map((s) => ({ tag: s.tag, id: s.id, name: s.name, text: s.stat_text }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
  for (const s of c.passive_skills) enchantSize.set(s.tag, c.size);
}

const NOTABLE_RE = /^1 Added Passive Skill is (.+)$/;
const out_mods = [];
for (const [id, m] of Object.entries(mods)) {
  if (m.domain !== 'affliction_jewel') continue;
  if (m.generation_type !== 'prefix' && m.generation_type !== 'suffix') continue;
  const weights = {};
  for (const w of m.spawn_weights || []) if (!(w.tag in weights)) weights[w.tag] = w.weight; // first match wins
  // Keep a mod if it can spawn on a Large/Medium base: through an enchant tag, the base tag, or default.
  const tags = Object.entries(weights).filter(([, w]) => w > 0).map(([t]) => t);
  const relevant = tags.some((t) => t === 'default' || SIZE_TAGS.includes(t) || SIZES.includes(enchantSize.get(t)));
  if (!relevant) continue;
  const genWeights = {};
  for (const w of m.generation_weights || []) if (!(w.tag in genWeights)) genWeights[w.tag] = w.weight;
  const notable = NOTABLE_RE.exec(m.text || '');
  out_mods.push({
    id,
    type: m.type,
    groups: m.groups,
    affix: m.generation_type,
    ilvl: m.required_level,
    text: m.text,
    notable: notable ? notable[1] : null,
    weights,
    ...(Object.keys(genWeights).length ? { generationWeights: genWeights } : {}),
    ...(m.adds_tags?.length ? { addsTags: m.adds_tags } : {}),
  });
}
out_mods.sort((a, b) => a.id.localeCompare(b.id));

const result = { source: 'RePoE', patch, sizes, mods: out_mods };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
console.log(`patch ${patch}: ${out_mods.length} mods (${out_mods.filter((m) => m.notable).length} notables) -> ${out}`);
