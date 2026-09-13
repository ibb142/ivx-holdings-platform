// Reviewed identifiers used as field names and SecureStore lookup keys. These
// exceptions apply only to the exact binding at its original source path.
const nonCredentialBindings = new Map([
  ['backend/services/ivx-analytics-brain.ts', [
    /^\s*token:\s*(['"])interest_tokenized_assets\1(?=\s*(?:[,}]|\/\/|$)),?/,
  ]],
  ['expo/lib/owner-session-resilience.ts', [
    /^\s*ACCESS_TOKEN:\s*(['"])ivx_owner_resilient_access_token\1(?=\s*(?:[,}]|\/\/|$)),?/,
    /^\s*REFRESH_TOKEN:\s*(['"])ivx_owner_resilient_refresh_token\1(?=\s*(?:[,}]|\/\/|$)),?/,
  ]],
]);

export function hasHardcodedSecret(line, file) {
  if (/\.example$|fixtures|test|spec|docs\//.test(file)) return false;
  // Remove only the reviewed binding, then scan the rest of the same line.
  // An annotation alone never authorizes a credential exception.
  for (const binding of nonCredentialBindings.get(file) ?? []) line = line.replace(binding, '');
  return /(?:AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:secret|api[_-]?key|token|password)\s*[:=]\s*['"][A-Za-z0-9_\-\/.+=]{24,}['"])/i.test(line);
}

export function hasTypecheckDisable(line, file) {
  // A directive must be a source comment. JSON evidence and the scanner's
  // own regular expression are text, not TypeScript compiler directives.
  return /\.[cm]?[jt]sx?$/.test(file) && /^\s*(?:\/\/+|\/\*+|\*)\s*@ts-nocheck\b/.test(line);
}
