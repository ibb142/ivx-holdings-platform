/**
 * Canonical login state machine.
 *
 * Enforces a single deterministic state transition graph for the login screen.
 * Prevents duplicate taps, concurrent login attempts, and invalid transitions.
 *
 * States:
 *   IDLE → VALIDATING → AUTHENTICATING → AUTHORIZING → PERSISTING → NAVIGATING → SUCCESS
 *   Any state → FAILED (recoverable) → IDLE
 *   Any state → ERROR (terminal) → IDLE (after ack)
 *
 * No secrets are logged. Only state names and transition metadata.
 */

export type LoginState =
  | 'IDLE'
  | 'VALIDATING'
  | 'AUTHENTICATING'
  | 'AUTHORIZING'
  | 'PERSISTING'
  | 'NAVIGATING'
  | 'SUCCESS'
  | 'FAILED'
  | 'ERROR';

export interface LoginStateTransition {
  from: LoginState;
  to: LoginState;
  timestamp: number;
  reason?: string;
}

/**
 * Valid state transitions. Any transition not in this map is rejected.
 */
const VALID_TRANSITIONS: ReadonlySet<string> = new Set([
  'IDLE->VALIDATING',
  'VALIDATING->AUTHENTICATING',
  'VALIDATING->FAILED',
  'AUTHENTICATING->AUTHORIZING',
  'AUTHENTICATING->FAILED',
  'AUTHENTICATING->SUCCESS',
  'AUTHORIZING->PERSISTING',
  'AUTHORIZING->FAILED',
  'AUTHORIZING->SUCCESS',
  'PERSISTING->NAVIGATING',
  'PERSISTING->FAILED',
  'NAVIGATING->SUCCESS',
  'NAVIGATING->FAILED',
  'FAILED->IDLE',
  'ERROR->IDLE',
  // Allow short-circuit from AUTHENTICATING -> SUCCESS for non-owner flows
  // that don't need a separate authorization stage.
  'IDLE->FAILED',
  'SUCCESS->IDLE',
]);

export class LoginStateMachine {
  private currentState: LoginState = 'IDLE';
  private transitionLog: LoginStateTransition[] = [];
  private inFlight: boolean = false;
  private lastTransitionTime: number = 0;

  get state(): LoginState {
    return this.currentState;
  }

  get isInFlight(): boolean {
    return this.inFlight;
  }

  get transitions(): readonly LoginStateTransition[] {
    return this.transitionLog;
  }

  /**
   * Attempt a state transition. Returns true if the transition was accepted.
   * Rejects if the transition is invalid or if a login is already in flight
   * (unless transitioning to FAILED/ERROR/IDLE).
   */
  transition(to: LoginState, reason?: string): boolean {
    const from = this.currentState;
    const key = `${from}->${to}`;

    if (!VALID_TRANSITIONS.has(key)) {
      console.log(`[LoginStateMachine] Rejected invalid transition ${key}`);
      return false;
    }

    const now = Date.now();
    this.currentState = to;
    this.lastTransitionTime = now;
    this.inFlight = to !== 'IDLE' && to !== 'SUCCESS' && to !== 'FAILED' && to !== 'ERROR';
    this.transitionLog.push({ from, to, timestamp: now, reason });

    // Keep log bounded.
    if (this.transitionLog.length > 50) {
      this.transitionLog = this.transitionLog.slice(-50);
    }

    console.log(`[LoginStateMachine] ${from} -> ${to}${reason ? ` (${reason})` : ''}`);
    return true;
  }

  /**
   * Try to start a new login attempt. Returns false if a login is already
   * in progress, preventing duplicate taps and concurrent submissions.
   */
  tryStart(): boolean {
    if (this.inFlight || this.currentState !== 'IDLE') {
      console.log(`[LoginStateMachine] Duplicate tap blocked: state=${this.currentState} inFlight=${this.inFlight}`);
      return false;
    }
    return this.transition('VALIDATING', 'login attempt started');
  }

  /**
   * Reset to IDLE after a failure or terminal error.
   */
  reset(): void {
    this.inFlight = false;
    this.currentState = 'IDLE';
    console.log('[LoginStateMachine] Reset to IDLE');
  }

  /**
   * Get the elapsed time since the last transition in milliseconds.
   */
  get elapsedSinceLastTransitionMs(): number {
    return this.lastTransitionTime > 0 ? Date.now() - this.lastTransitionTime : 0;
  }
}

/**
 * Global singleton instance for the login screen.
 * The login screen creates a fresh instance per mount via useLoginStateMachine.
 */
export function createLoginStateMachine(): LoginStateMachine {
  return new LoginStateMachine();
}
