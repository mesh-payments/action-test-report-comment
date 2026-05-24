// Two coverage shapes are supported:
//
//   1. v8 `coverage-summary.json` (Vitest's json-summary reporter) —
//      already aggregated: `{ total: {...}, "<abs>/file.ts": {...} }`
//      where each entry has { statements, branches, functions, lines }
//      with { pct, covered, total } fields.
//
//   2. Jest `coverage-report.json` (the `--json --coverage
//      --testLocationInResults` shape used by ~100 consumers) — carries
//      a raw istanbul `coverageMap` we have to aggregate ourselves, plus
//      `numTotalTests` / `numPassedTests` / ... at the top level.
//
// `loadCoverage` returns a uniform internal shape:
//   { total: { statements, branches, functions, lines }, perFile: {<absPath>: {...}}, testCounts?: {...} }

const { readFileSync, existsSync } = require('node:fs');

function emptyMetric() {
    return { pct: 0, covered: 0, total: 0 };
}

function metricFromIstanbul(numerator, denominator) {
    const pct = denominator > 0 ? (numerator / denominator) * 100 : 100;
    return { pct, covered: numerator, total: denominator };
}

// Aggregate one entry from istanbul's `coverageMap`:
//   s: { "<id>": <hitCount> }    statements
//   f: { "<id>": <hitCount> }    functions
//   b: { "<id>": [<hit>, ...] }  branches (one count per arm)
// Lines are derived from statementMap line numbers — Jest's
// coverage-summary does the same. We follow that convention so the
// rendered numbers match what consumers saw under the dropped action.
function aggregateIstanbulEntry(entry) {
    const statements = Object.values(entry.s || {});
    const stTotal = statements.length;
    const stCovered = statements.filter((c) => c > 0).length;

    const functions = Object.values(entry.f || {});
    const fnTotal = functions.length;
    const fnCovered = functions.filter((c) => c > 0).length;

    const branchArms = Object.values(entry.b || {}).flat();
    const brTotal = branchArms.length;
    const brCovered = branchArms.filter((c) => c > 0).length;

    // Lines: collapse statement hits onto their source line number, then
    // count distinct lines that were ever hit.
    const statementMap = entry.statementMap || {};
    const lineHits = new Map();
    for (const id of Object.keys(statementMap)) {
        const line = statementMap[id]?.start?.line;
        if (line == null) continue;
        const hit = (entry.s || {})[id] > 0;
        const prev = lineHits.get(line);
        lineHits.set(line, prev || hit);
    }
    let lnTotal = 0;
    let lnCovered = 0;
    for (const hit of lineHits.values()) {
        lnTotal++;
        if (hit) lnCovered++;
    }

    return {
        statements: metricFromIstanbul(stCovered, stTotal),
        branches: metricFromIstanbul(brCovered, brTotal),
        functions: metricFromIstanbul(fnCovered, fnTotal),
        lines: metricFromIstanbul(lnCovered, lnTotal)
    };
}

function sumMetrics(a, b) {
    return {
        covered: a.covered + b.covered,
        total: a.total + b.total
    };
}

function fromV8Summary(raw) {
    const perFile = {};
    let totalEntry = null;
    for (const [k, v] of Object.entries(raw)) {
        if (k === 'total') {
            totalEntry = v;
            continue;
        }
        perFile[k] = normalizeSummaryEntry(v);
    }
    const total = totalEntry
        ? normalizeSummaryEntry(totalEntry)
        : aggregateTotalFromPerFile(perFile);
    return { total, perFile };
}

function normalizeSummaryEntry(v) {
    const pick = (m) => ({
        pct: typeof m?.pct === 'number' ? m.pct : 0,
        covered: m?.covered ?? 0,
        total: m?.total ?? 0
    });
    return {
        statements: pick(v?.statements),
        branches: pick(v?.branches),
        functions: pick(v?.functions),
        lines: pick(v?.lines)
    };
}

function aggregateTotalFromPerFile(perFile) {
    const keys = ['statements', 'branches', 'functions', 'lines'];
    const acc = Object.fromEntries(keys.map((k) => [k, { covered: 0, total: 0 }]));
    for (const m of Object.values(perFile)) {
        for (const k of keys) {
            const next = sumMetrics(acc[k], m[k]);
            acc[k] = next;
        }
    }
    const out = {};
    for (const k of keys) {
        out[k] = {
            covered: acc[k].covered,
            total: acc[k].total,
            pct: acc[k].total > 0 ? (acc[k].covered / acc[k].total) * 100 : 100
        };
    }
    return out;
}

function fromJestReport(raw) {
    const map = raw.coverageMap || {};
    const perFile = {};
    for (const [absPath, entry] of Object.entries(map)) {
        perFile[absPath] = aggregateIstanbulEntry(entry);
    }
    const total = aggregateTotalFromPerFile(perFile);
    const testCounts =
        typeof raw.numTotalTests === 'number'
            ? {
                  tests: raw.numTotalTests ?? 0,
                  passed: raw.numPassedTests ?? 0,
                  failures: raw.numFailedTests ?? 0,
                  skipped:
                      (raw.numPendingTests ?? 0) + (raw.numTodoTests ?? 0)
              }
            : null;
    return { total, perFile, testCounts };
}

function detectShape(raw) {
    if (raw && typeof raw === 'object') {
        if (raw.coverageMap || typeof raw.numTotalTests === 'number') return 'jest';
        // v8 summary always has a `total` key plus per-file paths.
        if (raw.total && raw.total.lines) return 'v8';
    }
    return 'unknown';
}

function loadCoverage({ coverageSummaryPath, coverageReportPath }) {
    // Prefer v8 when both are provided — it's pre-aggregated, cheaper,
    // and matches what Vitest natively emits.
    if (coverageSummaryPath && existsSync(coverageSummaryPath)) {
        const raw = JSON.parse(readFileSync(coverageSummaryPath, 'utf8'));
        const shape = detectShape(raw);
        if (shape === 'v8') return fromV8Summary(raw);
        if (shape === 'jest') return fromJestReport(raw);
        return { total: emptyTotal(), perFile: {} };
    }
    if (coverageReportPath && existsSync(coverageReportPath)) {
        const raw = JSON.parse(readFileSync(coverageReportPath, 'utf8'));
        const shape = detectShape(raw);
        if (shape === 'jest') return fromJestReport(raw);
        if (shape === 'v8') return fromV8Summary(raw);
        return { total: emptyTotal(), perFile: {} };
    }
    return null;
}

function emptyTotal() {
    return {
        statements: emptyMetric(),
        branches: emptyMetric(),
        functions: emptyMetric(),
        lines: emptyMetric()
    };
}

module.exports = {
    loadCoverage,
    fromV8Summary,
    fromJestReport,
    aggregateIstanbulEntry,
    aggregateTotalFromPerFile,
    detectShape
};
