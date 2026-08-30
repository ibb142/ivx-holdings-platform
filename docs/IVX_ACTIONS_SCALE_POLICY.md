# IVX GitHub Actions Enterprise Scale Policy

Effective immediately:

1. Continuous Autonomous/112 IA work runs outside GitHub Actions.
2. Agent commits must land on non-protected agent/integration branches, never directly on main.
3. GitHub Actions is reserved for integration, CI, E2E, deploy proof and certification.
4. Recurrent patrol/timer/no-idle/research workflows must not use GitHub cron when equivalent production supervision exists.
5. Main merges are batched; many agent tasks collapse into a small number of integration commits.
6. Latest-SHA wins: obsolete validation should be cancelled/superseded rather than consume runner capacity.
7. Normal target is <=10 meaningful queued GitHub jobs. >=12 is a queue-storm condition.
8. Production runtime must never be paused merely because certification is waiting for GitHub capacity.

This policy exists to support 112+ parallel AI developers without linear CI fan-out.
