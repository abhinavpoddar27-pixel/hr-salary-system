/**
 * Loans engine — repayment schedule (Loans PR-2, docs/loans/SPEC.md §5.2 r3, K11).
 *
 * Interest-free only (D-2). EMI = principal ÷ tenure, rounded UP to the rupee;
 * the last instalment is the remainder (it absorbs any paisa), so the
 * instalments always sum exactly to the principal:
 *   ₹10,000 over 3 → ₹3,334, ₹3,334, ₹3,332.
 * Pure functions on integer paise, except closedMonths() which reads loan_closes.
 */
const { addMonths, compareMonth, monthIndex, dateToMonth, isValidMonth } = require('./months');

/** EMI in paise for a principal (paise) over n months: ceil to the whole rupee. */
function emiFor(principalPaise, tenure) {
  const unit = tenure * 100;
  return Math.floor((principalPaise + unit - 1) / unit) * 100;
}

/** Largest tenure ≤ maxTenure for which a schedule can be formed (last instalment > 0). */
function maxWorkableTenure(principalPaise, maxTenure) {
  for (let n = maxTenure; n >= 1; n--) {
    if (principalPaise - (n - 1) * emiFor(principalPaise, n) > 0) return n;
  }
  return 1;
}

/**
 * @param {{principalPaise:number, tenure:number, firstMonth:{month,year}}} p
 * @returns {{ok:true, emiPaise:number, instalments:Array<{sequence,month,year,amountPaise}>}
 *          | {ok:false, code:string, message:string, maxTenure?:number}}
 */
function buildSchedule({ principalPaise, tenure, firstMonth }) {
  if (!Number.isInteger(principalPaise) || principalPaise <= 0) {
    return { ok: false, code: 'AMOUNT_INVALID', message: 'principal must be a positive amount' };
  }
  if (!Number.isInteger(tenure) || tenure < 1) {
    return { ok: false, code: 'TENURE_INVALID', message: 'tenure must be a whole number of months, at least 1' };
  }
  if (!isValidMonth(firstMonth)) {
    return { ok: false, code: 'MONTH_INVALID', message: 'first EMI month is invalid' };
  }
  const emi = tenure === 1 ? principalPaise : emiFor(principalPaise, tenure);
  const last = principalPaise - (tenure - 1) * emi;
  if (last <= 0) {
    const maxTenure = maxWorkableTenure(principalPaise, tenure);
    return {
      ok: false, code: 'TENURE_TOO_LONG_FOR_AMOUNT', maxTenure,
      message: `₹${principalPaise / 100} cannot be spread over ${tenure} months with a whole-rupee EMI; at most ${maxTenure} months`,
    };
  }
  const instalments = [];
  for (let i = 0; i < tenure; i++) {
    const m = addMonths(firstMonth, i);
    instalments.push({ sequence: i + 1, month: m.month, year: m.year, amountPaise: i === tenure - 1 ? last : emi });
  }
  return { ok: true, emiPaise: emi, instalments };
}

/**
 * Schedule by a fixed EMI (restructure "new EMI"): as many whole EMIs as fit,
 * the remainder as the last instalment.
 */
function buildScheduleByEmi({ principalPaise, emiPaise, firstMonth }) {
  if (!Number.isInteger(emiPaise) || emiPaise <= 0 || emiPaise % 100 !== 0) {
    return { ok: false, code: 'EMI_INVALID', message: 'EMI must be a positive whole-rupee amount' };
  }
  const tenure = Math.ceil(principalPaise / emiPaise);
  const res = buildSchedule({ principalPaise, tenure, firstMonth });
  if (!res.ok) return res;
  // buildSchedule derives its own EMI; with tenure = ceil(P/emi) that EMI can be
  // lower than the one asked for, so lay the schedule out with the asked EMI.
  const instalments = res.instalments.map((ins, i) => ({
    ...ins, amountPaise: i === tenure - 1 ? principalPaise - (tenure - 1) * emiPaise : emiPaise,
  }));
  return { ok: true, emiPaise, instalments, tenure };
}

/** Set of monthIndex values already closed for a payroll ('plant' | 'sales'). */
function closedMonths(db, payroll) {
  const rows = db.prepare('SELECT month, year FROM loan_closes WHERE payroll = ?').all(payroll);
  return new Set(rows.map((r) => monthIndex(r)));
}

/**
 * First EMI month (K11, coordinator ruling Q2): the first month AFTER the
 * disbursement month whose loan close has not happened for the borrower's
 * payroll. Finance may ask for a later month, never an earlier one.
 * @returns {{ok:true, month:{month,year}, earliest:{month,year}} | {ok:false, code, message, earliest?}}
 */
function firstEmiMonth({ disbursedOn, closed, requested }) {
  const dm = dateToMonth(disbursedOn);
  if (!dm) return { ok: false, code: 'DATE_INVALID', message: 'disbursement date must be YYYY-MM-DD' };
  let earliest = addMonths(dm, 1);
  while (closed && closed.has(monthIndex(earliest))) earliest = addMonths(earliest, 1);
  if (requested) {
    if (!isValidMonth(requested)) return { ok: false, code: 'MONTH_INVALID', message: 'requested first EMI month is invalid' };
    if (compareMonth(requested, earliest) < 0 || (closed && closed.has(monthIndex(requested)))) {
      return { ok: false, code: 'FIRST_EMI_TOO_EARLY', earliest, message: `first EMI month cannot be earlier than ${earliest.year}-${String(earliest.month).padStart(2, '0')}` };
    }
    return { ok: true, month: { month: requested.month, year: requested.year }, earliest };
  }
  return { ok: true, month: earliest, earliest };
}

module.exports = { emiFor, maxWorkableTenure, buildSchedule, buildScheduleByEmi, closedMonths, firstEmiMonth };
