// Pure derivation: turns a student's existing credential records into a
// small node/edge graph structure for the "Academic Credential Graph"
// visualization. No new data is invented — every node is backed by a real
// credential (or the student identity / institutions already present on
// those records). Kept independent of any rendering concerns so it can be
// unit-tested (or later backed by a real API) without touching the UI.

function slug(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * @param {{studentId:string, studentName:string, allVerified:boolean}} profile
 * @param {Array} credentials - this student's credential records.
 */
export function buildCredentialGraph(profile, credentials) {
  const institutionNames = [...new Set(credentials.map((c) => c.issuer))];
  const multiInstitution = institutionNames.length > 1;

  const institutions = institutionNames.map((name) => ({
    id: `institution:${slug(name)}`,
    name,
    credentialIds: credentials.filter((c) => c.issuer === name).map((c) => c.credentialId),
  }));

  const institutionIdByName = new Map(institutions.map((i) => [i.name, i.id]));

  const nodes = credentials.map((c) => ({
    id: c.credentialId,
    credentialId: c.credentialId,
    type: c.credentialType,
    // Future-ready hook: the current credential record has no separate
    // "category" field (Degree / Certificate / Internship / etc.), so this
    // falls back to a generic label rather than guessing a classification
    // the data doesn't actually contain.
    category: c.category || 'Credential',
    institution: c.issuer,
    institutionId: multiInstitution ? institutionIdByName.get(c.issuer) : null,
    issueYear: new Date(c.issueDate).getFullYear(),
    issueDate: c.issueDate,
    status: c.status,
    hash: c.hash,
    parentId: multiInstitution ? institutionIdByName.get(c.issuer) : 'identity',
  }));

  const relationships = [
    ...(multiInstitution ? institutions.map((i) => ({ from: 'identity', to: i.id })) : []),
    ...nodes.map((n) => ({ from: n.parentId, to: n.id })),
  ];

  return {
    identity: {
      id: 'identity',
      studentId: profile.studentId,
      studentName: profile.studentName,
      allVerified: profile.allVerified,
    },
    institutions: multiInstitution ? institutions : [],
    credentials: nodes,
    relationships,
  };
}

/** Same nodes, ordered chronologically — used by the graph's "Timeline" view. */
export function orderChronologically(nodes) {
  return [...nodes].sort((a, b) => new Date(a.issueDate) - new Date(b.issueDate));
}
