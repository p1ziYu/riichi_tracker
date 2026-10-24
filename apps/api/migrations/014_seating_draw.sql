SET LOCAL search_path TO app, public;

ALTER TABLE app.matches ADD COLUMN seating_drawn_at timestamptz NULL;
ALTER TABLE app.matches
  ADD COLUMN dealer_seat_no smallint NULL,
  ADD CONSTRAINT ck_matches_dealer_seat
    CHECK (dealer_seat_no IS NULL OR (dealer_seat_no >= 0 AND dealer_seat_no < player_count));

ALTER TABLE app.match_members
  ADD COLUMN drawn_wind text NULL,
  ADD CONSTRAINT ck_match_members_drawn_wind
    CHECK (drawn_wind IS NULL OR drawn_wind IN ('E', 'S', 'W', 'N'));
ALTER TABLE app.match_members
  ADD CONSTRAINT uq_match_members_drawn_wind
    UNIQUE (match_id, drawn_wind) DEFERRABLE INITIALLY IMMEDIATE;
