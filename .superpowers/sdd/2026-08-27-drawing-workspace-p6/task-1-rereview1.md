# P6 Task 1 fix round 1 independent re-review

**Verdict: READY**
**Counts: Critical 0, Important 0, Minor 0**

Reviewed `e8a290396a0e0c1ea32a1ea8998b3d6746f748e6..f5bce651eac171313161a80a917f50d269c2ec42` from a fresh detached checkout at `f5bce65` against the prior NOT READY report.

## Prior findings closed

1. `convertDrawingMeasurement()` now performs exact conversion first, then rejects with `P6Q01` when the result is negative, the count is not the canonical `"1"`, the integer portion exceeds 17 digits, or the fraction exceeds 12 digits. This is a no-rounding fit check for the approved `numeric(29,12)` quantity-link contract. The maximum accepted area fixture is exactly `17` integer plus `12` fractional digits.
2. Material groups now key on bytewise `code/specification/unit`; a differing name in that identity group is rejected as `P6M01` in either input order. This removes the prior input-order-dependent sort tie. Normal groups and their component rows retain bytewise deterministic ordering.

Fresh direct assertions confirmed `P6Q01` for negative length, noncanonical count, 13-place converted area, and integer overflow; and `P6M01` for the conflicting material identity in both orders. A normal input and its reverse serialize identically.

## Contract assessment

- The approved design formula is honored: individually rounded material components total **`15.308645`**, not the plan sample's arithmetic typo.
- Exact decimal helpers handle parse/multiply/round/add/string conversion; the new module has no Number/Math value arithmetic and no silent rounding.
- Drawing units remain exactly `EA`, `m`, and `m2`; `volume`/`m3` fail `P6Q01`. No volume, density, waste, carbon, allowance, or unit-conversion derivation was added.
- The unchanged P4 canonical fingerprint function is reused and SHA-256-hashed verbatim. Leaving `drawing-semantic-schedules.ts` and `material-control.server.ts` untouched remains the correct reuse boundary for this pure adapter.
- Empty input, zero, positive six-place half-away tie, negative/overflow material input, duplicate components, same-resource metadata conflicts, mixed BOQ versions, deterministic grouping, and legacy BOQ 1.0 regression behavior are covered or directly rechecked.

## Fresh verification

After `npm ci --ignore-scripts` in the detached checkout:

```text
node --test tests/drawing-quantity-lineage.test.mjs \
  tests/drawing-workspace-measurements.test.mjs \
  tests/drawing-workspace-semantic-schedules.test.mjs \
  tests/verified-boq.test.mjs
49 passed, 0 failed

npm run typecheck
exit 0

git diff --check e8a2903..f5bce65
git diff --check 34d6ec5..f5bce65
exit 0
```

Only `drawing-quantity-lineage.ts` and its focused test changed in the fix range; legacy BOQ code and shared P4/audit evidence were untouched.
