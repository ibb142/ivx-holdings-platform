/** Preserve the verified credential across environment-variable expansion.
 * The encoded value is still a secret and must never be logged or returned.
 */
export function readOwnerPasswordBinding(bindings: Record<string, string | undefined> = process.env): string {
  const encoded = bindings.IVX_OWNER_PASSWORD_BASE64;
  if (encoded) {
    const password = Buffer.from(encoded, 'base64').toString('utf8');
    // Reject noncanonical base64 and invalid UTF-8; never use a stale alias
    // when an explicit transport binding is malformed.
    return password && Buffer.from(password, 'utf8').toString('base64') === encoded ? password : '';
  }
  return bindings.IVX_OWNER_PASSWORD || bindings.OWNER_NEW_PASSWORD || '';
}
