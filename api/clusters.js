// GET /api/clusters[?tm=current]
// Everything the Cluster Jewels page needs, read from Supabase's public.poe_* views (read-only, anon key),
// returned as one compact payload and cached at Vercel's edge for 10 minutes.
// Env: SUPABASE_URL, SUPABASE_KEY (publishable/anon key — read-only by RLS).

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_KEY;

async function rest(path) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!res.ok) throw new Error(`supabase ${res.status} for ${path.split('?')[0]}`);
  return res.json();
}

export default async function handler(req, res) {
  try {
    if (!URL_ || !KEY) throw new Error('SUPABASE_URL / SUPABASE_KEY not configured');
    const tm = new URL(req.url, 'http://x').searchParams.get('tm') || 'current';
    const [snapshots, status] = await Promise.all([
      rest('poe_build_snapshots?select=league,time_machine,snapshot_version,characters,captured_at&order=captured_at.desc&limit=200'),
      rest('poe_source_status?select=source,started_at,finished_at,status,error'),
    ]);
    const latest = snapshots.find((s) => s.time_machine === tm);
    if (!latest) {
      res.setHeader('Cache-Control', 'public, s-maxage=120');
      return res.status(200).json({ empty: true, timeMachine: tm, timeMachines: [...new Set(snapshots.map((s) => s.time_machine))], status });
    }
    const league = encodeURIComponent(latest.league);
    const [usage, trade, bases, currency, queries] = await Promise.all([
      rest(`poe_cluster_usage?select=size,enchant,combo_key,notables,build_count,share&snapshot_version=eq.${encodeURIComponent(latest.snapshot_version)}&time_machine=eq.${encodeURIComponent(tm)}&order=build_count.desc&limit=2000`),
      rest(`poe_latest_trade_prices?select=combo_key,ilvl_tier,listing_count,sample_n,min_chaos,p25_chaos,median_n_chaos,captured_at,search_id&league=eq.${league}`),
      rest(`poe_latest_base_prices?select=size,enchant,passives,ilvl_tier,chaos_value,listing_count,captured_at&league=eq.${league}&size=in.(Large,Medium)`),
      rest(`poe_latest_currency?select=name,chaos_value,captured_at&league=eq.${league}`),
      rest(`poe_trade_queries?select=combo_key,ilvl_tier,query&league=eq.${league}`),
    ]);
    const payload = {
      league: latest.league,
      timeMachine: tm,
      timeMachines: [...new Set(snapshots.map((s) => s.time_machine))],
      snapshot: { version: latest.snapshot_version, capturedAt: latest.captured_at, characters: latest.characters },
      usage: usage.map((u) => [u.size, u.enchant, u.notables, u.build_count, Number(u.share)]),
      trade: trade.map((t) => [t.combo_key, t.ilvl_tier, t.listing_count, t.sample_n, t.min_chaos, t.p25_chaos, t.median_n_chaos, t.captured_at, t.search_id]),
      bases: bases.map((b) => [b.size, b.enchant, b.passives, b.ilvl_tier, Number(b.chaos_value), b.listing_count]),
      currency: Object.fromEntries(currency.map((c) => [c.name, Number(c.chaos_value)])),
      queries: queries.map((q) => [q.combo_key, q.ilvl_tier, q.query?.query ?? null]),
      status,
    };
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    res.status(200).json(payload);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String(e.message || e) });
  }
}
