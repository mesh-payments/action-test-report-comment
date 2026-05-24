const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
    parseJunitContent,
    parseJunitFile
} = require('../src/parse-junit');

const fx = (n) => path.join(__dirname, 'fixtures', n);

test('parses a passing Unit suite', () => {
    const r = parseJunitFile(fx('junit-unit.xml'));
    assert.deepEqual(r, { tests: 142, passed: 142, failures: 0, skipped: 0 });
});

test('parses an empty E2E suite as zeros', () => {
    const r = parseJunitFile(fx('junit-e2e-empty.xml'));
    assert.deepEqual(r, { tests: 0, passed: 0, failures: 0, skipped: 0 });
});

test('treats <errors> the same as <failures>', () => {
    const xml =
        '<testsuites tests="3" failures="1" errors="1" skipped="0"></testsuites>';
    assert.deepEqual(parseJunitContent(xml), {
        tests: 3,
        passed: 1,
        failures: 2,
        skipped: 0
    });
});

test('parses a <testsuite> root (no plural)', () => {
    const xml =
        '<testsuite tests="5" failures="0" errors="0" skipped="2"></testsuite>';
    assert.deepEqual(parseJunitContent(xml), {
        tests: 5,
        passed: 3,
        failures: 0,
        skipped: 2
    });
});

test('returns null when the file is missing', () => {
    assert.equal(parseJunitFile('/tmp/does-not-exist.xml'), null);
    assert.equal(parseJunitFile(''), null);
    assert.equal(parseJunitFile(undefined), null);
});

test('returns null when the XML has no testsuite root', () => {
    assert.equal(parseJunitContent('<rubbish></rubbish>'), null);
});
