# P6 Task 4 independent review 1

Review target: commits `193f251` and `0325920` against Task 4 of
`docs/superpowers/plans/2026-08-27-drawing-workspace-p6.md` and design section
6.4.

## Verdict

**BLOCKED — Critical 0 / Important 3 / Minor 0**

The exact-decimal adapter, raw/adjustment/adjusted/final separation, result
hash boundary, calculation-manifest self-hash boundary, approval-envelope
handoff binding, and evidence-file SHA conflict checks are structurally sound.
The focused suite is green locally, but three contract defects remain.

## Findings

### Important 1 — 1.1 canonical arrays use ID order instead of the specified business order

`platform/app/lukas/lib/verified-boq-v1-1.server.ts:199-210` sorts BOQ lines by
line ID only, `:273-281` sorts resources by resource ID only, and `:282-289`
sorts components by component ID only. The design requires lines to sort by
`itemCode` then line ID and resources/components by their specified code/ID
keys. The result preserves the canonical input line order at `:411-447`, and
the calculation manifest copies those arrays at
`platform/app/lukas/lib/verified-boq-manifest.server.ts:190-210`, so this is not
cosmetic: it defines different result and manifest bytes and therefore
different SHA identities from the published 1.1 contract.

Mutation evidence deliberately anti-correlating IDs and codes:

```text
canonicalLineOrder: [["999","a-line"],["001","z-line"]]
resultLineOrder:    [["999","a-line"],["001","z-line"]]
resourceOrder:      [["999","a-resource"],["001","z-resource"]]
```

The current order-independence test reverses arrays whose fixture IDs and
business codes already sort in the same direction, so it cannot detect this.
Use explicit bytewise comparators for `itemCode -> id` and the specified
resource/component `code -> id` keys, with anti-correlated fixtures.

### Important 2 — split legacy mappings do not prove one immutable source identity

`platform/app/lukas/lib/verified-boq-v1-1.server.ts:252-259` checks that repeated
Drawing `quantityLinkId` values carry identical source content, but there is no
equivalent check for repeated legacy `(sourceFileId, subjectKey, unit)` sources.
The shared core groups their factors as one source at
`platform/app/lukas/lib/verified-boq.server.ts:218-230`, while the manifest emits
one `legacySources` row per mapping at
`platform/app/lukas/lib/verified-boq-manifest.server.ts:151-162` rather than one
row per immutable source.

A mutation with the same legacy file/subject/unit split by exact factors
`0.5 + 0.5`, but with source quantities `1` and `100` and different Element IDs,
was accepted. It calculated line raw quantities `["0.5", "50"]` and emitted two
legacy source records for the same manifest source identity. Thus factor closure
can bless contradictory evidence and `mappings.sourceId` no longer identifies
one unambiguous `legacySources` record.

Canonicalize legacy sources into a map keyed by
`sourceFileId + subjectKey + unit`, require identical SHA, quantity, and Element
IDs for every occurrence, reject conflicts with `P6B04`, and emit each legacy
source once while retaining the separate allocation mappings.

### Important 3 — the 1.0 XLSX fixed-clock oracle is host-timezone dependent

`platform/tests/verified-boq.test.mjs:102-110` freezes an absolute UTC instant,
but `fflate` serializes ZIP DOS timestamps using local `Date` getters. The literal
XLSX SHA at `:160` therefore changes with the host timezone. The oracle is honest
for the author's local timezone: it passes against the pre-implementation RED
commit `193f251` as well as current HEAD. It is not a portable regression gate:

```text
local Asia/Seoul: 89d84aff... PASS
TZ=UTC:           c2c8a6fb... FAIL
TZ=America/New_York: d1197f61... FAIL
```

Make the test's ZIP-local timestamp deterministic across hosts (for example by
temporarily fixing `TZ`, including restoration, or overriding the Date local
getters used by `fflate`) and re-prove the same literal bytes against the parent
implementation. Do not change the 1.0 exporter merely to accommodate the test.

## Positive evidence

- `node --test tests/verified-boq-v1-1.test.mjs tests/verified-boq.test.mjs tests/drawing-quantity-lineage.test.mjs`: **41/41 PASS** in the local timezone.
- `npm run typecheck`: **PASS**.
- `git diff --check`: **PASS**.
- The fixed-clock 1.0 JSON/result/CSV/XLSX oracle also passes at `193f251`, proving the local literal was taken from the old implementation rather than regenerated from the new core.
- Exact decimal addition/multiplication and half-away rounding are reused from the existing engine; Drawing and legacy factor totals remain separated by source kind; Drawing units and `m3` rejection are enforced.
- `adjustedQuantity` is exact `rawQuantity + signedAdjustment` before rounding, while `finalQuantity` remains the shared rounded value; negative adjusted quantities fail closed.
- Calculation `manifestSha256` hashes the fixed-field manifest without a self field. Handoff SHA hashes calculation, approval envelope, result/manifest hashes, and bytewise-sorted evidence files without its own field; conflicting SHA values for the same evidence file fail closed.

## Ponytail-only review

Lean already for the required boundary: the implementation extracts and reuses
the existing exact calculation core instead of introducing a second engine or a
new dependency. No independent deletion finding beyond the correctness changes
above.

