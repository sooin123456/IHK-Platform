# P3 Task 4 implementation report

## Outcome

- Added a separate Node.js 22 Hocuspocus collaboration service with injectable
  configuration, authentication, database/storage, clock, timer, flush, and
  shutdown seams.
- Added fail-closed Supabase JWT verification for exact issuer/audience,
  authenticated non-anonymous users, and asymmetric `RS256`/`ES256` JWKS only.
  The bounded JWKS cache has an explicit rotation purge and startup preflight.
- Added canonical room/origin authorization, token-sync and per-message database
  reauthorization, required JWT expiry, refresh requests before expiry, and a
  30-second passive downgrade/removal/expiry check. `SIGHUP` exposes the JWKS
  emergency purge path.
- Added server-owned empty-room metadata, clone-before-mutate client update
  validation on Hocuspocus v4's decoded `beforeSync` bytes, immutable
  actor-scoped concurrent operation appends, connection-owned and lease-bounded
  stamped Awareness, atomic accepted-operation polling, and constant-time
  signed idempotent rejected/conflicted outcome receipts that durably load and
  store unloaded rooms before acknowledgement.
- Added complete-document validation, Task 3 generation/SHA CAS persistence,
  transient read/write retry, reload/merge/revalidate CAS recovery that advances
  both the checkpoint and live room, scoped server-origin status persistence,
  bounded Hocuspocus debounce/max-debounce, real liveness/readiness HTTP probes,
  and single-flight shutdown.
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
- Review mutation tests initially produced 12 failures: a missing `exp` token
  was accepted; valid concurrent Y.Array appends were rejected; Awareness peer
  ownership, update count, and ten-second lease bounds were absent; operation
  lookup was not retried; CAS recovery retained checkpoint 3 instead of remote
  checkpoint 5 and did not reconcile the live room; unloaded receipt delivery
  was discarded; polling could leave a partial status mutation; server status
  stores lacked scope; the decoded `beforeSync` seam was absent; and the Docker
  healthcheck used a fixed port.
- The Hocuspocus framing regression uses v4 `OutgoingMessage`,
  `IncomingMessage`, and `MessageReceiver`: the framed Sync/Update is decoded
  before the service receives and clone-validates the bare Yjs update bytes.
- The Awareness regression also passes a malicious peer-removal frame through
  v4 `MessageReceiver`; connection ownership rejects it before the peer state
  can be changed.
- A signed receipt with a failing durable store initially returned HTTP 401;
  the endpoint now reserves 401 for signature/schema authentication failures
  and returns retriable HTTP 503 for persistence failures.
- Rereview RED: a real `HocuspocusProvider` connection was disconnected because
  v4's scratch Awareness contributes its own empty client state, making one
  provider appear as two states. The production provider could sync but its
  cursor never reached the room. The hook now removes exactly that one seeded
  scratch state before enforcing the unchanged one-client limit; the real
  provider sync and stamped cursor update pass end to end.
- Rereview RED: deleting and reinserting an existing `operationOrder` entry in
  a new position while appending a valid operation was accepted. Existing IDs
  must now appear in exactly their prior relative order after new concurrent
  IDs are filtered out. The reorder attack is rejected while both legitimate
  Yjs concurrent arrival orders remain accepted.

GREEN:

- `node --test tests/drawing-collaboration-service.test.mjs`: 24 passed,
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
- Follow-up review hardening is committed separately from the required feature
  commit so the RED/GREEN review delta remains auditable.

## Unexecuted deployment gates

- Docker/Podman is not installed on this machine, so the executable Docker image
  build and container healthcheck are `UNEXECUTED`. The Dockerfile contract is
  covered by the focused static test.
- No production/disposable asymmetric Supabase JWKS, dedicated collaboration
  database login, or real PostgreSQL fixture credentials were available.
  Therefore deployed JWT rotation, `SET LOCAL ROLE` database calls, real
  WebSocket clients, and deployed store/reconciliation behavior are
  `UNEXECUTED`. Tests use real `jose`-generated RSA/EC key pairs, real Yjs
  documents, Hocuspocus v4's real message encoder/decoder and HTTP server, and
  injected database contracts; they do not claim a deployed integration run.
- No production migration, secret, database, or external service was modified.
