-- Mercenary Warrants: sampled trade listings and the aggregates behind the /mercenaries ranking.
-- Written by collectors/trade-mercs.mjs (GitHub Actions, DATABASE_URL). The site only reads the public.poe_merc_* views.
-- A warrant's gear is re-rolled on use, so its value is its class (build), level, skills and supports.

create table poe.merc_listings (
  league         text not null,
  item_id        text not null,                      -- trade item id (stable while the listing is up)
  seller         text not null,                      -- sha-256 of the account name; only used to collapse bulk sellers
  build          text not null,                      -- mercenary class without the "Infamous " prefix
  infamous       boolean not null,
  merc_name      text,
  level          smallint,
  price_amount   numeric not null,
  price_currency text not null,                      -- trade currency id (chaos, divine, chrome, ...)
  price_chaos    numeric,                            -- converted with poe.ninja exchange rates at capture time
  price_div      numeric,                            -- price_chaos / chaos-per-divine at capture time
  skills         jsonb not null,                     -- [{name, supports: [{name, tier}]}]
  indexed_at     timestamptz,                        -- when the trade site (re)indexed the listing
  first_seen     timestamptz not null default now(),
  last_seen      timestamptz not null default now(),
  primary key (league, item_id)
);
create index merc_listings_recent on poe.merc_listings (league, indexed_at desc);

-- Rotating targeted searches: one per mercenary skill / support stat on the trade site, plus price-band sweeps.
create table poe.merc_queue (
  league       text not null,
  stat_id      text not null,                        -- mercenary.skill_N | mercenary.support_N | sweep:<band>
  label        text not null,                        -- trade text, e.g. "Gilded Heft (Tier 3)"
  kind         text not null check (kind in ('skill', 'support', 'sweep')),
  priority     numeric not null default 0,
  last_checked timestamptz,
  last_total   integer,                              -- listings the trade site reported for this search (supply)
  primary key (league, stat_id)
);
create index merc_queue_next on poe.merc_queue (league, last_checked nulls first, priority desc);

alter table poe.merc_listings enable row level security;
alter table poe.merc_queue enable row level security;
-- No grants on merc_listings: the site reads aggregates only (no per-listing data, no seller hashes).

-- ---------- aggregates (materialized; refreshed by the collector at the end of each run) ----------

-- One row per (league, feature) over listings indexed in the last 7 days. Each (seller, price) is counted once per
-- feature, so a bulk seller listing 50 warrants at the same price counts as one observation.
create materialized view poe.merc_feature_stats as
with recent as (
  select * from poe.merc_listings
  where indexed_at > now() - interval '7 days' and price_div > 0
),
feats as (
  select league, seller, price_div, 'all'::text as kind, 'All warrants'::text as feature from recent
  union all
  select league, seller, price_div, 'class', build from recent
  union all
  select league, seller, price_div, 'infamous', case when infamous then 'Infamous' else 'Not infamous' end from recent
  union all
  select league, seller, price_div, 'level', 'Level ' || level from recent where level is not null
  union all
  select r.league, r.seller, r.price_div, 'skill', s ->> 'name'
  from recent r, jsonb_array_elements(r.skills) s
  union all
  select r.league, r.seller, r.price_div, 'support',
         (sp ->> 'name') || coalesce(' (Tier ' || (sp ->> 'tier') || ')', '')
  from recent r, jsonb_array_elements(r.skills) s, jsonb_array_elements(coalesce(s -> 'supports', '[]'::jsonb)) sp
),
dedup as (
  select distinct league, seller, price_div, kind, feature from feats
)
select league, kind, feature,
       count(*)::int                                                  as observations,
       count(distinct seller)::int                                    as sellers,
       percentile_cont(0.25) within group (order by price_div)        as p25_div,
       percentile_cont(0.5)  within group (order by price_div)        as median_div,
       percentile_cont(0.75) within group (order by price_div)        as p75_div
from dedup
group by league, kind, feature;
create unique index merc_feature_stats_key on poe.merc_feature_stats (league, kind, feature);

-- Sample size and freshness for the page header.
create materialized view poe.merc_sample as
select league,
       count(*) filter (where indexed_at > now() - interval '7 days')::int as listings_7d,
       count(distinct seller) filter (where indexed_at > now() - interval '7 days')::int as sellers_7d,
       count(*)::int as listings_total,
       max(last_seen) as last_capture
from poe.merc_listings
group by league;
create unique index merc_sample_key on poe.merc_sample (league);

-- ---------- access + read-only views for the site ----------
grant select on poe.merc_feature_stats, poe.merc_sample to anon, authenticated;
-- Supply per trade stat (listings the last targeted search reported) and the stat id, for trade links.
grant select (league, stat_id, label, kind, last_total, last_checked) on poe.merc_queue to anon, authenticated;
create policy "public read" on poe.merc_queue for select to anon, authenticated using (true);

create view public.poe_merc_feature_stats with (security_invoker = on) as
select league, kind, feature, observations, sellers, p25_div, median_div, p75_div from poe.merc_feature_stats;

create view public.poe_merc_sample with (security_invoker = on) as
select league, listings_7d, sellers_7d, listings_total, last_capture from poe.merc_sample;

create view public.poe_merc_supply with (security_invoker = on) as
select league, stat_id, label, kind, last_total, last_checked from poe.merc_queue where kind in ('skill', 'support');

grant select on public.poe_merc_feature_stats, public.poe_merc_sample, public.poe_merc_supply to anon, authenticated;
