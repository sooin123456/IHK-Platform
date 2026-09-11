# IFC derivative production deployment evidence

Date: 2026-09-03 (Asia/Seoul)

Scope: deploy the current Universal Drawing Workspace increment, including the immutable IFC derivative queue/worker and truthful web status UI. This evidence does not claim completion of the remaining M2–M5/product roadmap.

## Production state

- Supabase project: `naubrijesaqnnbfaehpy`.
- Applied migration `20260903081614 drawing_ifc_derivative_job_authority` from local source SHA-256 `0e41fbe5bf0d6d4e584b0c272579285f1b02c2509ee8c7d1678b710b4fe4e11e`.
- Applied migration `20260903081624 drawing_ifc_derivative_retention_closure` from local source SHA-256 `2a76e0d061951052f2a660d7bbfa66dfac7fd5b2bbb2f11b7820f2ca1d9c3aa5`.
- Applied migration `20260903091157 drawing_ifc_derivative_audited_requeue` from local source SHA-256 `8c132417a8c6dfddd7e696a8ab6365a96a128d62bc0cf3bf6bc8a23c340e1a6c`.
- Applied forward migration `20260903103502 drawing_ifc_derivative_requeue_replay` from local source `20260903100720_drawing_ifc_derivative_requeue_replay.sql`. It preserves exact committed replay decisions across later purge preparation and uses null-safe payload identity checks.
- Railway service: `lukas-qto-ifc-derivative` (`cad79833-a208-44d2-a9fc-35a2b7e57aa7`). Final deployment `250886a8-e444-4850-b702-94da5935dcc2` is `SUCCESS`, and the deployed image digest is `sha256:68759dd9197276958642eb8246328a7f04a9599882348678c4b342527831b2b0`. Its converter SHA-256 is `b712e9ca85990d5ab95118c442aa784a31ebc34107790260bde6d6fc97c2bcc2`; deployment `6cba1903-a95d-4b26-99d7-19187a1ec173` is the immediately preceding worker rollback target.
- Vercel application: production deployment `dpl_2MDD2wmtnDicRUZ5PbWQcsBbtRE3` is `READY` and promoted to `https://lukas-qto-platform.vercel.app`. Deployment `dpl_JAAzg3aKVMBdUF1v78ApZXnUPyTn` is the immediately preceding web rollback target.

## Deployed increment

- IFC originals remain immutable. A service-only leased queue freezes project, file, Storage path, byte size, SHA-256, requestor, and derivative version before a worker can read an original.
- The worker downloads privately, verifies byte size and SHA-256, invokes an absolute no-shell converter with bounded time/output, publishes exact manifest/GLB lineage through the current lease token, and then acknowledges completion. Retryable infrastructure failures and terminal identity/conversion failures are separated.
- The OxideAV-based converter is pinned to commit `b6dce78735558c631950fc6a700440855ceb9953`, emits deterministic self-contained GLB plus an exact manifest, and carries its MIT license inventory in the release image.
- Exact schema-arity mapped `FootPrint` → `GeometricSet` → `IfcPolyline` window shapes are retained as glTF `LINES`; near-miss and other represented unsupported geometry still fails closed. The handwritten fallback preflights remaining vertex/index budgets before allocation or model cloning.
- Manifest numbers use the ECMAScript-compatible `ryu-js` formatter so fixed/scientific notation round-trips byte-for-byte through the server canonicalizer. Managed GLB publication accepts only default-scene-reachable, fully claimed `TRIANGLES` or `LINES` primitives and rejects orphan meshes.
- Terminal `conversion_failed` jobs can be requeued only by the service role. Every request appends immutable audit evidence, advances the scheduler generation and derivative version, and is fenced to one exact deployed converter SHA. The legacy unfenced claim RPC is revoked.
- Exact request replay is evaluated before purge-state rejection and returns only a null-safe exact identity match. New requeue requests remain blocked after purge preparation, so retry idempotency no longer weakens retention authority.
- Retention now includes derivative manifest/GLB paths, blocks purge while a job is active, rejects orphan derivative prefixes, and uses one project-to-job lock order across purge, claim, publish, fail, and complete.
- The web UI reports `not_queued`, `queued`, `processing`, `retry_wait`, `completed`, and `failed` truthfully. Polling is bounded and pauses in hidden tabs.
- A material-control overflow found by the release browser gate was corrected by constraining shared native selects to their grid column. The failing layout had `scrollWidth=1804` in a 1440px viewport; the corrected layout has `scrollWidth=1440` and the transaction submit button is the actual pointer target.

## Verification

