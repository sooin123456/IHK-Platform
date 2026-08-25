# P3 Task 4 implementation report

## Outcome

- Added a separate Node.js 22 Hocuspocus collaboration service with injectable
  configuration, authentication, database/storage, clock, timer, flush, and
  shutdown seams.
- Added fail-closed Supabase JWT verification for exact issuer/audience,
  authenticated non-anonymous users, and asymmetric `RS256`/`ES256` JWKS only.
  The bounded JWKS cache has an explicit rotation purge and startup preflight.
- Added canonical room/origin authorization, token-sync and per-message database
  reauthorization, plus a 30-second passive downgrade/removal check.
- Added server-owned empty-room metadata, clone-before-mutate client update
  validation, immutable actor-scoped operation appends, bounded stamped
  Awareness, accepted-operation polling, and constant-time signed idempotent
  rejected/conflicted outcome receipts.
- Added complete-document validation, Task 3 generation/SHA CAS persistence,
  transient retry, reload/merge/revalidate CAS recovery, bounded Hocuspocus
  debounce/max-debounce, real liveness/readiness HTTP probes, and single-flight
  shutdown.
- Added a multi-stage `node:22-bookworm-slim` OCI build with a non-root runtime,
  one exposed port, and a built-in readiness healthcheck. No Redis, direct
  `ws`/`lib0`, service-role key, Vercel/Supabase SDK, or second state manager was
  added to the service.

## TDD evidence

RED:

- Initial `node --test tests/drawing-collaboration-service.test.mjs`: 0 passed,
  9 failed because the four collaboration service modules did not exist.
- JWKS cache/purge test failed with
  `createDrawingAccessTokenVerifier is not a function` before implementation.
- The real `/healthz` test received the Hocuspocus welcome response before the
  one-port request listener was correctly installed.
- The startup-preflight test reported `Missing expected rejection` before
  asymmetric JWKS preflight was wired into `start()`.
- The CAS recovery test exposed that empty Yjs top-level collections are not
  encoded in a state update; load now materializes the four canonical shared
  types before full validation.

GREEN:

- `node --test tests/drawing-collaboration-service.test.mjs`: 14 passed,
  0 failed.
- `npm run typecheck:collaboration`: exit 0.
- `npm run build:collaboration`: exit 0; the emitted entrypoint imports
  successfully under the local Node runtime.
- `npm run typecheck`: exit 0.
- `node --test tests/drawing-collaboration-protocol.test.mjs tests/drawing-workspace-p3-database-contract.test.mjs tests/drawing-workspace-p3-postgres-concurrency.test.mjs`:
  12 passed, 0 failed, 1 explicitly `UNEXECUTED` PostgreSQL fixture gate.
- `git diff --check`: exit 0.
- Static scans found no collaboration source import of `ws`, `lib0`, Redis,
  Vercel/Supabase vendor SDKs, service-role shortcuts, console token logging,
  user metadata authorization, private keys, JWTs, or committed database URLs.

## Files

- `platform/collaboration/src/config.ts`
- `platform/collaboration/src/auth.ts`
- `platform/collaboration/src/storage.ts`
- `platform/collaboration/src/server.ts`
- `platform/collaboration/tsconfig.json`
- `platform/collaboration/Dockerfile`
- `platform/collaboration/.dockerignore`
- `platform/collaboration/.gitignore`
- `platform/tests/drawing-collaboration-service.test.mjs`
- `platform/package.json`

## Commit

- `feat: add drawing collaboration service`

## Unexecuted deployment gates

- Docker/Podman is not installed on this machine, so the executable Docker image
  build and container healthcheck are `UNEXECUTED`. The Dockerfile contract is
  covered by the focused static test.
- No production/disposable asymmetric Supabase JWKS, dedicated collaboration
  database login, or real PostgreSQL fixture credentials were available.
  Therefore deployed JWT rotation, `SET LOCAL ROLE` database calls, real
  WebSocket clients, and live store/reconciliation behavior are `UNEXECUTED`.
  Tests use real `jose`-generated RSA/EC key pairs, real Yjs documents, the real
  Hocuspocus HTTP server, and injected database contracts; they do not claim a
  deployed integration run.
- No production migration, secret, database, or external service was modified.
