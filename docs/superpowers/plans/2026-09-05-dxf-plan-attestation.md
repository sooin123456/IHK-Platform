# DXF server-plan attestation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` task-by-task. Use strict TDD for every
> behavior change.

**Goal:** Make immutable DXF provenance authoritative across the server-prepared
plan, browser outbox, and final Supabase operation insert without replacing the
existing collaboration model.

**Spec:** `docs/superpowers/specs/2026-09-05-dxf-plan-attestation-design.md`

**Architecture:** A service-role-only RPC registers PostgreSQL-canonical digests
of the exact server-built plan in a private ledger. Transaction-local operation
insert/update guards consume one exact proof for every new original grouped DXF
operation, catch the legacy ungrouped source-create compound, and reject the
reference-aware insert-then-rewrite bypass for novel DXF sources. The current
client applies and persists the same plan through IndexedDB/Yjs and the ordinary
outbox.

**Tech stack:** React Router, TypeScript, Zod, Supabase/PostgreSQL, PGlite,
Node test runner, Playwright. No new dependency, state library, CRDT, or service.

## Global constraints

- Preserve the existing linked dirty worktree. Do not stage, commit, reset,
  clean, stash, or broadly format it.
- Never edit a prior migration. Create both forward migrations through the
  Supabase CLI after checking `migration new --help`.
- The database insert boundary, not a browser or route-only comparison, is the
  final authority.
- The service-only issuer may attest only the exact `plan.operations` built from
  the just re-hashed immutable source. Never accept operation JSON from a form.
- Preserve deterministic IDs, canonical receipt prefix recovery, undo/redo,
  offline outbox ordering, Viewer denial, and approved-revision immutability.
- Do not deploy or claim success until the migration, application, disposable
  database/browser, and production candidate gates all pass.
- Release in compatibility order: additive attestation foundation migration,
  attesting web artifact, then enforcement-trigger migration. Capture the exact
  pre-change rollback state and the reviewed guard-disable recovery path; run
  canaries at each boundary.

---

### Task 1: Database attestation authority

**Files:**

- Add: one CLI-created migration named
  `drawing_dxf_plan_attestation_foundation`
- Add: one CLI-created migration named
  `drawing_dxf_plan_attestation_enforcement`
- Modify: `platform/tests/drawing-workspace-dxf-source-runtime.test.mjs`
- Modify: `platform/tests/drawing-workspace-dxf-source-database.test.mjs`

- [ ] Add a RED PGlite scenario using a real deterministic server plan: an
  un-attested original fails, service role attests the exact plan, a one-coordinate
  phase mutation fails with `P1C01` and leaves no object/source/operation row, and
  the exact phase then succeeds.
- [ ] Add RED authority/idempotency cases for authenticated issuer denial,
  actor/project/revision/source/SHA mismatch, incomplete/reordered/duplicate
  groups, changed same-ID re-attestation, exact repeat, committed-prefix repeat,
  rogue same-group members, stripped-group source creation, exact retry,
  a reference-aware fresh-source rewrite bypass, checkpoint/template-clone false
  positives, existing-source restore, and undo/redo.
- [ ] Create the additive foundation migration with one private per-operation
  ledger, a domain/version-separated canonical digest helper shared with the
  existing write lease, and one service-role-only issuer RPC. Bind actor,
  project, revision, canvas, source file/SHA, plan ID/index/count, and exact
  operation-RPC fields. Use explicit grants and an empty search path.
- [ ] Create the separate enforcement migration with final operation insert/update
  guards and a consumer. Require proof for grouped original `mutate_structure`
  DXF imports and the ungrouped `object_source_create` compound. Reject a
  `mutate_objects_with_references` internal rewrite that introduces a novel
  version-1 DXF source, while preserving exact tombstone restore,
  `restore_checkpoint`, and trusted template-clone paths.
- [ ] Run both complete DXF database/runtime files GREEN and prove unrelated
  ordinary structure operations still work.

### Task 2: Server-only issuance integration

**Files:**

- Modify: `platform/app/lukas/lib/drawing-dxf-source.server.ts`
- Modify: `platform/app/lukas/screens/drawing-workspace.tsx`
- Modify: `platform/app/lukas/lib/drawing-workspace.server.ts` only if its narrow
  RPC client contract requires the new function
- Modify: `platform/database.types.ts` from the local authoritative schema if the
  generated public RPC contract changes
- Modify: `platform/tests/drawing-dxf-source-server.test.mjs`
- Modify: `platform/tests/drawing-dxf-route-contract.test.mjs`
- Modify adjacent action/route tests only when their real mocks consume the new
  boundary

- [ ] Add RED server tests proving the privileged call receives the exact
  immutable-byte-derived plan identities and operations, validates the exact
  receipt, rejects altered/malformed/error receipts, and never runs for a blocked
  or empty plan.
- [ ] Add RED action coverage proving Admin/Editor preparation dynamically uses
  the server-only admin client, attests before returning, maps authority outage to
  retryable failure, and never serializes privileged material.
- [ ] Implement the minimum attestation helper and route call. Call the exact
  seven-argument issuer RPC and strictly validate `{ planId, planCount,
  alreadyAppliedCount }` against the plan; dynamically import the existing admin
  client only after a successful non-empty user-scoped prepare. Keep the browser
  plan payload and `applyDrawingDxfImportOperations`/outbox protocol unchanged,
  and never serialize the privileged receipt.
- [ ] Run the complete server, route, source, import-client, and outbox focused
  suites GREEN; run typecheck and scoped formatting.

### Task 3: Regression, review, release, and evidence

**Files:**

- Modify: `docs/superpowers/evidence/2026-09-03-universal-workspace-m4-source-integration.md`
- Modify: `docs/superpowers/evidence/2026-09-03-universal-workspace-production-deployment.md`
- Modify: this plan's SDD ledger and generated review artifacts

- [ ] Independent task and whole-scope review must report zero Critical and zero
  Important findings for provenance, direct-RPC bypass, privilege, idempotency,
  concurrency, rollback, history, and collaboration behavior.
- [ ] Run the focused DXF/database/server/route/outbox union, the broad Drawing
  Workspace Node union, app and collaboration typechecks/builds, scoped Prettier,
  and `git diff --check`.
- [ ] Run the disposable production-shaped M1 browser gate. It must exercise real
  login, verified DXF upload, server attestation, import, persistence/relogin,
  collaboration/offline replay, Viewer denial, approval and downstream lineage.
- [ ] Capture the current hosted migration list and Vercel rollback deployment.
  Apply only the reviewed additive foundation migration and canary service-only
  issuance plus browser denial without retaining test data.
- [ ] Build a production-environment Vercel candidate without moving the primary
  alias. Verify public routes, exact login return paths, protected error surfaces,
  and candidate-scoped fatal/error/HTTP-500 logs; promote that exact attesting
  artifact and repeat the preparation canary.
- [ ] Apply only the reviewed enforcement migration after the attesting artifact
  is live. Canary an authenticated exact plan, an un-attested/direct-RPC denial,
  exact retry and undo/redo, then verify cleanup. Record the reviewed
  guard-disable recovery command because a pre-attestation web rollback is not
  schema-compatible for new DXF imports.
- [ ] Record exact IDs, commands, counts, skips/UNEXECUTED external gates, rollback
  target, and the next remaining roadmap gap. Do not equate local disposable
  evidence with approved-customer or managed-restore acceptance.
