-- WaveNova Cleanup Loyalty Program — Initial Schema
-- Run in Supabase SQL Editor (landing-production project)
-- 2026-07-15

-- ── 1. Members ──────────────────────────────────────────────────────────────
create table if not exists members (
  id              uuid primary key default gen_random_uuid(),
  email           text unique not null,      -- normalized: lowercase + trim
  name            text,
  luma_user_id    text,                      -- Luma user_api_id for dedup
  created_at      timestamptz default now()
);

create index if not exists members_email_idx      on members(email);
create index if not exists members_luma_user_idx  on members(luma_user_id);

-- ── 2. Events ───────────────────────────────────────────────────────────────
create table if not exists events (
  id              uuid primary key default gen_random_uuid(),
  luma_event_id   text unique,               -- null for CSV-only historical events
  code            text,                      -- e.g. '0.16'
  name            text not null,
  event_date      date not null,
  location        text,
  synced_at       timestamptz,               -- last guest list sync time
  created_at      timestamptz default now()
);

create index if not exists events_luma_event_idx  on events(luma_event_id);
create index if not exists events_date_idx         on events(event_date);

-- ── 3. Weigh Sessions ───────────────────────────────────────────────────────
-- Created BEFORE attendances because attendances FKs into this table
create table if not exists weigh_sessions (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid references events(id) not null,
  station         text not null,             -- 'A' / 'B' / 'C'
  total_weight_kg numeric(7,2) not null,
  headcount       int not null,
  client_uuid     text unique not null,      -- front-end generated, idempotency key
  shadow          boolean not null default false,
  created_at      timestamptz default now()
);

create index if not exists weigh_sessions_event_idx on weigh_sessions(event_id);

-- ── 4. Attendances ──────────────────────────────────────────────────────────
create table if not exists attendances (
  id                    uuid primary key default gen_random_uuid(),
  event_id              uuid references events(id) not null,
  member_id             uuid references members(id),           -- null = companion without email
  registrant_member_id  uuid references members(id) not null,  -- who registered (self = same as member_id)
  luma_guest_key        text,                                  -- g- prefixed pk from QR scan
  source                text not null check (source in ('backfill','luma_sync','scan','manual')),
  checked_in            boolean not null default false,
  weight_kg             numeric(7,2) not null default 0,
  weigh_session_id      uuid references weigh_sessions(id),
  created_at            timestamptz default now(),
  unique (event_id, member_id),        -- same person can't attend same event twice
  unique (event_id, luma_guest_key)    -- same QR key can't be scanned twice per event
);

create index if not exists attendances_event_idx      on attendances(event_id);
create index if not exists attendances_member_idx     on attendances(member_id);
create index if not exists attendances_registrant_idx on attendances(registrant_member_id);
create index if not exists attendances_guest_key_idx  on attendances(luma_guest_key);

-- ── 5. Shadow Scans ─────────────────────────────────────────────────────────
-- Isolated table for 7/18 shadow test — NEVER mixed into official stats
create table if not exists shadow_scans (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid references events(id) not null,
  luma_guest_key  text,
  resolved_name   text,
  resolved_email  text,
  total_weight_kg numeric(7,2),
  headcount       int,
  station         text,
  client_uuid     text unique not null,
  notes           text,
  created_at      timestamptz default now()
);

create index if not exists shadow_scans_event_idx on shadow_scans(event_id);

-- ── 6. Useful Views ─────────────────────────────────────────────────────────

-- Member stats: attendance count + total kg (for member dashboard / API)
create or replace view member_stats as
select
  m.id,
  m.email,
  m.name,
  count(a.id) filter (where a.checked_in)             as events_attended,
  coalesce(sum(a.weight_kg) filter (where a.checked_in), 0) as total_kg,
  count(a.id) filter (where a.registrant_member_id = m.id and (a.member_id is null or a.member_id != m.id)) as companions_brought
from members m
left join attendances a on a.member_id = m.id
group by m.id, m.email, m.name;

-- Event summary: headcount + total kg per event
create or replace view event_summary as
select
  e.id,
  e.luma_event_id,
  e.code,
  e.name,
  e.event_date,
  e.location,
  count(distinct a.member_id) filter (where a.checked_in) as attendees,
  coalesce(sum(a.weight_kg), 0)                            as total_kg
from events e
left join attendances a on a.event_id = e.id
group by e.id, e.luma_event_id, e.code, e.name, e.event_date, e.location;
