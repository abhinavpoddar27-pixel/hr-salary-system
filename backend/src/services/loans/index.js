/**
 * Loans engine (Loans PR-2) — public façade. See docs/loans/SPEC.md.
 * Route-free: PR-3 builds the API on this, PR-5 / PR-6 call the ledger
 * building blocks from Stage 7 and the loan close.
 */
module.exports = {
  ...require('./policy'),
  ...require('./schedule'),
  ...require('./headroom'),
  ...require('./states'),
  ...require('./eligibility'),
  ...require('./lifecycle'),
  ...require('./ledger'),
  ...require('./receipts'),
  ...require('./changes'),
  ...require('./requests'),
  ...require('./reconcile'),
  money: require('./money'),
  months: require('./months'),
};
