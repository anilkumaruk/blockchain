# Karnataka Degree Registry (synthetic)

Source: the "Karnataka Degree Registry" dataset artifact provided by the project team
(karnataka_degree_verification_dataset.xlsx, 12 sheets, DigiLocker NAD field layout).

All students, register numbers, ABC/APAAR ids, certificate numbers and hashes are
randomly generated. University and college names are real; their codes are
placeholders. No record belongs to a real person.

The *.json files are the data sheets converted 1:1 (one object per row, original
column names). `npm run import:karnataka` loads them into the database and anchors
every degree certificate on-chain under its university's own issuer wallet.
