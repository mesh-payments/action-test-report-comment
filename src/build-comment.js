// Pure comment-builder. Takes a normalized data object (no filesystem
// reads, no env lookups) and returns the markdown body. Keeping this
// side-effect-free is what lets the golden-file tests in test/
// reproduce the rendered output byte-for-byte.

// Status emoji for a suite row:
//   ✅ all green   ❌ any failure   ⏭️ no run (skipped/opt-in)
function suiteStatus(r) {
    if (!r) return '⏭️';
    if (r.failures > 0) return '❌';
    return '✅';
}

// Coverage thresholds: 🟢 ≥80, 🟡 ≥50, 🔴 <50. Applied per metric.
function coverageDot(pct) {
    if (pct >= 80) return '🟢';
    if (pct >= 50) return '🟡';
    return '🔴';
}

function coverageTable(cov) {
    const rows = [
        ['Statements', cov.statements],
        ['Branches', cov.branches],
        ['Functions', cov.functions],
        ['Lines', cov.lines]
    ];
    const header = '| St. | Category | Percentage | Covered / Total |';
    const sep = '|:---:|:---------|-----------:|:----------------|';
    const body = rows.map(([label, m]) => {
        const pct = typeof m?.pct === 'number' ? m.pct : 0;
        const covered = m?.covered ?? 0;
        const total = m?.total ?? 0;
        return `| ${coverageDot(pct)} | ${label} | ${pct.toFixed(2)}% | ${covered} / ${total} |`;
    });
    return [header, sep, ...body].join('\n');
}

function suiteRow(name, r, fallback) {
    if (!r) {
        return `| ${name} | ${suiteStatus(null)} | — | — | — | ${fallback} |`;
    }
    return `| ${name} | ${suiteStatus(r)} | ${r.passed} | ${r.failures} | ${r.skipped} | ${r.tests} |`;
}

// Suites table is rendered when any junit data is present. With only
// one suite the table has one row — no special-case formatting branch.
// When the opt-in gate is off, the e2e step typically still runs but
// Playwright skips the gated specs internally → junit shows 0 tests.
// We render that as "skipped (opt-in)" rather than a misleading all-zero
// row. The gate signal is the input flag, not the junit contents alone
// — step outcome doesn't disambiguate either, because the e2e step
// typically still exits 0 in this case.
function suitesTable({
    unit,
    e2e,
    e2eFeatureName,
    e2eOptIn,
    hasUnitJunitInput,
    hasE2EJunitInput
}) {
    const lines = [
        '| Suite | Status | Passed | Failed | Skipped | Total |',
        '|:------|:------:|-------:|-------:|--------:|------:|'
    ];
    if (hasUnitJunitInput) {
        lines.push(suiteRow('Unit', unit, '_no results_'));
    }
    if (hasE2EJunitInput) {
        const e2eRow =
            !e2eOptIn && (!e2e || e2e.tests === 0)
                ? `| ${e2eFeatureName} | ${suiteStatus(null)} | — | — | — | _skipped (opt-in)_ |`
                : suiteRow(e2eFeatureName, e2e, '_no results_');
        lines.push(e2eRow);
    }
    return lines.join('\n');
}

// Per-file weak-spots: files whose Lines % is below the green threshold
// (default 80). Collapsed into a <details> block so the comment stays
// compact on repos with a long tail. Sorted ascending by Lines % so the
// worst offenders surface first. Capped at `limit` rows to stay well
// under GitHub's 65 536-char comment limit and keep the table readable.
// When the cap trims rows, the summary line shows "showing X of Y" so
// the truncation is explicit.
function weakFilesSection({ perFile, repoRoot, threshold, limit }) {
    const rows = Object.entries(perFile || {})
        .map(([absPath, m]) => ({
            // coverage paths are absolute from the runner's perspective.
            // Strip the workspace prefix so rendered paths are
            // repo-relative and stable across runs.
            path:
                repoRoot && absPath.startsWith(repoRoot + '/')
                    ? absPath.slice(repoRoot.length + 1)
                    : absPath,
            lines: m?.lines?.pct ?? 0,
            statements: m?.statements?.pct ?? 0,
            branches: m?.branches?.pct ?? 0,
            functions: m?.functions?.pct ?? 0
        }))
        .filter((r) => r.lines < threshold)
        .sort((a, b) => a.lines - b.lines);

    if (rows.length === 0) {
        return `_All files at or above ${threshold}% line coverage._`;
    }

    const shown = rows.slice(0, limit);
    const truncated = rows.length > limit;
    const summary = truncated
        ? `showing ${shown.length} of ${rows.length} file(s) below ${threshold}% line coverage`
        : `${rows.length} file(s) below ${threshold}% line coverage`;

    const header = '| File | Lines | Statements | Branches | Functions |';
    const sep = '|:-----|------:|-----------:|---------:|----------:|';
    const body = shown.map(
        (r) =>
            `| \`${r.path}\` | ${r.lines.toFixed(2)}% | ${r.statements.toFixed(2)}% | ` +
            `${r.branches.toFixed(2)}% | ${r.functions.toFixed(2)}% |`
    );
    return [
        `<details><summary>${summary}</summary>`,
        '',
        header,
        sep,
        ...body,
        '',
        '</details>'
    ].join('\n');
}

