# Task 9 report — typed custom properties and simple schedules

## Outcome

Implemented Task 9 on base `0b71f05` in the canonical `DrawingDocumentState.structure` flow. Property schema/value and schedule changes are strict version-aware `mutate_structure` commands and continue through the existing command → durable outbox → RPC path. Viewer/Reviewer markup remains readable and contains no mutation controls; draft Editor/Admin users receive only native labeled controls.

No dependency, state library, direct fetch/database write, formula evaluator, XLSX support, or CSV exporter was added. CSV was optional in the brief and did not justify another surface under ponytail full.

## TDD evidence

### Initial RED

Created the property and table tests before their production units and ran:

```text
node --test tests/drawing-workspace-properties.test.mjs tests/drawing-workspace-tables.test.mjs
tests 13; pass 0; fail 13
```

Every failure was the expected missing-feature assertion: the property/table domain exports and SSR components did not exist yet.

### Cascade RED

After the first property GREEN, added an exact block-instance deletion test and ran only that case:

```text
node --test --test-name-pattern='block-instance deletion cascades' tests/drawing-workspace-properties.test.mjs
tests 1; pass 0; fail 1
```

Expected mismatch: the forward command contained only `delete_block_instance`; it did not yet delete the property value or remove the schedule row. The final command is one atomic ordered batch with exact bases.

## Delivered contracts

### Properties

- Parses text, finite number, checkbox boolean, valid ISO calendar date, and enum values without widening canonical types.
- Creates, evolves, and deletes schemas with canonical Zod validation, unique trimmed names, reference-safe deletion, and reducer preflight.
- Rejects schema evolution that would invalidate an existing typed value or target applicability.
- Finds applicable schemas deterministically for object and block-instance selections.
- Writes every dirty schema × selected target pair in one stable atomic action batch; the test proves exact forward bases and reverse inverse for an existing plus newly-created value.
- Generates deterministic value/table-row cleanup actions for deleted targets. Block-instance deletion includes cleanup and deletion in one structure batch.
- Detects missing required values in stable schema/target order before client review preparation; the unchanged review RPC remains the authoritative final gate. Legacy documents without structure remain review-compatible.

### Schedules

- Resolves stored rows and columns in their persisted order from immutable state maps.
- Supports object name/type and typed property columns, plus literal manual text/number cells only.
- Formats numbers as numbers, booleans deterministically, date/enum/text as strings, and missing values as empty strings.
- Marks missing derived targets explicitly as `[missing target]`.
- Treats leading `=` text as literal data. There is no formula parsing or evaluation.
- Creates, updates, and deletes tables with strict version-aware structure actions and exact inverse coverage.
- Renders the shared semantic Table primitives (`table`, `thead`, `tbody`, `th`, `td`) and native labeled manual cell inputs.

### Access and integration

- Property definitions and schedules are mounted in the production drawing workspace.
- Applicable property values are shown in object and block-instance inspector branches, including locked/read-only branches.
- Viewer/Reviewer SSR tests prove that read surfaces contain no `form`, `input`, `select`, or `button` mutation controls.
- Draft Editor/Admin users receive native `text`, `number`, `checkbox`, `date`, and `select` controls with accessible labels.
- Ordinary P1 object deletion first serializes a version-aware structure cleanup command, then the existing legacy object deletion, preventing orphaned values/table rows from making the next canonical load fail closed.

## Files

Created:

- `platform/app/lukas/lib/drawing-properties.ts`
- `platform/app/lukas/lib/drawing-tables.ts`
- `platform/app/lukas/components/drawing-properties-panel.tsx`
- `platform/app/lukas/components/drawing-tables-panel.tsx`
- `platform/tests/drawing-workspace-properties.test.mjs`
- `platform/tests/drawing-workspace-tables.test.mjs`

Modified:

- `platform/app/lukas/components/drawing-inspector.tsx`
- `platform/app/lukas/components/drawing-workspace.tsx`
- `platform/app/lukas/lib/drawing-blocks.ts`

No schema, SQL, RPC, or dependency contract needed changing: the existing property/table constraints and required-property review gate were already authoritative.

## Verification

Final worktree verification after the last production edit:

```text
Focused properties/tables/blocks/route/server: 83 passed, 0 failed
npm run typecheck: passed
npm run test:drawing-workspace: 366 passed, 0 failed
node --test tests/*.test.mjs: 499 passed, 0 failed
npm run build: passed (client + SSR; prebuild typecheck passed)
git diff --check: passed
```

The drawing suite includes the relevant real PGlite migration/RPC/review runtime coverage. Build emitted only the repository's existing non-fatal chunk-size, React Router future-flag, mixed IFC import, and unsigned theme-cookie warnings.

## Self-review

