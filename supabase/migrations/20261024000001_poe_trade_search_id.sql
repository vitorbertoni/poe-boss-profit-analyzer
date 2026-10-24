-- Keep the trade site's search id so the page can link to /trade/search/<league>/<id>, the site's own share format.
alter table poe.trade_prices add column if not exists search_id text;
create or replace view public.poe_latest_trade_prices with (security_invoker = on) as
select distinct on (league, combo_key, ilvl_tier)
       league, combo_key, ilvl_tier, listing_count, sample_n, min_chaos, p25_chaos, median_n_chaos, captured_at, search_id
from poe.trade_prices
order by league, combo_key, ilvl_tier, captured_at desc;
