const core = require('@actions/core');
const github = require('@actions/github');

const { parseJunitFile } = require('./parse-junit');
const { loadCoverage } = require('./parse-coverage');
const { buildComment, buildPlaywrightAppend } = require('./build-comment');
const { postSticky } = require('./sticky');

function getOptionalInput(name) {
    const v = core.getInput(name);
    return v && v.trim() !== '' ? v : '';
}

function getIntInput(name, fallback) {
    const raw = getOptionalInput(name);
    if (!raw) return fallback;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
}

function isTruthy(s) {
    if (!s) return false;
    const v = s.trim().toLowerCase();
    return v !== '' && v !== '0' && v !== 'false' && v !== 'no';
}

function getIssueNumber(context) {
    // pull_request / pull_request_target carry the PR number directly.
    const pr = context.payload?.pull_request;
    if (pr?.number) return pr.number;
    // workflow_run (e.g. the deploy-playwright-report job in a separate
    // workflow) — caller must populate the issue number themselves;
    // we don't try to look it up from the head sha here.
    return null;
}

async function run() {
    try {
        const coverageSummaryPath = getOptionalInput('coverage-summary');
        const coverageReportPath = getOptionalInput('coverage-report');
        const unitJunitPath = getOptionalInput('unit-junit');
        const e2eJunitPath = getOptionalInput('e2e-junit');
        const e2eOptIn = isTruthy(getOptionalInput('e2e-opt-in'));
        const e2eFeatureName =
            getOptionalInput('e2e-feature-name') || 'E2E';
        const e2eSkipNote = getOptionalInput('e2e-skip-note');
        const weakFiles = isTruthy(getOptionalInput('weak-files'));
        const weakThreshold = getIntInput('weak-threshold', 80);
        const weakLimit = getIntInput('weak-limit', 50);
        const header = getOptionalInput('comment-header') || 'test-results';
        const playwrightReportUrl = getOptionalInput('playwright-report-url');
        const playwrightFooterNote = getOptionalInput(
            'playwright-footer-note'
        );
        const token = core.getInput('github-token', { required: true });

        const context = github.context;
        const issueNumber = getIssueNumber(context);
        if (!issueNumber) {
            core.info(
                `No pull-request number available on event "${context.eventName}"; skipping.`
            );
            return;
        }

        const octokit = github.getOctokit(token);
        const repoCtx = {
            owner: context.repo.owner,
            repo: context.repo.repo,
            issueNumber
        };

        // Append-mode short-circuit. The downstream job (e.g. after a
        // Pages deploy) calls the action again with the same header and
        // a populated `playwright-report-url`. We don't rebuild the
        // full comment in this mode — we only append the URL block to
        // the sticky the previous job already posted.
        if (playwrightReportUrl) {
            const runId = context.runId ? String(context.runId) : '';
            const runUrl = runId
                ? `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${runId}`
                : '';
            const body = buildPlaywrightAppend({
                url: playwrightReportUrl,
                runUrl,
                runId,
                commitSha: context.sha,
                note: getOptionalInput('playwright-append-note')
            });
            const result = await postSticky({
                octokit,
                ...repoCtx,
                header,
                body,
                mode: 'append',
                log: (m) => core.info(m)
            });
            core.setOutput('comment-action', result.action);
            if (result.commentId) {
                core.setOutput('comment-id', String(result.commentId));
            }
            return;
        }

        if (!coverageSummaryPath && !coverageReportPath) {
            throw new Error(
                'At least one of `coverage-summary` or `coverage-report` is required.'
            );
        }

        const coverage = loadCoverage({
            coverageSummaryPath,
            coverageReportPath
        });
        if (!coverage) {
            core.warning(
                'Coverage input was provided but the file was not found; rendering "_no coverage data_".'
            );
        }

        let unit = parseJunitFile(unitJunitPath);
        const e2e = parseJunitFile(e2eJunitPath);

        // Test-counts fallback: when the unit-junit input was provided
        // but the file is missing (or unreadable) and the coverage
        // report carries top-level test counts (Jest's
        // --json --coverage shape), substitute those so the Unit row
        // still renders meaningful numbers. Coverage-only calls that
        // don't set unit-junit at all do NOT auto-render a Suites
        // table — they remain a one-line invocation as documented.
        if (unitJunitPath && !unit && coverage && coverage.testCounts) {
            unit = coverage.testCounts;
        }
        const hasUnitJunitInput = Boolean(unitJunitPath);
        const hasE2EJunitInput = Boolean(e2eJunitPath);

        const body = buildComment({
            coverage,
            unit,
            e2e,
            hasUnitJunitInput,
            hasE2EJunitInput,
            e2eFeatureName,
            e2eOptIn,
            e2eSkipNote,
            weakFiles,
            weakThreshold,
            weakLimit,
            repoRoot: process.env.GITHUB_WORKSPACE || process.cwd(),
            playwrightFooterNote
        });

        const result = await postSticky({
            octokit,
            ...repoCtx,
            header,
            body,
            mode: 'replace',
            log: (m) => core.info(m)
        });
        core.setOutput('comment-action', result.action);
        if (result.commentId) {
            core.setOutput('comment-id', String(result.commentId));
        }
        core.setOutput('comment-body', body);
    } catch (err) {
        core.setFailed(err.message);
    }
}

if (require.main === module) {
    run();
}

module.exports = { run };
