// Cluster jewel notable usage from poe.ninja builds (low volume, test only).
// One aggregate search gives how many characters allocate each notable; one filtered search per top notable
// gives co-occurrence. Two notables that share an enchant and appear on the same character are counted as a
// combo on that enchant — an estimate, since poe.ninja's aggregate does not say which jewel a notable is on.
// Env: DATABASE_URL, LEAGUE_URL (default: current league's url, e.g. "allflame"), TIME_MACHINE (default "current"),
//      TOP_NOTABLES (default 40).
import { readFileSync } from 'node:fs';
import { connect, startRun } from './lib/db.mjs';
import { client, notableIndex, sharedEnchant, comboKey } from './lib/ninja-builds.mjs';
import { reportError } from './lib/report.mjs';

const clusterData = JSON.parse(readFileSync(new URL('../data/clusters/cluster-mods.json', import.meta.url), 'utf8'));
const TOP = Number(process.env.TOP_NOTABLES || 40);
const timeMachine = process.env.TIME_MACHINE || 'current';

let sql;
let run;
try {
  sql = connect();
  run = await startRun(sql, 'ninja-builds', { timeMachine });
  const ninja = client();

  const snap = await ninja.snapshot(process.env.LEAGUE_URL);
  if (timeMachine !== 'current' && !snap.timeMachineLabels.includes(timeMachine))
    throw new Error(`time machine "${timeMachine}" not offered; available: ${snap.timeMachineLabels.join(', ')}`);

  const base = await ninja.search(snap, { timeMachine });
  const dim = base.dimensions.keypassives;
  const hash = base.dictionaries[dim?.dict]?.[0];
  if (!dim || !hash) throw new Error('keypassives dimension or dictionary missing — format may have changed');
  const names = await ninja.dictionary(hash);
  const countByName = new Map([...dim.counts].map(([i, c]) => [names[i], c]));

  // Cluster notables present in the snapshot, most used first.
  const notables = notableIndex(clusterData)
    .map((n) => ({ ...n, count: countByName.get(n.name) || 0 }))
    .filter((n) => n.count > 0)
    .sort((a, b) => b.count - a.count);
  const top = [...new Map(notables.map((n) => [n.name, n])).values()].slice(0, TOP); // one filtered search per name

  const combos = new Map();
  const add = (size, enchant, list, count) => {
    const key = comboKey(size, enchant, list.map((n) => n.name));
    const prev = combos.get(key);
    if (!prev || prev.build_count < count)
      combos.set(key, { size, enchant, combo_key: key, notables: list.map((n) => n.name).sort(), build_count: count });
  };

  for (const a of top) {
    const sub = await ninja.search(snap, { timeMachine, keypassive: a.name });
    const co = new Map([...sub.dimensions.keypassives.counts].map(([i, c]) => [names[i], c]));
    for (const aSized of notables.filter((n) => n.name === a.name)) {
      // single-notable usage on its most likely enchant (useful for Medium jewels)
      const [bestTag] = [...aSized.enchants].sort((x, y) => y[1] - x[1])[0];
      add(aSized.size, bestTag, [aSized], aSized.count);
      for (const b of notables) {
        if (b.name === a.name || b.size !== aSized.size) continue;
        const both = co.get(b.name) || 0;
        if (!both) continue;
        const tag = sharedEnchant(aSized, b);
        if (tag) add(aSized.size, tag, [aSized, b], both);
      }
    }
  }

  const rows = [...combos.values()]
    .filter((c) => c.notables.length === 1 || c.build_count >= 5)
    .map((c) => ({ ...c, share: base.total ? c.build_count / base.total : 0 }));

  let written = 0;
  await sql.begin(async (tx) => {
    const [s] = await tx`insert into poe.build_snapshots (league, time_machine, snapshot_version, characters)
      values (${snap.name}, ${timeMachine}, ${snap.version}, ${base.total})
      on conflict (league, time_machine, snapshot_version) do update set characters = excluded.characters, captured_at = now()
      returning id`;
    await tx`delete from poe.cluster_usage where snapshot_id = ${s.id}`;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => ({ snapshot_id: s.id, ...r }));
      await tx`insert into poe.cluster_usage ${tx(chunk, 'snapshot_id', 'size', 'enchant', 'combo_key', 'notables', 'build_count', 'share')}`;
      written += chunk.length;
    }
  });
  await run.ok(written, { league: snap.name, version: snap.version, characters: base.total, notables: top.length, requests: ninja.requests });
  console.log(`${snap.name} ${timeMachine}: ${base.total} characters, ${top.length} notables searched, ${written} combos, ${ninja.requests} requests`);
} catch (e) {
  reportError(e);
  await run?.fail(e).catch(() => {});
  process.exitCode = 1;
} finally {
  await sql?.end().catch(() => {});
}
