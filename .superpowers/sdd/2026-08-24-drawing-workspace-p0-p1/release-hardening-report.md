# Release hardening report

## Outcome

- Added the additive `20260824154700_drawing_workspace_release_hardening.sql` migration without changing or remotely applying any earlier migration.
- Assigned `P1C01` to deterministic drawing conflicts and `P1R01` to fail-closed target/domain rejection. PostgreSQL `40001` and `40P01` remain transient RPC failures and therefore stay queued for retry.
- Added deployment duplicate detection and a partial unique non-null `(project_id, source_file_id)` index. Repeated null-source documents remain valid.
- Bound an exact duplicate operation acknowledgement to its stored revision, actor, operation type, base versions, forward payload, and inverse payload.
- Made apply, review-request, decision, document-create, and issue-link errors capability-aware and typed while preserving the existing guarded implementation behind additive wrappers.
- Review submission now freezes new local mutations, drains volatile persistence, flushes immediately, proves both scoped durable and legacy queues empty, and surfaces failure without submitting.
- A newly created and acknowledged object is linkable to an existing issue in the same session from current `drawingState`, without a loader reload. The authoritative RPC remains the final object/issue validator.

## TDD evidence

### RED

- `node --test tests/drawing-workspace-server.test.mjs`: three new stable-error assertions failed while `P1C01`/`P1R01` were unmapped and `40001`/`40P01` were incorrectly terminal conflicts.
- `node --test tests/drawing-workspace-outbox.test.mjs`: failed because `prepareDrawingReview` did not exist and HTTP 409 rejection was collapsed into conflict.
- `node --test tests/drawing-workspace-database-runtime.test.mjs`: initially failed with `ENOENT` for the required new migration; after the RED migration fixture existed, the real issue-link RPC still returned legacy `P0001` rather than the stable rejection code.
- `node --test tests/drawing-workspace-route.test.mjs`: failed because same-session readiness still depended on loader objects and `drawingIssueLinkReady` did not exist.
- `node --test tests/drawing-workspace-e2e-contract.test.mjs`: failed because the production specification did not contain a draw → save → issue-link-without-reload contract.

### GREEN

- Focused final command covering PGlite/server/outbox/route/E2E contracts: 130/130 passed.
- `node --test tests/drawing-workspace-database-runtime.test.mjs`: 49/49 passed, including real stale-version `P1C01`, real PGlite `40001`/`40P01`, non-null source concurrency/sequential conflict, null-source repeatability, duplicate-deployment preflight, uniform foreign/random revision targets, and exact idempotency payload checks.
- `npm run test:drawing-workspace`: 222/222 passed.
- `node --test tests/*.test.mjs`: 337/337 passed.
- `npm run test:ifc`: passed with 413,681 bytes, 120 selectable elements, 115 geometric elements, 119 placements, and 14,694 triangles.
- `npm run typecheck`: passed.
- `npm run build`: passed. Only the established large-chunk, React Router future-flag, and unsigned theme-cookie warnings were emitted.
- `git diff --check`: passed.

## Database behavior evidence

- A real PGlite stale-object-version error crosses the actual migration RPC, server action, transport, and durable outbox paths and ends as terminal `충돌 검토 필요`.
- Real PGlite exceptions carrying `40001` and `40P01` cross the same server/transport path and remain `pending`; no terminal conflict or rejection is fabricated.
- Concurrent-intent and sequential document creates permit one non-null source identity only. A duplicate pre-existing deployment fixture aborts with `P1C01` before the unique index is installed.
- Apply, request-review, and decision return the same `P1R01` / `Drawing revision target is unavailable` pair for foreign and random revision IDs. Authorized state/version diagnostics are retained only after that lookup.
- An exact operation retry returns the original operation/sequence/result-version acknowledgement. Actor, type, bases, forward, or inverse mismatch returns `P1C01`.

## Browser verification

`agent-browser` was unavailable on `PATH`, so the equivalent checklist was run with the repository's Playwright Chromium against an explicitly bound local development server with non-secret placeholder publishable Supabase settings.

- `E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test e2e/workspace-preview-room.spec.ts --project=chromium --reporter=line`: 1/1 passed.
- Preview route returned HTTP 200 with 657 body characters, the expected `건축 평면도 A-101.pdf` heading exactly once, zero framework overlays, 24 interactive elements, and zero console/page errors.
- Screenshot: `/tmp/drawing-release-hardening-preview.png`.
- Chromium closed and the local development server was stopped.

