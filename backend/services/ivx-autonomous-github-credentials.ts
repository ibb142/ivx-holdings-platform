type TokenSource = (preferStored: boolean) => Promise<string>;

/** Validate only owner-configured credentials, with a read-only GitHub probe.
 * A rejected environment token must not mask a valid rotated owner-store token.
 * No credentials are logged, returned to APIs, changed, or sent to arbitrary hosts.
 */
export function createAutonomousGithubTokenResolver() {
  let cached: { repo: string; primary: string; token: string; expiresAt: number } | null = null;
  return async (repoUrl: string, readToken: TokenSource): Promise<string> => {
    const match = repoUrl.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
    const primary = (await readToken(false)).trim();
    if (!primary || !match) return primary;
    const repo = `${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`;
    if (cached?.repo === repo && cached.primary === primary && cached.expiresAt > Date.now()) return cached.token;
    const probe = async (token: string) => {
      const response = await fetch(`https://api.github.com/repos/${repo}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(8000), redirect: 'error',
      });
      await response.body?.cancel().catch(() => {});
      return response.status;
    };
    let selected = primary;
    let status = await probe(primary);
    // 401 is definitive rejection. Do not rotate credentials or replay requests
    // on timeouts, rate limits, permission errors or ambiguous write results.
    if (status === 401) {
      const stored = (await readToken(true)).trim();
      if (stored && stored !== primary) {
        selected = stored;
        status = await probe(stored);
      }
    }
    if (status !== 200) throw new Error(`GitHub credential preflight failed (HTTP ${status}); repository access must be restored before coding`);
    cached = { repo, primary, token: selected, expiresAt: Date.now() + 60_000 };
    return selected;
  };
}
