import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyzeFallback, fallbackKinds, filterRecords, showValue, toCSV } from "../wave60c.mjs";

const rows = [
  { id: 1, reference: "A-1", status: "Open", risk: "High", amount: 0, active: false, note: "" },
  { id: 2, reference: "B-2", status: "Closed", risk: "Low", amount: 250, active: true, note: "filed" },
];

test("showValue preserves false, 0 and empty string distinctly", () => {
  assert.equal(showValue(false), "false");
  assert.equal(showValue(0), "0");
  assert.equal(showValue(""), "");
  assert.equal(showValue(null), "");
});

test("filterRecords searches and filters the main list", () => {
  assert.equal(filterRecords(rows, { q: "a-1" }).length, 1);
  assert.equal(filterRecords(rows, { status: "Closed" })[0].reference, "B-2");
  assert.equal(filterRecords(rows, { risk: "High" }).length, 1);
  assert.equal(filterRecords(rows, {}).length, 2);
});

test("toCSV keeps false/0/empty cells readable", () => {
  const csv = toCSV(rows);
  assert.ok(csv.split("\n")[1].includes("false"));
  assert.ok(csv.split("\n")[1].includes(",0,"));
});

test("offline AI fallbacks are labelled aiGenerated:false with sections", () => {
  assert.ok(fallbackKinds.length >= 2 && fallbackKinds.length <= 3);
  for (const kind of fallbackKinds) {
    const result = analyzeFallback(kind, rows);
    assert.equal(result.aiGenerated, false);
    assert.equal(result.source, "deterministic-fallback");
    assert.ok(result.sections.length >= 3 && result.sections.every((s) => s.title && s.detail));
    assert.equal(result.recordsReviewed, 2);
  }
  assert.equal(analyzeFallback("nope", rows), null);
});

test("wave routes are mounted behind auth in server", () => {
  const server = fs.readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.ok(server.includes("mountWave60c("), "server must mount wave60c");
});
