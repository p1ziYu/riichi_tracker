-- Rotating initial winds at finalize can swap East and another occupied seat.
-- Check uniqueness at transaction commit rather than between row updates.
SET LOCAL search_path TO app, public;
ALTER TABLE match_seats DROP CONSTRAINT uq_match_seats_wind;
ALTER TABLE match_seats ADD CONSTRAINT uq_match_seats_wind
  UNIQUE (match_id, initial_wind) DEFERRABLE INITIALLY IMMEDIATE;
