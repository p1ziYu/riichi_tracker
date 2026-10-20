-- 数据库设计 v1.3 §3.2 (guest_sessions, member_access_grants, guest_recovery), §4 (matches,
-- members, seats, seat assignments, devices).
-- Every intra-match reference uses a composite FK on (match_id, ...) against a
-- UNIQUE (match_id, id) target so rows from another match cannot be linked.
-- Seats are numbered 0..player_count-1; seat 0 starts as East.

SET LOCAL search_path TO app, public;

CREATE TABLE matches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_principal_id uuid NOT NULL REFERENCES principals (id),
  cohost_member_id   uuid NULL,          -- FK added below (needs match_members)
  player_count       smallint NOT NULL CHECK (player_count IN (3, 4)),
  -- NULL for table-only adjustments; rules_snapshot/rules_hash are always the settlement basis.
  ruleset_version_id uuid NULL,
  rules_snapshot     jsonb NOT NULL CHECK (jsonb_typeof(rules_snapshot) = 'object'),
  rules_hash         text NOT NULL,
  engine_version     text NOT NULL,
  state              text NOT NULL DEFAULT 'preparing'
                       CHECK (state IN ('preparing', 'active', 'finished', 'abandoned')),
  -- Equals the latest committed match_events.seq.
  version            bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  current_hand_id    uuid NULL,          -- FK added in 005 (needs hands)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz NULL,
  ended_at           timestamptz NULL,
  CONSTRAINT fk_matches_ruleset_version FOREIGN KEY (ruleset_version_id, player_count)
    REFERENCES ruleset_versions (id, player_count) ON DELETE SET NULL (ruleset_version_id),
  CONSTRAINT uq_matches_id_player_count UNIQUE (id, player_count),
  CONSTRAINT ck_matches_started CHECK (state = 'preparing' OR state = 'abandoned' OR started_at IS NOT NULL),
  CONSTRAINT ck_matches_ended CHECK (ended_at IS NULL OR (started_at IS NOT NULL AND ended_at >= started_at))
);
CREATE INDEX ix_matches_owner_started ON matches (owner_principal_id, started_at DESC);
CREATE INDEX ix_matches_state_updated ON matches (state, updated_at);

