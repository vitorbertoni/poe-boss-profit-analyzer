-- Cluster Jewel Analyzer: storage for collectors (GitHub Actions) and read-only views for the site.
-- Writers connect to Postgres directly (DATABASE_URL secret). The site reads the public.poe_* views
-- with the publishable/anon key; base tables stay in the unexposed `poe` schema.

create schema if not exists poe;

-- One row per collector run, so the UI can show how fresh each source is.
create table poe.source_runs (
  id           bigserial primary key,
  source       text not null,                       -- ninja-builds | ninja-prices | trade-prices | repoe-sync
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running' check (status in ('running', 'ok', 'error')),
  rows_written integer not null default 0,
  error        text,
  meta         jsonb not null default '{}'::jsonb
);
create index source_runs_source_started on poe.source_runs (source, started_at desc);

-- poe.ninja builds snapshots (league + time machine key).
create table poe.build_snapshots (
  id               bigserial primary key,
  league           text not null,
  time_machine     text not null default 'current',  -- current | day-N | week-N
  snapshot_version text not null,
  characters       integer not null default 0,
  captured_at      timestamptz not null default now(),
  unique (league, time_machine, snapshot_version)
);

-- Aggregated notable combos per snapshot.
create table poe.cluster_usage (
  snapshot_id bigint not null references poe.build_snapshots (id) on delete cascade,
  size        text not null check (size in ('Large', 'Medium')),
  enchant     text not null,
  combo_key   text not null,                         -- size|enchant|notableA+notableB (sorted)
  notables    text[] not null,
  build_count integer not null,
  share       numeric not null,                      -- build_count / characters in the snapshot
  primary key (snapshot_id, combo_key)
);

-- poe.ninja currency (Alteration, Augmentation, Regal, Divine, ...).
create table poe.currency_prices (
  league      text not null,
  item_id     text not null,
  name        text not null,
  chaos_value numeric not null,
  volume      numeric,
  captured_at timestamptz not null default now(),
  primary key (league, item_id, captured_at)
);

-- poe.ninja white cluster base prices.
create table poe.base_prices (
  league        text not null,
  size          text not null check (size in ('Large', 'Medium', 'Small')),
  enchant       text not null,
  passives      smallint not null,
  ilvl_tier     smallint not null,                   -- 1 | 50 | 68 | 75 | 84
  chaos_value   numeric not null,
  listing_count integer,
  captured_at   timestamptz not null default now(),
  primary key (league, size, enchant, passives, ilvl_tier, captured_at)
);

-- Trade site buyout prices (instant buyout listings only).
create table poe.trade_prices (
  league         text not null,
  combo_key      text not null,
  ilvl_tier      smallint not null,
  listing_count  integer not null,
  sample_n       integer not null,
  min_chaos      numeric,
  p25_chaos      numeric,
  median_n_chaos numeric,
  captured_at    timestamptz not null default now(),
  primary key (league, combo_key, ilvl_tier, captured_at)
);

-- Work queue for the trade worker; never exposed to the site.
create table poe.trade_queue (
  league       text not null,
  combo_key    text not null,
  ilvl_tier    smallint not null,
  query        jsonb not null,
  priority     numeric not null default 0,
  last_checked timestamptz,
  last_status  text,
  primary key (league, combo_key, ilvl_tier)
);
create index trade_queue_next on poe.trade_queue (league, last_checked nulls first, priority desc);

-- Persisted trade rate-limit backoff so the next run also waits.
create table poe.rate_limit_state (
  id            text primary key default 'trade',
  backoff_until timestamptz,
  last_headers  jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now()
);

-- ---------- access ----------
alter table poe.source_runs      enable row level security;
alter table poe.build_snapshots  enable row level security;
alter table poe.cluster_usage    enable row level security;
alter table poe.currency_prices  enable row level security;
alter table poe.base_prices      enable row level security;
alter table poe.trade_prices     enable row level security;
alter table poe.trade_queue      enable row level security;
alter table poe.rate_limit_state enable row level security;

grant usage on schema poe to anon, authenticated;
grant select on poe.source_runs, poe.build_snapshots, poe.cluster_usage, poe.currency_prices,
  poe.base_prices, poe.trade_prices to anon, authenticated;

create policy "public read" on poe.source_runs     for select to anon, authenticated using (true);
create policy "public read" on poe.build_snapshots for select to anon, authenticated using (true);
create policy "public read" on poe.cluster_usage   for select to anon, authenticated using (true);
create policy "public read" on poe.currency_prices for select to anon, authenticated using (true);
create policy "public read" on poe.base_prices     for select to anon, authenticated using (true);
create policy "public read" on poe.trade_prices    for select to anon, authenticated using (true);
-- trade_queue and rate_limit_state: RLS on, no policies, no grants -> invisible to the site.

-- ---------- read-only views for the site (latest value per key) ----------
create view public.poe_source_status with (security_invoker = on) as
select distinct on (source) source, started_at, finished_at, status, rows_written, error
from poe.source_runs
order by source, started_at desc;

create view public.poe_cluster_usage with (security_invoker = on) as
select s.league, s.time_machine, s.snapshot_version, s.captured_at, s.characters,
       u.size, u.enchant, u.combo_key, u.notables, u.build_count, u.share
from poe.cluster_usage u
join poe.build_snapshots s on s.id = u.snapshot_id;

create view public.poe_latest_currency with (security_invoker = on) as
select distinct on (league, item_id) league, item_id, name, chaos_value, volume, captured_at
from poe.currency_prices
order by league, item_id, captured_at desc;

create view public.poe_latest_base_prices with (security_invoker = on) as
select distinct on (league, size, enchant, passives, ilvl_tier)
       league, size, enchant, passives, ilvl_tier, chaos_value, listing_count, captured_at
from poe.base_prices
order by league, size, enchant, passives, ilvl_tier, captured_at desc;

create view public.poe_latest_trade_prices with (security_invoker = on) as
select distinct on (league, combo_key, ilvl_tier)
       league, combo_key, ilvl_tier, listing_count, sample_n, min_chaos, p25_chaos, median_n_chaos, captured_at
from poe.trade_prices
order by league, combo_key, ilvl_tier, captured_at desc;

grant select on public.poe_source_status, public.poe_cluster_usage, public.poe_latest_currency,
  public.poe_latest_base_prices, public.poe_latest_trade_prices to anon, authenticated;