- Re-read the Task 9 brief and checked every RED/GREEN requirement against the final tests.
- Ponytail full: reused the authoritative Zod schemas, structure reducer, command/outbox path, inspector/panel patterns, and shared Table components; added no generalized store, evaluator, serializer, or new dependency.
- React best-practices review: native controls and semantic markup are accessible, render derivation stays local/pure, no effect-derived state or client data-fetch layer was added, and list keys are stable IDs.
- Security/authority: no controls are rendered for read-only roles and no client-supplied authority fields or direct persistence path was introduced.
- `git diff --check` is clean; no unrelated worktree change is included.

## Concern

The pre-existing P1 `delete_objects` operation cannot legally be combined with property/table cleanup inside one `mutate_structure` payload: both the reducer and RPC reserve structure object actions for exact block conversion compounds. Therefore ordinary object cleanup and legacy deletion are two causally ordered outbox operations and require two undo actions to restore both the object and its references. Block-instance deletion, all property edits (including multi-selection), and all schedule edits are single atomic structure batches. Closing the ordinary-object gap atomically would require an explicit cross-contract migration of the legacy delete payload/RPC and is intentionally outside Task 9.

## Fix round 1 — atomic deletion and contract hardening

### Outcome

Closed every round-1 finding. Ordinary object deletion is now one canonical `mutate_objects_with_references` operation: one command, one durable outbox entry, one RPC transaction, one operation ledger row, and one undo/redo history step. The prior two-operation concern above is resolved and no longer applies.

The forward migration `20260825210000_drawing_workspace_task9_contract_fixes.sql` adds only the new operation enum/transaction wrapper and the table/block contract guards needed by these findings. Existing `mutate_structure` object actions remain reserved for exact block compounds.

### RED evidence

Each finding received a failing focused test before its production change:

```text
# Critical client command/history
node --test --test-name-pattern='ordinary object deletion is one atomic' tests/drawing-workspace-properties.test.mjs
tests 1; pass 0; fail 1
expected deleteDrawingObjectsWithReferencesCommand function; received undefined

# Critical durable recovery / acknowledgement
node --test --test-name-pattern='reference-aware object deletion enqueues once' tests/drawing-workspace-outbox.test.mjs
tests 1; pass 0; fail 1
pending/acked recovery retained an ambiguous operation instead of one atomic effect

# Critical server payload contract
node --test --test-name-pattern='server parses and acknowledges the exact reference-aware' tests/drawing-workspace-server.test.mjs
tests 1; pass 0; fail 1
OperationPayloadSchemas did not contain the cross-contract operation

# Critical real RPC transaction
node --test --test-name-pattern='reference-aware object deletion is one idempotent RPC transaction' tests/drawing-workspace-database-runtime.test.mjs
tests 1; pass 0; fail 1
P1C01: Unsupported drawing operation type

# Block conversion cleanup
node --test --test-name-pattern='block conversion atomically cleans' tests/drawing-workspace-blocks.test.mjs
tests 1; pass 0; fail 1
actual kinds: put_block, put_block_instance, delete_object; cleanup actions absent

node --test --test-name-pattern='block helper persists atomic selection conversion' tests/drawing-workspace-database-runtime.test.mjs
tests 1; pass 0; fail 1
P1C01: Structure object actions require an exact block compound

# Resolver/appliesTo and table identity
node --test --test-name-pattern='schedule resolution validates property|table commands reject incompatible' tests/drawing-workspace-tables.test.mjs
tests 2; pass 0; fail 2
both expected validation exceptions were missing

node --test --test-name-pattern='table SQL and RPC boundaries reject' tests/drawing-workspace-database-runtime.test.mjs
tests 1; pass 0; fail 1
the malformed duplicate/incompatible table RPC was accepted

# Selection dirty-state isolation
node --test --test-name-pattern='property field selection identity' tests/drawing-workspace-properties.test.mjs
tests 1; pass 0; fail 1
expected synchronous selection/dirty helper; received undefined

# Self-review privilege boundary
node --test --test-name-pattern='task 9 keeps only' tests/drawing-workspace-database-runtime.test.mjs
tests 1; pass 0; fail 1
anon could execute the new private apply function and authenticated could execute internal wrappers
```

An additional repeated delete → undo → redo → undo check exposed a stale property tombstone realization failure before the narrow history fix:

```text
DrawingStructureError: put_property_value must restore the exact tombstoned entity
```

### Delivered contracts

