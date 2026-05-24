// Sticky-comment posting via the GitHub REST API. We intentionally
// match marocchino/sticky-pull-request-comment's marker format
// (`<!-- Sticky Pull Request Comment<header> -->`) so consumers can
// migrate from that action without losing their existing sticky
// (the next run updates the same comment in place rather than posting
// a duplicate).

function headerMarker(header) {
    return `<!-- Sticky Pull Request Comment${header} -->`;
}

function bodyWithHeader(body, header) {
    return `${body}\n${headerMarker(header)}`;
}

function bodyWithoutHeader(body, header) {
    return body.replace(`\n${headerMarker(header)}`, '');
}

async function findPreviousComment({ octokit, owner, repo, issueNumber, header }) {
    const marker = headerMarker(header);
    for await (const { data } of octokit.paginate.iterator(
        octokit.rest.issues.listComments,
        { owner, repo, issue_number: issueNumber, per_page: 100 }
    )) {
        const found = data.find((c) => c.body && c.body.includes(marker));
        if (found) return found;
    }
    return null;
}

// Post (or update) the sticky comment for a PR.
//
//   mode = 'replace' → write `body` as the comment, replacing any
//                      previous content. Creates if not present.
//   mode = 'append'  → leave the previous body intact and append the
//                      new content after it. If no previous comment
//                      exists, this no-ops with a warning rather than
//                      creating one (the append flow assumes the first
//                      job already posted).
async function postSticky({
    octokit,
    owner,
    repo,
    issueNumber,
    header,
    body,
    mode = 'replace',
    log = () => {}
}) {
    const previous = await findPreviousComment({
        octokit,
        owner,
        repo,
        issueNumber,
        header
    });

    if (mode === 'append') {
        if (!previous) {
            log(
                'No previous sticky comment found for header ' +
                    `"${header}" — skipping append.`
            );
            return { action: 'skipped' };
        }
        const previousRaw = bodyWithoutHeader(previous.body, header);
        const merged = bodyWithHeader(`${previousRaw}\n${body}`, header);
        await octokit.rest.issues.updateComment({
            owner,
            repo,
            comment_id: previous.id,
            body: merged
        });
        return { action: 'appended', commentId: previous.id };
    }

    // replace
    const finalBody = bodyWithHeader(body, header);
    if (previous) {
        await octokit.rest.issues.updateComment({
            owner,
            repo,
            comment_id: previous.id,
            body: finalBody
        });
        return { action: 'updated', commentId: previous.id };
    }
    const created = await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: finalBody
    });
    return { action: 'created', commentId: created.data.id };
}

module.exports = {
    headerMarker,
    bodyWithHeader,
    bodyWithoutHeader,
    findPreviousComment,
    postSticky
};
