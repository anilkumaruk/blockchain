# Fluree Academic Credentials Dataset (ACD)

Source: https://github.com/fluree/dataset-academic-credentials (commit 69f35b2, 27 Dec 2023)
License: MIT (see LICENSE, Copyright (c) 2023 Fluree). Files copied unchanged.

A fictional ecosystem of learners, institutions, employers, achievements and
credentials in the Open Badges 3.0 / CLR vocabulary. `npm run import:fluree`
loads it into the off-chain database and anchors every credential on-chain
under its issuing institution's own wallet.

Known issues in the source data (handled by the importer):
- `acd:institutions/ncbels` is referenced by credential 43 but not defined in
  01_profiles.jsonld; the importer creates it from the reference.
- Only 1 of 51 credentials has a credentialStatus; none is revoked.
- `clr:expirationDate` (1 credential) is not yet modelled and is ignored.
