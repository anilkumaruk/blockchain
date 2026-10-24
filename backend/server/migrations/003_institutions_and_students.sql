-- Multi-institution support and student accounts.
--   institutions: colleges and other issuers. Self-registered ones start as
--                 'pending' until the platform admin approves them; approval
--                 creates the institution's own on-chain issuer wallet.
--   students:     student records an institution holds, including the
--                 student's personal email. A student can only create a
--                 login for an email that an institution has on record.

CREATE TABLE institutions (
  id              TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,60}$'),
  name            TEXT NOT NULL UNIQUE,
  kind            TEXT NOT NULL DEFAULT 'university'
                  CHECK (kind IN ('university', 'certifying_body', 'employer', 'other')),
  email           TEXT,
  website         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  wallet_address  TEXT UNIQUE CHECK (wallet_address ~ '^0x[0-9a-fA-F]{40}$'),
  -- AES-256-GCM encrypted private key; NULL for the platform owner, whose key
  -- lives only in the server environment.
  wallet_key_enc  TEXT,
  source          TEXT NOT NULL DEFAULT 'registration',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at     TIMESTAMPTZ,
  approved_by     TEXT
);

CREATE TABLE students (
  student_id      TEXT PRIMARY KEY,
  full_name       TEXT NOT NULL,
  email           TEXT UNIQUE CHECK (email = lower(email)),
  institution_id  TEXT REFERENCES institutions (id),
  source          TEXT NOT NULL DEFAULT 'issuance',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'institution', 'student'));
ALTER TABLE users ADD COLUMN email TEXT UNIQUE CHECK (email = lower(email));
ALTER TABLE users ADD COLUMN institution_id TEXT REFERENCES institutions (id);

ALTER TABLE credentials ADD COLUMN institution_id TEXT REFERENCES institutions (id);
ALTER TABLE credentials ADD COLUMN issuer_address TEXT;
CREATE INDEX credentials_institution_idx ON credentials (institution_id);

-- Same lock-down as migration 002 for the new tables.
ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE students     ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON institutions, students FROM %I', r);
    END IF;
  END LOOP;
END $$;
