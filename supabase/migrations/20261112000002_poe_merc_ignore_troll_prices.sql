-- Leave placeholder / troll asking prices out of the warrant aggregates: anything priced in Mirrors or above
-- 1000 divines (the first sample had a dozen of these). They stay in merc_listings, only the ranking ignores them.
drop view public.poe_merc_feature_stats;
drop materialized view poe.merc_feature_stats;

create materialized view poe.merc_feature_stats as
with recent as (
  select * from poe.merc_listings
  where indexed_at > now() - interval '7 days'
    and price_div > 0 and price_div <= 1000 and price_currency <> 'mirror'
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
grant select on poe.merc_feature_stats to anon, authenticated;

create view public.poe_merc_feature_stats with (security_invoker = on) as
select league, kind, feature, observations, sellers, p25_div, median_div, p75_div from poe.merc_feature_stats;
grant select on public.poe_merc_feature_stats to anon, authenticated;
