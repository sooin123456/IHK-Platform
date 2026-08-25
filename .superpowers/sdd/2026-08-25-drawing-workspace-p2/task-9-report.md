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

## Fix round 2 — exact offline restore recovery and immutable tombstones

### Outcome

Closed both round-2 findings without adding an operation type, migration, dependency, service, or persistence path.

- Pending `mutate_objects_with_references` restores now validate their complete object/structure inverse result versions before projection, reconstruct the exact missing object and reference tombstones, consume those tombstones into the restored entities, and keep delete → undo chains as one atomic operation at every replay step.
- Acknowledged deletes are reconciled against the authoritative deleted loader before the remaining pending undo replays. Mixed property-value and table-row references restore at their exact monotonic versions.
- Noncanonical pending inverse evidence is failed closed, returned as a conflict, and durably quarantined instead of remaining retryable ambiguous work.
- The RPC restore branch compares the complete client-visible object snapshot, excluding only version, to the locked deleted row. It also requires stored page/layer ancestry to remain exact and changes only `status`, `version`, and the normal `updated_by` audit field.
- Forged identity, revision, project, page, layer, name, geometry, inline style, style reference, or creator payloads return `P1C01` atomically with no operation row. Exact restore succeeds and exact retry returns the same result.

### RED evidence

The outbox tests were written and run before the recovery implementation changed:

```text
node --test --test-name-pattern='pending reference restore|acknowledged reference delete|pending reference restore quarantines|reference-aware object deletion enqueues' tests/drawing-workspace-outbox.test.mjs
tests 4; pass 1; fail 3

pending restore actual ambiguousOperationIds:
  [00000000-0000-4000-8000-000000000006]
acknowledged delete → pending undo actual ambiguousOperationIds:
  [00000000-0000-4000-8000-000000000006]
malformed inverse actual conflictedOperationIds:
  []
expected:
  [00000000-0000-4000-8000-000000000006]
```

The real PGlite tombstone test was then written and run before the SQL restore branch changed:

```text
node --test --test-name-pattern='reference-aware restore rejects every noncanonical' tests/drawing-workspace-database-runtime.test.mjs
tests 1; pass 0; fail 1
AssertionError: Missing expected rejection: name
```

This proved the prior function accepted a validly-shaped forged name and overwrote the deleted object rather than merely exposing a theoretical guard gap.

### Delivered contracts

- `acknowledgedFinalEffects` remains the single existing validator for operation bases, opposite object actions, reverse-indexed structure inverses, unique targets, and object snapshots. Round 2 tightens it with the exact result-version relationships for both put and delete reference actions; pending recovery reuses it rather than introducing another validator.
- Pending delete replay records exact object tombstones alongside structure tombstones. Pending restore accepts an omitted loader tombstone version only when the durable operation proves the exact base/result relationship, reconstructs the object tombstone entity at `base - 1`, reconstructs missing reference tombstones through the existing structure helper, validates the tombstoned state, and consumes all tombstones before applying restore actions.
- A malformed durable cross-contract operation is distinct from an uncertain legacy acknowledgement: it enters `conflictedOperationIds` and the existing outbox `retainRecoveryEvidence` path changes only that entry to `conflicted`. Later causal work remains unprojected.
- SQL equality normalizes the schema's legacy-equivalent omitted `styleId` to JSON null, then compares every other non-version JSON field to the locked tombstone. Hidden revision/project/page/creator identity remains immutable because the payload validator rejects those keys and the UPDATE no longer writes any canonical content field.
- Authorization, revision lock, idempotency lookup, draft gate, eligible-layer lock, exact reference validation, transaction boundary, result versions, and ledger insertion order are unchanged.

### Files changed

Production:

- `platform/app/lukas/lib/drawing-outbox.ts`
- `platform/supabase/migrations/20260825210000_drawing_workspace_task9_contract_fixes.sql`

Tests:

- `platform/tests/drawing-workspace-outbox.test.mjs`
- `platform/tests/drawing-workspace-database-runtime.test.mjs`

No generated contract, dependency, package manifest, or unrelated file changed.

### GREEN verification

```text
node --test --test-name-pattern='pending reference restore|acknowledged reference delete|pending reference restore quarantines|reference-aware object deletion enqueues' tests/drawing-workspace-outbox.test.mjs
tests 4; pass 4; fail 0

node --test --test-name-pattern='reference-aware restore rejects every noncanonical|reference-aware object deletion is one idempotent' tests/drawing-workspace-database-runtime.test.mjs
tests 2; pass 2; fail 0

node --test tests/drawing-workspace-outbox.test.mjs tests/drawing-workspace-properties.test.mjs tests/drawing-workspace-server.test.mjs tests/drawing-workspace-database-runtime.test.mjs
tests 201; pass 201; fail 0

npm run typecheck
passed

npm run test:drawing-workspace
tests 381; pass 381; fail 0

npm run build
passed client and SSR; prebuild typecheck passed

git diff --check
passed
```

Build emitted only the repository's existing non-fatal chunk-size, React Router future-flag, mixed IFC import, and unsigned theme-cookie warnings.

### Self-review

- Re-read both findings verbatim and traced command history → durable outbox → recovery → RPC tombstone mutation before reviewing the diff.
- Ponytail full kept the production change to the existing acknowledgement validator, existing tombstone reconstruction helper, one recovery branch, existing conflict-evidence method, and the existing Task 9 migration. No parallel recovery model or new abstraction was added.
- The recovery tests cover both all-pending delete → undo and acknowledged-delete → pending-undo chains, mixed property/table references, exact versions, atomic final state, one remaining pending unit, and durable quarantine for object plus reference inverse corruption.
- The database test changes every meaningful object field one at a time, checks `P1C01`, byte-equivalent stored canonical fields, deleted status/version, zero forged operation rows, exact restore, one exact ledger row, and idempotent retry.
- The SQL change preserves lock/idempotency/authorization ordering and reduces the mutation surface: canonical content can no longer be sourced from restore JSON.
- `git diff --check` is clean. The four changed code/test files and this report are scoped only to the two findings.

### Concerns

None.
