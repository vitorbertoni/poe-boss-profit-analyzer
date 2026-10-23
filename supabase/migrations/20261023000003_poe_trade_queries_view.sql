-- Expose the trade search behind each price so the page can link to it (column grant: query fields only).
grant select (league, combo_key, ilvl_tier, query) on poe.trade_queue to anon, authenticated;
create policy "public read queries" on poe.trade_queue for select to anon, authenticated using (true);
create view public.poe_trade_queries with (security_invoker = on) as
select league, combo_key, ilvl_tier, query from poe.trade_queue;
grant select on public.poe_trade_queries to anon, authenticated;
