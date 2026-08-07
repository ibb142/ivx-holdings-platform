/**
 * React hook for the canonical login state machine.
 * Provides a fresh LoginStateMachine instance per mount and
 * exposes the current state for UI rendering.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { createLoginStateMachine, LoginState, LoginStateMachine } from './login-state-machine';

export function useLoginStateMachine() {
  const machineRef = useRef<LoginStateMachine>(createLoginStateMachine());
  const [state, setState] = useState<LoginState>('IDLE');

  const guardedTransition = useCallback(
    (to: LoginState, reason?: string): boolean => {
      const accepted = machineRef.current.transition(to, reason);
      if (accepted) {
        setState(machineRef.current.state);
      }
      return accepted;
    },
    [],
  );

  const tryStart = useCallback((): boolean => {
    const accepted = machineRef.current.tryStart();
    if (accepted) {
      setState(machineRef.current.state);
    }
    return accepted;
  }, []);

  const reset = useCallback(() => {
    machineRef.current.reset();
    setState(machineRef.current.state);
  }, []);

  const isInFlight = useMemo(
    () => state !== 'IDLE' && state !== 'SUCCESS' && state !== 'FAILED' && state !== 'ERROR',
    [state],
  );

  return {
    state,
    isInFlight,
    tryStart,
    transition: guardedTransition,
    reset,
    machine: machineRef.current,
  };
}
