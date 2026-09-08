// A keyword guard, not a legal-compliance certificate. Only a complete,
// standalone negative disclosure is exempt; positive promises elsewhere in
// the same document must still fail the gate.
export function findReturnGuaranteeClaims(body) {
  const withoutNegativeHeadings = String(body).replace(
    /^[ \t]*No guaranteed (?:returns?|roi|profits?)[.!]?[ \t]*$/gim,
    '',
  );
  return [...withoutNegativeHeadings.matchAll(/\bguaranteed\s+(?:returns?|roi|profits?)\b/gi)]
    .map((match) => match[0]);
}