CREATE TRIGGER tg_matches_updated_at
  BEFORE UPDATE ON matches
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Rules are frozen once the match leaves 'preparing'.
CREATE FUNCTION app.matches_rules_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'preparing'
     AND (NEW.rules_snapshot IS DISTINCT FROM OLD.rules_snapshot
          OR NEW.rules_hash IS DISTINCT FROM OLD.rules_hash
          OR NEW.engine_version IS DISTINCT FROM OLD.engine_version
          OR NEW.player_count IS DISTINCT FROM OLD.player_count
          OR (NEW.ruleset_version_id IS DISTINCT FROM OLD.ruleset_version_id
              AND NEW.ruleset_version_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'match % rules are frozen after start', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tg_matches_rules_frozen
  BEFORE UPDATE ON matches
  FOR EACH ROW EXECUTE FUNCTION app.matches_rules_frozen();

CREATE TABLE match_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id     uuid NOT NULL REFERENCES matches (id),
  principal_id uuid NOT NULL REFERENCES principals (id),
  role         text NOT NULL CHECK (role IN ('participant', 'spectator')),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left', 'removed')),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  removed_at   timestamptz NULL,
  CONSTRAINT uq_match_members_principal UNIQUE (match_id, principal_id),
  CONSTRAINT uq_match_members_match_id UNIQUE (match_id, id),
  CONSTRAINT ck_match_members_removed CHECK ((status = 'active') = (removed_at IS NULL))
);
CREATE INDEX ix_match_members_principal ON match_members (principal_id, status, match_id);

ALTER TABLE matches
  ADD CONSTRAINT fk_matches_cohost FOREIGN KEY (id, cohost_member_id)
    REFERENCES match_members (match_id, id);

CREATE TABLE match_seats (
  match_id     uuid NOT NULL,
  seat_no      smallint NOT NULL,
  player_count smallint NOT NULL,
  initial_wind text NOT NULL CHECK (initial_wind IN ('E', 'S', 'W', 'N')),
  PRIMARY KEY (match_id, seat_no),
  CONSTRAINT fk_match_seats_match FOREIGN KEY (match_id, player_count)
    REFERENCES matches (id, player_count),
  CONSTRAINT uq_match_seats_wind UNIQUE (match_id, initial_wind),
  CONSTRAINT ck_match_seats_range CHECK (seat_no >= 0 AND seat_no < player_count),
  CONSTRAINT ck_match_seats_wind CHECK (player_count = 4 OR initial_wind <> 'N')
);

-- Occupancy interval [start_hand_no, end_hand_no); NULL end = still seated.
-- Seat swaps only happen between hands; past hands keep the old assignment.
CREATE TABLE seat_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id      uuid NOT NULL,
  seat_no       smallint NOT NULL,
  member_id     uuid NOT NULL,
  start_hand_no integer NOT NULL CHECK (start_hand_no >= 0),
  end_hand_no   integer NULL,
  confirmed_by  uuid NULL REFERENCES principals (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_seat_assignments_seat FOREIGN KEY (match_id, seat_no)
    REFERENCES match_seats (match_id, seat_no),
  CONSTRAINT fk_seat_assignments_member FOREIGN KEY (match_id, member_id)
    REFERENCES match_members (match_id, id),
  CONSTRAINT ck_seat_assignments_interval CHECK (end_hand_no IS NULL OR end_hand_no > start_hand_no),
  CONSTRAINT uq_seat_assignments_match_id UNIQUE (match_id, id),
  -- Targets letting dependants pin the assignment's seat or member as well.
  CONSTRAINT uq_seat_assignments_match_id_seat UNIQUE (match_id, id, seat_no),
  CONSTRAINT uq_seat_assignments_match_id_member UNIQUE (match_id, id, member_id),
  -- Same seat: occupancy intervals never overlap.
  CONSTRAINT ex_seat_assignments_seat EXCLUDE USING gist (
    match_id WITH =, seat_no WITH =, int4range(start_hand_no, end_hand_no) WITH &&),
  -- Same member: never two seats at once.
  CONSTRAINT ex_seat_assignments_member EXCLUDE USING gist (
    match_id WITH =, member_id WITH =, int4range(start_hand_no, end_hand_no) WITH &&)
);
CREATE INDEX ix_seat_assignments_match_start ON seat_assignments (match_id, start_hand_no);

-- A member may have several devices online; online != present.
CREATE TABLE match_devices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id       uuid NOT NULL,
  member_id      uuid NOT NULL,
  device_label   text NOT NULL,
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_acked_seq bigint NOT NULL DEFAULT 0 CHECK (last_acked_seq >= 0),
  CONSTRAINT fk_match_devices_member FOREIGN KEY (match_id, member_id)
    REFERENCES match_members (match_id, id),
  CONSTRAINT uq_match_devices_member_device UNIQUE (match_id, member_id, id)
);

-- Table-scoped guest credential; only an irreversible verifier of the token is stored.
CREATE TABLE guest_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id   uuid NOT NULL REFERENCES principals (id),
  match_id       uuid NOT NULL REFERENCES matches (id),
  token_verifier text NOT NULL UNIQUE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz NULL,
  CONSTRAINT uq_guest_sessions_match_id UNIQUE (match_id, id)
);
CREATE INDEX ix_guest_sessions_principal ON guest_sessions (principal_id, match_id);

-- Upgraded account gains access to the original guest member row.
CREATE TABLE member_access_grants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    uuid NOT NULL REFERENCES match_members (id),
  principal_id uuid NOT NULL REFERENCES principals (id),
  granted_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz NULL
);
CREATE UNIQUE INDEX uq_active_member_access_grant
  ON member_access_grants (member_id, principal_id)
  WHERE revoked_at IS NULL;
CREATE INDEX ix_member_access_grants_principal
  ON member_access_grants (principal_id)
  WHERE revoked_at IS NULL;

-- Single-use lost-device recovery, consumed only after on-site host/cohost check.
CREATE TABLE guest_recovery (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id           uuid NOT NULL,
  guest_session_id   uuid NOT NULL,
  seat_assignment_id uuid NOT NULL,
  secret_hash        text NOT NULL UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  used_at            timestamptz NULL,
  CONSTRAINT fk_guest_recovery_session FOREIGN KEY (match_id, guest_session_id)
    REFERENCES guest_sessions (match_id, id),
  CONSTRAINT fk_guest_recovery_assignment FOREIGN KEY (match_id, seat_assignment_id)
    REFERENCES seat_assignments (match_id, id)
);
CREATE INDEX ix_guest_recovery_session ON guest_recovery (guest_session_id);
