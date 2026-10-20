-- 数据库设计 v1.3 §6.1 (hands, riichi marks, results, seat outcomes, winners,
-- liabilities), §6.2 (match_events), §7 (unique / partial indexes).

SET LOCAL search_path TO app, public;

-- A replayed hand gets a new id and hand_no; round wind / honba may repeat.
CREATE TABLE hands (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id           uuid NOT NULL,
  hand_no            integer NOT NULL CHECK (hand_no >= 0),
  round_wind         text NOT NULL CHECK (round_wind IN ('E', 'S', 'W', 'N')),
  round_number       smallint NOT NULL CHECK (round_number BETWEEN 1 AND 4),
  dealer_seat_no     smallint NOT NULL,
  honba              integer NOT NULL DEFAULT 0 CHECK (honba >= 0),
  riichi_pool_before integer NOT NULL DEFAULT 0 CHECK (riichi_pool_before >= 0),
  -- Bumped only by riichi mark changes.
  mark_revision      bigint NOT NULL DEFAULT 0 CHECK (mark_revision >= 0),
  -- Bumped only on first valid result and approved revisions.
  result_revision    bigint NOT NULL DEFAULT 0 CHECK (result_revision >= 0),
  state              text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'settled', 'voided')),
  opened_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_hands_match FOREIGN KEY (match_id) REFERENCES matches (id),
  CONSTRAINT fk_hands_dealer FOREIGN KEY (match_id, dealer_seat_no)
    REFERENCES match_seats (match_id, seat_no),
  CONSTRAINT uq_hands_hand_no UNIQUE (match_id, hand_no),
  CONSTRAINT uq_hands_match_id UNIQUE (match_id, id)
);

ALTER TABLE matches
  ADD CONSTRAINT fk_matches_current_hand FOREIGN KEY (id, current_hand_id)
    REFERENCES hands (match_id, id);

-- Total order per match: matches.version = latest seq. Retries are deduplicated by
-- (match, actor, client_event_id); request_hash detects a reused id with different content.
CREATE TABLE match_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id           uuid NOT NULL REFERENCES matches (id),
  seq                bigint NOT NULL CHECK (seq >= 1),
  hand_id            uuid NULL,
  actor_principal_id uuid NOT NULL REFERENCES principals (id),
  client_event_id    uuid NOT NULL,
  request_hash       text NOT NULL,
  type               text NOT NULL,
  payload            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_match_events_hand FOREIGN KEY (match_id, hand_id)
    REFERENCES hands (match_id, id),
  CONSTRAINT uq_match_events_match_id UNIQUE (match_id, id)
);
CREATE UNIQUE INDEX uq_match_event_sequence
  ON match_events (match_id, seq);
CREATE UNIQUE INDEX uq_match_event_retry
  ON match_events (match_id, actor_principal_id, client_event_id);

-- Shared, versioned in-hand riichi flag. Produces no ledger entries.
CREATE TABLE hand_riichi_marks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id      uuid NOT NULL,
  hand_id       uuid NOT NULL,
  seat_no       smallint NOT NULL,
  marked        boolean NOT NULL,
  seat_revision bigint NOT NULL DEFAULT 1 CHECK (seat_revision >= 1),
  updated_by    uuid NOT NULL REFERENCES principals (id),
  last_event_id uuid NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_hand_riichi_marks_hand FOREIGN KEY (match_id, hand_id)
    REFERENCES hands (match_id, id),
  CONSTRAINT fk_hand_riichi_marks_seat FOREIGN KEY (match_id, seat_no)
    REFERENCES match_seats (match_id, seat_no),
  CONSTRAINT fk_hand_riichi_marks_event FOREIGN KEY (match_id, last_event_id)
    REFERENCES match_events (match_id, id)
);
CREATE UNIQUE INDEX uq_hand_riichi_mark
  ON hand_riichi_marks (hand_id, seat_no);
CREATE INDEX ix_hand_marks_by_match
  ON hand_riichi_marks (match_id, hand_id);

