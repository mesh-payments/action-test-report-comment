const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const {
    buildComment,
    buildPlaywrightAppend,
    weakFilesSection
} = require('../src/build-comment');
const { loadCoverage } = require('../src/parse-coverage');
const { parseJunitFile } = require('../src/parse-junit');
const { makeManyWeakFiles } = require('./helpers/make-many-weak-files');

const fx = (n) => path.join(__dirname, 'fixtures', n);
const REPO_ROOT = '/runner/work/repo/repo';

function read(name) {
    return fs.readFileSync(path.join(__dirname, 'golden', name), 'utf8');
}

// ---------- 1. Coverage-only Jest call ----------
test('coverage-only Jest call: Coverage only, no Suites, no footer', () => {
    const coverage = loadCoverage({
        coverageReportPath: fx('coverage-report.jest.json')
    });
    const body = buildComment({
        coverage,
        hasUnitJunitInput: false,
        hasE2EJunitInput: false,
        repoRoot: REPO_ROOT
    });
    assert.equal(body, read('coverage-only-jest.md'));
});

// ---------- 2. Single-suite Unit-only ----------
test('single-suite Unit-only: Suites table with one row', () => {
    const unit = parseJunitFile(fx('junit-unit.xml'));
    const coverage = loadCoverage({
        coverageSummaryPath: fx('coverage-summary.v8.json')
    });
    const body = buildComment({
        coverage,
        unit,
        hasUnitJunitInput: true,
        hasE2EJunitInput: false,
        repoRoot: REPO_ROOT
    });
    assert.equal(body, read('unit-only.md'));
});

// ---------- 3. Full Vitest + e2e + Playwright ----------
test('full Vitest + e2e + Playwright shape', () => {
    const unit = parseJunitFile(fx('junit-unit.xml'));
    const e2e = parseJunitFile(fx('junit-e2e-passing.xml'));
    const coverage = loadCoverage({
        coverageSummaryPath: fx('coverage-summary.v8.json')
    });
    const body = buildComment({
        coverage,
        unit,
        e2e,
        hasUnitJunitInput: true,
        hasE2EJunitInput: true,
        e2eOptIn: true,
        e2eFeatureName: 'E2E',
        repoRoot: REPO_ROOT,
        playwrightFooterNote: 'Playwright report is only published on failure.'
    });
    assert.equal(body, read('full-vitest-e2e-playwright.md'));
});

// ---------- 4. Missing-junit fallback path ----------
test('missing-junit fallback: still renders Coverage section', () => {
    const coverage = loadCoverage({
        coverageSummaryPath: fx('coverage-summary.v8.json')
    });
    // Caller declared a unit-junit input path but the file is missing →
    // parseJunitFile returns null; we still render the Unit row as
    // "_no results_" so the absence is visible.
    const body = buildComment({
        coverage,
        unit: null,
        hasUnitJunitInput: true,
        hasE2EJunitInput: false,
        repoRoot: REPO_ROOT
    });
    assert.equal(body, read('missing-junit.md'));
});

// ---------- 5. Weak-files cap at 50 with "showing X of Y" ----------
test('weak-files cap at 50 produces "showing 50 of N" summary', () => {
    const fakeSummary = makeManyWeakFiles(60, { repoRoot: REPO_ROOT });
    const { fromV8Summary } = require('../src/parse-coverage');
    const coverage = fromV8Summary(fakeSummary);
    const body = buildComment({
        coverage,
        hasUnitJunitInput: false,
        hasE2EJunitInput: false,
        weakFiles: true,
        repoRoot: REPO_ROOT
    });
    assert.match(
        body,
        /<summary>showing 50 of 60 file\(s\) below 80% line coverage<\/summary>/
    );
    // First row is the worst offender (line coverage 10).
    assert.match(body, /file-000\.ts.*\| 10\.00%/);
    // 51st row (file index 50) must not appear.
    assert.equal(body.includes('file-050.ts'), false);
});

