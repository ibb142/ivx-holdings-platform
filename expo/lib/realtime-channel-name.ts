export function buildRealtimeRuntimeChannelName(
  baseName: string,
  instanceId: string,
  generation: number,
): string {
  return `${baseName}-${instanceId}-g${generation}`;
}

