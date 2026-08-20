/**
 * Login trace checkpoint logging.
 * Emits T1–T7 checkpoints with traceId, timestamp, elapsedMs, and checkpoint name.
 * Never logs password, access token, refresh token, or secret keys.
 */

export type LoginCheckpoint =
  | 'LOGIN_TAP'
  | 'CREDENTIAL_VALIDATION'
  | 'BACKEND_REQUEST_STARTED'
  | 'BACKEND_RESPONSE_RECEIVED'
  | 'SUPABASE_REQUEST_STARTED'
  | 'SUPABASE_RESPONSE_RECEIVED'
  | 'SESSION_CREATED'
  | 'SESSION_PERSIST_STARTED'
  | 'SESSION_PERSIST_COMPLETE'
  | 'OWNER_LOOKUP_STARTED'
  | 'OWNER_LOOKUP_COMPLETE'
  | 'OWNER_RECOVERY_STARTED'
  | 'OWNER_RECOVERY_COMPLETE'
  | 'AUTHORIZATION_STARTED'
  | 'AUTHORIZATION_COMPLETE'
  | 'APP_SESSION_READY'
  | 'NAVIGATION_STARTED'
  | 'NAVIGATION_COMPLETE'
  | 'FAILED';

export interface LoginTraceEvent {
  traceId: string;
  checkpoint: LoginCheckpoint;
  timestamp: number;
  elapsedMs: number;
  success: boolean;
  stage?: 'auth' | 'authorization' | 'storage' | 'navigation';
  path?: string;
  httpStatus?: number;
  errorCode?: string;
  errorMessage?: string;
  networkError?: string;
  timeoutSource?: string;
}

export function generateLoginTraceId(): string {
  return `login-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class LoginTrace {
  traceId: string;
  startTime: number;
  lastCheckpoint: number;

  constructor(traceId?: string) {
    this.traceId = traceId ?? generateLoginTraceId();
    this.startTime = Date.now();
    this.lastCheckpoint = this.startTime;
  }

  checkpoint(
    name: LoginCheckpoint,
    options: {
      success?: boolean;
      stage?: 'auth' | 'authorization' | 'storage' | 'navigation';
      path?: string;
      elapsedMs?: number;
      httpStatus?: number;
      errorCode?: string;
      errorMessage?: string;
      networkError?: string;
      timeoutSource?: string;
    } = {},
  ): LoginTraceEvent {
    const now = Date.now();
    const elapsedMs = now - this.startTime;
    const checkpointElapsedMs = now - this.lastCheckpoint;
    this.lastCheckpoint = now;
    const event: LoginTraceEvent = {
      traceId: this.traceId,
      checkpoint: name,
      timestamp: now,
      elapsedMs,
      success: options.success ?? true,
      ...options,
    };
    console.log(`[LoginTrace] ${this.traceId} ${name} +${checkpointElapsedMs}ms total=${elapsedMs}ms${event.httpStatus ? ` http=${event.httpStatus}` : ''}${event.errorCode ? ` code=${event.errorCode}` : ''}${event.errorMessage ? ` msg=${event.errorMessage}` : ''}`);
    return event;
  }
}
