import React from 'react';
import { LoginScreenContent } from './login';

/**
 * Owner sign-in must remain a minimal authentication surface.
 *
 * Do not subscribe to Realtime tables here: opening a DB websocket before the
 * owner is authenticated adds avoidable latency and couples sign-in UX to
 * database/realtime availability. Authenticated screens can subscribe after
 * session creation.
 */
export default function OwnerLoginScreen() {
  return <LoginScreenContent ownerMode />;
}
