/** Web uses upright chronological rows; native lists retain their inverted layout. */
export function chatListData<T>(chronological: readonly T[], inverted: boolean): T[] {
  return inverted ? [...chronological].reverse() : [...chronological];
}

export function chatScrollMetrics(offset: number, height: number, viewport: number, inverted: boolean) {
  const maxScroll = Math.max(0, height - viewport);
  return {
    distanceFromLatest: inverted ? Math.abs(offset) : Math.max(0, maxScroll - offset),
    atOlderEdge: maxScroll > 0 && (inverted ? offset >= maxScroll - 120 : offset <= 120),
  };
}

export function scrollChatToLatest(list: {
  scrollToOffset: (options: { offset: number; animated: boolean }) => void;
  scrollToEnd: (options: { animated: boolean }) => void;
} | null, inverted: boolean, animated: boolean) {
  if (inverted) list?.scrollToOffset({ offset: 0, animated });
  else list?.scrollToEnd({ animated });
}
