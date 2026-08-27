# P5 Task 3 implementation report

Date: 2026-08-27

Base: `ce202ea55feda77438ff27263e2990e25f8b802d`

Commit subject: `feat: persist drawing evidence links and relinks`

## Outcome

Implemented the Supabase evidence authority and atomic issue-anchor relink in one new forward CLI migration. The server now loads strict active PDF/IFC source rows into the existing drawing workspace contract, and the revision service exposes one typed call to the atomic relink RPC. No UI, dependency, public source-management RPC, schema discriminator, collaboration state-store, or unrelated runtime surface was added.

## TDD record

Initial RED command:

```sh
node --import tsx --test \
  tests/drawing-workspace-p5-database-contract.test.mjs \
  tests/drawing-workspace-p5-server.test.mjs \
  tests/drawing-revision.test.mjs
```

Initial result: exit 1, 6 failures. The failures were the intended missing migration, active-source loader, database contract, and relink service/RPC boundaries.

During GREEN, focused checkpoint tests exposed two pre-P5 compatibility gaps rather than weakening the assertions:

- source actions had to be symmetrically removed from checkpoint object action/inverse arrays before the P3 object executor ran;
- the existing tombstone helper did not recognize the established `mutate_objects_with_references` restore-object inverse.

The migration now handles those exact cases, recombines source result versions into the one operation ledger row, and revalidates the final canonical source/issue graph. A new lineage regression also exposed that the existing approved-child path copied sources but the template path did not; the latest private template clone is therefore wrapped to copy active source lineage only.

## Migration and database authority

Created with the repository CLI:

```sh
npx supabase migration new drawing_workspace_p5_evidence_authority
```

New migration only:

`platform/supabase/migrations/20260827045411_drawing_workspace_p5_evidence_authority.sql`

The migration:

- adds `status`, `version`, `updated_by`, and `updated_at` to object sources, backfills the actor, and replaces all-row uniqueness with partial active uniqueness;
- replaces the legacy payload check with exact mutually exclusive PDF/IFC payload constraints;
- verifies immutable same-project file ID/kind/SHA ownership and active same-revision object ownership;
- makes source payload/file/SHA/project/revision ownership immutable while allowing monotonic active/deleted version transitions;
- extends the latest private structure validators/entity lookup/raw-ID/tombstone and operation executor paths for `put_source`/`delete_source`;
- implements exact source OCC, inverse validation, idempotent retries, base/result version reconciliation, MOWR cleanup ordering, and one stored operation request;
- includes active source lineage in canonical snapshots, P5 checkpoint restore, template clones, approved-child clones, review/freeze snapshots, while excluding deleted lineage;
- removes authenticated insert/update/delete source policies and table grants, retains capability-scoped active SELECT, and retains service-role table access;
- gives every new/changed function an empty search path, revokes PUBLIC/default PUBLIC function execution, and grants only the required authenticated/service entry points;
- adds guarded `replaces_anchor_id` lineage with same issue/project composite ownership and one-predecessor uniqueness;
- adds one atomic `lukas_drawing_relink_issue_anchor(uuid,uuid,uuid,jsonb,text)` RPC that locks the predecessor/issue, validates the exact immutable `supersedes` file edge and same kind, inserts the replacement, deactivates the predecessor with a required note, and returns both IDs transactionally.

## Server and generated contract changes

- `drawing-workspace.server.ts`: paginated, capability/RLS-backed active-source loading; strict row schema; exact PDF/IFC domain parsing; revision/project/object ancestry validation; workspace integration.
- `drawing-revision.server.ts`: strict PDF/IFC relink input and result schemas plus the single atomic RPC call.
- `database.types.ts`: source rows, anchor replacement lineage, and relink RPC signature.
- Shared P5 fixture module is reused by server and revision tests.

## Executed verification

### PGlite database runtime

```sh
node --import tsx --test --test-reporter=dot \
  tests/drawing-workspace-database-runtime.test.mjs
```

Result: exit 0, 137/137 tests passed in about 11 seconds.

This harness executes the forward chain into a fresh foundation database and also exercises a populated P0-P3 database through every P4 migration and then the P5 migration. P5 runtime coverage includes:

- exact initial/OCC/delete/restore result versions and idempotent retry;
- source deletion before MOWR owner deletion;
- direct authenticated DML denial;
- incomplete PDF payload rejection;
- wrong SHA, wrong kind, mutable file, wrong role, and partial-active-uniqueness rollback;
- review/freeze rejection plus canonical snapshot source content;
- checkpoint deletion and exact source/issue revival;
- template and approved-child copies of active lineage only;
- exact relink success, inactive/stale predecessor rejection, direct replacement denial, wrong-kind rollback, old/new audit lineage.

Targeted checkpoint proof:

```sh
node --import tsx --test \
  --test-name-pattern='P3 checkpoint restore (deletes an object|revives exact source)' \
  tests/drawing-workspace-database-runtime.test.mjs
```

Result: exit 0, 2/2 passed.

### Focused server and Drawing tests

```sh
node --import tsx --test --test-reporter=dot \
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

Result: exit 0, 100/100 passed.

### Type and format checks

```sh
npm run typecheck
npm run typecheck:collaboration
```

Results: both exit 0.

```sh
npx prettier --no-semi --check database.types.ts
npx prettier --check \
  app/lukas/lib/drawing-revision.server.ts \
  app/lukas/lib/drawing-workspace.server.ts \
  tests/drawing-revision.test.mjs \
  tests/drawing-workspace-database-runtime.test.mjs \
  tests/drawing-workspace-p5-database-contract.test.mjs \
  tests/drawing-workspace-p5-server.test.mjs \
  tests/fixtures/drawing-workspace-p5-database-fixtures.mjs
```

Results: all matched files use the configured style. The generated database type file retains its repository no-semicolon style.

### Migration and diff checks

```sh
find supabase/migrations -maxdepth 1 -type f \
  -name '*drawing_workspace_p5_evidence_authority.sql' -print
rg -n '^begin;|^commit;' \
  supabase/migrations/20260827045411_drawing_workspace_p5_evidence_authority.sql
git diff --check
```

Results: exactly one P5 migration, exactly one `begin`/`commit` pair, and no whitespace errors. No committed migration was edited.

## Real PostgreSQL / Supabase local gate

Commands:

```sh
command -v pg_isready
command -v docker
command -v podman
npx supabase status
```

Result: **UNEXECUTED** for real PostgreSQL. No `pg_isready`, Docker, or Podman executable is installed. `npx supabase status` exits 1 with `docker: command not found (podman also not found)`. Therefore local Supabase reset/diff/lint against a real server could not be executed in this environment; PGlite is the executed SQL runtime gate.

## Scope and preserved worktree state

Task 3 changes are limited to:

- one new migration;
- the two strict server modules and generated database contract;
- P5 database/server/revision tests and one shared fixture;
- this implementation report.

The pre-existing P4 progress and screenshot modifications remain untouched and are intentionally excluded from the Task 3 commit:

- `.superpowers/sdd/2026-08-26-drawing-workspace-p4/progress.md`
- `.superpowers/sdd/2026-08-26-drawing-workspace-p4/task-6-desktop.png`
- `.superpowers/sdd/2026-08-26-drawing-workspace-p4/task-6-fix2-integrated-authored.png`
- `.superpowers/sdd/2026-08-26-drawing-workspace-p4/task-6-fix2-integrated-restored.png`

## Residual gates

- Real PostgreSQL/Supabase local reset and schema diff remain unexecuted solely because no local container/PostgreSQL runtime is available.
- UI/E2E source viewing and relink confirmation belong to later P5 tasks and were not added here.
