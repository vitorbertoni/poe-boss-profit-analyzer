// Prices the most-used cluster combos on the official trade site (instant buyout listings only).
// Low volume: a fixed budget of searches per run, paced well under the announced rate limits, and a hard stop
// on the first 429 with the backoff persisted for the next run.
// Env: DATABASE_URL, LEAGUE (trade league id, default: league of the latest builds snapshot),
//      BUDGET (searches per run, default 40), TOP (combos to queue, default 30), TIERS (default "75,84"),
//      POESESSID (optional; the search API works without it).
import { readFileSync } from 'node:fs';
import { connect, startRun } from './lib/db.mjs';
import { reportError } from './lib/report.mjs';
import { TRADE, UA, indexStats, enchantOption, buildQuery, limiter, rateTable, summarize } from './lib/trade.mjs';

const clusterData = JSON.parse(readFileSync(new URL('../data/clusters/cluster-mods.json', import.meta.url), 'utf8'));
const BUDGET = Number(process.env.BUDGET || 40);
const TOP = Number(process.env.TOP || 30);
const TIERS = (process.env.TIERS || '75,84').split(',').map(Number);

class Stop extends Error {}

let sql;
let run;
try {
  sql = connect();
  run = await startRun(sql, 'trade-prices', { budget: BUDGET });

  const [state] = await sql`select backoff_until from poe.rate_limit_state where id = 'trade'`;
  if (state?.backoff_until && new Date(state.backoff_until) > new Date()) {
    await run.ok(0, { skipped: `backoff until ${new Date(state.backoff_until).toISOString()}` });
    console.log('in backoff, skipping');
    process.exit(0);
  }

  const [snap] = await sql`select id, league from poe.build_snapshots where time_machine = 'current' order by captured_at desc limit 1`;
  if (!snap) throw new Error('no builds snapshot yet — run ninja-builds first');
  const league = process.env.LEAGUE || snap.league;

  const headers = { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json' };
  if (process.env.POESESSID) headers.Cookie = `POESESSID=${process.env.POESESSID}`;
  const lim = limiter();
  let searches = 0;
  async function call(policy, url, init = {}) {
    await lim.before(policy);
    const res = await fetch(url, { ...init, headers });
    lim.after(policy, res.headers);
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after') || 1800);
      await sql`insert into poe.rate_limit_state (id, backoff_until, last_headers, updated_at)
        values ('trade', now() + make_interval(secs => ${retry}), ${sql.json(Object.fromEntries(res.headers))}, now())
        on conflict (id) do update set backoff_until = excluded.backoff_until, last_headers = excluded.last_headers, updated_at = now()`;
      throw new Stop(`429 from trade API; backing off ${retry}s`);
    }
    const type = res.headers.get('content-type') || '';
    if (!type.includes('json')) throw new Error(`trade API answered ${res.status} ${type} — likely a Cloudflare challenge for this runner IP`);
    const body = await res.json();
    if (!res.ok) throw new Error(`trade API ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    return body;
  }

  // 1. stat ids (one request) and currency rates (from poe.ninja rows we already store)
  const stats = indexStats(await call('trade-data', `${TRADE}/data/stats`));
  const rates = rateTable(await sql`select name, chaos_value from public.poe_latest_currency where league = ${league}`);
  if (!rates.divine) throw new Error(`no currency prices for ${league} — run ninja-prices first`);
  const enchants = new Map(Object.values(clusterData.sizes).flatMap((s) => s.enchants).map((e) => [e.tag, e]));

  // 2. refresh the queue from the latest snapshot (pairs only: those are the craft targets)
  const combos = await sql`select size, enchant, combo_key, notables, build_count from poe.cluster_usage
    where snapshot_id = ${snap.id} and cardinality(notables) = 2 order by build_count desc limit ${TOP}`;
  const queued = [];
  for (const c of combos) {
    const e = enchants.get(c.enchant);
    const opt = e && enchantOption(stats, e);
    const notableStats = c.notables.map((n) => stats.notables.get(n));
    if (opt == null || notableStats.some((x) => !x)) continue; // unknown on trade: skip, never guess
    for (const tier of TIERS) {
      queued.push({
        league, combo_key: c.combo_key, ilvl_tier: tier, priority: c.build_count,
        query: buildQuery({ size: c.size, enchantOption: opt, notableStats, tier }),
      });
    }
  }
  if (queued.length) {
    await sql`insert into poe.trade_queue ${sql(queued.map((q) => ({ ...q, query: sql.json(q.query) })), 'league', 'combo_key', 'ilvl_tier', 'query', 'priority')}
      on conflict (league, combo_key, ilvl_tier) do update set query = excluded.query, priority = excluded.priority`;
  }

  // 3. work the queue: never-checked first, then oldest
  const jobs = await sql`select combo_key, ilvl_tier, query from poe.trade_queue where league = ${league}
    order by last_checked nulls first, priority desc limit ${BUDGET}`;
  let written = 0;
  let stopped = null;
  try {
    for (const job of jobs) {
      searches++;
      const found = await call('trade-search', `${TRADE}/search/${encodeURIComponent(league)}`, { method: 'POST', body: JSON.stringify(job.query) });
      let listings = [];
      if (found.result?.length) {
        const ids = found.result.slice(0, 10).join(',');
        listings = (await call('trade-fetch', `${TRADE}/fetch/${ids}?query=${found.id}`)).result || [];
      }
      const s = summarize(listings, rates);
      await sql`insert into poe.trade_prices ${sql({ league, combo_key: job.combo_key, ilvl_tier: job.ilvl_tier, listing_count: found.total ?? 0, search_id: found.id ?? null, ...s })}`;
      await sql`update poe.trade_queue set last_checked = now(), last_status = ${'ok'} where league = ${league} and combo_key = ${job.combo_key} and ilvl_tier = ${job.ilvl_tier}`;
      written++;
    }
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    stopped = e.message; // rate limited: keep what we have, the persisted backoff pauses the next runs
  }
  await run.ok(written, { league, searches, queued: queued.length, ...(stopped ? { stopped } : {}) });
  console.log(`${league}: ${written} prices from ${searches} searches (${queued.length} queue entries)${stopped ? ` — ${stopped}` : ''}`);
} catch (e) {
  reportError(e);
  await run?.fail(e).catch(() => {});
  process.exitCode = 1;
} finally {
  await sql?.end().catch(() => {});
}
