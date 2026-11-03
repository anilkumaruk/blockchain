# Photo verification: OCR + QR measurement

Generated 2026-11-02T06:45:01.545Z by `npm run chain:photos`, 6 certificates per case.
Certificates rendered from the dataset, then degraded by software to imitate photos. **These are simulated conditions, not photos from a real camera.** Software-edited forgeries keep the original QR code.

| Condition | Case | Expected | Correct | QR read |
|---|---|---|---:|---:|
| clean | genuine | valid | 6/6 | 6/6 |
| clean | revoked | revoked | 5/6 | 6/6 |
| clean | cgpa edited | invalid | 6/6 | 6/6 |
| clean | name edited | invalid | 6/6 | 6/6 |
| clean | sgpa edited | invalid | 6/6 | 6/6 |
| clean | year edited | invalid | 6/6 | 6/6 |
| clean | fake serial | invalid | 6/6 | 0/6 |
| phone-like | genuine | valid | 5/6 | 6/6 |
| phone-like | revoked | revoked | 6/6 | 6/6 |
| phone-like | cgpa edited | invalid | 6/6 | 6/6 |
| phone-like | name edited | invalid | 6/6 | 6/6 |
| phone-like | sgpa edited | invalid | 6/6 | 6/6 |
| phone-like | year edited | invalid | 6/6 | 6/6 |
| phone-like | fake serial | invalid | 6/6 | 0/6 |
| poor (small, blurred) | genuine | valid | 3/6 | 1/6 |
| poor (small, blurred) | revoked | revoked | 5/6 | 0/6 |
| poor (small, blurred) | cgpa edited | invalid | 6/6 | 0/6 |
| poor (small, blurred) | name edited | invalid | 6/6 | 1/6 |
| poor (small, blurred) | sgpa edited | invalid | 6/6 | 1/6 |
| poor (small, blurred) | year edited | invalid | 6/6 | 1/6 |
| poor (small, blurred) | fake serial | invalid | 6/6 | 0/6 |

- **clean: 41/42** correct, about 5.9 s per image
- **phone-like: 41/42** correct, about 13.9 s per image
- **poor (small, blurred): 38/42** correct, about 5.6 s per image
