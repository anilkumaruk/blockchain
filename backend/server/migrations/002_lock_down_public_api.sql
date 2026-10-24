-- Hosted Postgres providers such as Supabase expose every table in the
-- `public` schema through an auto-generated REST API (roles `anon` and
-- `authenticated`). This API server is the only intended client, so:
--   1. Row Level Security is enabled with no policies: API roles see nothing.
--      The server connects as the table owner, which RLS does not restrict.
--   2. Table privileges are revoked from those roles where they exist.
-- On plain PostgreSQL this migration is harmless.

ALTER TABLE credentials       ENABLE ROW LEVEL SECURITY;
ALTER TABLE users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON credentials, users, audit_log, schema_migrations FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE audit_log_id_seq FROM %I', r);
    END IF;
  END LOOP;
END $$;
