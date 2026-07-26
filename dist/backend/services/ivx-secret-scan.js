/**
 * Pre-patch secret scanner.
 *
 * Called by the repair-job orchestrator BEFORE writing any patch to disk or
 * uploading to staging. Blocks patches that contain anything matching known
 * secret patterns (AWS keys, JWT-shaped strings, PEM blocks, RevenueCat, etc.).
 *
 * Never logs the matched value — only the pattern name and the index range.
 */
const RULES = [
    { name: 'aws_access_key_id', regex: /\bAKIA[0-9A-Z]{16}\b/g },
    { name: 'aws_secret_access_key', regex: /\b(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/g },
    { name: 'google_api_key', regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
    { name: 'github_token', regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
    { name: 'slack_token', regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
    { name: 'stripe_secret', regex: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
    { name: 'jwt_token', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
    { name: 'pem_private_key', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
    { name: 'revenuecat_key', regex: /\b(?:appl|goog|amzn|stripe|mkt)_[A-Za-z0-9]{20,}\b/g },
    { name: 'supabase_service_role', regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[^\.]*"role"\s*:\s*"service_role"[^\.]*\.[A-Za-z0-9_-]+\b/g },
    { name: 'generic_password_assignment', regex: /\b(?:password|passwd|secret)\s*[:=]\s*['"][^'"\s]{8,}['"]/gi },
];
function computeLineColumn(content, index) {
    let line = 1;
    let column = 1;
    for (let i = 0; i < index && i < content.length; i++) {
        if (content.charCodeAt(i) === 10) {
            line += 1;
            column = 1;
        }
        else {
            column += 1;
        }
    }
    return { line, column };
}
/**
 * Scan a patch / file content for secrets.
 * Returns ok=false with findings if ANY rule matched.
 */
export function scanContentForSecrets(content) {
    const scannedAt = new Date().toISOString();
    if (typeof content !== 'string' || content.length === 0) {
        return { ok: true, findings: [], scannedAt, contentLength: 0 };
    }
    const findings = [];
    for (const rule of RULES) {
        const regex = new RegExp(rule.regex.source, rule.regex.flags);
        let match;
        while ((match = regex.exec(content)) !== null) {
            const { line, column } = computeLineColumn(content, match.index);
            findings.push({
                pattern: rule.name,
                line,
                column,
                context: `[REDACTED:${rule.name}]`,
            });
            if (findings.length >= 20)
                break;
            if (match.index === regex.lastIndex)
                regex.lastIndex += 1;
        }
        if (findings.length >= 20)
            break;
    }
    return { ok: findings.length === 0, findings, scannedAt, contentLength: content.length };
}
/** Convenience: scan multiple file patches at once. */
export function scanPatchesForSecrets(patches) {
    const perFile = patches.map((p) => ({ filePath: p.filePath, result: scanContentForSecrets(p.content) }));
    return { ok: perFile.every((p) => p.result.ok), perFile };
}
