-- 数据库设计 v1.3 §9 — revisions, disputes, final settlements, statistics projection.

SET LOCAL search_path TO app, public;

-- Correction proposal; an approved review produces a new event, never an in-place edit.
CREATE TABLE revision_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        uuid NOT NULL,
  target_event_id uuid NOT NULL,
  base_version    bigint NOT NULL CHECK (base_version >= 0),
  proposed_input  jsonb NOT NULL,
  reason          text NOT NULL,
  requested_by    uuid NOT NULL REFERENCES principals (id),
  reviewed_by     uuid NULL REFERENCES principals (id),
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_at     timestamptz NULL,
  CONSTRAINT fk_revision_requests_event FOREIGN KEY (match_id, target_event_id)
    REFERENCES match_events (match_id, id)
);
CREATE INDEX ix_revision_requests_match ON revision_requests (match_id, status);

-- Disputes keep the record and its handling; they never delete history.
CREATE TABLE disputes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    uuid NOT NULL REFERENCES matches (id),
  hand_id     uuid NULL,
  created_by  uuid NOT NULL REFERENCES principals (id),
  reason      text NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_by uuid NULL REFERENCES principals (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  CONSTRAINT fk_disputes_hand FOREIGN KEY (match_id, hand_id)
    REFERENCES hands (match_id, id)
);
CREATE INDEX ix_disputes_match ON disputes (match_id, status);

CREATE TABLE settlements (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id                uuid NOT NULL REFERENCES matches (id),
  revision                integer NOT NULL CHECK (revision >= 1),
  source_seq              bigint NOT NULL CHECK (source_seq >= 1),
  unclaimed_riichi_points integer NOT NULL DEFAULT 0 CHECK (unclaimed_riichi_points >= 0),
  created_at              timestamptz NOT NULL DEFAULT now(),
  superseded_at           timestamptz NULL,
  CONSTRAINT uq_settlements_revision UNIQUE (match_id, revision),
  CONSTRAINT uq_settlements_match_id UNIQUE (match_id, id)
);
CREATE UNIQUE INDEX uq_active_settlement
  ON settlements (match_id)
  WHERE superseded_at IS NULL;

-- Scores and ranks belong to the seat; principal_id is the occupant at match end.
CREATE TABLE settlement_players (
  settlement_id  uuid NOT NULL,
  match_id       uuid NOT NULL,
  seat_no        smallint NOT NULL,
  principal_id   uuid NOT NULL REFERENCES principals (id),
  final_points   integer NOT NULL,
  rank           smallint NOT NULL CHECK (rank BETWEEN 1 AND 4),
  uma_tenths     integer NOT NULL,
  oka_tenths     integer NOT NULL,
  -- P0 never applies end-of-match competition penalties automatically.
  penalty_tenths integer NOT NULL DEFAULT 0,
  total_tenths   integer NOT NULL,
  PRIMARY KEY (settlement_id, seat_no),
  CONSTRAINT fk_settlement_players_settlement FOREIGN KEY (match_id, settlement_id)
    REFERENCES settlements (match_id, id),
  CONSTRAINT fk_settlement_players_seat FOREIGN KEY (match_id, seat_no)
    REFERENCES match_seats (match_id, seat_no)
);
CREATE INDEX ix_settlement_players_principal ON settlement_players (principal_id, settlement_id);

-- A new settlement revision does not inherit earlier confirmations.
CREATE TABLE settlement_confirmations (
  settlement_id uuid NOT NULL,
  match_id      uuid NOT NULL,
  member_id     uuid NOT NULL,
  status        text NOT NULL CHECK (status IN ('confirmed', 'disputed')),
  confirmed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (settlement_id, member_id),
  CONSTRAINT fk_settlement_confirmations_settlement FOREIGN KEY (match_id, settlement_id)
    REFERENCES settlements (match_id, id),
  CONSTRAINT fk_settlement_confirmations_member FOREIGN KEY (match_id, member_id)
    REFERENCES match_members (match_id, id)
);

-- Per-assignment attribution so mid-match substitutions keep each player's share.
CREATE TABLE settlement_participations (
  settlement_id      uuid NOT NULL,
  match_id           uuid NOT NULL,
  seat_assignment_id uuid NOT NULL,
  principal_id       uuid NOT NULL REFERENCES principals (id),
  hands_played       integer NOT NULL CHECK (hands_played >= 0),
  full_match         boolean NOT NULL,
  PRIMARY KEY (settlement_id, seat_assignment_id),
  CONSTRAINT fk_settlement_participations_settlement FOREIGN KEY (match_id, settlement_id)
    REFERENCES settlements (match_id, id),
  CONSTRAINT fk_settlement_participations_assignment FOREIGN KEY (match_id, seat_assignment_id)
    REFERENCES seat_assignments (match_id, id)
);
CREATE INDEX ix_settlement_participations_principal ON settlement_participations (principal_id);

-- Rebuildable projection grouped by population (player count, length, start/return,
-- uma, oka) and period. Exact-ruleset filters query settlement facts instead.
CREATE TABLE player_stats (
  principal_id   uuid NOT NULL REFERENCES principals (id),
  population_key text NOT NULL,
  period_key     text NOT NULL,
  match_count    integer NOT NULL DEFAULT 0 CHECK (match_count >= 0),
  -- rank_counts[i] = number of i-th place finishes; length = player count.
  rank_counts    integer[] NOT NULL CHECK (cardinality(rank_counts) IN (3, 4)),
  score_tenths   bigint NOT NULL DEFAULT 0,
  source_version bigint NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (principal_id, population_key, period_key)
);
