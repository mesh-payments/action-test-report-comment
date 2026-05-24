const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
    loadCoverage,
    fromV8Summary,
    fromJestReport,
    aggregateIstanbulEntry,
    detectShape
} = require('../src/parse-coverage');

const fx = (n) => path.join(__dirname, 'fixtures', n);

test('detects v8 summary shape', () => {
    const raw = require(fx('coverage-summary.v8.json'));
    assert.equal(detectShape(raw), 'v8');
});

test('detects Jest report shape', () => {
    const raw = require(fx('coverage-report.jest.json'));
    assert.equal(detectShape(raw), 'jest');
});

test('loadCoverage picks v8 summary first when both provided', () => {
    const c = loadCoverage({
        coverageSummaryPath: fx('coverage-summary.v8.json'),
        coverageReportPath: fx('coverage-report.jest.json')
    });
    assert.equal(c.total.statements.pct, 36.67);
    assert.equal(c.total.lines.covered, 2666);
});

test('loadCoverage parses Jest report when only that is provided', () => {
    const c = loadCoverage({
        coverageReportPath: fx('coverage-report.jest.json')
    });
    // format.ts: 5 stmts, 1 covered → 20% statements
    const formatTs =
        c.perFile['/runner/work/repo/repo/src/utils/format.ts'];
    assert.ok(formatTs);
    assert.equal(formatTs.statements.total, 5);
    assert.equal(formatTs.statements.covered, 1);
    // Top-level test counts surface for the fallback path.
    assert.deepEqual(c.testCounts, {
        tests: 142,
        passed: 140,
        failures: 0,
        skipped: 2
    });
});

test('istanbul aggregator collapses statements onto distinct lines', () => {
    const entry = {
        statementMap: {
            '0': { start: { line: 1 } },
            '1': { start: { line: 1 } },
            '2': { start: { line: 2 } },
            '3': { start: { line: 3 } }
        },
        fnMap: { '0': {} },
        branchMap: { '0': {} },
        s: { '0': 1, '1': 1, '2': 0, '3': 0 },
        f: { '0': 1 },
        b: { '0': [1, 0] }
    };
    const m = aggregateIstanbulEntry(entry);
    // Lines: 3 distinct lines (1,2,3), 1 covered (line 1)
    assert.equal(m.lines.total, 3);
    assert.equal(m.lines.covered, 1);
    // Statements: 4 total, 2 covered
    assert.equal(m.statements.total, 4);
    assert.equal(m.statements.covered, 2);
    // Branches: 2 arms, 1 covered
    assert.equal(m.branches.total, 2);
    assert.equal(m.branches.covered, 1);
});

test('v8 summary aggregator preserves the supplied totals', () => {
    const raw = {
        total: {
            statements: { total: 100, covered: 80, pct: 80 },
            branches: { total: 20, covered: 10, pct: 50 },
            functions: { total: 10, covered: 9, pct: 90 },
            lines: { total: 100, covered: 70, pct: 70 }
        }
    };
    const c = fromV8Summary(raw);
    assert.equal(c.total.statements.pct, 80);
    assert.equal(c.total.lines.covered, 70);
});

test('Jest report with no coverageMap returns empty perFile', () => {
    const c = fromJestReport({ numTotalTests: 0 });
    assert.deepEqual(c.perFile, {});
    assert.equal(c.total.lines.total, 0);
});

test('loadCoverage returns null when no input is provided', () => {
    assert.equal(loadCoverage({}), null);
});
