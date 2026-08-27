# P5 Task 3 review fix 2 implementation report

Date: 2026-08-27

Prior fix commit: `96d1386e6d2bbdc1ab6749c2086c1797cc59c755`

Required commit subject: `fix: enforce atomic drawing anchor relinks`

Review source: `.superpowers/sdd/2026-08-27-drawing-workspace-p5/task-3-rereview1.md`

## Outcome

Closed rereview 1's sole Important finding. Replacement-anchor lineage no longer trusts any custom PostgreSQL session setting. Authenticated direct DML is rejected even when the caller sets the exact former bypass value, while the public atomic relink RPC continues to validate the exact immutable file-revision edge, insert the replacement, deactivate its predecessor, preserve actor/audit fields, and roll back both sides on failure.

The existing unmerged P5 migration remains the only forward P5 migration. No public API signature, UI, dependency, state store, schema discriminator, or unrelated surface was added.

## Defensive TDD

The existing full relink runtime test was extended before production changes with a transaction-scoped adversarial probe:

1. authenticate as the project owner;
2. set `private.lukas_drawing_anchor_relink` to the exact active predecessor ID using client-callable `set_config`;
3. set a second arbitrary client session value;
4. directly insert a new active anchor with `replaces_anchor_id` but without an exact file-revision edge or predecessor deactivation;
5. require the direct insert to fail with the atomic-relink boundary error;
6. roll the probe transaction back regardless of assertion outcome.

RED command:

```sh
node --import tsx --test --test-concurrency=1 \
  --test-name-pattern='P5 relink atomically preserves predecessor lineage' \
  tests/drawing-workspace-database-runtime.test.mjs
```

RED result: 0/1 pass. Node reported `AssertionError: Missing expected rejection` at the forged-session insert. The old session setting authorized the direct replacement exactly as rereview reported.

GREEN command: the same focused command after the production change.

GREEN result: 1/1 pass. The intended RPC, exact predecessor/replacement lineage assertions, stale-predecessor denial, forged direct insert denial, forged-session denial, and wrong-kind rollback all passed.

The private-function ACL catalog regression was also extended to prove that neither authenticated nor service_role can execute the internal complete-mutation function directly.

## Database-authoritative design

The P5 migration now uses no replacement capability token or session GUC.

- `private.lukas_drawing_anchor_guard()` is `SECURITY INVOKER` with an empty search path. For direct Data API/authenticated DML, `current_user` is `authenticated`, so every non-null `replaces_anchor_id` is rejected regardless of client-settable session state.
- `private.lukas_drawing_relink_issue_anchor(uuid,uuid,uuid,jsonb,text)` is a revoked `SECURITY INVOKER` internal function containing the complete validated mutation: actor/capability checks, predecessor and issue locks, exact immutable `supersedes` edge and SHA locks, strict same-kind payload validation, replacement insert, predecessor deactivation, and stable SQLSTATE mapping.
- The unchanged public signature `public.lukas_drawing_relink_issue_anchor(uuid,uuid,uuid,jsonb,text)` is a minimal `SECURITY DEFINER` SQL wrapper with an empty search path. Its owner-authorized call is the only external route into the revoked private function, so the invoker trigger recognizes the database-trusted call boundary without consulting attacker-controlled state.
- The internal function is explicitly revoked from PUBLIC, anon, authenticated, and service_role. Existing global default PUBLIC function-execute revocation remains in force.
- The public RPC keeps its exact authenticated/service_role grants and generated/server contract; no second public API was added.

The original event/audit triggers remain installed on the same table. The atomic path still performs one insert and one update, so it retains the existing `anchor_added` and `anchor_deactivated` audit behavior. Runtime assertions verify the exact new anchor's `replaces_anchor_id`, the old anchor's inactive state and deactivation note, the actor-bound mutation path, and complete rollback when validation fails.

## Verification

### Focused authorization and relink

```sh
node --import tsx --test --test-concurrency=1 \
  --test-name-pattern='P5 private trigger guards and future private functions|P5 relink atomically preserves predecessor lineage' \
  tests/drawing-workspace-database-runtime.test.mjs
```

Result: 2/2 PASS, 0 fail.

### Full fresh-chain and populated-upgrade PGlite

```sh
node --import tsx --test --test-concurrency=1 \
  tests/drawing-workspace-database-runtime.test.mjs
```

Result: 140/140 PASS, 0 fail. This includes the empty foundation-to-P5 chain, populated P0-P4 upgrades, source authority/checkpoint compatibility, exact relink success, direct/session-forged replacement denial, and rollback.

### Focused server/source/revision/database contracts

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

### Types, format, migration, and diff

```sh
npm run typecheck
npm run typecheck:collaboration
npx prettier --check tests/drawing-workspace-database-runtime.test.mjs
git diff --check
git diff --name-only ce202ea55feda77438ff27263e2990e25f8b802d \
  -- platform/supabase/migrations
rg -n '^begin;$|^commit;$' \
  platform/supabase/migrations/20260827045411_drawing_workspace_p5_evidence_authority.sql
```

Results: application and collaboration typechecks PASS; changed MJS matches Prettier; diff check PASS; the only migration changed from Task 3 BASE is the existing P5 evidence-authority migration; it retains one `begin;` and one `commit;`.

### Real PostgreSQL / local Supabase

```sh
command -v psql
command -v pg_isready
command -v docker
command -v podman
npx supabase status
```

Result: **UNEXECUTED**. `psql`, `pg_isready`, Docker, and Podman are unavailable. Supabase status reports `docker: command not found (podman also not found)`. PGlite is the executed SQL runtime gate.

## Scope and preserved artifacts

Fix 2 changes only:

- `platform/supabase/migrations/20260827045411_drawing_workspace_p5_evidence_authority.sql`
- `platform/tests/drawing-workspace-database-runtime.test.mjs`
- this report

The four pre-existing P4 dirty artifacts remain untouched and excluded from the commit:

- `.superpowers/sdd/2026-08-26-drawing-workspace-p4/progress.md`
- `.superpowers/sdd/2026-08-26-drawing-workspace-p4/task-6-desktop.png`
- `.superpowers/sdd/2026-08-26-drawing-workspace-p4/task-6-fix2-integrated-authored.png`
- `.superpowers/sdd/2026-08-26-drawing-workspace-p4/task-6-fix2-integrated-restored.png`

## Residual gates

- Real PostgreSQL/Supabase reset, lint, and schema diff remain unexecuted solely because no local PostgreSQL/container runtime is available.
- No residual Task 3 rereview 1 correctness finding remains in the executed PGlite scope.
