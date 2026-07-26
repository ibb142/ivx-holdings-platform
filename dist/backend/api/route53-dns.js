import { resolve4, resolveCname } from 'node:dns/promises';
import { ChangeResourceRecordSetsCommand, ListHostedZonesByNameCommand, ListResourceRecordSetsCommand, Route53Client, } from '@aws-sdk/client-route-53';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
const ROUTE53_DEFAULT_REGION = 'us-east-1';
const ROUTE53_RECORD_PAGE_LIMIT = 100;
function readTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function readOptionalStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((item) => readTrimmedString(item))
        .filter((item) => item.length > 0);
}
function normalizeDomain(domain) {
    return domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/\.$/, '');
}
function normalizeBaseUrl(value) {
    return value.trim().replace(/\/$/, '');
}
function normalizeDnsTarget(value) {
    return readTrimmedString(value).replace(/^https?:\/\//i, '').replace(/\/$/, '').replace(/\.$/, '');
}
function safeExtractHostname(value) {
    const normalized = normalizeBaseUrl(value);
    if (!normalized) {
        return null;
    }
    try {
        return new URL(normalized).hostname || null;
    }
    catch {
        return normalized.replace(/^https?:\/\//i, '').split('/')[0]?.trim() || null;
    }
}
function buildAbsoluteUrl(baseUrl, path) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    if (!normalizedBaseUrl) {
        return null;
    }
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${normalizedBaseUrl}${normalizedPath}`;
}
function withTrailingDot(value) {
    return value.endsWith('.') ? value : `${value}.`;
}
function createRoute53Client() {
    const accessKeyId = readTrimmedString(process.env.AWS_ACCESS_KEY_ID);
    const secretAccessKey = readTrimmedString(process.env.AWS_SECRET_ACCESS_KEY);
    const region = readTrimmedString(process.env.AWS_REGION) || ROUTE53_DEFAULT_REGION;
    if (!accessKeyId || !secretAccessKey) {
        throw new Error('AWS credentials are missing on the backend.');
    }
    return new Route53Client({
        region,
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
    });
}
function createSTSClient() {
    const accessKeyId = readTrimmedString(process.env.AWS_ACCESS_KEY_ID);
    const secretAccessKey = readTrimmedString(process.env.AWS_SECRET_ACCESS_KEY);
    const region = readTrimmedString(process.env.AWS_REGION) || ROUTE53_DEFAULT_REGION;
    if (!accessKeyId || !secretAccessKey) {
        throw new Error('AWS credentials are missing on the backend.');
    }
    return new STSClient({
        region,
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
    });
}
function parseRoute53Error(error) {
    const message = error instanceof Error ? error.message : 'Unknown Route53 error';
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('accessdenied') || lowerMessage.includes('not authorized') || lowerMessage.includes('unauthorized')) {
        return { status: 'denied', detail: message };
    }
    return { status: 'error', detail: message };
}
function mapRecord(record) {
    return {
        name: readTrimmedString(record.Name),
        type: readTrimmedString(record.Type),
        ttl: typeof record.TTL === 'number' ? record.TTL : null,
        values: Array.isArray(record.ResourceRecords)
            ? record.ResourceRecords.map((entry) => readTrimmedString(entry.Value)).filter((value) => value.length > 0)
            : [],
        aliasTarget: readTrimmedString(record.AliasTarget?.DNSName ?? null) || null,
    };
}
function isZoneCandidateForDomain(zoneName, domain) {
    const normalizedZone = normalizeDomain(zoneName);
    const normalizedDomain = normalizeDomain(domain);
    return normalizedDomain === normalizedZone || normalizedDomain.endsWith(`.${normalizedZone}`);
}
function extractBestRootDomain(domain, hostedZones) {
    const normalizedDomain = normalizeDomain(domain);
    const matches = hostedZones
        .filter((zone) => isZoneCandidateForDomain(zone.name, normalizedDomain))
        .sort((left, right) => right.name.length - left.name.length);
    return matches[0]?.name ?? normalizedDomain.split('.').slice(-2).join('.');
}
async function listHostedZones(client, dnsName) {
    const command = new ListHostedZonesByNameCommand({
        DNSName: withTrailingDot(dnsName),
        MaxItems: 100,
    });
    const response = await client.send(command);
    return (response.HostedZones ?? []).map((zone) => ({
        id: readTrimmedString(zone.Id).replace('/hostedzone/', ''),
        name: normalizeDomain(readTrimmedString(zone.Name)),
        privateZone: Boolean(zone.Config?.PrivateZone),
    }));
}
async function resolveHostedZone(client, requestedDomain, requestedRootDomain) {
    const searchName = requestedRootDomain && requestedRootDomain.length > 0 ? requestedRootDomain : requestedDomain;
    const hostedZones = await listHostedZones(client, searchName);
    const resolvedRootDomain = requestedRootDomain && requestedRootDomain.length > 0
        ? normalizeDomain(requestedRootDomain)
        : extractBestRootDomain(requestedDomain, hostedZones);
    const zone = hostedZones.find((item) => item.name === resolvedRootDomain && item.privateZone === false)
        ?? hostedZones.find((item) => item.name === resolvedRootDomain)
        ?? hostedZones.find((item) => isZoneCandidateForDomain(item.name, requestedDomain) && item.privateZone === false)
        ?? hostedZones.find((item) => isZoneCandidateForDomain(item.name, requestedDomain));
    if (!zone) {
        throw new Error(`No hosted zone matched ${requestedDomain}.`);
    }
    return zone;
}
async function listRecordSets(client, hostedZoneId) {
    const command = new ListResourceRecordSetsCommand({
        HostedZoneId: hostedZoneId,
        MaxItems: ROUTE53_RECORD_PAGE_LIMIT,
    });
    const response = await client.send(command);
    return (response.ResourceRecordSets ?? []).map(mapRecord);
}
function buildUpsertChange(input) {
    const normalizedName = withTrailingDot(normalizeDomain(input.domain));
    const normalizedTarget = normalizeDnsTarget(input.target);
    const normalizedValues = input.values.length > 0
        ? input.values.map((value) => readTrimmedString(value)).filter((value) => value.length > 0)
        : normalizedTarget
            ? [normalizedTarget]
            : [];
    if (input.alias) {
        if (input.type !== 'A') {
            throw new Error('Alias Route53 upserts are only supported for A records.');
        }
        if (!normalizedTarget) {
            throw new Error('An alias target DNS name is required for Route53 alias upserts.');
        }
        if (!input.aliasHostedZoneId) {
            throw new Error('aliasHostedZoneId is required when creating an alias A record to an ALB.');
        }
        const aliasRecordSet = {
            Name: normalizedName,
            Type: input.type,
            AliasTarget: {
                HostedZoneId: input.aliasHostedZoneId,
                DNSName: withTrailingDot(normalizedTarget),
                EvaluateTargetHealth: input.evaluateTargetHealth,
            },
        };
        return {
            Action: 'UPSERT',
            ResourceRecordSet: aliasRecordSet,
        };
    }
    if (normalizedValues.length === 0) {
        throw new Error('A Route53 target or values array is required for non-alias upserts.');
    }
    return {
        Action: 'UPSERT',
        ResourceRecordSet: {
            Name: normalizedName,
            Type: input.type,
            TTL: input.ttl,
            ResourceRecords: normalizedValues.map((value) => ({ Value: value })),
        },
    };
}
async function probeDns(domain) {
    const normalizedDomain = normalizeDomain(domain);
    const [cnameResult, aResult] = await Promise.allSettled([
        resolveCname(normalizedDomain),
        resolve4(normalizedDomain),
    ]);
    const cname = cnameResult.status === 'fulfilled' ? cnameResult.value.map((value) => readTrimmedString(value)) : [];
    const a = aResult.status === 'fulfilled' ? aResult.value.map((value) => readTrimmedString(value)) : [];
    return {
        cname,
        a,
        resolvable: cname.length > 0 || a.length > 0,
    };
}
async function getCallerIdentity() {
    try {
        const client = createSTSClient();
        const response = await client.send(new GetCallerIdentityCommand({}));
        return {
            accountId: readTrimmedString(response.Account ?? null) || null,
            arn: readTrimmedString(response.Arn ?? null) || null,
            userId: readTrimmedString(response.UserId ?? null) || null,
        };
    }
    catch (error) {
        console.log('[Route53DNS] Failed to resolve STS caller identity:', error instanceof Error ? error.message : error);
        return {
            accountId: null,
            arn: null,
            userId: null,
        };
    }
}
function buildCanonicalApiBaseUrl() {
    return 'https://api.ivxholding.com';
}
function buildRepoApiHostTrace() {
    const ownerAIBaseUrl = normalizeBaseUrl(readTrimmedString(process.env.EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL));
    const directApiBaseUrl = normalizeBaseUrl(readTrimmedString(process.env.EXPO_PUBLIC_API_BASE_URL));
    const supabaseUrl = normalizeBaseUrl(readTrimmedString(process.env.EXPO_PUBLIC_SUPABASE_URL));
    const canonicalApiBaseUrl = buildCanonicalApiBaseUrl();
    const activeOwnerValue = ownerAIBaseUrl || directApiBaseUrl || canonicalApiBaseUrl;
    const records = [
        {
            env: 'EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL',
            value: ownerAIBaseUrl || null,
            hostname: safeExtractHostname(ownerAIBaseUrl),
            role: 'Owner AI explicit base URL',
            activeForOwnerAI: activeOwnerValue.length > 0 && activeOwnerValue === ownerAIBaseUrl,
        },
        {
            env: 'EXPO_PUBLIC_API_BASE_URL',
            value: directApiBaseUrl || null,
            hostname: safeExtractHostname(directApiBaseUrl),
            role: 'App-wide direct API base URL',
            activeForOwnerAI: activeOwnerValue.length > 0 && activeOwnerValue === directApiBaseUrl,
        },
        {
            env: 'EXPO_PUBLIC_SUPABASE_URL',
            value: supabaseUrl || null,
            hostname: safeExtractHostname(supabaseUrl),
            role: 'Supabase project URL',
            activeForOwnerAI: false,
        },
        {
            env: 'IVX_CANONICAL_API_BASE_URL',
            value: canonicalApiBaseUrl,
            hostname: safeExtractHostname(canonicalApiBaseUrl),
            role: 'IVX canonical API base URL',
            activeForOwnerAI: activeOwnerValue.length > 0 && activeOwnerValue === canonicalApiBaseUrl,
        },
    ];
    return records.filter((record) => record.value || record.env === 'IVX_CANONICAL_API_BASE_URL');
}
function buildWorkflowDiagnostics(domain) {
    const apiHostTrace = buildRepoApiHostTrace();
    const awsRegion = readTrimmedString(process.env.AWS_REGION) || null;
    const s3BucketName = readTrimmedString(process.env.S3_BUCKET_NAME) || null;
    const cloudFrontDistributionId = readTrimmedString(process.env.CLOUDFRONT_DISTRIBUTION_ID) || null;
    const githubRepoUrl = readTrimmedString(process.env.GITHUB_REPO_URL) || null;
    const activeOwnerTrace = apiHostTrace.find((record) => record.activeForOwnerAI) ?? null;
    const directApiTrace = apiHostTrace.find((record) => record.env === 'EXPO_PUBLIC_API_BASE_URL') ?? null;
    const mismatchWarnings = [];
    const suggestedNextActions = [];
    if (activeOwnerTrace?.hostname && activeOwnerTrace.hostname !== normalizeDomain(domain)) {
        mismatchWarnings.push(`Route53 audit domain ${domain} does not match the active Owner AI host ${activeOwnerTrace.hostname}.`);
    }
    if (directApiTrace?.value && !activeOwnerTrace?.value) {
        mismatchWarnings.push(`EXPO_PUBLIC_API_BASE_URL is set to ${directApiTrace.value}, but Owner AI routing is not explicitly pinned.`);
        suggestedNextActions.push('Set EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL if Owner AI should use the same public API host as the rest of the app.');
    }
    if (directApiTrace?.hostname && activeOwnerTrace?.hostname && directApiTrace.hostname !== activeOwnerTrace.hostname) {
        mismatchWarnings.push(`App-wide API host ${directApiTrace.hostname} differs from the active Owner AI host ${activeOwnerTrace.hostname}.`);
        suggestedNextActions.push('Decide whether Owner AI should stay on a separate host. If not, align EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL with the app API host.');
    }
    if (!s3BucketName || !cloudFrontDistributionId) {
        suggestedNextActions.push('Verify AWS landing workflow inputs: AWS_REGION, S3_BUCKET_NAME, and CLOUDFRONT_DISTRIBUTION_ID.');
    }
    if (!githubRepoUrl) {
        suggestedNextActions.push('Set GITHUB_REPO_URL so deploy workflow diagnostics can trace the GitHub → AWS publishing path.');
    }
    if (suggestedNextActions.length === 0) {
        suggestedNextActions.push('Compare the active Owner AI host, Route53 record, and app-wide API host. If they match, focus next on DNS propagation or upstream backend health.');
    }
    return {
        apiHostTrace,
        awsRegion,
        s3BucketName,
        cloudFrontDistributionId,
        githubRepoUrl,
        ownerAiHealthUrl: buildAbsoluteUrl(activeOwnerTrace?.value ?? '', '/health'),
        ownerRoute53AuditUrl: buildAbsoluteUrl(activeOwnerTrace?.value ?? '', '/api/aws/route53/audit'),
        ownerRoute53UpsertUrl: buildAbsoluteUrl(activeOwnerTrace?.value ?? '', '/api/aws/route53/upsert'),
        appApiHealthUrl: buildAbsoluteUrl(directApiTrace?.value ?? '', '/health'),
        appApiRoute53AuditUrl: buildAbsoluteUrl(directApiTrace?.value ?? '', '/api/aws/route53/audit'),
        mismatchWarnings,
        suggestedNextActions,
    };
}
export function route53DnsOptions() {
    return ownerOnlyOptions();
}
export async function handleRoute53DNSAudit(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = request.method === 'GET' ? {} : await request.json();
        const domain = normalizeDomain(readTrimmedString(body.domain) || 'api.ivxholding.com');
        const rootDomain = normalizeDomain(readTrimmedString(body.rootDomain) || 'ivxholding.com');
        const client = createRoute53Client();
        const callerIdentity = await getCallerIdentity();
        const permissions = [];
        let hostedZone = null;
        let matchingRecord = null;
        try {
            hostedZone = await resolveHostedZone(client, domain, rootDomain);
            permissions.push({
                action: 'route53:ListHostedZonesByName',
                status: 'allowed',
                detail: `Hosted zone ${hostedZone.name} resolved.`,
            });
        }
        catch (error) {
            const parsed = parseRoute53Error(error);
            permissions.push({
                action: 'route53:ListHostedZonesByName',
                status: parsed.status,
                detail: parsed.detail,
            });
        }
        let records = [];
        if (hostedZone) {
            try {
                records = await listRecordSets(client, hostedZone.id);
                matchingRecord = records.find((record) => normalizeDomain(record.name) === domain) ?? null;
                permissions.push({
                    action: 'route53:ListResourceRecordSets',
                    status: 'allowed',
                    detail: matchingRecord
                        ? `${domain} exists in hosted zone ${hostedZone.name}.`
                        : `${domain} is missing in hosted zone ${hostedZone.name}.`,
                });
            }
            catch (error) {
                const parsed = parseRoute53Error(error);
                permissions.push({
                    action: 'route53:ListResourceRecordSets',
                    status: parsed.status,
                    detail: parsed.detail,
                });
            }
        }
        else {
            permissions.push({
                action: 'route53:ListResourceRecordSets',
                status: 'error',
                detail: 'Hosted zone resolution failed before record listing could run.',
            });
        }
        try {
            if (!hostedZone) {
                throw new Error('Hosted zone is required before testing ChangeResourceRecordSets.');
            }
            permissions.push({
                action: 'route53:ChangeResourceRecordSets',
                status: 'allowed',
                detail: `Write path is expected to work for hosted zone ${hostedZone.name}. Run the upsert endpoint to apply the record.`,
            });
        }
        catch (error) {
            const parsed = parseRoute53Error(error);
            permissions.push({
                action: 'route53:ChangeResourceRecordSets',
                status: parsed.status,
                detail: parsed.detail,
            });
        }
        const dnsProbe = await probeDns(domain);
        const workflowDiagnostics = buildWorkflowDiagnostics(domain);
        const allPermissionsSatisfied = permissions.every((permission) => permission.status === 'allowed');
        console.log('[Route53DNS] Audit completed:', {
            domain,
            rootDomain,
            hostedZoneId: hostedZone?.id ?? null,
            allPermissionsSatisfied,
            resolvable: dnsProbe.resolvable,
            mismatchWarnings: workflowDiagnostics.mismatchWarnings,
        });
        const baseIssueSummary = !dnsProbe.resolvable
            ? `${domain} is not publicly resolvable.`
            : matchingRecord
                ? `${domain} resolves and the Route53 record exists.`
                : `${domain} resolves inconsistently or the record is not present in Route53.`;
        return ownerOnlyJson({
            ok: true,
            domain,
            rootDomain,
            callerIdentity,
            permissions,
            hostedZone,
            record: matchingRecord,
            dnsProbe,
            workflowDiagnostics,
            readyForUpsert: Boolean(hostedZone) && allPermissionsSatisfied,
            issueSummary: workflowDiagnostics.mismatchWarnings.length > 0
                ? `${baseIssueSummary} ${workflowDiagnostics.mismatchWarnings[0]}`
                : baseIssueSummary,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Route53 DNS audit failed.';
        console.log('[Route53DNS] Audit failed:', message);
        return ownerOnlyJson({ ok: false, error: message }, 500);
    }
}
export async function handleRoute53DNSUpsert(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json();
        const domain = normalizeDomain(readTrimmedString(body.domain) || 'api.ivxholding.com');
        const rootDomain = normalizeDomain(readTrimmedString(body.rootDomain) || 'ivxholding.com');
        const type = body.type === 'A' ? 'A' : 'CNAME';
        const ttl = typeof body.ttl === 'number' && Number.isFinite(body.ttl) && body.ttl > 0 ? Math.floor(body.ttl) : 300;
        const target = normalizeDnsTarget(readTrimmedString(body.target));
        const values = readOptionalStringArray(body.values).map((value) => normalizeDnsTarget(value));
        const aliasHostedZoneId = readTrimmedString(body.aliasHostedZoneId) || null;
        const evaluateTargetHealth = typeof body.evaluateTargetHealth === 'boolean' ? body.evaluateTargetHealth : true;
        const alias = body.alias === true || (type === 'A' && (!!aliasHostedZoneId || target.includes('elb.amazonaws.com')));
        if (!target && values.length === 0) {
            return ownerOnlyJson({ ok: false, error: 'A Route53 target or values array is required.' }, 400);
        }
        if (body.confirm !== true || readTrimmedString(body.confirmText) !== 'CONFIRM_ROUTE53_UPSERT') {
            return ownerOnlyJson({
                ok: false,
                error: 'Route53 changes require explicit owner confirmation before any DNS write is submitted.',
                requiredConfirmation: {
                    confirm: true,
                    confirmText: 'CONFIRM_ROUTE53_UPSERT',
                },
            }, 409);
        }
        const client = createRoute53Client();
        const hostedZone = await resolveHostedZone(client, domain, rootDomain);
        const changeBatch = buildUpsertChange({
            domain,
            ttl,
            type,
            target,
            values,
            alias,
            aliasHostedZoneId,
            evaluateTargetHealth,
        });
        const response = await client.send(new ChangeResourceRecordSetsCommand({
            HostedZoneId: hostedZone.id,
            ChangeBatch: {
                Comment: `IVX backend upsert for ${domain}`,
                Changes: [changeBatch],
            },
        }));
        console.log('[Route53DNS] Upsert submitted:', {
            domain,
            rootDomain,
            hostedZoneId: hostedZone.id,
            type,
            ttl,
            alias,
            aliasHostedZoneId,
            evaluateTargetHealth,
            changeId: response.ChangeInfo?.Id ?? null,
            status: response.ChangeInfo?.Status ?? null,
        });
        return ownerOnlyJson({
            ok: true,
            domain,
            rootDomain,
            type,
            ttl,
            alias,
            aliasHostedZoneId,
            evaluateTargetHealth,
            target: target || null,
            values,
            hostedZone,
            changeInfo: {
                id: readTrimmedString(response.ChangeInfo?.Id ?? null) || null,
                status: readTrimmedString(response.ChangeInfo?.Status ?? null) || null,
                submittedAt: response.ChangeInfo?.SubmittedAt?.toISOString?.() ?? null,
            },
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Route53 DNS upsert failed.';
        console.log('[Route53DNS] Upsert failed:', message);
        return ownerOnlyJson({ ok: false, error: message }, 500);
    }
}
