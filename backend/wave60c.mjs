// Wave 60C — search/filter, CSV/JSON export, and deterministic offline AI
// fallbacks over this app's own records. No provider calls are made here:
// every analysis is computed locally and labelled aiGenerated:false.
export function showValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function filterRecords(rows, { q = "", status = "", risk = "" } = {}) {
  const needle = String(q || "").trim().toLowerCase();
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (status && String(row?.status ?? row?.state ?? "") !== status) return false;
    if (risk && String(row?.risk ?? "") !== risk) return false;
    if (!needle) return true;
    return Object.values(row || {}).some((v) => showValue(v).toLowerCase().includes(needle))
      || showValue(row?.payload).toLowerCase().includes(needle);
  });
}

export function toCSV(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const keys = [];
  for (const row of list) for (const key of Object.keys(row || {})) if (!keys.includes(key)) keys.push(key);
  const cell = (v) => { const s = showValue(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [keys.join(","), ...list.map((row) => keys.map((k) => cell(row?.[k])).join(","))].join("\n") + "\n";
}

export function fallbackEnvelope(kind, sections, extra = {}) {
  return {
    aiGenerated: false,
    source: "deterministic-fallback",
    label: "Deterministic offline fallback — not AI-generated",
    kind,
    sections,
    ...extra,
  };
}

function num(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function money(value) { return `$${num(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`; }
function payloadOf(row) { return row && typeof row.payload === "object" && row.payload !== null ? row.payload : {}; }
function amountOf(row) { return num(row?.amount ?? payloadOf(row).amount ?? payloadOf(row).billedAmount ?? payloadOf(row).propertyAmount); }

const ANALYZERS = {
  "franchise-variance-scan": (rows) => {
    const total = rows.reduce((sum, row) => sum + amountOf(row), 0);
    const open = rows.filter((row) => !["Closed", "Approved", "DONE"].includes(String(row?.status ?? row?.state ?? ""))).length;
    const flagged = rows.filter((row) => ["High", "Critical"].includes(String(row?.risk ?? ""))).length;
    return fallbackEnvelope("franchise-variance-scan", [
      { title: "Franchise variance scan — scope", detail: `${rows.length} record(s) reviewed; ${open} still open; ${flagged} high/critical risk. Total recorded amount ${money(total)} (zero amounts are preserved, not hidden).` },
      { title: "Franchise variance scan — finding", detail: `${flagged} record(s) carry High/Critical risk; compare billed versus recalculated franchise fees on the ${open} open record(s).` },
      { title: "Franchise variance scan — next step", detail: "Assign an accountable owner, attach source evidence, and re-run this check after the record is updated." },
    ], { recordsReviewed: rows.length, openCount: open, flaggedCount: flagged, totalAmount: total });
  },
  "tariff-exception-rank": (rows) => {
    const total = rows.reduce((sum, row) => sum + amountOf(row), 0);
    const open = rows.filter((row) => !["Closed", "Approved", "DONE"].includes(String(row?.status ?? row?.state ?? ""))).length;
    const flagged = rows.filter((row) => ["High", "Critical"].includes(String(row?.risk ?? ""))).length;
    return fallbackEnvelope("tariff-exception-rank", [
      { title: "Tariff exception rank — scope", detail: `${rows.length} record(s) reviewed; ${open} still open; ${flagged} high/critical risk. Total recorded amount ${money(total)} (zero amounts are preserved, not hidden).` },
      { title: "Tariff exception rank — finding", detail: `Rank open exceptions by recorded amount (total ${money(total)}); validate meter and tariff evidence before disputing charges.` },
      { title: "Tariff exception rank — next step", detail: "Assign an accountable owner, attach source evidence, and re-run this check after the record is updated." },
    ], { recordsReviewed: rows.length, openCount: open, flaggedCount: flagged, totalAmount: total });
  },
  "recovery-summary": (rows) => {
    const total = rows.reduce((sum, row) => sum + amountOf(row), 0);
    const open = rows.filter((row) => !["Closed", "Approved", "DONE"].includes(String(row?.status ?? row?.state ?? ""))).length;
    const flagged = rows.filter((row) => ["High", "Critical"].includes(String(row?.risk ?? ""))).length;
    return fallbackEnvelope("recovery-summary", [
      { title: "Recovery summary — scope", detail: `${rows.length} record(s) reviewed; ${open} still open; ${flagged} high/critical risk. Total recorded amount ${money(total)} (zero amounts are preserved, not hidden).` },
      { title: "Recovery summary — finding", detail: `Potential recovery pool is ${money(total)} across ${rows.length} record(s); retain calculation evidence for each claimed variance.` },
      { title: "Recovery summary — next step", detail: "Assign an accountable owner, attach source evidence, and re-run this check after the record is updated." },
    ], { recordsReviewed: rows.length, openCount: open, flaggedCount: flagged, totalAmount: total });
  }
};

export function analyzeFallback(kind, records) {
  const fn = ANALYZERS[kind];
  if (!fn) return null;
  return fn(Array.isArray(records) ? records : records ? [records] : []);
}
export const fallbackKinds = Object.keys(ANALYZERS);

export function mountWave60c(app, { pool, auth, featureById, table = "feature_records", featureScoped = false } = {}) {
  const guard = typeof auth === "function" ? auth : (_req, _res, next) => next();
  async function loadRows(req) {
    if (featureScoped) {
      featureById(req.params.id);
      return (await pool.query("SELECT * FROM feature_records WHERE feature_id=$1 ORDER BY updated_at DESC, id DESC", [req.params.id])).rows;
    }
    return (await pool.query(`SELECT * FROM ${table} ORDER BY due_date ASC NULLS LAST, id DESC LIMIT 500`)).rows;
  }
  const searchPath = featureScoped ? "/api/features/:id/records/search" : "/api/records/search";
  const exportPath = featureScoped ? "/api/features/:id/records/export" : "/api/records/export";
  app.get(searchPath, guard, async (req, res, next) => {
    try {
      const items = filterRecords(await loadRows(req), { q: req.query.q, status: req.query.status, risk: req.query.risk });
      res.json({ items, count: items.length });
    } catch (error) { next(error); }
  });
  app.get(exportPath, guard, async (req, res, next) => {
    try {
      const items = filterRecords(await loadRows(req), { q: req.query.q, status: req.query.status, risk: req.query.risk });
      if (String(req.query.format || "csv").toLowerCase() === "json") return res.json({ items, count: items.length });
      res.type("text/csv").set("Content-Disposition", "attachment; filename=records.csv").send(toCSV(items));
    } catch (error) { next(error); }
  });
  app.post("/api/ai/fallback/:kind", guard, async (req, res) => {
    const records = req.body?.records ?? req.body?.record ?? [];
    const result = analyzeFallback(req.params.kind, records);
    if (!result) return res.status(404).json({ error: "Unknown fallback analysis", kinds: fallbackKinds });
    res.json({ result });
  });
}