An earlier no-placeholder probe was intentionally not counted as a pass: it returned the expected HTTP 500 `Missing Supabase environment variables`. This confirmed the environment gate rather than the product UI.

## React self-review

- Review preparation is interaction-owned rather than effect-driven; transient freeze/submission coordination uses refs, while visible preparation/error state uses React state.
- The navigation effect subscribes only to the primitive navigation state and releases the freeze only after the real form submission lifecycle was observed.
- No new global listener, duplicated authoritative drawing state, heavy dependency, barrel import, or render-loop work was added.
- The review button is unavailable until the scoped outbox exists. Duplicate submission during preparation is synchronously refused, but the captured native submitter remains enabled so the final `requestSubmit` is valid.
- Same-session issue-link eligibility is a small pure derived predicate over the current authoritative client reducer state and save status.

## Unexecuted external gates

- Production Drawing Workspace E2E remains **unexecuted** because `E2E_BASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are all absent. No remote fixture or migration write was attempted and no production browser/performance result is claimed.
- `npx supabase migration list --local` could not connect to `127.0.0.1:54322` because the local Supabase/Docker stack was not running. Migration behavior is covered by the real PGlite application path, but this is not represented as a local Supabase CLI pass.

## Changed files

- `platform/supabase/migrations/20260824154700_drawing_workspace_release_hardening.sql`
- `platform/app/lukas/components/drawing-workspace.client.tsx`
- `platform/app/lukas/lib/drawing-outbox.client.ts`
- `platform/app/lukas/lib/drawing-workspace-view.ts`
- `platform/app/lukas/lib/drawing-workspace.server.ts`
- `platform/e2e/drawing-workspace.spec.ts`
- `platform/tests/drawing-workspace-database-runtime.test.mjs`
- `platform/tests/drawing-workspace-e2e-contract.test.mjs`
- `platform/tests/drawing-workspace-outbox.test.mjs`
- `platform/tests/drawing-workspace-route.test.mjs`
- `platform/tests/drawing-workspace-server.test.mjs`

## Scope boundaries

- No earlier migration was rewritten and no migration was applied remotely.
- No Yjs, separate collaboration server, state-management package, or other new dependency was introduced.
- P3 live multi-user synchronization and the production-only performance/SHA/role fixture remain outside this release-hardening change and are not claimed complete here.

## Fix round 2 — local Playwright host alignment

### RED and root cause

- Added `local Playwright server binds the same explicit host as its readiness URL` before changing the config.
- `node --test tests/drawing-collaboration-e2e-contract.test.mjs`: 2/3 passed and the new test failed with `local webServer command must declare an explicit host`.
- `BASE_URL` used `127.0.0.1`, while the local web-server command allowed the development server to bind its default `localhost`. Playwright therefore polled a different interface until its 60-second timeout.

### Correction

- Changed only the non-remote `webServer.command` to `npm run dev -- --port ${PORT} --host 127.0.0.1`.
- The `remote` branch remains `undefined`, so a supplied `E2E_BASE_URL` still starts no local server and is unchanged.
- No dependency, server abstraction, or additional configuration path was introduced.

### GREEN and environment evidence

- Focused config contract: 3/3 passed.
- The literal no-environment preview command reached `127.0.0.1:4000` after the host correction, then timed out because the root loader returned the existing HTTP 500 `Missing Supabase environment variables`; this was not counted as a product pass.
- In a clean shell with non-secret local placeholder publishable Supabase values exported, the requested command itself was run unchanged: `npx playwright test e2e/workspace-preview-room.spec.ts --project=chromium`. It started the configured local server and passed 1/1 in 5.7 seconds.
- Focused config/workspace E2E contracts: 5/5 passed.
- `npm run test:drawing-workspace`: 222/222 passed.
- `node --test tests/*.test.mjs`: 338/338 passed.
- `npm run test:ifc`: passed with 413,681 bytes, 120 selectable elements, 115 geometric elements, 119 placements, and 14,694 triangles.
- `npm run typecheck`, `npm run build`, and `git diff --check`: passed. Build output contained only the already-recorded warnings.
