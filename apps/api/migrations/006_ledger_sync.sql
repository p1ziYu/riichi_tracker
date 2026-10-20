-- 数据库设计 v1.3 §6.2/§6.3 — score accounts, ledger, snapshots, outbox, sync, WS tickets.
-- Current balance = opening_balance + SUM(score_entries.amount). Totals are never
-- stored as writable columns.

SET LOCAL search_path TO app, public;

CREATE TABLE score_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        uuid NOT NULL REFERENCES matches (id),
  kind            text NOT NULL CHECK (kind IN ('seat', 'riichi_pool', 'penalty_pool')),
  seat_no         smallint NULL,
  opening_balance integer NOT NULL,
  CONSTRAINT fk_score_accounts_seat FOREIGN KEY (match_id, seat_no)
    REFERENCES match_seats (match_id, seat_no),
  CONSTRAINT ck_score_accounts_seat CHECK ((kind = 'seat') = (seat_no IS NOT NULL)),
  CONSTRAINT ck_score_accounts_pool_opening CHECK (kind = 'seat' OR opening_balance = 0),
  CONSTRAINT uq_score_accounts_seat UNIQUE (match_id, seat_no),
  CONSTRAINT uq_score_accounts_match_id UNIQUE (match_id, id)
);
-- One riichi pool (and at most one penalty pool) per match.
CREATE UNIQUE INDEX uq_score_accounts_pool
  ON score_accounts (match_id, kind)
  WHERE kind <> 'seat';

-- Several entries per (event, account) with different reasons are allowed by design;
-- there is deliberately no UNIQUE (event_id, account_id).
CREATE TABLE score_entries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id   uuid NOT NULL,
  event_id   uuid NOT NULL,
  account_id uuid NOT NULL,
  amount     integer NOT NULL CHECK (amount <> 0),
  reason     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_score_entries_event FOREIGN KEY (match_id, event_id)
    REFERENCES match_events (match_id, id),
  CONSTRAINT fk_score_entries_account FOREIGN KEY (match_id, account_id)
    REFERENCES score_accounts (match_id, id)
);
-- Leading event_id index: the deferred zero-sum trigger looks entries up by event.
CREATE INDEX ix_score_entries_by_event
  ON score_entries (event_id);
CREATE INDEX ix_score_entries_by_account
  ON score_entries (account_id, event_id);

-- History is append-only; corrections are reversing entries in a new event.
CREATE FUNCTION app.score_entries_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'score_entries are append-only (% rejected)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER tg_score_entries_append_only
  BEFORE UPDATE OR DELETE ON score_entries
  FOR EACH ROW EXECUTE FUNCTION app.score_entries_append_only();
CREATE TRIGGER tg_score_entries_no_truncate
  BEFORE TRUNCATE ON score_entries
  FOR EACH STATEMENT EXECUTE FUNCTION app.score_entries_append_only();

-- Checked at commit: every event's entries net to 0, and the riichi pool never goes negative.
-- (Player balances may go negative: busting is legal.)
CREATE FUNCTION app.score_entries_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  event_total bigint;
  pool_balance bigint;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO event_total
    FROM app.score_entries WHERE event_id = NEW.event_id;
  IF event_total <> 0 THEN
    RAISE EXCEPTION 'score entries of event % net to %, expected 0', NEW.event_id, event_total
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT a.opening_balance + COALESCE(SUM(e.amount), 0) INTO pool_balance
    FROM app.score_accounts a
    LEFT JOIN app.score_entries e ON e.account_id = a.id
   WHERE a.id = NEW.account_id AND a.kind = 'riichi_pool'
   GROUP BY a.id, a.opening_balance;
  IF pool_balance < 0 THEN
    RAISE EXCEPTION 'riichi pool % balance would be %', NEW.account_id, pool_balance
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tg_score_entries_balanced
  AFTER INSERT ON score_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.score_entries_balanced();

-- Disposable, rebuildable projection; never a client write path.
CREATE TABLE match_snapshots (
  match_id       uuid NOT NULL REFERENCES matches (id),
  seq            bigint NOT NULL CHECK (seq >= 0),
  state          jsonb NOT NULL,
  engine_version text NOT NULL,
  state_hash     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, seq)
);

-- Written in the business transaction; publishers may deliver more than once.
CREATE TABLE outbox_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES match_events (id),
  topic           text NOT NULL,
  payload         jsonb NOT NULL,
  attempts        integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz NULL,
  CONSTRAINT uq_outbox_messages_event_topic UNIQUE (event_id, topic)
);
CREATE INDEX ix_outbox_pending
  ON outbox_messages (next_attempt_at, id)
  WHERE published_at IS NULL;

-- Catch-up cursor only; grants no permission.
CREATE TABLE sync_cursors (
  match_id       uuid NOT NULL,
  member_id      uuid NOT NULL,
  device_id      uuid NOT NULL,
  last_acked_seq bigint NOT NULL DEFAULT 0 CHECK (last_acked_seq >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, member_id, device_id),
  CONSTRAINT fk_sync_cursors_device FOREIGN KEY (match_id, member_id, device_id)
    REFERENCES match_devices (match_id, member_id, id)
);

-- 30-second single-use WebSocket ticket issued over HTTPS; only the hash is stored.
CREATE TABLE ws_tickets (
  token_hash       text PRIMARY KEY,
  principal_id     uuid NOT NULL REFERENCES principals (id),
  auth_session_ref text NOT NULL,
  match_id         uuid NOT NULL REFERENCES matches (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  consumed_at      timestamptz NULL
);
CREATE INDEX ix_ws_tickets_expires ON ws_tickets (expires_at);
