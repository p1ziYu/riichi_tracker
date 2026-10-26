-- Final-native model (Round 1): only final scores are recorded per match.
-- No change to existing tables' semantics: matches.state keeps
-- preparing/active/finished/abandoned, mapped by the API to
-- waiting/in_progress/finished/cancelled. Seats keep living in
-- match_members.drawn_wind + seat_assignments (written by the atomic
-- auto-draw inside POST /api/matches/:id/join).
SET LOCAL search_path TO app, public;

ALTER TABLE app.matches ADD COLUMN final_scores jsonb NULL;
ALTER TABLE app.matches ADD COLUMN corrected_at timestamptz NULL;
ALTER TABLE app.matches ADD CONSTRAINT ck_matches_final_scores
  CHECK (final_scores IS NULL OR jsonb_typeof(final_scores) = 'array');
