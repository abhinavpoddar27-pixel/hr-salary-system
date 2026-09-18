/**
 * Contractor Report routes — READ ONLY. (PR-2, Sep 2026)
 * Mounted at /api/contractor-report behind the app-level requireAuth.
 *
 * Three GET endpoints, no writes of any kind — no INSERT, no UPDATE, no audit
 * row. Every endpoint carries the same HR / finance / admin gate; there is no
 * commission endpoint and no finance-only surface (AMENDMENT 1).
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const CFG = require('../config/contractorReportConfig');
const service = require('../services/contractorReport');

// Matches the local helper in early-exits.js / short-leaves.js. roles.js has
// no HR+finance+admin export, and adding one would touch a shared file that is
// outside this PR's allowed edits.
function requireHrFinanceOrAdmin(req, res, next) {
  const role = req.user?.role;
  if (role !== 'hr' && role !== 'finance' && role !== 'admin') {
    return res.status(403).json({ success: false, error: 'HR, finance, or admin access required' });
  }
  next();
}

const MIN_YEAR = 2024;
const MAX_YEAR = 2030;

const fail = (res, error) => res.status(400).json({ success: false, error });

/** month + year from the query string, or a 400-worthy message. */
function parseMonthYear(query) {
  const month = Number(query.month);
  const year = Number(query.year);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { error: 'month is required and must be an integer 1-12' };
  }
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    return { error: `year is required and must be an integer ${MIN_YEAR}-${MAX_YEAR}` };
  }
  return { month, year };
}

/** Strict YYYY-MM-DD, and a real calendar date (rejects 2026-02-30). */
function parseDate(value) {
  if (!value || typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { error: 'date is required and must be YYYY-MM-DD' };
  }
  const d = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    return { error: 'date is not a valid calendar date' };
  }
  const year = d.getUTCFullYear();
  if (year < MIN_YEAR || year > MAX_YEAR) {
    return { error: `date must fall within ${MIN_YEAR}-${MAX_YEAR}` };
  }
  return { date: value };
}

/** Optional company filter. Empty/absent means "all companies". */
function parseCompany(value) {
  if (value === undefined || value === null || String(value).trim() === '') return { company: null };
  const company = String(value).trim();
  if (company.length > 100) return { error: 'company is too long' };
  return { company };
}

// ── GET /month ────────────────────────────────────────────────────────────
router.get('/month', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const my = parseMonthYear(req.query);
    if (my.error) return fail(res, my.error);
    const co = parseCompany(req.query.company);
    if (co.error) return fail(res, co.error);

    const data = service.monthReport(getDb(), {
      month: my.month, year: my.year, company: co.company,
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error(`${req.requestId || ''} [contractor-report] /month failed:`, err);
    res.status(500).json({ success: false, error: 'Failed to build contractor month report' });
  }
});

// ── GET /day ──────────────────────────────────────────────────────────────
router.get('/day', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const d = parseDate(req.query.date);
    if (d.error) return fail(res, d.error);
    const co = parseCompany(req.query.company);
    if (co.error) return fail(res, co.error);

    const data = service.dayReport(getDb(), { date: d.date, company: co.company });
    res.json({ success: true, data });
  } catch (err) {
    console.error(`${req.requestId || ''} [contractor-report] /day failed:`, err);
    res.status(500).json({ success: false, error: 'Failed to build contractor day report' });
  }
});

// ── GET /grid ─────────────────────────────────────────────────────────────
router.get('/grid', requireHrFinanceOrAdmin, (req, res) => {
  try {
    const my = parseMonthYear(req.query);
    if (my.error) return fail(res, my.error);
    const co = parseCompany(req.query.company);
    if (co.error) return fail(res, co.error);

    const contractor = String(req.query.contractor || '').trim();
    if (!contractor) return fail(res, 'contractor is required');
    if (contractor.length > 100) return fail(res, 'contractor is too long');

    const db = getDb();

    // A contractor the config knows is always valid, even with nobody on
    // biometric that month (a daily-wage-only gang is a real case and must
    // render an empty grid, not a 400). Anything else has to actually appear
    // in the month's data, otherwise it is a typo and earns a 400.
    if (!CFG.knownContractorNames().includes(contractor)) {
      const seen = service.contractorNamesForMonth(db, {
        month: my.month, year: my.year, company: co.company,
      });
      if (!seen.includes(contractor)) {
        return fail(res, `Unknown contractor: ${contractor}`);
      }
    }

    const data = service.gridReport(db, {
      month: my.month, year: my.year, contractor, company: co.company,
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error(`${req.requestId || ''} [contractor-report] /grid failed:`, err);
    res.status(500).json({ success: false, error: 'Failed to build contractor grid report' });
  }
});

module.exports = router;
