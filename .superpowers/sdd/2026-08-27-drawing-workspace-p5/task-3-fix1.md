# P5 Task 3 review fix 1 implementation report

Date: 2026-08-27

Base feature commit: `f8be5336895575cfb5c6a88deb16a147868aca43`

Required commit subject: `fix: harden drawing evidence authority`

Review source: `.superpowers/sdd/2026-08-27-drawing-workspace-p5/task-3-review.md`

## Outcome

Resolved all four Important findings and the low-risk Minor finding from review round 1/5 without adding a second migration or changing any committed P0-P4 migration. The existing unmerged P5 forward migration remains the only P5 migration.

- Active source-bearing integrated workspace loads no longer hit a temporal-dead-zone crash.
- Every legal P0-P4 IFC identity/camera combination upgrades losslessly. Rows that do not satisfy the exact live P5 IFC contract become version-2 deleted history; their element ID, GlobalId, and camera bytes are retained and no GlobalId is fabricated.
- Trusted pre-P5 schema-v2 PDF checkpoint source payloads are normalized at restore time from their exact historical producer shape. The immutable snapshot JSON and SHA remain unchanged.
- Source-only checkpoint restores use an atomic ledger insert when no legacy core action remains, preserving source OCC/result versions and the existing final canonical-graph comparison.
- Both SECURITY DEFINER trigger guards deny direct execution to PUBLIC, anon, authenticated, and service_role. The migration owner's global default PUBLIC function EXECUTE privilege is revoked, which closes future private-function execution rather than relying on ineffective schema-local subtraction from PostgreSQL's global default ACL.
- Removed the comment-sensitive P5 lineage regex test. Runtime review/checkpoint/template/approved-child/freeze tests remain the executable lineage proof.

No UI, dependency, public source-management API, schema discriminator, collaboration state store, or unrelated behavior was added.

## TDD RED record

Each Important finding received a focused behavioral regression before its production fix.

### I1 integrated loader

The existing full `loadDrawingWorkspace` fixture was given one active PDF source and an assertion over the integrated revision source collection.

```sh
node --import tsx --test --test-concurrency=1 \
  --test-name-pattern='loads a full P4 workspace' \
  tests/drawing-workspace-server.test.mjs
```

RED: `ReferenceError: Cannot access 'objectIds' before initialization` in `parseP2Workspace`.

### I2 populated P0-P4 upgrade

Added a PGlite upgrade matrix containing the legal PDF shape and the full cross-product of legacy IFC identity forms (numeric element only, arbitrary legacy element only, GlobalId only, numeric element plus GlobalId, arbitrary legacy element plus GlobalId) with null, canonical, and legacy-object cameras.

```sh
node --import tsx --test --test-concurrency=1 \
  --test-name-pattern='P5 upgrade preserves every legal P0-P4 source shape' \
  tests/drawing-workspace-database-runtime.test.mjs
```

RED: PostgreSQL `23514`, `lukas_drawing_object_sources_exact_payload_check`.

### I3 immutable pre-P5 checkpoint

Added a full-chain fixture that creates a P3 PDF source checkpoint, verifies that the stored source has neither `revisionId` nor `version`, rejects review back to draft, applies every P4 migration and P5, soft-deletes the source, and restores the checkpoint.

```sh
node --import tsx --test --test-concurrency=1 \
  --test-name-pattern='P5 restores an immutable pre-P5 PDF checkpoint' \
  tests/drawing-workspace-database-runtime.test.mjs
```

Initial RED: `Drawing checkpoint source graph is invalid`.

After historical-shape normalization, the same test exposed the source-only legacy executor boundary with RED `Drawing checkpoint payload is invalid`; the final atomic source-only ledger path resolved that second failure.

### I4 trigger/default ACL boundary

Added catalog assertions for both current SECURITY DEFINER guards and a private function created after the P5 migration.

```sh
node --import tsx --test --test-concurrency=1 \
  --test-name-pattern='P5 private trigger guards and future private functions' \
  tests/drawing-workspace-database-runtime.test.mjs
```

RED: authenticated/service_role could execute the anchor guard, and anon/authenticated/service_role inherited PUBLIC execute on the future private probe. Explicit guard revokes fixed the first half; global default PUBLIC function-execute revocation fixed the future-function probe.

## Implementation details

### Loader authority

`platform/app/lukas/lib/drawing-workspace.server.ts` now constructs all ancestry ID sets before source validation. The full integrated loader fixture, not only the isolated source loader, exercises an active PDF source.

### Lossless legacy source policy

`platform/supabase/migrations/20260827045411_drawing_workspace_p5_evidence_authority.sql` temporarily disables only the old revision guard during migration-owned source backfill/normalization, then re-enables it before installing live authority.

The policy is deterministic:

- P0-P4 rows already satisfying the exact P5 IFC union remain active at version 1.
- P0-P4 IFC rows missing GlobalId, using a legacy nonnumeric element identifier, or using a noncanonical legacy camera become deleted at version 2.
- Deleted rows remain constrained to the exact legal P0-P4 payload union, preserving evidence without inventing identity.
- Every active row must satisfy the strict P5 PDF/IFC union.

### Immutable checkpoint compatibility

The private immutable `lukas_drawing_p5_checkpoint_sources(jsonb,uuid)` helper recognizes only the exact trusted 13-key P4 source producer shape. It derives `revisionId` from the snapshot's owning revision and `version: 1` from the migration backfill, emits the exact P5 branch shape, and leaves all other shapes untouched so the existing P5 validator fails closed.

