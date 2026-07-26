const OWNER_ROLE_ALIASES = new Set([
    'owner',
    'owneradmin',
    'ivxowner',
]);
const DEVELOPER_ROLE_ALIASES = new Set([
    'developer',
    'dev',
    'devops',
    'engineer',
    'softwareengineer',
    'leaddeveloper',
]);
const ADMIN_ROLE_ALIASES = new Set([
    'admin',
    'superadmin',
    'administrator',
    'opsadmin',
    'teamadmin',
    'founder',
    'staff',
    'staffmember',
    'ceo',
    'manager',
    'analyst',
    'support',
]);
export function readIVXTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
export function canonicalizeIVXRole(value) {
    return readIVXTrimmedString(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}
export function normalizeIVXRole(value) {
    const normalizedValue = canonicalizeIVXRole(value);
    if (!normalizedValue) {
        return 'investor';
    }
    if (OWNER_ROLE_ALIASES.has(normalizedValue)) {
        return 'owner';
    }
    if (DEVELOPER_ROLE_ALIASES.has(normalizedValue)
        || normalizedValue.startsWith('dev')
        || normalizedValue.endsWith('developer')
        || normalizedValue.endsWith('engineer')) {
        return 'developer';
    }
    if (ADMIN_ROLE_ALIASES.has(normalizedValue)
        || normalizedValue.endsWith('admin')
        || normalizedValue.endsWith('founder')
        || normalizedValue.endsWith('staff')
        || normalizedValue.endsWith('support')
        || normalizedValue.endsWith('manager')
        || normalizedValue.endsWith('analyst')) {
        return 'admin';
    }
    return 'investor';
}
export function isPrivilegedIVXRole(role) {
    return role === 'owner' || role === 'developer' || role === 'admin';
}
export function extractIVXRoleCandidate(record) {
    if (!record) {
        return null;
    }
    const directKeys = ['role', 'user_role', 'app_role', 'access_role', 'profile_role'];
    for (const key of directKeys) {
        const candidate = record[key];
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim();
        }
    }
    const nestedKeys = ['profile', 'app_metadata', 'metadata'];
    for (const key of nestedKeys) {
        const nestedValue = record[key];
        if (!nestedValue || typeof nestedValue !== 'object') {
            continue;
        }
        const nestedRecord = nestedValue;
        for (const nestedKey of directKeys) {
            const candidate = nestedRecord[nestedKey];
            if (typeof candidate === 'string' && candidate.trim()) {
                return candidate.trim();
            }
        }
    }
    return null;
}
export function resolveIVXRoleContext(candidates) {
    let firstNonEmptyRole = null;
    for (const candidate of candidates) {
        const rawRole = readIVXTrimmedString(candidate) || null;
        if (!rawRole) {
            continue;
        }
        if (!firstNonEmptyRole) {
            firstNonEmptyRole = rawRole;
        }
        const normalizedRole = normalizeIVXRole(rawRole);
        if (isPrivilegedIVXRole(normalizedRole)) {
            return {
                rawRole,
                normalizedRole,
            };
        }
    }
    return {
        rawRole: firstNonEmptyRole,
        normalizedRole: normalizeIVXRole(firstNonEmptyRole),
    };
}
