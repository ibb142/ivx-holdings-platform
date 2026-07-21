const PASSWORD_RESET_ROUTE_PATH = '/reset-password';
const DEFAULT_PASSWORD_RESET_REDIRECT_URL = 'https://ivxholding.com/reset-password.html';

export interface PasswordResetRedirectAudit {
  configuredValue: string;
  resolvedUrl: string;
  usesDefault: boolean;
  rejectedConfiguredUrl: boolean;
  rejectionReason: string | null;
}

function looksLikeApiHost(hostname: string): boolean {
  const normalizedHostname = hostname.trim().toLowerCase();
  return normalizedHostname.startsWith('api.');
}

function resolveConfiguredPasswordResetUrl(value: string): { url: string; rejectionReason: string | null } {
  const trimmed = value.trim().replace(/\/$/, '');
  if (!trimmed) {
    return { url: '', rejectionReason: null };
  }

  try {
    const parsed = new URL(trimmed);
    if (looksLikeApiHost(parsed.hostname)) {
      return {
        url: '',
        rejectionReason: `Configured auth URL uses API host ${parsed.hostname}, which cannot serve the public reset-password route.`,
      };
    }

    if (trimmed.endsWith(PASSWORD_RESET_ROUTE_PATH)) {
      return { url: trimmed, rejectionReason: null };
    }

    return { url: `${parsed.origin}${PASSWORD_RESET_ROUTE_PATH}`, rejectionReason: null };
  } catch {
    return { url: '', rejectionReason: 'Configured auth URL is not a valid HTTP URL.' };
  }
}

export function inspectPasswordResetRedirect(): PasswordResetRedirectAudit {
  const configuredValue = (process.env.EXPO_PUBLIC_IVX_AUTH_URL || '').trim();
  const configuredResolution = resolveConfiguredPasswordResetUrl(configuredValue);
  const resolvedUrl = configuredResolution.url || DEFAULT_PASSWORD_RESET_REDIRECT_URL;

  return {
    configuredValue,
    resolvedUrl,
    usesDefault: !configuredResolution.url,
    rejectedConfiguredUrl: !!configuredValue && !configuredResolution.url,
    rejectionReason: configuredResolution.url ? null : configuredResolution.rejectionReason,
  };
}

export function getPasswordResetRedirectUrl(): string {
  return inspectPasswordResetRedirect().resolvedUrl;
}

export function getPasswordResetRoutePath(): string {
  return PASSWORD_RESET_ROUTE_PATH;
}
