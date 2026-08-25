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
