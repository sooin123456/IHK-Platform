# Task 11 — P2 end-to-end, performance, migration, and release evidence

Date: 2026-08-26 KST

Base: `2675c48`

Commit: `test: verify drawing workspace P2 structure`

## Outcome and boundary

Task 11 is implemented and locally verified. The credentialed production P2
Playwright spec was **UNEXECUTED**. The fail-closed credential helper reported all
four required variable names missing: `E2E_BASE_URL`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. No remote target was called
and no secret value was printed.

The production performance annotations are implemented, but their product targets
are **UNMEASURED / NOT PASSED** until the production gate executes. P3
realtime/Yjs/Hocuspocus is not implemented or claimed by this task.

## RED / GREEN

- RED: `node --test tests/drawing-workspace-p2-contract.test.mjs` completed with
  5 pass / 1 fail. The failing release-record contract found that
  `test:e2e:drawing-workspace-p2:production` was absent from `package.json`; the
  executable fixture, twelve-gate source, active-slice attributes, and nested six
  PGlite migration/security checks were already green.
- GREEN: after adding the exact script and the P2 deployment/matrix status records,
  the same command completed with 6 pass / 0 fail / 0 skipped / 0 todo.
- The production entrypoint is exactly
  `npx playwright test e2e/drawing-workspace-p2.spec.ts --project=chromium`.
  The imported spec calls the four-variable credential guard before fixture setup,
  so absent or masked values fail as `UNEXECUTED`; there is no `test.skip` path.

## Twelve release gates

| Gate                                                        | Exact executable evidence                                                                                                                                                                                                                                                                                                                                    | Local result / production status                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 1. P0/P1 default-paper upgrade without loss                 | Contract invokes the PGlite tests `P2 upgrade leaves an approved v1 snapshot byte-stable` and `P2 upgrade deterministically repairs legacy canvases`; production `Gate 01` rereads retained rows and the default paper canvas.                                                                                                                               | PGlite locally executed; production UNEXECUTED.                        |
| 2. Three pages and paper/model canvas switching             | `P2 performance fixture has exact deterministic release composition` asserts 3 pages and 20 stable canvases; production `Gate 02` switches named canvases and asserts the active ID.                                                                                                                                                                         | Fixture contract locally executed; production UNEXECUTED.              |
| 3. Canvas-isolated layer/object/instance state              | `canvas exposes active-slice mount evidence to the browser gate` checks active canvas plus mounted layer/object/instance counts; production `Gate 03` asserts 500 of 10,000 objects and 50 of 1,000 instances on each active slice.                                                                                                                          | Source/fixture contract locally executed; production UNEXECUTED.       |
| 4. Live style references with persistent overrides          | Production `Gate 04` updates the style definition, rereads the referenced object/block, and asserts their overrides remain exact; drawing suite includes live-style resolution and invalidation tests.                                                                                                                                                       | Drawing suite locally executed; production UNEXECUTED.                 |
| 5. Block lifecycle and referenced-delete denial             | Production `Gate 05` creates, transforms, deletes, and rereads a copy while asserting referenced definition deletion is denied; drawing suite covers copy/transform/delete/undo and referenced guards.                                                                                                                                                       | Drawing suite locally executed; production UNEXECUTED.                 |
| 6. Approved template clone and immutable lineage/SHA        | Nested PGlite test `P2 approved template clone generates fresh identities` passes; production `Gate 06` checks maker/reviewer approval, fresh IDs, lineage, source SHA, and unchanged source evidence.                                                                                                                                                       | PGlite locally executed; production UNEXECUTED.                        |
| 7. Five property types and approval validation              | Fixture contract asserts text/number/boolean/date/enum composition; drawing suite executes property parsing and required-review rejection; production `Gate 07` supplies the missing required value after denial.                                                                                                                                            | Drawing suite locally executed; production UNEXECUTED.                 |
| 8. Deterministic schedule resolution                        | Drawing suite executes object/property/manual-cell schedule ordering and formatting; production `Gate 08` checks row count and exact object, property, manual text, and manual number values across reload.                                                                                                                                                  | Drawing suite locally executed; production UNEXECUTED.                 |
| 9. Reload and offline outbox replay                         | Drawing suite executes P2 recovery, acknowledged/pending replay, atomic conflict, and IndexedDB upgrade cases; production `Gate 09` uses `context.setOffline`, reconnects, reloads, and rereads all P2 counts.                                                                                                                                               | Drawing suite locally executed; production UNEXECUTED.                 |
| 10. Snapshot v2 determinism and approved mutation denial    | Nested PGlite tests `P2 review writes a deterministic complete v2 snapshot` and `P2 tables deny authenticated direct DML` pass; production `Gate 10` uses a separate estimator-backed Editor to author, proves that role cannot approve, then uses Reviewer, Viewer, and non-member clients and rereads unchanged rows after approved DML/RPC probes.        | PGlite locally executed; production UNEXECUTED.                        |
| 11. Parsed PNG/SVG/PDF and ordered content                  | Drawing suite executes the real-browser export and canonical SVG/PNG/PDF tests; production `Gate 11` checks PNG signature/dimensions, parses SVG XML and PDF bytes, asserts visible object/block text, paper page order/dimensions, and metadata.                                                                                                            | Local browser/export contracts executed; production UNEXECUTED.        |
| 12. Source SHA and P0/P1/quantity/approval/Revit regression | `npm run test:ifc` verifies the pinned IFC fixture; drawing and whole Node suites cover P0/P1, quantity, approval, and Revit contracts; production `Gate 12` compares stored and downloaded PDF/IFC SHA evidence, requires 200 responses with functional page evidence, and follows the configured Revit release redirect to a nonempty successful download. | IFC/Node suites locally executed; production source reread UNEXECUTED. |

