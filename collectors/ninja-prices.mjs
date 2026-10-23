// Collects craft currency prices and white cluster base prices from poe.ninja's documented economy API.
// Env: DATABASE_URL (required), LEAGUE (optional, defaults to the current softcore league).
import { connect, startRun } from './lib/db.mjs';
import { NINJA, currentLeague, getJson, parseCurrency, parseBases } from './lib/ninja.mjs';

const sql = connect();
const run = await startRun(sql, 'ninja-prices');
try {
  const league = process.env.LEAGUE || (await currentLeague());
  const q = `league=${encodeURIComponent(league)}`;
  const [cur, clusters] = await Promise.all([
    getJson(`${NINJA}/economy/exchange/current/overview?${q}&type=Currency`),
    getJson(`${NINJA}/economy/stash/current/item/overview?${q}&type=ClusterJewel`),
  ]);
  const currency = parseCurrency(cur, league);
  const bases = parseBases(clusters, league);
  if (!currency.some((r) => r.name === 'Divine Orb')) throw new Error('Divine Orb missing from exchange overview');
  if (!bases.length) throw new Error('no cluster bases parsed — poe.ninja format may have changed');

  // The overview can list the same key twice (e.g. corrupted vs not); keep the cheapest.
  const dedup = new Map();
  for (const r of bases) {
    const k = [r.size, r.enchant, r.passives, r.ilvl_tier].join('|');
    if (!dedup.has(k) || dedup.get(k).chaos_value > r.chaos_value) dedup.set(k, r);
  }
  const baseRows = [...dedup.values()];

  const now = new Date();
  await sql.begin(async (tx) => {
    await tx`insert into poe.currency_prices ${tx(currency.map((r) => ({ ...r, captured_at: now })))}`;
    await tx`insert into poe.base_prices ${tx(baseRows.map((r) => ({ ...r, captured_at: now })))}`;
  });
  await run.ok(currency.length + baseRows.length, { league, currency: currency.length, bases: baseRows.length });
  console.log(`${league}: ${currency.length} currency rows, ${baseRows.length} base rows`);
} catch (e) {
  await run.fail(e);
  console.error(e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
