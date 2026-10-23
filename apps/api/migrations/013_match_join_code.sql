-- Short join codes resolve only live, joinable matches; historical rows may retain their code.
SET LOCAL search_path TO app, public;

ALTER TABLE app.matches ADD COLUMN join_code text;
ALTER TABLE app.matches ADD CONSTRAINT ck_matches_join_code
  CHECK (join_code IS NULL OR join_code ~ '^[A-HJ-NP-Z2-9]{6}$');
CREATE UNIQUE INDEX ux_matches_live_join_code ON app.matches (join_code)
  WHERE join_code IS NOT NULL AND deleted_at IS NULL AND state IN ('preparing', 'active');

-- Backfill live rooms with cryptographic UUID bytes, retrying index collisions
-- without aborting the migration transaction. Finished/deleted rooms are not joinable.
DO $$
DECLARE
  match_row record;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  entropy bytea;
  candidate text;
  digit_index integer;
BEGIN
  FOR match_row IN
    SELECT id FROM app.matches
    WHERE join_code IS NULL AND deleted_at IS NULL AND state IN ('preparing', 'active')
    ORDER BY id
  LOOP
    LOOP
      entropy := decode(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 'hex');
      candidate := '';
      FOR digit_index IN 0..5 LOOP
        candidate := candidate || substr(alphabet, 1 + get_byte(entropy, digit_index) % 32, 1);
      END LOOP;
      BEGIN
        UPDATE app.matches SET join_code = candidate WHERE id = match_row.id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- The partial unique index rejects another live match's code; generate a new one.
        NULL;
      END;
    END LOOP;
  END LOOP;
END;
$$;
