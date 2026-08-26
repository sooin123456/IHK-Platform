# P4 Task 5 review-fix report

Reviewed implementation: `83d560e7b16c985553679296de2fc23152690c08`

## Corrections

- I1: authorized `P4_MEASUREMENT_V1` evidence now carries the canonical document ID, revision ID/version, snapshot SHA-256, operation checkpoint, and an exact sorted `{ objectId, objectVersion }` ledger. Per-object evidence repeats that lineage and an exact canonical object fingerprint. Both the Schedule and semantic-inspector surfaces compare the full current lineage before displaying a server value as confirmed; a same-ID version or geometry replacement is stale.
- I2: authorization and transactional-bootstrap failures still propagate. Only derivation after a successful authorized bootstrap is converted to a bounded `measurement_derivation_failed` state. The invalid collaboration bootstrap is not hydrated, editing is disabled, and the already-loaded workspace remains visible with explicit accessible `계산 오류 · 미확정` status.
- Browser schedule derivation is isolated per fixed schedule. A malformed door graph, for example, leaves valid Room and Finish previews available while the Door schedule renders no rows and `계산 불가` totals; it never represents unavailable data as zero or confirmed evidence.

No migration, table, RPC, public measurement API, persisted semantic schedule row, package/lockfile change, dependency, state manager, operation type, or CRDT shape was added. The existing P0-P3 database and authority surfaces are unchanged.

## RED evidence

- Initial focused review suite: 77 discovered; 70 passed and 7 failed on missing bundle/item lineage, same-ID object-version rejection, bounded server derivation state, safe preview resolution, route composition, and accessible UI error handling.
- The corrected same-ID UI probe failed with the prior behavior by displaying the old `1 m²` server schedule as confirmed against version-2 geometry.
- A route adversarial probe failed because the prior loader accepted cross-document/revision lineage, and the invalid-graph probe exposed the malformed collaboration bootstrap instead of retaining a bounded read-only workspace.

## GREEN and verification evidence

- Focused semantic schedule/server/table/route suite: 77/77 passed, 0 failed.
- Broad P4 database/runtime/server/schedule/table/route suite: 233/233 passed, 0 failed.
- Full `npm run test:drawing-workspace`: 589 discovered; 588 passed, 0 failed, 1 explicitly skipped disposable-PostgreSQL concurrency fixture.
- Fresh `npm run typecheck`: exit 0.
- Fresh `npm run build`: exit 0. Established mixed dynamic/static import, unsigned-theme-cookie, and localStorage warnings remain warnings only.
- Real Chromium shell `e2e/drawing-workspace-shell.spec.ts`, Chromium, one worker: 11/11 passed.
- Focused Prettier check and fresh `git diff --check`: exit 0.

## Adversarial coverage

- Same semantic object ID with version 1 evidence and version 2 geometry at the same checkpoint is stale in the pure resolver, Schedule surface, and semantic inspector.
- Document ID, revision ID/version, snapshot SHA-256, checkpoint, object version, and canonical object fingerprint mismatches independently prevent confirmation.
- A missing opening host yields bounded server evidence failure plus an accessible unconfirmed/error preview with safe empty/unavailable Door semantics while independent schedules remain visible.
- Direct-workspace versus bootstrap document/revision lineage mismatch rejects the route state, and an authorization/bootstrap RPC denial still propagates instead of being downgraded to a measurement error.
- Client-submitted measurement fields remain rejected; the browser cannot create confirmed evidence.

## Commit

- Subject: `fix: close P4 schedule evidence review findings`
- Identity: the commit containing this report; the exact SHA is reported in the task handoff because a commit cannot embed its own content hash.

## Residuals

- The disposable PostgreSQL concurrency fixture remains explicitly unexecuted because the external fixture is not configured; no new real-PostgreSQL execution is claimed.
- Task 6 remains responsible for populated semantic preview/export and collaboration/offline/history vertical evidence.
