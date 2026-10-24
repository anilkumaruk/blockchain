-- Off-chain academic data layer for Chain of Record.
-- Personal data lives here; only fingerprints and status go on-chain.

CREATE TABLE credentials (
  credential_id   TEXT PRIMARY KEY,
  student_name    TEXT NOT NULL,
  student_id      TEXT NOT NULL,
  credential_type TEXT NOT NULL,
  issue_date      DATE NOT NULL,
  issuer          TEXT NOT NULL,
  cert_ref        TEXT NOT NULL,
  doc_hash        TEXT NOT NULL UNIQUE CHECK (doc_hash ~ '^0x[0-9a-f]{64}$'),
  status          TEXT NOT NULL CHECK (status IN ('valid', 'revoked')),
  revocation      JSONB,
  chain           JSONB,
  batch           JSONB,
  replaces        TEXT REFERENCES credentials (credential_id),
  replaced_by     TEXT REFERENCES credentials (credential_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX credentials_student_idx ON credentials (student_id);

CREATE TABLE users (
  username        TEXT PRIMARY KEY,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('admin', 'student')),
  student_id      TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only record of security-relevant actions (who did what, from where).
CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor      TEXT,
  action     TEXT NOT NULL,
  target     TEXT,
  ip         TEXT,
  details    JSONB
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);

CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
