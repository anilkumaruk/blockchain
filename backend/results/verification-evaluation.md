# Verification evaluation: 666 labelled requests

Generated 2026-11-02T06:04:35.787Z by `npm run chain:evaluate`.
Chain used: 107 blocks, 1708 transactions, 1604 certificates.
Input: each request's claimed details as text, and its QR hash. These cases test the verifier and the chain; OCR is measured separately in photo-ocr.md.

**Accuracy: 666/666 (100.00%)**, 4.99 ms per verification.

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
