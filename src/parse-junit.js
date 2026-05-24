// Minimal junit <testsuite[s] ... tests="N" failures="N" skipped="N">
// attribute scrape. Vitest, Jest, and Playwright all emit the standard
// surefire shape, so a regex on the root element's attrs is enough —
// pulling in an XML parser for four integers is overkill.

const { readFileSync, existsSync } = require('node:fs');

function parseJunitContent(xml) {
    const m = xml.match(/<testsuites?\s[^>]*>/);
    if (!m) return null;
    const attrs = m[0];
    const num = (k) => {
        const a = attrs.match(new RegExp(`${k}="(\\d+)"`));
        return a ? parseInt(a[1], 10) : 0;
    };
    const tests = num('tests');
    const failures = num('failures') + num('errors');
    const skipped = num('skipped');
    const passed = Math.max(0, tests - failures - skipped);
    return { tests, passed, failures, skipped };
}

function parseJunitFile(path) {
    if (!path || !existsSync(path)) return null;
    return parseJunitContent(readFileSync(path, 'utf8'));
}

module.exports = { parseJunitContent, parseJunitFile };
