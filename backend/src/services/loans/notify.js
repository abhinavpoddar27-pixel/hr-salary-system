/**
 * Loans engine — notifications (Loans PR-6). Best effort: never throws.
 *
 * Written directly to `notifications` (like routes/loans.js notify), not through
 * monthEndScheduler.createNotification, which de-duplicates on type + message per
 * day across ALL roles. Here the same message may go to finance and to admin, and
 * a repeat to the same role on the same UTC day is skipped (the daily close /
 * sweep re-checks every morning and must not pile up identical rows).
 */
function notify(db, roleTarget, type, message, link = '/loans') {
  try {
    const dup = db.prepare(`SELECT 1 FROM notifications WHERE role_target = ? AND type = ? AND message = ?
                              AND date(created_at) = date('now') LIMIT 1`).get(roleTarget, type, message);
    if (dup) return false;
    db.prepare('INSERT INTO notifications (role_target, type, title, message, link, action_url) VALUES (?, ?, ?, ?, ?, ?)')
      .run(roleTarget, type, message, message, link, link);
    return true;
  } catch (e) {
    console.warn('[loans] notification failed:', e.message);
    return false;
  }
}

/** One notification per engine alert ({type, audience, message}). */
function notifyAlerts(db, alerts) {
  for (const a of alerts || []) {
    if (a && a.message) notify(db, a.audience || 'finance', String(a.type || 'loan_alert').toUpperCase(), a.message);
  }
}

module.exports = { notify, notifyAlerts };
