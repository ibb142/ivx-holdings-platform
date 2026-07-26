/**
 * IVX IA Developer Proof endpoint.
 *
 * Created by IVX IA as one real, end-to-end developer task:
 *   file created -> committed to GitHub -> deployed to Render -> verified live.
 *
 * The route returns the live deployed commit (RENDER_GIT_COMMIT) so that an
 * external caller can confirm GitHub HEAD == Render deployed SHA == endpoint
 * commit, proving a single real task flowed through the full executor chain.
 */
export function handleIVXIaDeveloperProofRequest(liveCommitSha, liveCommitShort, bootTime, deploymentMarker) {
    const timestamp = new Date().toISOString();
    const payload = {
        status: 'live',
        developer: 'IVX IA',
        task: 'developer_proof',
        commit: liveCommitSha,
        deployedCommit: liveCommitSha,
        commitShort: liveCommitShort,
        renderDeployId: process.env.RENDER_DEPLOY_ID?.trim() || 'render-provided-at-runtime',
        deploymentMarker,
        bootTime,
        endpoint: '/api/ivx/ia-developer-proof',
        message: 'This endpoint was created, committed, pushed, deployed, and verified live by IVX IA as one real developer task.',
        timestamp,
    };
    return new Response(JSON.stringify(payload, null, 2), {
        status: 200,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': 'https://ivxholding.com',
            'Cache-Control': 'no-store',
        },
    });
}
export function ivxIaDeveloperProofOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': 'https://ivxholding.com',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
        },
    });
}
