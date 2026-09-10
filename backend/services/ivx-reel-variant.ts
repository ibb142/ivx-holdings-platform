/** Accept the public .webm URL as well as the legacy extensionless ID. */
export function reelVariantFileName(id: string): string | null {
  const match = /^([a-zA-Z0-9_-]+)(?:\.webm)?$/.exec(id);
  return match ? `${match[1]}.webm` : null;
}
