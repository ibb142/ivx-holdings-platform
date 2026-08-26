export type TelemetryJsonErrorCode =
  | 'HTTP_ERROR'
  | 'NON_JSON_CONTENT_TYPE'
  | 'NON_JSON_RUNTIME_RESPONSE'
  | 'INVALID_JSON';

export class TelemetryJsonError extends Error {
  readonly code: TelemetryJsonErrorCode;
  readonly status: number;
  readonly contentType: string;
  readonly preview: string;
  readonly url: string;

  constructor(input: {
    code: TelemetryJsonErrorCode;
    message: string;
    status: number;
    contentType: string;
    preview: string;
    url: string;
  }) {
    super(input.message);
    this.name = 'TelemetryJsonError';
    this.code = input.code;
    this.status = input.status;
    this.contentType = input.contentType;
    this.preview = input.preview;
    this.url = input.url;
  }
}

function safePreview(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 180);
}

/**
 * Fail-closed JSON reader for IVX runtime telemetry.
 *
 * Never calls response.json() blindly. We first read text so an upstream HTML
 * login/error/proxy page cannot surface as a raw "Unexpected character: <"
 * exception or be mistaken for an empty/zero telemetry payload.
 */
export async function readTelemetryJson<T>(response: Response, url: string): Promise<T> {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const body = await response.text();
  const preview = safePreview(body);
  const looksHtml = /^\s*</.test(body) || /<html[\s>]/i.test(body) || /<!doctype\s+html/i.test(body);

  if (!response.ok) {
    throw new TelemetryJsonError({
      code: looksHtml ? 'NON_JSON_RUNTIME_RESPONSE' : 'HTTP_ERROR',
      message: looksHtml
        ? `NON_JSON_RUNTIME_RESPONSE: ${url} returned HTML with HTTP ${response.status}`
        : `HTTP_ERROR: ${url} returned HTTP ${response.status}`,
      status: response.status,
      contentType,
      preview,
      url,
    });
  }

  if (looksHtml) {
    throw new TelemetryJsonError({
      code: 'NON_JSON_RUNTIME_RESPONSE',
      message: `NON_JSON_RUNTIME_RESPONSE: ${url} returned HTML instead of telemetry JSON`,
      status: response.status,
      contentType,
      preview,
      url,
    });
  }

  if (contentType && !contentType.includes('application/json') && !contentType.includes('+json')) {
    throw new TelemetryJsonError({
      code: 'NON_JSON_CONTENT_TYPE',
      message: `NON_JSON_CONTENT_TYPE: ${url} returned ${contentType || 'unknown content type'}`,
      status: response.status,
      contentType,
      preview,
      url,
    });
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new TelemetryJsonError({
      code: 'INVALID_JSON',
      message: `INVALID_JSON: ${url} returned a body that could not be parsed as JSON`,
      status: response.status,
      contentType,
      preview,
      url,
    });
  }
}
