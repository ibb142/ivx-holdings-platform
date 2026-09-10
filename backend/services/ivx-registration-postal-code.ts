/** Postal code is optional; when supplied, validate before creating an identity. */
export function validRegistrationPostalCode(value: string, country: string): boolean {
  const code = value.trim();
  if (!code) return true;
  if (/^(US|USA|United States)$/i.test(country.trim())) return /^\d{5}(?:-\d{4})?$/.test(code);
  // Other countries may use letters, spaces and hyphens. Do not impose a US ZIP.
  return /^[\p{L}\p{N}][\p{L}\p{N} -]{0,14}[\p{L}\p{N}]$/u.test(code);
}
