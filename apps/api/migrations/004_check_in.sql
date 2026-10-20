-- 数据库设计 v1.3 §5 — QR invitations, join requests, check-ins.
-- Validity windows (expires_at vs server now()) are transactional checks, never
-- part of a unique index predicate.

SET LOCAL search_path TO app, public;

-- One row per invitation activity; the 60s QR image rotation inserts nothing.
-- generation changes only on manual reset or match start.
CREATE TABLE match_invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    uuid NOT NULL REFERENCES matches (id),
  scope       text NOT NULL CHECK (scope IN ('join', 'watch')),
  generation  integer NOT NULL DEFAULT 1 CHECK (generation >= 1),
  hmac_key_id text NOT NULL,
  created_by  uuid NOT NULL REFERENCES principals (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz NULL,
  CONSTRAINT uq_match_invitations_match_id UNIQUE (match_id, id)
);

CREATE TABLE join_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id          uuid NOT NULL,
  invitation_id     uuid NOT NULL,
  principal_id      uuid NOT NULL REFERENCES principals (id),
  requested_seat_no smallint NULL,
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
  approved_by       uuid NULL REFERENCES principals (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  decided_at        timestamptz NULL,
  CONSTRAINT fk_join_requests_invitation FOREIGN KEY (match_id, invitation_id)
    REFERENCES match_invitations (match_id, id),
  CONSTRAINT fk_join_requests_seat FOREIGN KEY (match_id, requested_seat_no)
    REFERENCES match_seats (match_id, seat_no),
  CONSTRAINT ck_join_requests_decided CHECK ((status = 'pending') = (decided_at IS NULL))
);
-- Re-scanning across QR windows returns the existing pending request.
CREATE UNIQUE INDEX uq_pending_join_request
  ON join_requests (match_id, principal_id)
  WHERE status = 'pending';

-- Bound to rules_hash; rule or seat changes invalidate first, then re-confirm.
-- No GPS / Bluetooth data is stored.
CREATE TABLE check_ins (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id           uuid NOT NULL,
  member_id          uuid NOT NULL,
  seat_assignment_id uuid NOT NULL,
  rules_hash         text NOT NULL,
  method             text NOT NULL CHECK (method IN ('qr_scan', 'host_confirm')),
  confirmed_at       timestamptz NOT NULL DEFAULT now(),
  host_confirmed_at  timestamptz NULL,
  host_confirmed_by  uuid NULL REFERENCES principals (id),
  invalidated_at     timestamptz NULL,
  CONSTRAINT fk_check_ins_member FOREIGN KEY (match_id, member_id)
    REFERENCES match_members (match_id, id),
  -- The confirming member must be the one occupying the assignment.
  CONSTRAINT fk_check_ins_assignment FOREIGN KEY (match_id, seat_assignment_id, member_id)
    REFERENCES seat_assignments (match_id, id, member_id),
  CONSTRAINT ck_check_ins_host CHECK ((host_confirmed_at IS NULL) = (host_confirmed_by IS NULL))
);
CREATE UNIQUE INDEX uq_active_check_in
  ON check_ins (seat_assignment_id)
  WHERE invalidated_at IS NULL;
CREATE INDEX ix_check_ins_match ON check_ins (match_id) WHERE invalidated_at IS NULL;
