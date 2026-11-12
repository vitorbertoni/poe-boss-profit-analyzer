// GET /api/mercs[?league=Name]
// Mercenary Warrant ranking: per-feature price stats (class, infamous, level, skill, support) over listings indexed in
// the last 7 days, supply per trade stat, and sample size. Read from Supabase's public.poe_merc_* views (anon key,
// aggregates only) and cached at Vercel's edge for 10 minutes.
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
    const [samples, status] = await Promise.all([
      rest('poe_merc_sample?select=league,listings_7d,sellers_7d,listings_total,last_capture&order=last_capture.desc'),
      rest('poe_source_status?select=source,started_at,finished_at,status,error&source=eq.trade-mercs'),
    ]);
    const wanted = new URL(req.url, 'http://x').searchParams.get('league');
    const sample = samples.find((s) => s.league === wanted) || samples[0];
    if (!sample) {
      res.setHeader('Cache-Control', 'public, s-maxage=120');
      return res.status(200).json({ empty: true, status: status[0] ?? null });
    }
    const league = encodeURIComponent(sample.league);
    const [features, supply, divine] = await Promise.all([
      rest(`poe_merc_feature_stats?select=kind,feature,observations,sellers,p25_div,median_div,p75_div&league=eq.${league}&limit=5000`),
      rest(`poe_merc_supply?select=stat_id,label,kind,last_total,last_checked&league=eq.${league}&limit=2000`),
      rest(`poe_latest_currency?select=chaos_value&league=eq.${league}&name=eq.Divine%20Orb`),
    ]);
    const r3 = (v) => (v == null ? null : Math.round(Number(v) * 1000) / 1000);
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    res.status(200).json({
      league: sample.league,
      leagues: samples.map((s) => s.league),
      sample: { listings7d: sample.listings_7d, sellers7d: sample.sellers_7d, total: sample.listings_total, lastCapture: sample.last_capture },
      chaosPerDivine: divine[0] ? Number(divine[0].chaos_value) : null,
      // [kind, feature, observations, sellers, p25, median, p75] — prices in divines
      features: features.map((f) => [f.kind, f.feature, f.observations, f.sellers, r3(f.p25_div), r3(f.median_div), r3(f.p75_div)]),
      // [trade text, stat id, listings on trade at last check, checked at]
      supply: supply.map((s) => [s.label, s.stat_id, s.last_total, s.last_checked]),
      status: status[0] ?? null,
    });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String(e.message || e) });
  }
}