// ---------- 6. Opt-in-off → E2E row reads "_skipped (opt-in)_" ----------
test('opt-in-off path renders E2E as "_skipped (opt-in)_" even when junit has zero tests', () => {
    const unit = parseJunitFile(fx('junit-unit.xml'));
    const e2e = parseJunitFile(fx('junit-e2e-empty.xml'));
    const coverage = loadCoverage({
        coverageSummaryPath: fx('coverage-summary.v8.json')
    });
    const body = buildComment({
        coverage,
        unit,
        e2e,
        hasUnitJunitInput: true,
        hasE2EJunitInput: true,
        e2eOptIn: false,
        e2eFeatureName: 'E2E',
        e2eSkipNote:
            'E2E is gated on `RUN_E2E` and did not run on this PR.',
        repoRoot: REPO_ROOT,
        playwrightFooterNote: 'Playwright report is only published on failure.'
    });
    assert.equal(body, read('opt-in-off.md'));
});

// ---------- 7. Append-mode body ----------
test('append-mode body renders the Playwright report block', () => {
    const body = buildPlaywrightAppend({
        url: 'https://example.github.io/my-app/',
        runUrl:
            'https://github.com/example/my-app/actions/runs/12345',
        runId: '12345',
        commitSha: 'abc1234',
        note: 'Report includes screenshots, video, and trace viewer per failure.'
    });
    assert.equal(body, read('append-playwright.md'));
});

// ---------- 8. weak-files flag, both directions ----------
test('weak-files off (default): the per-file block is absent', () => {
    const coverage = loadCoverage({
        coverageReportPath: fx('coverage-report.jest.json')
    });
    // Prove the fixture actually has files under the threshold first, so
    // the absence asserted below is caused by the flag and not by there
    // being nothing to render.
    const rendered = weakFilesSection({
        perFile: coverage.perFile,
        repoRoot: REPO_ROOT,
        threshold: 80,
        limit: 50
    });
    assert.match(rendered, /file\(s\) below 80% line coverage/);

    const body = buildComment({
        coverage,
        hasUnitJunitInput: false,
        hasE2EJunitInput: false,
        repoRoot: REPO_ROOT
    });
    assert.equal(body.includes('<details>'), false);
    assert.equal(body.includes('line coverage'), false);
    // The overall Coverage table stays.
    assert.match(body, /#### Coverage/);
    assert.match(body, /\| Lines \|/);
});

test('weak-files on: the per-file block is rendered', () => {
    const coverage = loadCoverage({
        coverageReportPath: fx('coverage-report.jest.json')
    });
    const body = buildComment({
        coverage,
        hasUnitJunitInput: false,
        hasE2EJunitInput: false,
        weakFiles: true,
        repoRoot: REPO_ROOT
    });
    assert.match(
        body,
        /<summary>\d+ file\(s\) below 80% line coverage<\/summary>/
    );
});

// ---------- Custom e2e feature name ----------
test('e2eFeatureName labels the E2E row', () => {
    const unit = parseJunitFile(fx('junit-unit.xml'));
    const e2e = parseJunitFile(fx('junit-e2e-passing.xml'));
    const body = buildComment({
        coverage: null,
        unit,
        e2e,
        hasUnitJunitInput: true,
        hasE2EJunitInput: true,
        e2eOptIn: true,
        e2eFeatureName: 'E2E (RUN_E2E)',
        repoRoot: REPO_ROOT
    });
    assert.match(body, /\| E2E \(RUN_E2E\) \| ✅/);
});

// ---------- No-coverage fallback ----------
test('no coverage data renders the placeholder', () => {
    const body = buildComment({
        coverage: null,
        hasUnitJunitInput: false,
        hasE2EJunitInput: false,
        repoRoot: REPO_ROOT
    });
    assert.match(body, /#### Coverage\n_no coverage data_/);
});
