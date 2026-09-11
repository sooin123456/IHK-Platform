# IFC derivative production implementation plan

**Goal:** Connect a verified immutable IFC upload to a truthful, source-faithful
3D derivative through a separately deployed open-source worker.

**Architecture:** Reuse the existing immutable file identity, strict
manifest/GLB validator, content-addressed Storage publisher, and ready RPC. Add
one small service-only lease queue, continue the pinned permissive Rust
converter, and run it in one Linux storage-pull worker. Do not add a browser IFC
parser, a second collaboration protocol, or another client state store.

**Tech:** Supabase Postgres/Storage, Node 22 worker, Rust 1.80.1,
`oxideav-ifc` pinned Git revision, current `gltf-validator` authority.

---

## Task 1 — Close the converter/platform contract

- [ ] Import the already reviewed `tools/ifc-derivative` prototype without its
  generated targets.
- [ ] Write RED tests for exact canonical manifest keys and self-contained GLB
  identity/primitive mapping.
- [ ] Add deterministic GLB generation, source UUID binding, metre units,
  no-clobber two-artifact output, and current platform byte limits.
- [ ] Prove deterministic output, fail-closed cleanup, source SHA invariance,
  glTF conformance, and permissive locked dependency closure.

## Task 2 — Add the service-only job/lease authority

- [ ] Write RED install/backfill/enqueue/claim/lease/retry/terminal tests.
- [ ] Add one forward migration with one idempotent IFC enqueue trigger and
  service-only job projection.
- [ ] Add narrow claim/complete/fail RPCs with `SKIP LOCKED`, bounded leases,
  opaque tokens, attempts, next derivative version, and exact-ready
  reconciliation.
- [ ] Prove anon/authenticated/Viewer denial, concurrency, response-loss retry,
  and source-row/hash invariance.

## Task 3 — Implement the storage-pull worker

- [ ] Write RED orchestration tests for no-job, success, source mismatch,
  converter rejection, transient publication failure, timeout, and cleanup.
- [ ] Download the claimed object, stream/hash it, invoke the converter without
  a shell or credential-bearing environment, and enforce time/byte limits.
- [ ] Reuse `validateManagedIfcDerivativePair` and
  `publishManagedIfcDerivativeReady`; complete only after exact ready evidence.
- [ ] Add one Node 22 Linux multi-stage image, non-root runtime, health endpoint,
  graceful shutdown, bounded polling, and structured secret-free metrics.

## Task 4 — Make IFC status truthful and live

- [ ] Write RED loader/UI tests for legacy no-job, queued, processing,
  retry-wait, ready, and failed states.
- [ ] Load only the selected source's job metadata and remove the no-row means
  pending fallback.
- [ ] Add bounded route revalidation while a real job is nonterminal; preserve
  the full 2D workspace on 3D failure.
- [ ] Prove upload-to-terminal browser behavior and Viewer read-only access.

## Task 5 — Close retention and publication races

- [ ] Write RED purge dependency/storage-manifest tests with ready, failed,
  queued, and leased jobs.
- [ ] Extend retention authority to stop claims, cover job/derivative rows and
  JSON/GLB objects, and reject late publication.
- [ ] Prove full purge, restore boundary, active-lease handling, orphan cleanup,
  and no cross-project deletion.

## Task 6 — Qualify and deploy

- [ ] Run focused converter, database, worker, server, browser, typecheck,
  production-build, collaboration, license, and retention regressions.
- [ ] Convert the pinned real IFC2X3 fixture twice; validate byte-identical
  artifacts, exact source SHA, ready publication, rendering, and GlobalId focus.
- [ ] Build the Linux image and record digest, Rust/engine revisions, SBOM,
  timings, sizes, and honest unsupported cases.
- [ ] Deploy database migration, worker, then the Vercel application; run public
  and authenticated production smoke without weakening secret boundaries.
- [ ] Keep multi-exporter compatibility `UNEXECUTED` until approved Revit,
  Archicad, Tekla, IFC2X3, and IFC4 fixtures all pass.

