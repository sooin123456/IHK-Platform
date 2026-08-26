# P4 Task 7 rereview round-three fix report

Source implementation commit: `cc33072ac041351439c04e9fae39150dee4f52ab`

## Result

- Hosted evidence now requires the exact top-level key set, exact object IDs,
  exact object lineage, exact fingerprint keys, and an exact measurement-map
  key set. Every measurement item is compared as a complete structure with its
  document/revision/checkpoint/object/version/fingerprint lineage, V1 rule,
  semantic identity, values, and count. An orphan seventh key whose embedded
  object ID duplicates the wall is rejected.
- Schedule evidence now requires exactly `room`, `door`, and `finish`. Each
  schedule is compared to an independent complete literal: kind, caption,
  ordered columns, ordered rows, object IDs, exact cell keys/values, and exact
  totals. Missing, extra, reordered, duplicated, swapped, or incorrect
  structures fail closed.
- Confirmed server evidence is serialized into a React-escaped data attribute
  only while its loader evidence matches the current lineage. The production
  browser reads that complete payload, compares it to a separate authorized
  bootstrap derivation, and reruns the exact structural validator before any
  UI text assertion can contribute to a production pass. Preview and stale
  schedules do not expose the attribute.

No dependency, lockfile, migration, RPC, protocol, semantic store, or hosted
state changed.

## Fresh verification

- Focused Task 7 release/mutation suite: **32/32 passed**, including 17 named
  exact-structure mutations and all prior random UUID permutations.
- Full semantic table suite: **15/15 passed**.
- Full local P4 functional/IndexedDB Chromium: **9/9 passed**.
- `env -i PATH="$PATH" npm run release:drawing-workspace-p4:local`:
  **exit 0, `P4 LOCAL PASS`**. It covered the whole Node and Drawing Workspace
  suites, collaboration 33/33, IFC smoke, 98 explicit
  IFC/PDF/quantity/approval/Revit regressions, both typechecks and builds,
  Chromium functional/IndexedDB 9/9, production-build performance 1/1,
  generated evidence validation, licenses 7/7, both audits, and diff check.
- The application audit retains three known moderate `ajv` findings with no
  available fix and passes the high-severity threshold. The collaboration audit
  reports zero vulnerabilities.
- Credential-free production remains **exit 1 before Playwright**, naming all
  ten required authorities.

## Evidence status

`task-7-performance.json` is the sole browser/hardware/viewport/sample record
and is bound to the source implementation commit above. Its exact `2500` ms
decision remains `firstUsableTargetMet: false`; P7 60 fps and the
production-provider p95 remain `UNEXECUTED`.

Real hosted provider convergence/offline recovery, organization/RLS,
freeze/approved immutability, deployed source re-read, cleanup, deployment, and
rollback remain **PRODUCTION UNEXECUTED**. No local result is promoted to a
hosted pass.
