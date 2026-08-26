# P4 Task 7 rereview fix report

Source implementation commit: `1a78ea49b4c3ad91f09f0d44306938dd023d1c60`

## Result

- Hosted measurement expectations are now selected by the stable object ID
  belonging to each exact semantic type, including the one door opening.
  Room, Door, and Finish schedule rows use those same semantic identities.
  UUID sort order and caller object order no longer assign meaning.
- The validator still requires the exact six-object semantic set, confirmed
  revision/checkpoint/fingerprint lineage, V1 measurements, and exact schedule
  rows. Sixty-four deterministic UUID assignments and object permutations pass;
  wrong, missing, duplicate, type-swapped, schedule-swapped, and stale-lineage
  mutations fail.
- The exact release manifest now invokes `git --no-pager diff --check`. Every
  release child receives `GIT_PAGER=cat`, `PAGER=cat`, and
  `GIT_TERMINAL_PROMPT=0` as a second noninteractive boundary. A real
  pseudo-terminal regression starts the runner with hostile inherited pager
  values and proves it exits without input.

No dependency, lockfile, migration, RPC, product feature, or hosted state
changed.

## Fresh verification

- `env -i PATH="$PATH" npm run release:drawing-workspace-p4:local`, executed
  with a TTY: **exit 0, `P4 LOCAL PASS` without input**.
- The complete release gate passed: whole Node, Drawing Workspace,
  collaboration service, IFC smoke, 98 explicit
  IFC/PDF/quantity/approval/Revit regressions, both typechecks, both builds,
  Chromium functional/IndexedDB 9/9, production-build performance 1/1,
  generated evidence validation, licenses 7/7, both audits, and the
  noninteractive diff check.
- Focused Task 7 release and mutation suite: **15/15 passed**.
- Application audit retained three known moderate `ajv` findings with no
  available fix and passed the high-severity threshold; collaboration audit
  reported zero vulnerabilities.
- `env -i PATH="$PATH" npm run release:drawing-workspace-p4:production`:
  **exit 1 before Playwright**, listing all ten missing authorities and keeping
  production `UNEXECUTED`.

## Generated measurement evidence

`task-7-performance.json` is bound to the source implementation commit above
and is the sole record of the browser, host, viewport, exact sample, and warm
p95 values. Its exact `2500` ms decision remains
`firstUsableTargetMet: false`; the P7 60 fps gate and production-provider p95
remain `UNEXECUTED`.

Hosted provider convergence/offline recovery, organization/RLS,
freeze/approved immutability, deployed source re-read, cleanup, deployment, and
rollback remain **PRODUCTION UNEXECUTED**. No local result is promoted to a
hosted pass.
