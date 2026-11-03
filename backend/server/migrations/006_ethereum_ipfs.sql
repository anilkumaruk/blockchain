-- The blockchain is the CredentialRegistry smart contract on Ethereum.
-- Each credential may have an encrypted copy on IPFS: { cid, key }.
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS ipfs JSONB;
-- The project's earlier own chain is retired (see archive/own-blockchain).
DROP TABLE IF EXISTS chain_blocks;
-- Universities sign in MetaMask; the server keeps no keys.
UPDATE institutions SET wallet_key_enc = NULL WHERE wallet_key_enc IS NOT NULL;
