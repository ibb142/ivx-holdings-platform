/**
 * IVX email-provider detection (owner-only outreach sending).
 *
 * BLOCK 93. The Capital Network action engine drafts outreach but NEVER sends without
 * a configured provider AND owner approval. This module reports — from environment
 * presence ONLY (never a secret value) — whether a real send path is configured:
 * Gmail draft, SendGrid, AWS SES, or a backend email queue.
 *
 * Until a provider is configured, callers must create an OUTREACH_DRAFT only and
 * surface EMAIL_PROVIDER_NOT_CONFIGURED. Nothing is ever auto-sent.
 */
function present(env, key) {
    const value = env[key];
    return typeof value === 'string' && value.trim().length > 0;
}
/**
 * Detect a configured email provider from env presence only. Pure + injectable for tests.
 * AWS SES requires an explicit verified from-address (`IVX_SES_FROM_EMAIL`) in addition to
 * AWS credentials, so generic S3 credentials never imply a sending path.
 */
export function detectConfiguredEmailProvider(env = process.env) {
    const checks = [
        {
            provider: 'sendgrid',
            requiredEnv: ['SENDGRID_API_KEY'],
            ok: present(env, 'SENDGRID_API_KEY'),
        },
        {
            provider: 'gmail',
            requiredEnv: ['GMAIL_OAUTH_TOKEN'],
            ok: present(env, 'GMAIL_OAUTH_TOKEN') || present(env, 'GMAIL_REFRESH_TOKEN'),
        },
        {
            provider: 'aws_ses',
            requiredEnv: ['IVX_SES_FROM_EMAIL', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
            ok: present(env, 'IVX_SES_FROM_EMAIL') && present(env, 'AWS_ACCESS_KEY_ID') && present(env, 'AWS_SECRET_ACCESS_KEY'),
        },
        {
            provider: 'backend_queue',
            requiredEnv: ['IVX_EMAIL_QUEUE_URL'],
            ok: present(env, 'IVX_EMAIL_QUEUE_URL'),
        },
    ];
    const available = checks.filter((c) => c.ok).map((c) => c.provider);
    const missing = checks.filter((c) => !c.ok).map((c) => ({ provider: c.provider, requiredEnv: c.requiredEnv }));
    const configured = available.length > 0;
    return {
        configured,
        provider: available[0] ?? null,
        available,
        missing,
        note: configured
            ? `Email sending available via ${available.join(', ')}. Owner approval is still required before any message is sent.`
            : 'EMAIL_PROVIDER_NOT_CONFIGURED — configure SendGrid, Gmail, AWS SES, or a backend email queue to enable sending. Until then, outreach is created as a draft only and never sent.',
    };
}
