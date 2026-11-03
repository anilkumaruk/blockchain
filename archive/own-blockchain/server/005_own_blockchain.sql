-- The project's own blockchain. Each validator node keeps an independent copy,
-- so each block appears once per node. Blocks are append-only.
CREATE TABLE chain_blocks (
  node_id       TEXT NOT NULL,
  idx           INTEGER NOT NULL CHECK (idx >= 0),
  hash          TEXT NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  previous_hash TEXT NOT NULL CHECK (previous_hash ~ '^[0-9a-f]{64}$'),
  block         JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (node_id, idx)
);

ALTER TABLE chain_blocks ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON chain_blocks FROM %I', r);
    END IF;
  END LOOP;
END $$;