- `mutate_objects_with_references` carries sorted exact object snapshots plus deterministic property/table actions. Delete and restore use opposite object actions, reverse-indexed exact structure inverses, complete base maps, and monotonic tombstone versions.
- Production ordinary Delete now records that one operation only. The reducer, durable parser, server parser, outbox pending recovery, acknowledged recovery, conflict detection, undo, redo, and repeated history realization all understand the same payload.
- The SQL path locks the authoritative revision, objects, and eligible layers; checks editor/admin plus draft status; binds exact retries before target lookup; derives the complete cleanup set server-side; rejects incomplete/extra actions, stale snapshots/bases, malformed inverses, raw reference failures, and locked/source/hidden layers; mutates references and object status in one transaction; and inserts exactly one ledger row.
- Block creation now inserts deterministic cleanup actions before `delete_object`. The SQL wrapper validates the full cleanup/inverse/base contract, delegates the unchanged exact block core, and rewrites the single final ledger row atomically. Undo/redo restore and remove references with the objects.
- Schedule resolution prevalidates every property column before rows, so a missing row target cannot mask a broken schema reference. Present object/block targets must match every property schema's `appliesTo`; table commands and the SQL trigger reject incompatible new rows.
- `DrawingTableSchema`, the structure reducer, SQL action validation, and the table trigger require exact trimmed unique column IDs/names and unique row IDs. A real upgrade test proves legacy duplicates stop at an explicit P1C01 preflight before the contract is installed.
- Property field form keys now include the ordered selection identity. A ref-only synchronous render guard clears dirty schema IDs as soon as identity changes; no effect-derived state race or dependency was added.
- Private helper/wrapper execute privileges are revoked; only the established canonical apply entry retains its intended authenticated/service-role grant.

### Files and contract changes

Added:

- `platform/supabase/migrations/20260825210000_drawing_workspace_task9_contract_fixes.sql`

Modified production contracts:

- `platform/app/lukas/lib/drawing-workspace.types.ts`
- `platform/app/lukas/lib/drawing-commands.ts`
- `platform/app/lukas/lib/drawing-properties.ts`
- `platform/app/lukas/lib/drawing-outbox.ts`
- `platform/app/lukas/lib/drawing-workspace.server.ts`
- `platform/app/lukas/lib/drawing-blocks.ts`
- `platform/app/lukas/lib/drawing-structure.ts`
- `platform/app/lukas/lib/drawing-tables.ts`
- `platform/app/lukas/components/drawing-workspace.tsx`
- `platform/app/lukas/components/drawing-properties-panel.tsx`

Modified tests:

- `platform/tests/drawing-workspace-properties.test.mjs`
- `platform/tests/drawing-workspace-outbox.test.mjs`
- `platform/tests/drawing-workspace-server.test.mjs`
- `platform/tests/drawing-workspace-blocks.test.mjs`
- `platform/tests/drawing-workspace-tables.test.mjs`
- `platform/tests/drawing-workspace-database-runtime.test.mjs`

### GREEN verification

```text
node --test --test-name-pattern='reference-aware object deletion|block helper persists atomic selection conversion|table SQL and RPC boundaries reject' tests/drawing-workspace-database-runtime.test.mjs
tests 3; pass 3; fail 0

node --test tests/drawing-workspace-properties.test.mjs tests/drawing-workspace-blocks.test.mjs tests/drawing-workspace-tables.test.mjs tests/drawing-workspace-outbox.test.mjs tests/drawing-workspace-server.test.mjs
tests 130; pass 130; fail 0

node --test tests/drawing-workspace-database-runtime.test.mjs
tests 93; pass 93; fail 0

npm run typecheck
passed

npm run test:drawing-workspace
tests 377; pass 377; fail 0

npm run build
passed client and SSR; prebuild typecheck passed

git diff --check
passed
```

Build warnings remain the repository's existing non-fatal chunk-size, React Router future-flag, mixed IFC import, and unsigned theme-cookie warnings.

### Self-review

- Rechecked every finding verbatim against a named test and the final server/client contract.
- Preserved one command → outbox → RPC path; no direct fetch/DB mutation, state library, evaluator, serializer, service, dependency, or widened structure object action was added.
- Kept the new operation deliberately narrow to cross-contract ordinary object deletion. Block conversion remains the established `mutate_structure` compound.
- Reused the canonical schemas, reducer, tombstones, operation ledger, append-only rewrite guard, table trigger, and panel patterns. The SQL is explicit because exact deletion and restoration must be independently validated at the database boundary; no generalized framework was introduced.
- Verified exact retry before target lookup, one operation row, incomplete-cleanup rollback, locked-layer rollback, repeated undo/redo monotonicity, pending and acknowledged recovery, upgrade preflight, and least privilege in real PGlite.
- Viewer/Reviewer mutation controls remain absent and no formula/XLSX/evaluation surface was introduced.

### Concerns

None. Deployments containing legacy table JSON with duplicate column IDs/names or row IDs will intentionally receive the migration's explicit P1C01 preflight and must repair that corrupt data before retrying the migration.
