export const PUBLIC_LANDING_BASE_URL = 'https://api.ivxholding.com';

export const DIRECT_API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  process.env.EXPO_PUBLIC_IVX_API_BASE_URL ||
  'https://api.ivxholding.com'
).trim().replace(/\/$/, '');

export function buildPublicApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${PUBLIC_LANDING_BASE_URL}${normalizedPath}`;
}

export function getPublishedDealsReadUrls(): string[] {
  const urls = [
    buildPublicApiUrl('/api/published-jv-deals'),
    buildPublicApiUrl('/api/landing-deals'),
  ];

  if (DIRECT_API_BASE_URL) {
    urls.push(`${DIRECT_API_BASE_URL}/api/published-jv-deals`);
    urls.push(`${DIRECT_API_BASE_URL}/api/landing-deals`);
  }

  return Array.from(new Set(urls));
}

export function getLandingDealsReadUrls(): string[] {
  const urls = [
    buildPublicApiUrl('/api/landing-deals'),
    buildPublicApiUrl('/api/published-jv-deals'),
  ];

  if (DIRECT_API_BASE_URL) {
    urls.push(`${DIRECT_API_BASE_URL}/api/landing-deals`);
    urls.push(`${DIRECT_API_BASE_URL}/api/published-jv-deals`);
  }

  return Array.from(new Set(urls));
}