-- Revisions are kept; at most one active (non-superseded) result per hand.
CREATE TABLE hand_results (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id                uuid NOT NULL,
  hand_id                 uuid NOT NULL,
  revision                integer NOT NULL CHECK (revision >= 1),
  kind                    text NOT NULL CHECK (kind IN (
                            'ron', 'tsumo', 'ryuukyoku', 'abortive_draw',
                            'nagashi_mangan', 'chombo', 'manual_ruling')),
  confirmed_mark_revision bigint NOT NULL CHECK (confirmed_mark_revision >= 0),
  input_mode              text NOT NULL CHECK (input_mode IN ('han_fu', 'hand', 'manual_adjustment')),
  input                   jsonb NOT NULL,
  calculation             jsonb NOT NULL,
  engine_version          text NOT NULL,
  created_by              uuid NOT NULL REFERENCES principals (id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  superseded_at           timestamptz NULL,
  CONSTRAINT fk_hand_results_hand FOREIGN KEY (match_id, hand_id)
    REFERENCES hands (match_id, id),
  CONSTRAINT uq_hand_results_revision UNIQUE (hand_id, revision),
  CONSTRAINT uq_hand_results_match_id UNIQUE (match_id, id)
);
CREATE UNIQUE INDEX uq_active_hand_result
  ON hand_results (hand_id)
  WHERE superseded_at IS NULL;
CREATE INDEX ix_hand_results_by_match
  ON hand_results (match_id, hand_id);

-- One row per participating seat per result. match_id is carried so the seat
-- assignment is pinned to the same match and seat.
CREATE TABLE hand_seat_outcomes (
  result_id          uuid NOT NULL,
  match_id           uuid NOT NULL,
  seat_no            smallint NOT NULL,
  seat_assignment_id uuid NOT NULL,
  is_riichi          boolean NOT NULL,
  is_tenpai          boolean NULL,
  is_nagashi_mangan  boolean NOT NULL DEFAULT false,
  chombo_role        text NULL CHECK (chombo_role IN ('offender', 'victim')),
  net_points         integer NOT NULL,
  PRIMARY KEY (result_id, seat_no),
  CONSTRAINT fk_hand_seat_outcomes_result FOREIGN KEY (match_id, result_id)
    REFERENCES hand_results (match_id, id),
  CONSTRAINT fk_hand_seat_outcomes_assignment FOREIGN KEY (match_id, seat_assignment_id, seat_no)
    REFERENCES seat_assignments (match_id, id, seat_no)
);

-- Winners only; double ron = two rows. Each row points to the seat outcome of the same result.
CREATE TABLE result_winners (
  result_id       uuid NOT NULL,
  seat_no         smallint NOT NULL,
  han             smallint NOT NULL CHECK (han >= 0),
  fu              smallint NULL CHECK (fu BETWEEN 20 AND 140),
  yakuman_count   smallint NOT NULL DEFAULT 0 CHECK (yakuman_count >= 0),
  deal_in_seat_no smallint NULL,
  PRIMARY KEY (result_id, seat_no),
  CONSTRAINT fk_result_winners_outcome FOREIGN KEY (result_id, seat_no)
    REFERENCES hand_seat_outcomes (result_id, seat_no),
  CONSTRAINT fk_result_winners_deal_in FOREIGN KEY (result_id, deal_in_seat_no)
    REFERENCES hand_seat_outcomes (result_id, seat_no),
  CONSTRAINT ck_result_winners_deal_in CHECK (deal_in_seat_no IS NULL OR deal_in_seat_no <> seat_no)
);

-- P1 automatic pao; P0 forbids automatic liability mode.
CREATE TABLE result_liabilities (
  result_id           uuid NOT NULL,
  winner_seat_no      smallint NOT NULL,
  responsible_seat_no smallint NOT NULL,
  yakuman_count       smallint NOT NULL CHECK (yakuman_count >= 1),
  reason              text NOT NULL,
  PRIMARY KEY (result_id, winner_seat_no, responsible_seat_no),
  CONSTRAINT fk_result_liabilities_winner FOREIGN KEY (result_id, winner_seat_no)
    REFERENCES result_winners (result_id, seat_no),
  CONSTRAINT fk_result_liabilities_responsible FOREIGN KEY (result_id, responsible_seat_no)
    REFERENCES hand_seat_outcomes (result_id, seat_no),
  CONSTRAINT ck_result_liabilities_distinct CHECK (winner_seat_no <> responsible_seat_no)
);
