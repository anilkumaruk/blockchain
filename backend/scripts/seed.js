// Loads the same demo credentials the frontend mock uses into a running API
// server (and therefore onto the chain), including the two revoked ones.
//
//   node scripts/seed.js            (API_URL defaults to http://localhost:4000)

import 'dotenv/config';

const API = (process.env.API_URL || 'http://localhost:4000').replace(/\/$/, '');
const CSE = 'B.Tech in Computer Science & Engineering';

const SEED = [
  { credentialId: 'COR-2023-9F3A1C', studentName: 'Ananya Sharma', studentId: 'RGIT21CS014', credentialType: CSE, issueDate: '2023-06-15' },
  { credentialId: 'COR-2023-4B7E22', studentName: 'Rohan Verma', studentId: 'RGIT21CS027', credentialType: CSE, issueDate: '2023-06-15',
    revoke: 'Issued in error — duplicate record for merged student file.' },
  { credentialId: 'COR-2022-1A88D0', studentName: 'Priya Nair', studentId: 'RGIT19CS002', credentialType: 'B.Tech in Electronics & Communication Engineering', issueDate: '2022-05-30' },
  { credentialId: 'COR-2023-77C3E9', studentName: 'Karthik Iyer', studentId: 'RGIT21CS014', credentialType: 'M.Tech in Data Science', issueDate: '2023-11-20' },
  { credentialId: 'COR-2021-C51F6A', studentName: 'Sneha Reddy', studentId: 'RGIT18CS041', credentialType: CSE, issueDate: '2021-06-10' },
  { credentialId: 'COR-2022-E20B4D', studentName: 'Aditya Kulkarni', studentId: 'RGIT19CS009', credentialType: 'B.Tech in Information Technology', issueDate: '2022-06-18',
    revoke: 'Academic integrity violation confirmed after appeal process.' },
  { credentialId: 'COR-2020-88A5F1', studentName: 'Meera Joshi', studentId: 'RGIT17CS003', credentialType: CSE, issueDate: '2020-06-22' },
  { credentialId: 'COR-2024-3D6C90', studentName: 'Vikram Singh', studentId: 'RGIT20CS033', credentialType: CSE, issueDate: '2024-06-05' },
];

async function call(path, { token, ...init } = {}) {
  const res = await fetch(`${API}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const login = await call('/auth/login', {
  method: 'POST',
  body: JSON.stringify({
    username: process.env.ADMIN_USERNAME || 'registrar.admin',
    password: process.env.ADMIN_PASSWORD || 'admin12345',
  }),
});
if (login.status !== 200) throw new Error(`Login failed: ${login.body.error}`);
const { token } = login.body;

for (const { revoke, ...fields } of SEED) {
  const issued = await call('/credentials', { method: 'POST', token, body: JSON.stringify(fields) });
  if (issued.status === 409) {
    console.log(`skip   ${fields.credentialId} (already issued)`);
    continue;
  }
  if (issued.status !== 201) throw new Error(`Issue ${fields.credentialId} failed: ${issued.body.error}`);
  console.log(`issued ${fields.credentialId}  tx ${issued.body.record.chain.txHash}`);
  if (revoke) {
    const r = await call(`/credentials/${fields.credentialId}/revoke`, {
      method: 'POST',
      token,
      body: JSON.stringify({ reason: revoke }),
    });
    if (r.status !== 200) throw new Error(`Revoke ${fields.credentialId} failed: ${r.body.error}`);
    console.log(`revoke ${fields.credentialId}  tx ${r.body.revocation.txHash}`);
  }
}
