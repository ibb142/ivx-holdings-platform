/** Read-only metadata for the public landing repository. Never used for writes. */
const PUBLIC_REPOSITORY_API = 'https://api.github.com/repos/ibb142/ivx-holdings-platform/';
const RETRY_CREDENTIAL_AFTER_MS = 5 * 60_000;
let rejectedCredential: string | null = null;
let retryCredentialAt = 0;

/**
 * Public commit and workflow-run metadata is readable without a token. An
 * expired runtime token must not turn public QA evidence into an auth outage.
 * Only a 401 may retry anonymously; permission/rate-limit responses stay closed.
 * Repository writes and private resources never pass through this helper.
 */
export async function fetchLandingGitHubRead(
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if ((process.env.IVX_LANDING_REPO ?? 'ibb142/ivx-holdings-platform') !== 'ibb142/ivx-holdings-platform') {
    throw new Error('Public landing metadata repository does not match configured mission');
  }
  if (path !== 'commits/main'
    && !/^actions\/runs\?head_sha=[a-f0-9]{40}&per_page=100$/i.test(path)
    && !/^actions\/runs\/[1-9]\d*\/jobs\?per_page=100$/.test(path)) {
    throw new Error('Unsupported public landing metadata path');
  }
  const configured = (process.env.GITHUB_TOKEN ?? '').trim();
  const token = configured === rejectedCredential && Date.now() < retryCredentialAt ? '' : configured;
  const request = (credential: string) => fetchImpl(`${PUBLIC_REPOSITORY_API}${path}`, {
    method: 'GET',
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'ivx-landing-p0-audit/1.0',
      ...(credential ? { authorization: `Bearer ${credential}` } : {}),
    },
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  });
  const response = await request(token);
  if (response.status !== 401 || !token) return response;
  rejectedCredential = token;
  retryCredentialAt = Date.now() + RETRY_CREDENTIAL_AFTER_MS;
  await response.body?.cancel().catch(() => undefined);
  return request('');
}

export function resetLandingGitHubReadForTests(): void {
  rejectedCredential = null;
  retryCredentialAt = 0;
}
