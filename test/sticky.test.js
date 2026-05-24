const test = require('node:test');
const assert = require('node:assert/strict');

const {
    headerMarker,
    bodyWithHeader,
    bodyWithoutHeader,
    postSticky
} = require('../src/sticky');

test('marker format matches marocchino/sticky-pull-request-comment', () => {
    assert.equal(
        headerMarker('test-results'),
        '<!-- Sticky Pull Request Commenttest-results -->'
    );
});

test('round-trip strips the marker', () => {
    const body = 'hello';
    const wrapped = bodyWithHeader(body, 'h');
    assert.equal(wrapped, 'hello\n<!-- Sticky Pull Request Commenth -->');
    assert.equal(bodyWithoutHeader(wrapped, 'h'), body);
});

function makeMockOctokit({ comments = [] } = {}) {
    const created = [];
    const updated = [];

    async function* iter() {
        yield { data: comments };
    }

    return {
        _state: { created, updated, comments },
        rest: {
            issues: {
                listComments: async () => ({ data: comments }),
                createComment: async (args) => {
                    const c = {
                        id: 1000 + created.length,
                        body: args.body
                    };
                    created.push({ args, c });
                    comments.push(c);
                    return { data: c };
                },
                updateComment: async (args) => {
                    updated.push(args);
                    const idx = comments.findIndex((c) => c.id === args.comment_id);
                    if (idx >= 0) comments[idx] = { ...comments[idx], body: args.body };
                    return { data: comments[idx] };
                }
            }
        },
        paginate: {
            iterator: () => iter()
        }
    };
}

test('replace mode creates a comment when none exists', async () => {
    const octokit = makeMockOctokit();
    const result = await postSticky({
        octokit,
        owner: 'o',
        repo: 'r',
        issueNumber: 42,
        header: 'test-results',
        body: 'hello',
        mode: 'replace'
    });
    assert.equal(result.action, 'created');
    assert.equal(octokit._state.created.length, 1);
    assert.equal(
        octokit._state.created[0].args.body,
        'hello\n<!-- Sticky Pull Request Commenttest-results -->'
    );
});

test('replace mode updates the existing sticky', async () => {
    const octokit = makeMockOctokit({
        comments: [
            {
                id: 7,
                body:
                    'old body\n<!-- Sticky Pull Request Commenttest-results -->'
            }
        ]
    });
    const result = await postSticky({
        octokit,
        owner: 'o',
        repo: 'r',
        issueNumber: 42,
        header: 'test-results',
        body: 'new body',
        mode: 'replace'
    });
    assert.equal(result.action, 'updated');
    assert.equal(result.commentId, 7);
    assert.equal(
        octokit._state.updated[0].body,
        'new body\n<!-- Sticky Pull Request Commenttest-results -->'
    );
});

test('append mode preserves previous body and tacks new content on', async () => {
    const octokit = makeMockOctokit({
        comments: [
            {
                id: 12,
                body:
                    '### Test results\nbody-line\n<!-- Sticky Pull Request Commenttest-results -->'
            }
        ]
    });
    const result = await postSticky({
        octokit,
        owner: 'o',
        repo: 'r',
        issueNumber: 42,
        header: 'test-results',
        body: '\n---\n**Playwright report:** http://example/',
        mode: 'append'
    });
    assert.equal(result.action, 'appended');
    assert.equal(
        octokit._state.updated[0].body,
        '### Test results\nbody-line\n\n---\n**Playwright report:** http://example/\n<!-- Sticky Pull Request Commenttest-results -->'
    );
});

test('append mode no-ops when no previous sticky exists', async () => {
    const octokit = makeMockOctokit();
    const logs = [];
    const result = await postSticky({
        octokit,
        owner: 'o',
        repo: 'r',
        issueNumber: 42,
        header: 'test-results',
        body: 'anything',
        mode: 'append',
        log: (m) => logs.push(m)
    });
    assert.equal(result.action, 'skipped');
    assert.equal(octokit._state.created.length, 0);
    assert.equal(octokit._state.updated.length, 0);
    assert.match(logs[0], /No previous sticky comment/);
});

test('finds the right comment among many by header', async () => {
    const octokit = makeMockOctokit({
        comments: [
            { id: 1, body: 'unrelated comment' },
            {
                id: 2,
                body: 'old\n<!-- Sticky Pull Request Commentother-header -->'
            },
            {
                id: 3,
                body: 'target\n<!-- Sticky Pull Request Commenttest-results -->'
            }
        ]
    });
    const result = await postSticky({
        octokit,
        owner: 'o',
        repo: 'r',
        issueNumber: 1,
        header: 'test-results',
        body: 'updated',
        mode: 'replace'
    });
    assert.equal(result.commentId, 3);
    assert.equal(octokit._state.updated[0].comment_id, 3);
});