## Deterministic performance evidence

The fixture contract generated the same stable graph twice and asserted this exact
composition: 3 pages, 20 canvases, 20 layers, 10,000 objects, 20 blocks, 1,000
block instances, 20 styles, 20 property schemas, 20 property values, and 5 tables.
Each canvas owns 500 objects and 50 block instances; the active slice attributes
expose those bounded mounted counts.

The unexecuted production spec is wired to record first usable canvas time, 60
wheel frames, 60 drag-pan frames, 20 alternating distinct block-instance selections, 19 canvas
switches, and SVG/PNG/PDF export durations. It separates product targets from
catastrophic ceilings:

| Metric              |           Product target | Catastrophic assertion | Measured status |
| ------------------- | -----------------------: | ---------------------: | --------------- |
| First usable canvas |                 <= 2.5 s |                <= 10 s | UNMEASURED      |
| Wheel + pan frames  | 60 fps (p95 <= 16.67 ms) |           p95 <= 50 ms | UNMEASURED      |
| Real selection      |      reported separately |           p95 <= 50 ms | UNMEASURED      |
| Canvas switch       |            p95 <= 250 ms |             p95 <= 2 s | UNMEASURED      |
| SVG/PNG/PDF export  |             each <= 30 s |            max <= 30 s | UNMEASURED      |

No product target is marked passed.

## Local verification

| Command                                                                                                                                                                                                                                                                         | Result                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `node --test tests/drawing-workspace-p2-contract.test.mjs`                                                                                                                                                                                                                      | PASS: 7/7, fail 0, skipped 0, todo 0.                                                                         |
| `npm run test:drawing-workspace`                                                                                                                                                                                                                                                | PASS: 418/418, fail 0, skipped 0, todo 0.                                                                     |
| `node --test tests/*.test.mjs`                                                                                                                                                                                                                                                  | PASS: 550/550, fail 0, skipped 0, todo 0.                                                                     |
| `npm run test:ifc`                                                                                                                                                                                                                                                              | PASS: pinned fixture, 413,681 bytes, 120 elements, 115 geometric elements, 119 placements, 14,694 triangles.  |
| `npm run typecheck`                                                                                                                                                                                                                                                             | PASS: React Router typegen and `tsc`, exit 0.                                                                 |
| `npm run build`                                                                                                                                                                                                                                                                 | PASS: prebuild typecheck plus production client/server build; 2,582 client and 139 SSR modules transformed.   |
| `SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=local-anon-key VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=local-anon-key npx playwright test e2e/drawing-workspace-shell.spec.ts e2e/workspace-preview-room.spec.ts --project=chromium --workers=1` | PASS: 4/4 local Chromium tests. Values are non-production loopback placeholders; no service-role key was set. |
| `npm run test:e2e:drawing-workspace-p2:production`                                                                                                                                                                                                                              | **UNEXECUTED**: all four real remote variables unavailable.                                                   |
| Prettier check and `git diff --check`                                                                                                                                                                                                                                           | PASS: all changed files match Prettier and the diff has no whitespace errors.                                 |

### Local Chromium diagnostic

The first credential-free attempt never started tests because Playwright's root
readiness check received HTTP 500 `Missing Supabase environment variables`. Safe
loopback publishable placeholders made the local server ready. A four-worker run
then produced 1 pass / 3 interaction failures. One failing shell test passed alone,
and the complete `--workers=1` run passed 4/4; this isolates the retry to shared
mutable local-preview state under parallel workers rather than production
credentials. The serial command above is the retained local evidence. The
credentialed P2 production file was not loaded or executed during these runs.

## Migration and deploy evidence

The focused contract ran six actual PGlite migration/security cases: duplicate
preflight, deterministic complete snapshot v2, fresh-identity template clone,
authenticated direct-DML denial, approved v1 byte preservation, and deterministic
legacy-canvas repair. The full drawing suite additionally ran fresh install,
ordered additive upgrade, RPC/RLS, invariant, and forward-history reconciliation
coverage. No applied migration was edited and no dependency was added.

`DEPLOYMENT.md` now records duplicate/invariant preflight SQL, backup and schema
snapshot identifiers, representative PDF/IFC SHA-256 identifiers, ordered additive
migrations, `db:typegen`, full tests/build/IFC, preview and credentialed production
commands, promotion evidence, collaboration-room application rollback,
forward-fix-only database changes, and the incident-only restore boundary.
`P0_P5_IMPLEMENTATION_MATRIX.md` keeps `implemented`, `locally executed`,
`production unexecuted`, and `measured target` as separate statuses.

## Concerns / external gates

- Production Editor/Reviewer/Viewer/non-member behavior, cleanup, source-byte
  reread, downloaded artifacts, and performance annotations remain UNEXECUTED.
- Backup identifier, schema snapshot identifier, deployment ID, representative
  production PDF/IFC hashes, migration application, type generation against a
  project ref, preview deployment, promotion, and rollback rehearsal are release
  operator evidence, not local-session claims.
- The production build passes with existing warnings for large chunks, React
  Router v8 future flags, an unsigned theme cookie, and one mixed static/dynamic
  import. No warning was promoted to a Task 11 success claim.
