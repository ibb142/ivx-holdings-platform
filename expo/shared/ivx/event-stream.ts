/** Incremental SSE framing, including CRLF split between network chunks. */
export function createEventStreamDecoder(onData: (data: string) => void, maxEventChars = 262_144) {
  let line = '', data: string[] = [], eventChars = 0, afterCR = false;
  const completeLine = () => {
    if (line === '') {
      if (data.length) onData(data.join('\n'));
      data = []; eventChars = 0;
    } else if (line === 'data' || line.startsWith('data:')) {
      const value = line === 'data' ? '' : line.slice(5).replace(/^ /, '');
      data.push(value);
    }
    line = '';
  };
  return {
    push(chunk: string) {
      for (const char of chunk) {
        if (afterCR) { afterCR = false; if (char === '\n') continue; }
        if (++eventChars > maxEventChars) throw new Error('EVENT_STREAM_RECORD_TOO_LARGE');
        if (char === '\r' || char === '\n') {
          completeLine(); afterCR = char === '\r';
        } else line += char;
      }
    },
  };
}
