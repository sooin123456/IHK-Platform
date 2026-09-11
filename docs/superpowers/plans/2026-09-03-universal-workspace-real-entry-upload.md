# Universal Workspace Real Entry, Upload, and Release Plan

> Required skills: `subagent-driven-development`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `ponytail`, and `supabase`.

**Goal:** Prove and release the real signed-in product path from the workspace dashboard through UI project creation, resumable immutable PDF upload, Edge verification, blank-workspace source attachment, SHA preservation, and Viewer denial, while restoring the canonical 10k release gate without weakening its 16.7 ms frame budget.

**Architecture:** Reuse the existing magic-link callback, workspace dashboard action, `tus-js-client` uploader, `lukas-qto-upload-verify` Edge Function, verified-upload finalization RPC, blank workspace, source-attach mutation, and current Playwright fixture users. Extend only the disposable Supabase runner so it owns and serves the existing verifier function. Add no product state library, upload service, or parallel implementation path.

## Constraints

- The browser must submit the visible project, file-upload, blank-workspace, and source-attach forms; tests may use admin access only to create disposable identities and independently verify persisted evidence.
- The upload must use the existing TUS endpoint and invoke the real local Edge Function before route finalization.
- Source bytes, stored SHA-256, metadata SHA-256, source binding, and project identity must match before and after attachment.
- Viewer denial must be proven against the newly UI-created project and workspace.
- The disposable runner must copy only the required existing function directory into its owned temporary Supabase root and must never point a cleanup command at the repository Supabase directory.
- The existing p95 frame-time target remains `<= 16.7 ms`; browser timestamp quantization may be represented as a rounded nominal fps but must not widen the frame-time target.
- This shared dirty worktree is not committed unless the user explicitly asks. Reviews use path-scoped diffs and reports.

## Task 1 — Disposable Edge verifier authority

- [x] Add failing harness tests that require `edge_runtime` to be enabled, the verifier function directory to be copied into the disposable root, and `supabase start` not to exclude `edge-runtime`.
- [x] Export or isolate the smallest testable disposable-project preparation helper without changing cleanup authority.
- [x] Copy `supabase/functions/lukas-qto-upload-verify` into the owned temporary project and start the local Edge runtime.
- [x] Prove the focused runner and verifier tests pass.

## Task 2 — Real authenticated project and upload vertical

- [x] Add a failing serial Playwright case using the existing real magic-link callback route and the visible `/workspace` new-project dialog.
- [x] Create a blank workspace through the visible start form, then upload a deterministic PDF through the visible project file form and real TUS/Edge/finalization path.
- [x] Return to the blank workspace, attach that uploaded PDF through the visible source control, reload/relogin, and prove exact project/file/workspace/source binding.
- [x] Independently prove uploaded byte SHA-256 and metadata SHA-256 are unchanged before and after attachment.
- [x] Grant the fixture Viewer role through the existing owner-authorized RPC and prove Viewer mutation denial on that newly created workspace.
- [x] Attach compact Playwright evidence with browser errors, identifiers, roles, upload verification/finalization evidence, and before/after SHA values.

## Task 3 — Canonical performance-gate consistency

- [x] Preserve the observed red evidence: p95 met `<= 16.7 ms` while raw reciprocal fps was `59.880239...` and the duplicate `>= 60` assertion failed.
- [x] Make nominal fps reporting tolerant only to browser timestamp display quantization while leaving the `16.7 ms` p95 target unchanged.
- [x] Re-run the canonical 10k case through the disposable production-build gate and retain raw frame samples in evidence.

## Task 4 — Release evidence and deployment

- [x] Run focused harness, upload verifier, route/UI contract, typecheck, build, database, canonical browser, collaboration, and `git diff --check` gates.
- [x] Record exact pass/fail/skip results and remaining M4/M5 boundaries without claiming unexecuted customer-fixture or IFC-conversion proof.
- [x] Deploy the verified tree to Vercel, keep the existing Railway collaboration release because its artifact did not change, and run production auth-route, asset, and health smokes.

## Task 5 — Release hardening correction

- [x] Reproduce and reject an XLSX selected entry whose actual inflated bytes exceed the limit while both ZIP headers understate its size.
- [x] Resolve and validate the canonical invitation origin before the invitation RPC; require `APP_URL` outside loopback development.
- [x] Bind TUS resumed-path adoption to the exact persisted upload URL and ignore malformed persisted metadata.
- [x] Include the upload-resume unit suite in the default Drawing Workspace regression command.
- [x] Re-run focused tests, typechecks, builds, formatting, diff integrity, and the fresh disposable 17-scenario browser gate.
- [x] Deploy one production-environment candidate, verify it, promote that exact artifact, and retain the preceding production deployment as rollback.

## Task 6 — Completed-upload recovery closure

- [x] Persist a versioned, actor/project-scoped browser journal with the authoritative source-upload path before TUS transfer starts, and update it with the service verification ID before finalization.
- [x] Keep the journal across verifier, action, response, reload, and tab-close failures; retry verification or the idempotent finalizer without uploading bytes again.
- [x] Return an explicit same-origin destination from the upload action for browser recovery mode, and clear the journal only after that finalization response succeeds.
- [x] Send no file bytes in the TUS creation request so a lost `Location` response cannot strand an untracked partial source object; retain 6 MiB PATCH chunks and restart resume.
- [x] Add RED-first unit/action tests plus a real browser interruption after the final PATCH, then prove reload recovery performs no second TUS POST/PATCH and creates exactly one immutable file.
- [x] Keep scheduled orphan deletion out of this bounded task: it requires a separate service-only Storage API worker and a verifier/finalizer cleanup-claim protocol so cleanup cannot race a valid finalization.
