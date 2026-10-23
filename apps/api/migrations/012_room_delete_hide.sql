-- Room-level soft delete (tombstone) and per-user match history hide.
SET LOCAL search_path TO app, public;

ALTER TABLE app.matches ADD COLUMN deleted_at timestamptz NULL;
CREATE INDEX ix_matches_owner_created ON app.matches (owner_principal_id, created_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE app.match_members ADD COLUMN hidden_at timestamptz NULL;

-- Allow releasing unfinalized seat assignments (0 hands played) without deleting historical check-in audit rows.
ALTER TABLE app.seat_assignments DROP CONSTRAINT ck_seat_assignments_interval;
ALTER TABLE app.seat_assignments ADD CONSTRAINT ck_seat_assignments_interval
  CHECK (end_hand_no IS NULL OR end_hand_no >= start_hand_no);