// Build the create/update sticky body. Inputs are already normalized;
// missing values render as their fallback rather than throwing.
function buildComment({
    coverage,
    unit,
    e2e,
    hasUnitJunitInput,
    hasE2EJunitInput,
    e2eFeatureName = 'E2E',
    e2eOptIn = false,
    e2eSkipNote = '',
    weakFiles = false,
    weakThreshold = 80,
    weakLimit = 50,
    repoRoot,
    playwrightFooterNote = ''
}) {
    const parts = ['### Test results', ''];

    const showSuites = hasUnitJunitInput || hasE2EJunitInput;
    if (showSuites) {
        parts.push(
            '#### Suites',
            suitesTable({
                unit,
                e2e,
                e2eFeatureName,
                e2eOptIn,
                hasUnitJunitInput,
                hasE2EJunitInput
            })
        );
        // Skip-note is repo-supplied prose. Render only when the E2E row
        // is actually showing "skipped (opt-in)" — otherwise the note
        // contradicts the row above it.
        const e2eShownAsSkipped =
            hasE2EJunitInput && !e2eOptIn && (!e2e || e2e.tests === 0);
        if (e2eShownAsSkipped && e2eSkipNote) {
            parts.push('', `> ${e2eSkipNote}`);
        }
        parts.push('');
    }

    if (coverage) {
        parts.push(
            '#### Coverage',
            coverageTable(coverage.total)
        );
        // Off by default. The block is sorted worst-first, so publishing it
        // on every PR reads as a ranked worklist of files to add tests to,
        // which is satisfied as well by a test asserting a rendered string as
        // by one testing a flow. Opt in with the weak-files input.
        if (weakFiles) {
            const weak = weakFilesSection({
                perFile: coverage.perFile,
                repoRoot,
                threshold: weakThreshold,
                limit: weakLimit
            });
            if (weak) parts.push('', weak);
        }
    } else {
        parts.push('#### Coverage', '_no coverage data_');
    }

    // Playwright footer is a blockquote rather than italics: GitHub's
    // markdown parser reads a `_…_` line that sits directly after a
    // closing </details> as a setext heading underline for the previous
    // block and renders it as an <h2>. Blockquote matches the visual
    // weight we want (muted informational note) and is unambiguous.
    if (playwrightFooterNote) {
        parts.push('', `> ${playwrightFooterNote}`);
    }

    return parts.join('\n');
}

// Append-mode body: rendered as a separator + URL block. The consumer's
// downstream job (e.g. after a Pages deploy) calls the action again
// with the same `comment-header` and a populated `playwright-report-url`
// to append this block to the existing sticky.
function buildPlaywrightAppend({ url, runUrl, runId, commitSha, note }) {
    const lines = ['', '---', ''];
    lines.push(`**Playwright report:** ${url}`);
    if (runUrl && runId) {
        lines.push(`**Run:** [#${runId}](${runUrl})`);
    } else if (runId) {
        lines.push(`**Run:** #${runId}`);
    }
    if (commitSha) lines.push(`**Commit:** \`${commitSha}\``);
    if (note) {
        lines.push('', note);
    }
    return lines.join('\n');
}

module.exports = {
    buildComment,
    buildPlaywrightAppend,
    coverageTable,
    suitesTable,
    weakFilesSection,
    coverageDot,
    suiteStatus
};
