// Generates a v8-summary-shaped object with N files all below the
// default 80% threshold, for use in the weak-files-cap test.

function makeManyWeakFiles(n, opts = {}) {
    const prefix = opts.repoRoot || '/runner/work/repo/repo';
    const obj = {
        total: {
            statements: { total: 100 * n, covered: 50 * n, skipped: 0, pct: 50 },
            branches: { total: 10 * n, covered: 5 * n, skipped: 0, pct: 50 },
            functions: { total: 10 * n, covered: 5 * n, skipped: 0, pct: 50 },
            lines: { total: 100 * n, covered: 50 * n, skipped: 0, pct: 50 }
        }
    };
    for (let i = 0; i < n; i++) {
        const linesPct = 10 + (i % 60);
        obj[`${prefix}/src/file-${String(i).padStart(3, '0')}.ts`] = {
            statements: { total: 100, covered: 30, skipped: 0, pct: 30 },
            branches: { total: 10, covered: 3, skipped: 0, pct: 30 },
            functions: { total: 10, covered: 3, skipped: 0, pct: 30 },
            lines: { total: 100, covered: linesPct, skipped: 0, pct: linesPct }
        };
    }
    return obj;
}

module.exports = { makeManyWeakFiles };
