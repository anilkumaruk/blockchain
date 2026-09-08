// Single source of truth for this prototype's reference institution.
// Credential records still carry their own `issuer` string (so the shape
// stays compatible with a future multi-institution data model, where each
// credential could reference a different institution by id) — but every
// place that needs *today's* institution name reads it from here instead
// of duplicating the literal string a second time.
export const REFERENCE_INSTITUTION = {
  id: 'alliance-university',
  name: 'Alliance University',
};
