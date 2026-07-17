-- WaveNova — Group Model Migration
-- v1.2 PRD: replaces flat weigh_sessions with groups + per-weigh sessions
--
-- STAGING SAFE: drops and recreates affected tables (members + events preserved)
-- Production: apply ALTER statements manually when ready

-- ── Drop old objects ─────────────────────────────────────────────────────────
DROP VIEW  IF EXISTS member_stats  CASCADE;
DROP VIEW  IF EXISTS event_summary CASCADE;
DROP TABLE IF EXISTS shadow_scans  CASCADE;
DROP TABLE IF EXISTS attendances   CASCADE;
DROP TABLE IF EXISTS weigh_sessions CASCADE;

-- ── Groups ───────────────────────────────────────────────────────────────────
CREATE TABLE groups (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid        REFERENCES events(id) NOT NULL,
  group_no   int         NOT NULL,              -- per-event sequential number (physical card)
  headcount  int         NOT NULL,              -- confirmed at first weigh-in
  is_shadow  boolean     NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE (event_id, group_no)
);

CREATE INDEX groups_event_idx ON groups(event_id);

-- ── Weigh Sessions ───────────────────────────────────────────────────────────
CREATE TABLE weigh_sessions (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid         REFERENCES groups(id) NOT NULL,
  station     text         NOT NULL DEFAULT 'A',
  weight_kg   numeric(7,2) NOT NULL,
  client_uuid text         UNIQUE NOT NULL,
  voided      boolean      NOT NULL DEFAULT false,
  created_at  timestamptz  DEFAULT now()
);

CREATE INDEX weigh_sessions_group_idx   ON weigh_sessions(group_id);
CREATE INDEX weigh_sessions_client_idx  ON weigh_sessions(client_uuid);

-- ── Attendances ──────────────────────────────────────────────────────────────
CREATE TABLE attendances (
  id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id             uuid         REFERENCES events(id)   NOT NULL,
  member_id            uuid         REFERENCES members(id),               -- null = companion without email
  registrant_member_id uuid         REFERENCES members(id)  NOT NULL,
  group_id             uuid         REFERENCES groups(id),
  luma_guest_key       text,                                              -- g- key from QR scan
  source               text         NOT NULL CHECK (source IN ('backfill','luma_sync','scan','manual')),
  checked_in           boolean      NOT NULL DEFAULT false,
  final_weight_kg      numeric(7,2) NOT NULL DEFAULT 0,                   -- written by finalize script
  created_at           timestamptz  DEFAULT now(),
  UNIQUE (event_id, member_id),
  UNIQUE (event_id, luma_guest_key)
);

CREATE INDEX attendances_event_idx      ON attendances(event_id);
CREATE INDEX attendances_member_idx     ON attendances(member_id);
CREATE INDEX attendances_registrant_idx ON attendances(registrant_member_id);
CREATE INDEX attendances_group_idx      ON attendances(group_id);
CREATE INDEX attendances_guest_key_idx  ON attendances(luma_guest_key);

-- ── Atomic group number assignment ──────────────────────────────────────────
-- Uses advisory lock on event_id hash to prevent duplicate group_no under
-- concurrent submissions (multiple stations or offline flush race).
CREATE OR REPLACE FUNCTION assign_group(
  p_event_id  uuid,
  p_headcount int,
  p_is_shadow boolean
) RETURNS TABLE(group_id uuid, group_no int) AS $$
DECLARE
  v_id uuid;
  v_no int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_event_id::text));

  SELECT COALESCE(MAX(g.group_no), 0) + 1
    INTO v_no
    FROM groups g
   WHERE g.event_id = p_event_id;

  INSERT INTO groups (event_id, group_no, headcount, is_shadow)
  VALUES (p_event_id, v_no, p_headcount, p_is_shadow)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_no;
END;
$$ LANGUAGE plpgsql;

-- ── Views ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW member_stats AS
SELECT
  m.id,
  m.email,
  m.name,
  COUNT(a.id)    FILTER (WHERE a.checked_in)             AS events_attended,
  COALESCE(SUM(a.final_weight_kg) FILTER (WHERE a.checked_in), 0) AS total_kg
FROM members m
LEFT JOIN attendances a ON a.member_id = m.id
GROUP BY m.id, m.email, m.name;

CREATE OR REPLACE VIEW event_summary AS
SELECT
  e.id,
  e.luma_event_id,
  e.code,
  e.name,
  e.event_date,
  e.location,
  COUNT(DISTINCT g.id) FILTER (WHERE NOT g.is_shadow)   AS group_count,
  COALESCE(SUM(g.headcount) FILTER (WHERE NOT g.is_shadow), 0) AS attendees,
  COALESCE((
    SELECT SUM(ws.weight_kg)
      FROM weigh_sessions ws
      JOIN groups g2 ON ws.group_id = g2.id
     WHERE g2.event_id = e.id AND NOT g2.is_shadow AND NOT ws.voided
  ), 0) AS total_kg
FROM events e
LEFT JOIN groups g ON g.event_id = e.id
GROUP BY e.id, e.luma_event_id, e.code, e.name, e.event_date, e.location;