All checkpoint graph validation, trusted reference-target injection, and final target comparison use the normalized in-memory value. No snapshot row is updated or rehashed. When stripping source actions leaves zero core actions, the wrapper follows the established P3 checkpoint ledger pattern: it allocates the next sequence under the already-held revision lock, inserts one operation with the exact request and result versions, lets the existing operation trigger apply source actions, and runs the same final source/issue graph comparison.

### ACL and executable lineage tests

Both trigger guard functions and the new checkpoint helper are in the explicit revoke list. `alter default privileges revoke execute on functions from public` removes the migration owner's global default PUBLIC execute grant; a schema-specific revoke cannot override that global default in PostgreSQL.

The comment-only lineage assertion was removed. Existing and full runtime tests exercise review/freeze canonical snapshots, checkpoint restoration, template source copying, and approved-child source copying with active-only lineage.

## Verification

### Review regressions together

```sh
node --import tsx --test --test-concurrency=1 \
  --test-name-pattern='P5 upgrade preserves every legal P0-P4 source shape|P5 restores an immutable pre-P5 PDF checkpoint|P5 private trigger guards and future private functions' \
  tests/drawing-workspace-database-runtime.test.mjs

node --import tsx --test --test-concurrency=1 \
  --test-name-pattern='loads a full P4 workspace' \
  tests/drawing-workspace-server.test.mjs
```

Result: 3/3 database regressions PASS and 1/1 integrated loader regression PASS.

### Fresh full chain and populated upgrade PGlite

```sh
node --import tsx --test --test-concurrency=1 \
  tests/drawing-workspace-database-runtime.test.mjs
```

Result: 140/140 PASS, 0 fail. The suite applies the complete empty foundation-to-P5 chain and the new tests separately apply populated P0-P4-to-P5 upgrades, including the legacy IFC matrix and immutable P3 checkpoint.

### Focused server and Drawing authority

```sh
node --import tsx --test --test-concurrency=1 \
  tests/drawing-workspace-server.test.mjs \
  tests/drawing-source-links.test.mjs \
  tests/drawing-source-lifecycle.test.mjs \
  tests/drawing-source-commands.test.mjs \
  tests/drawing-review-freeze.test.mjs \
  tests/drawing-workspace-template.test.mjs \
  tests/drawing-revision.test.mjs \
  tests/drawing-workspace-p5-server.test.mjs \
  tests/drawing-workspace-p5-database-contract.test.mjs
```

Result: 99/99 PASS, 0 fail.

### Full Drawing suites

```sh
npm run test:drawing-workspace
```

Result: 664 discovered; 663 PASS, 0 fail, 1 pre-existing real-PostgreSQL fixture skip/UNEXECUTED.

```sh
node --test --test-concurrency=1 tests/drawing-*.test.mjs
```

Result: 867 discovered; 866 PASS, 0 fail, 1 pre-existing real-PostgreSQL fixture skip/UNEXECUTED.

### Types and formatting

```sh
npm run typecheck
npm run typecheck:collaboration
npx prettier --check \
  app/lukas/lib/drawing-workspace.server.ts \
  tests/drawing-workspace-database-runtime.test.mjs \
  tests/drawing-workspace-p5-database-contract.test.mjs \
  tests/drawing-workspace-server.test.mjs
```

Result: application typecheck PASS, collaboration typecheck PASS, and all changed TypeScript/MJS files match Prettier.

### Migration and diff checks

```sh
git diff --check
git diff --name-only ce202ea55feda77438ff27263e2990e25f8b802d \
  -- platform/supabase/migrations
rg -n '^begin;$|^commit;$' \
  platform/supabase/migrations/20260827045411_drawing_workspace_p5_evidence_authority.sql
```

Result: no whitespace errors; the only migration changed from Task 3 BASE is `20260827045411_drawing_workspace_p5_evidence_authority.sql`; it contains exactly one `begin;` and one `commit;`.

### Real PostgreSQL / Supabase local

```sh
command -v psql
command -v pg_isready
command -v docker
command -v podman
npx supabase status
```

Result: **UNEXECUTED**. `psql`, `pg_isready`, Docker, and Podman are unavailable. Supabase status exits with `docker: command not found (podman also not found)`. PGlite is the executed SQL runtime gate.

## Scope diff and preserved artifacts

Fix 1 changes only:

- `platform/app/lukas/lib/drawing-workspace.server.ts`
- `platform/supabase/migrations/20260827045411_drawing_workspace_p5_evidence_authority.sql`
- `platform/tests/drawing-workspace-database-runtime.test.mjs`
- `platform/tests/drawing-workspace-p5-database-contract.test.mjs`
- `platform/tests/drawing-workspace-server.test.mjs`
- this fix report

The four pre-existing P4 dirty artifacts remain untouched and excluded from the commit:

- `.superpowers/sdd/2026-08-26-drawing-workspace-p4/progress.md`
- `.superpowers/sdd/2026-08-26-drawing-workspace-p4/task-6-desktop.png`
- `.superpowers/sdd/2026-08-26-drawing-workspace-p4/task-6-fix2-integrated-authored.png`
- `.superpowers/sdd/2026-08-26-drawing-workspace-p4/task-6-fix2-integrated-restored.png`

## Residual gates

- Real PostgreSQL/Supabase reset, lint, and schema diff are unexecuted solely because no local PostgreSQL/container runtime is available.
- UI/E2E source presentation and relink UX remain outside Task 3 and were not added.