- Production-shaped disposable Supabase/browser gate: 16/16 Playwright scenarios passed, including authentication, project creation, PDF/DXF/IFC source flows, immutable SHA lineage, Viewer denial, collaboration/offline replay, approval, BOQ/material lineage, 10,000-object performance evidence, legacy regressions, and compact/desktop layouts.
- Platform typecheck and production build: passed locally and in Vercel.
- IFC converter: 16/16 Rust tests, formatting, Clippy with warnings denied, an 18-package permissive license inventory, release build, and strict app/Khronos GLB validation passed.
- IFC worker: 15/15 tests, typecheck, and bundled build passed. The claim adapter independently hashes the deployed converter before requesting work.
- Railway worker service: 15/15 tests, typecheck, build, and host/final-image production audits passed with zero vulnerabilities.
- The final Railway image started cleanly, reported converter SHA `b712e9ca…bcc2`, remained idle with no active queue work, and emitted no error-level logs.
- Database authority/retention regression union passed with no failures; the one optional real-Postgres case was skipped outside its required environment. Fresh migration replay and scoped `git diff --check` passed.
- Supabase post-migration authority check: three immutable IFC originals produced three jobs; `anon` and `authenticated` cannot select the queue or claim work, while `service_role` can claim it.
- Vercel candidate and post-promotion checks both returned `/` 200, `/workspace` 302, `/auth/magic-link` 200, `/robots.txt` 200, and `/sitemap.xml` 200. Deployment-scoped `error`, `fatal`, and `5xx` queries returned zero records.
- The final focused IFC/DB/server/viewer regression union passed 102/102. A broader IFC/upload/Storage regression union then passed 126/126 after its stale object-literal-only upload assertion was aligned with the equivalent `FormData.set` transport used by the workspace return flow. The full drawing-workspace union reported 1,387 pass, 11 environment-dependent skips, and only the same two previously disclosed legacy P7 capture-SHA drift failures.
- Independent release review found zero Critical and zero Important findings and returned `Ready to merge: Yes`.
- The replay/consolidated-state follow-up passed its focused IFC requeue/estimator union 8/8. The final disposable production-shaped browser gate passed 16/16 in 1.8 minutes, and the adjacent raw DXF/source-handoff regression union passed 108/108.
- Hosted post-migration inspection confirmed `SECURITY DEFINER`, empty `search_path`, `postgres`/`service_role`-only execution, null-safe job/source/SHA checks, and replay-before-purge ordering. Candidate and promoted production deployment checks returned the expected 200/302 route contract with empty deployment-scoped `error`, `fatal`, and HTTP 500 queries.

## Production queue canary and recovery

- The first canary ended with three immutable failed v1 records. Diagnosis proved all three IFC2X3 files contained 522 represented products: 501 supported triangle meshes and 21 window footprints using the exact mapped geometric-set/polyline graph.
- The audited recovery used three stable request IDs and converter SHA `f3d644e…f0c3d`. Every job advanced once to generation 2 / target version 2, was claimed only by that worker, completed in one attempt, and retained its failed v1 evidence.
- Before the final formatting-only worker rebuild, release-candidate converter `2cde7e0b…293b8` independently reprocessed all three immutable originals read-only. Original byte-size/SHA metadata still matched, each conversion exited successfully, and the final managed validator accepted 522 nodes with `TRIANGLES=501` and `LINES=21`. The succeeding formatted-source deployment passed the same 16/16 converter suite, formatting check, denied-warning Clippy gate, and clean startup check under converter SHA `b712e9ca…bcc2`; no production behavior changed between those builds.
- Final database state: `queued=0`, `processing=0`, `retry_wait=0`, `failed=0`, `completed=3`. Each ready v2 manifest contains 522 elements.
- The three actual Storage pairs were downloaded again after the final deployment. Every manifest is 1,178,514 bytes, every GLB is 831,140 bytes, stored sizes and SHA-256 values match, the final default-scene/mode/orphan-aware managed validation passes, and each GLB contains 522 nodes with primitive modes `TRIANGLES=501` and `LINES=21`.
- All three source rows remain immutable with their original 2,207,320/2,207,379-byte sizes and original SHA-256 values. No failed v1 row or original byte was updated or deleted.

## Known follow-up work

- Railway's service-level healthcheck path is still unset; the image has a Docker `/healthz` check, but `/healthz` is liveness rather than Supabase readiness. This release used worker log events plus full queue convergence as the production readiness canary. Configure Railway Healthcheck Path `/healthz` in service settings and continue using a database canary for readiness.
- Supabase advisor findings newly associated with the queue are expected service-only RLS-without-policy information, an authenticated status RPC that performs its own project authorization, an unused fresh claim index, and a missing covering index for `requested_by`. The last item is a low-priority performance migration, not a current correctness blocker.
- The pinned OxideAV `Model::products()` inventory is still narrower than the full IFC product universe. Add corpus qualification and generic represented-product coverage before claiming universal IFC compatibility; keep unsupported cases fail-closed and use the audited requeue path for each reviewed converter release.
- The explicit mapped-line fallback is allocation-bounded. Allocation behavior inside the upstream normal OxideAV mesher still needs corpus profiling and upstream hardening before hostile-input resource guarantees can cover every geometry path.
- The older standalone P7 performance evidence remains bound to an earlier source commit; current typecheck, production builds, and the fresh production-shaped 16/16 browser gate are green.
- The broader M2–M5/product roadmap remains active and is not marked complete by this deployment.

## Ruling

The current web, database authority/retention/requeue closure, and Railway IFC worker are deployed and smoke-tested. The three production IFC canaries now have byte-verified ready v2 artifacts while their originals and failed v1 evidence remain immutable. Broader IFC product coverage remains a separately qualified compatibility goal rather than an implied claim of universal support.
