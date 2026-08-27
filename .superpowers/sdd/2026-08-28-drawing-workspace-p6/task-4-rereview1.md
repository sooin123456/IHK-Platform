# P6 Task 4 independent rereview 1

Review target: fix commits `45e3560` and `578c19e`, against findings I1-I3
from `task-4-review1.md` and the original Task 4/design 6.4 contract.

## Verdict

**READY — Critical 0 / Important 0 / Minor 0**

All three prior findings are resolved, their original mutation vectors now pass,
and no regression or new finding was identified.

## Prior finding closure

### I1 — canonical business ordering: resolved

- Lines now bytewise-sort by `itemCode`, then line ID.
- Resources now bytewise-sort by resource code, then resource ID.
- Components now bytewise-sort by referenced resource code, then component ID.
- A deliberately anti-correlated fixture proves `001` business codes precede
  `999` even when their database IDs sort in the opposite direction.
- Reversing lines, resources, components, legacy mappings, and Drawing mappings
  preserves the result SHA, manifest SHA, and manifest bytes.

Focused mutation result: **PASS**.

### I2 — immutable legacy source consistency and deduplication: resolved

- Repeated legacy source identity is keyed by canonical
  `(sourceFileId, subjectKey, unit)`.
- Repeated allocations must carry the same source SHA, exact canonical source
  quantity, and canonical Element IDs; conflicting values fail with `P6B04`.
- A valid `0.5 + 0.5` split calculates both lines and emits one canonical
  `legacySources` record plus two allocation mappings referencing the same
  source ID.

Conflicting and valid split mutations: **PASS**.

### I3 — portable 1.0 XLSX fixed-clock oracle: resolved

The test fixes `process.env.TZ` to `Asia/Seoul` for the ZIP creation boundary and
restores the prior value in `finally`, while retaining the literal pre-change
XLSX SHA. Independent external timezone runs both pass:

```text
TZ=UTC node --test --test-name-pattern='bytes stay frozen' tests/verified-boq.test.mjs
PASS

TZ=America/New_York node --test --test-name-pattern='bytes stay frozen' tests/verified-boq.test.mjs
PASS
```

## Verification

```text
node --test tests/verified-boq-v1-1.test.mjs tests/verified-boq.test.mjs tests/drawing-quantity-lineage.test.mjs
43/43 PASS

npm run typecheck
PASS

git diff --check
PASS
```

The rereview also re-inspected exact-decimal reuse, raw/adjustment/adjusted/final
semantics, source-kind-separated factor closure, result hash construction,
fixed-field manifest construction, manifest self-hash exclusion, approval
envelope binding, bytewise evidence-file ordering/conflict rejection, and the
handoff self-hash boundary. These remain conformant.

## Ponytail-only rereview

Lean already. The shared legacy source-ID helper removes duplicated identity
construction without adding a new dependency or speculative abstraction.

