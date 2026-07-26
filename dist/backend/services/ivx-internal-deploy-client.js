import { createHmac, randomBytes } from 'node:crypto';
function requiredEnv(name) {
    const value = process.env[name]?.trim() ?? '';
    if (!value)
        throw new Error(`${name} is not configured for the internal worker.`);
    return value;
}
function internalApiBaseUrl() {
    const raw = process.env.IVX_INTERNAL_API_URL?.trim() || 'https://api.ivxholding.com';
    return raw.replace(/\/$/, '');
}
/** Builds a short-lived HMAC request from the dedicated worker without exposing its secret. */
export function createInternalDeploymentAuthorizationRequest(input) {
    const workerId = requiredEnv('IVX_INTERNAL_WORKER_ID');
    const secret = requiredEnv('IVX_INTERNAL_DEPLOY_SECRET');
    const endpoint = `${internalApiBaseUrl()}/api/ivx/senior-developer/internal-deployment-authorizations/consume`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(24).toString('base64url');
    const body = JSON.stringify(input);
    const pathname = new URL(endpoint).pathname;
    const payload = [workerId, timestamp, nonce, 'POST', pathname, body].join('\n');
    const signature = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
    return new Request(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-IVX-Worker-ID': workerId,
            'X-IVX-Timestamp': timestamp,
            'X-IVX-Nonce': nonce,
            'X-IVX-Deploy-Signature': signature,
        },
        body,
    });
}
/** Consumes one owner approval immediately before the corresponding protected action. */
export async function consumeInternalDeploymentApproval(input) {
    const response = await fetch(createInternalDeploymentAuthorizationRequest(input));
    if (response.ok)
        return;
    const payload = await response.json().catch(() => ({}));
    const message = typeof payload.error === 'string' ? payload.error : `Internal authorization request failed with HTTP ${response.status}.`;
    throw new Error(message.slice(0, 500));
}
