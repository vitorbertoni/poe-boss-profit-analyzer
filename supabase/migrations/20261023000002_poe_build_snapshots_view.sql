create view public.poe_build_snapshots with (security_invoker = on) as
select id, league, time_machine, snapshot_version, characters, captured_at from poe.build_snapshots;
grant select on public.poe_build_snapshots to anon, authenticated;
