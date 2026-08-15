# Supabase pressure relief deployment

Deployment marker for the validated IVX agent-worker database outage circuit breaker.

- Worker interval: 60 seconds
- Schema bootstrap retry cooldown after connectivity failure: 10 minutes
- Application patch commit: a71c2d6953d69d0b0cf8cdcbff51fd091e8f6965
