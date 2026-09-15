// Keep the native-intent module independent of the router during cold start.
// A mounted root navigator can consume warm links with replace(), so repeated
// external links do not retain every previous screen and its subscriptions.
type NativeIntentHandler = (destination: string) => void;
let handler: NativeIntentHandler | null = null;

export function registerNativeIntentHandler(next: NativeIntentHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

export function dispatchNativeIntent(destination: string): boolean {
  if (!handler) return false;
  try {
    handler(destination);
    return true;
  } catch {
    // If the navigator is not ready, preserve Expo's normal link handling.
    // Do not log the link: it may include private IDs or authentication data.
    return false;
  }
}
