# P5 Task 6 Fix Round 1 — implementation and release report

Date: 2026-08-27
Source commits: `6ea2e40`, `04b1548`, `0e81be6`, `84c235f`

## Outcome

The exact local P5 release manifest completed with `P5 LOCAL PASS`. The hosted production gate remains honestly `UNEXECUTED`: this workspace does not contain the real application, Supabase, collaboration-service, database-admin, and run authority values required to execute it. The fail-closed production command exited nonzero instead of converting missing authority into a pass.

The measured 10,000-object / 2,000-link production-build baseline reached first usable in **13,718 ms**, so the 2,500 ms target is **NOT MET**. The P7 60 fps gate remains **UNEXECUTED**.

## Review findings

### I1 — stable local production lifecycle

- The Vite-development-only `web-ifc` import-generation test is isolated under the development Playwright configuration and its own installed-Playwright npm command.
- The production-build P5 command excludes that development-only interception and exercises only stable application-owned lifecycle seams.
- Package scripts use the repository-installed Playwright binary; no `npx`, dependency, lockfile, or workspace-file change was introduced.
- The exact local command now terminates successfully rather than waiting for a Vite URL that cannot exist in the production bundle.

### I2 — hosted `/workspace` authority

- The hosted P5 production specification targets `/workspace` and covers Editor `put_source` / `delete_source`, Viewer direct denial, two-user reflection, signed current/predecessor PDF and IFC access, 2D/3D/split modes, atomic relink, OCC/RLS/role denial, source-row and byte invariance, and cleanup.
- The spec compiles and lists one Chromium test without production credentials.
- `npm run release:drawing-workspace-p5:production` exited `1` with `P5 production gate is UNEXECUTED` because these real values are absent: `E2E_BASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_DRAWING_COLLABORATION_URL`, `COLLABORATION_INTERNAL_URL`, `COLLABORATION_INTERNAL_SECRET`, `COLLABORATION_FREEZE_SECRET`, `P3_E2E_DATABASE_ADMIN_URL`, and `P3_E2E_RUN_ID`.
- Consequently production authority, storage CORS, signed URLs, and the real two-user provider gate remain **UNEXECUTED**, not passed by a local substitute.

### I3 — run-bound source evidence

- The browser mutation workflow fetches and hashes the exact served bytes before and after mutation and records the authoritative file-row metadata under a run-specific UUID.
- The constants remain expected oracles only; the measurement payload is populated from observed browser bytes and rows.
- The observed pairs remained invariant:
  - current PDF: 62,602 bytes, SHA-256 `4dbe58c133a1ce84e1b4da4fce93694ec4f69585bed20e71408a86b7f704e326`
  - predecessor PDF: 63,118 bytes, SHA-256 `ea75a7e655dee16a460672131424f00112f70467e495f751d77de80e409fc9bc`
  - IFC: 413,681 bytes, SHA-256 `db372f3f57796e2f572958c1c144bf3d8be7912493738636a2152cf18f08a14d`

### M1 — usable IFC lifecycle and cleanup

- The production-build baseline waits for the 115-element ready marker, a usable IFC frame, and focus on element `2863`, while asserting exactly one IFC fetch.
- The mounted lifecycle records one owned IFC disposal and one context-loss request; after unmount no IFC canvas remains.
- Workload evidence is exactly 10,000 drawing objects, 2,000 immutable source links, one selected IFC model, and one active compare page.
- The measured first usable result is 13,718 ms: **NOT MET** against 2,500 ms. No 60 fps claim was inferred from this measurement.

## PDF lifecycle fixes

- The PDF revision-diff worker test now uses a deterministic two-way Atomics handshake, removing the scheduling assumption that previously failed only in the parallel suite.
- Current and predecessor PDF effects fence their mounted source before disposing their owned page/document resources. The production canonical lifecycle completed without the reproduced zero-sized `drawImage` `InvalidStateError`.
- The current/predecessor pair is distinct and byte-verified, and the canonical production-build workflow renders the explicit overlay change marker without contradictory route interception.

## Additional regression closure found by the exact manifest

- Yjs operation projection now re-establishes the canonical `objects` and `layers` map identities before publishing into the document store. The focused test was recorded RED on reference inequality and GREEN after normalization.
- The canvas, history undo harness, and checkpoint restore controls now wait for durable outbox authority. Legacy checkpoints missing the P5 `sources` collection restore as an empty source set.
- Legacy P4 flag routes no longer accidentally opt into the no-flag canonical P5 fixture; the canonical user entry remains the unflagged route.
- Selection falls back to canonical geometry when a transparent renderer hit node supplies no hint. The focused test was RED with an empty selection and GREEN after the pure geometry fallback; the integrated architectural flow then passed twice consecutively.

## Verification

- Exact command: `npm run release:drawing-workspace-p5:local` — **PASS** (`P5 LOCAL PASS`).
- Whole Node suite: 986 total, 985 pass, 1 intentional skip.
- Drawing Workspace Node suite: 691 total, 690 pass, 1 intentional skip.
- Collaboration service: 33/33 pass.
- IFC geometry smoke: 413,681 bytes, 120 elements, 115 geometry-bearing elements, 14,694 triangles — pass.
- IFC/PDF/quantity/approval/Revit regression set: 100/100 pass.
- Application and collaboration typechecks/builds: pass.
- P4 Chromium functional/IndexedDB manifest: 13/13 pass.
- P4 production-build performance: 1/1 pass; its performance decision remains governed by its evidence.
- License closure: 7/7 pass; application/collaboration audit and diff checks pass.
- P5 development import-generation lifecycle: 1/1 pass.
- P5 production-build vertical and stable lifecycle: 12/12 pass.
- Focused projection suite: 27/27 pass.
- Focused semantic selection/tool suite: 14/14 pass.
- Integrated P4 architectural flow: 1/1 pass and 2/2 consecutive repeat pass.
- Hosted P5 production spec `--list`: 1 test listed and compiled.
- Hosted production execution: **UNEXECUTED**, fail-closed exit `1` due to the missing real authority values listed above.

Generated release evidence: `task-6-release-evidence.json` with source commit `84c235f24cc335ad3a28f6187b913c8892593806` and run ID `30d8153a-558a-427f-b89e-bac52a5ab9cc`.

## Workspace preservation

The four pre-existing dirty P4 files were restored byte-for-byte after every release run and were not staged:

- `progress.md`: `192f4d61533008d04ae890859ba7557648856cd2fd5f91007e2a90e8fade9b39`
- `task-6-desktop.png`: `da1246a9c37673cd2a2d8beb533848e7a9ba0f4eb16b11b7870562ae782d4e69`
- `task-6-fix2-integrated-authored.png`: `b23862641c759aacdfcdbb6c642e9db9d7a2c15f910a4d0c59a157bd7bc7b357`
- `task-6-fix2-integrated-restored.png`: `ce56d8849cd3c0ad59b3b5785b21bc682837b52af73c9ed2e1ae9c4daf3bfd15`

Generated P4 performance output, the Task 5 PDF overlay image, and audit screenshots were excluded from Task 6. No `pnpm-lock.yaml`, `pnpm-workspace.yaml`, dependency, or lockfile change remains.
