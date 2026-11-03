# Verification evaluation: 666 labelled requests

Generated 2026-11-03T07:56:58.454Z by `npm run chain:evaluate`.
Contract used: CredentialRegistry on Hardhat's in-process Ethereum, 17 Merkle batches (one per university), 1604 certificates, 86 revoked.
Input: each request's claimed details as text, and its QR hash (a QR matching the dataset's own hash is treated as the genuine QR). These cases test the verifier and the contract; OCR is measured separately in photo-ocr.md.

**Accuracy: 666/666 (100.00%)**, 0.51 ms per verification.

| Expected \ Result | valid | invalid | revoked |
|---|---:|---:|---:|
| valid | 345 | 0 | 0 |
| invalid | 0 | 235 | 0 |
| revoked | 0 | 0 | 86 |

| Case | Expected | Correct |
|---|---|---:|
| DOB mismatch | invalid | 25/25 |
| CGPA/percentage tampered (hash mismatch) | invalid | 40/40 |
| Degree/branch altered | invalid | 20/20 |
| Year of passing altered | invalid | 25/25 |
| VALID | valid | 325/325 |
| Original serial cancelled - duplicate has been issued | revoked | 25/25 |
| Certificate serial number not found | invalid | 30/30 |
| Certificate revoked by university | revoked | 33/33 |
| Name mismatch with university record | invalid | 35/35 |
| Certificate withheld - not valid for verification | revoked | 28/28 |
| No degree awarded - enrollment status: Ongoing | invalid | 34/34 |
| Degree not yet conferred; provisional certificate valid until convocation | valid | 20/20 |
| Institution not a recognised university (not in UGC list) | invalid | 20/20 |
| No degree awarded - enrollment status: Discontinued | invalid | 6/6 |
