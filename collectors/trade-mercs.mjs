// Samples Mercenary Warrant listings on the official trade site for the /mercenaries ranking.
// Each run: three price-band sweeps (newest listings overall, ≥ 1 div, ≥ 10 div) plus a rotating queue of one search
// per mercenary skill / support stat (Gilded supports first). Only listings not seen before are fetched.
// Same rate-limit discipline as trade-prices: paced under half the announced limits, hard stop + shared persisted
// backoff on 429. At the end the ranking aggregates are refreshed.
// Env: DATABASE_URL, LEAGUE (default: current softcore league on poe.ninja), SEARCHES (default 24),
//      FETCHES (default 48 batches of 10), PER_SEARCH (new listings to fetch per search, default 20), POESESSID (optional).
import { connect, startRun } from './lib/db.mjs';
import { reportError } from './lib/report.mjs';
import { NINJA, currentLeague, getJson } from './lib/ninja.mjs';
import { TRADE, UA, limiter, LongWait } from './lib/trade.mjs';
import { buildSearch, SWEEPS, parseRates, queueFromStats, parseListing } from './lib/mercs.mjs';

const SEARCHES = Number(process.env.SEARCHES || 24);
const FETCHES = Number(process.env.FETCHES || 48);
const PER_SEARCH = Number(process.env.PER_SEARCH || 20);

class Stop extends Error {}

let sql;
let run;
try {
  sql = connect();
  run = await startRun(sql, 'trade-mercs', { searches: SEARCHES, fetches: FETCHES });

  const [state] = await sql`select backoff_until from poe.rate_limit_state where id = 'trade'`;
  if (state?.backoff_until && new Date(state.backoff_until) > new Date()) {
    await run.ok(0, { skipped: `backoff until ${new Date(state.backoff_until).toISOString()}` });
    console.log('in backoff, skipping');
    process.exit(0);
  }

  const league = process.env.LEAGUE || (await currentLeague());
  const rates = parseRates(await getJson(`${NINJA}/economy/exchange/current/overview?league=${encodeURIComponent(league)}&type=Currency`));
  if (!rates.divine) throw new Error(`no Divine Orb rate on poe.ninja for ${league}`);

  const headers = { 'User-Agent': UA.replace('cluster-price-check', 'mercenary-warrants'), Accept: 'application/json', 'Content-Type': 'application/json' };
  if (process.env.POESESSID) headers.Cookie = `POESESSID=${process.env.POESESSID}`;
  const lim = limiter();
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

  // 1. queue: every mercenary skill/support stat the trade site knows (new ones appear with patches)
  const queue = queueFromStats(await call('trade-data', `${TRADE}/data/stats`), league);
  if (!queue.length) throw new Error('no "mercenary" stat group on the trade site — format changed?');
  const sweepRows = SWEEPS.map((s) => ({ league, stat_id: s.stat_id, label: s.label, kind: 'sweep', priority: 0 }));
  await sql`insert into poe.merc_queue ${sql([...queue, ...sweepRows], 'league', 'stat_id', 'label', 'kind', 'priority')}
    on conflict (league, stat_id) do update set label = excluded.label, kind = excluded.kind, priority = excluded.priority`;

  const jobs = [
    ...SWEEPS.map((s) => ({ stat_id: s.stat_id, query: buildSearch({ minChaos: s.minDiv ? s.minDiv * rates.divine : null }) })),
    ...(await sql`select stat_id from poe.merc_queue where league = ${league} and kind <> 'sweep'
      order by last_checked nulls first, priority desc limit ${Math.max(0, SEARCHES - SWEEPS.length)}`).map((j) => ({
      stat_id: j.stat_id,
      query: buildSearch({ stat: j.stat_id }),
    })),
  ];

  // 2. search, then fetch only listings we have not stored yet
  let searches = 0;
  let fetches = 0;
  let written = 0;
  let stopped = null;
  try {
    for (const job of jobs) {
      searches++;
      const found = await call('trade-search', `${TRADE}/search/${encodeURIComponent(league)}`, { method: 'POST', body: JSON.stringify(job.query) });
      await sql`update poe.merc_queue set last_checked = now(), last_total = ${found.total ?? 0}
        where league = ${league} and stat_id = ${job.stat_id}`;
      const ids = (found.result || []).slice(0, 100);
      if (!ids.length) continue;
      const known = new Set((await sql`select item_id from poe.merc_listings where league = ${league} and item_id = any(${ids})`).map((r) => r.item_id));
      if (known.size) await sql`update poe.merc_listings set last_seen = now() where league = ${league} and item_id = any(${[...known]})`;
      const fresh = ids.filter((id) => !known.has(id)).slice(0, PER_SEARCH);
      for (let i = 0; i < fresh.length && fetches < FETCHES; i += 10) {
        fetches++;
        const got = await call('trade-fetch', `${TRADE}/fetch/${fresh.slice(i, i + 10).join(',')}?query=${found.id}`);
        const rows = (got.result || []).map((r) => parseListing(r, { league, rates })).filter(Boolean);
        if (!rows.length) continue;
        await sql`insert into poe.merc_listings ${sql(rows.map((r) => ({ ...r, skills: sql.json(r.skills) })))}
          on conflict (league, item_id) do update set price_amount = excluded.price_amount, price_currency = excluded.price_currency,
            price_chaos = excluded.price_chaos, price_div = excluded.price_div, indexed_at = excluded.indexed_at, last_seen = now()`;
        written += rows.length;
      }
      if (fetches >= FETCHES) break;
    }
  } catch (e) {
    // 429: the persisted backoff pauses the next runs. LongWait: this IP's window is busy; the next run re-checks.
    if (!(e instanceof Stop) && !(e instanceof LongWait)) throw e;
    stopped = e.message;
  }

  // 3. refresh the ranking aggregates (also when stopped early: what was stored is still good)
  await sql`refresh materialized view concurrently poe.merc_feature_stats`;
  await sql`refresh materialized view concurrently poe.merc_sample`;

  await run.ok(written, { league, searches, fetches, ...(stopped ? { stopped } : {}) });
  console.log(`${league}: ${written} new warrant listings from ${searches} searches / ${fetches} fetches${stopped ? ` — ${stopped}` : ''}`);
} catch (e) {
  if (e instanceof Stop || e instanceof LongWait) {
    console.log(e.message);
    await run?.ok(0, { stopped: e.message }).catch(() => {});
  } else {
    reportError(e);
    await run?.fail(e).catch(() => {});
    process.exitCode = 1;
  }
} finally {
  await sql?.end().catch(() => {});
}
