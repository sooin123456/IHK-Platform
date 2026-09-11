# Task 5 — actual imported DWG publication acceptance

Status: source implementation frozen for controller-owned build and full-stack
execution. Actual browser/native results below remain pending until that run
finishes; they are not claimed by the source checks.

## Scope and changed files

The existing marked M1 runner now accepts only the additional exact
`--profile=dwg-resave` selector and maps it to
`e2e/drawing-native-dwg-resave.spec.ts`. Existing M1, P3, and DWG-source
targets, real-database gates, loopback/status authority, process lifecycle,
build steps, and marked cleanup are unchanged.

The new Playwright story uses the exact public 10,987-byte AC1024 source and
the immutable combined reader/resaver image. It exercises browser TUS upload,
real native import, canonical imported entities, a version-checked LINE 4A
endpoint operation, collaboration-aware review/approval, browser resave
admission/retry/download/relogin, the real resave worker/native sandbox,
semantic native readback, cancellation settlement, and integrated role and
Storage denial checks. The main success path does not override native resave.

Deployment guidance adds only the imported-resave worker environment, startup,
uncertain-publication reconciliation, and experimental qualification boundary.
No package script, dependency, lockfile, accepted production route/UI/server,
SQL, publisher, compiler, or Storage implementation changed.

| File | SHA-256 | Mode |
| --- | --- | --- |
| `platform/scripts/run-drawing-workspace-m1-e2e.mjs` | `56d509800599c94dc0daa8056e3011796040f19b4da4e8493eaec2dfd6ee1bb3` | `0644` |
| `platform/tests/drawing-workspace-m1-release-harness.test.mjs` | `b0bd1ec1d3f9701d625ba9bca3d9082f64c8d53c070119d3af7e50eb284bcbd0` | `0644` |
| `platform/e2e/drawing-native-dwg-resave.spec.ts` | `af9b55feb84e2dad4fcca07b9d9aa7baa50a0a2f70e9ec44d42ba3de0683d06f` | `0644` |
| `platform/DEPLOYMENT.md` | `b7f56170946b4959df2b3707a652926dba8ab124a8b6087a0c93bdc3b1e838dc` | `0644` |

## TDD and source verification

Working directory for source checks:
`/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform`.
Every Node command used `NODE_OPTIONS=--no-experimental-webstorage`.

1. RED: focused runner profile test command selected the three new profile
   behaviors. Result: exit 1, 3 tests, 0 pass, 3 fail. The failures were the
   absent parser selector, absent Playwright target, and rejected runtime
   profile.
2. GREEN: the same focused command after the minimal selector extension:
   exit 0, 3 tests, 3 pass, 0 fail, 0 skipped.
3. Full release harness: `node --test
   tests/drawing-workspace-m1-release-harness.test.mjs` → exit 0, 27 tests,
   27 pass, 0 fail, 0 skipped. This includes existing profile, runtime,
   status/marker, sensitive-output, process-group, and direct-Playwright
   fail-closed checks.
4. Prettier wrote/checks the four Task5 platform files successfully.
5. Local `tsc --noEmit --incremental false --pretty false` reached the new
   spec with no Task5 diagnostic. It exits 2 only for the two already-recorded
   Task4 generated route modules
   `./+types/drawing-native-dwg-resave[-download]`, which are produced by the
   controller-owned route typegen/build. No authoritative local build or
   `.react-router` output was regenerated.
6. Direct Playwright discovery without a marked disposable environment refused
   before test loading with the expected `M1_E2E_DISPOSABLE=1` authority gate.
   It is not recorded as an executed browser test.

## Actual owned full-stack evidence

The first marked run reached Playwright after a fresh build and the mandatory
real-database gates, then stopped before fixture creation or application
mutation at the source reader oracle. The actual pinned reader reported the
three non-model-space entities present in the public inventory (paper-space
viewport plus the two block-definition entities), while the test had incorrectly
expected zero. Result: Playwright 1 test, 0 pass, 1 fail; runner exit 1. The
owned error context and trace were retained under the run's `test-results`
directory. No availability screenshot was reached. Runner cleanup completed:
ports 4000/12349/12350 were free and no marked recovery directory remained.
The assertion was corrected to the actual literal `nonModelSpaceEntities: 3`;
no production code or acceptance assertion was bypassed.

Pending controller synchronization of the corrected spec and its marked rerun:

```sh
NODE_OPTIONS=--no-experimental-webstorage node scripts/run-drawing-workspace-m1-e2e.mjs --profile=dwg-resave
```

No actual browser/native pass, screenshots, output hash, runtime project label,
or cleanup outcome is claimed yet. The run must stop at its first broken
application boundary and retain the owned `test-results` failure evidence.

## Acceptance limits

The native oracle covers the supported-field reader inventory, literal LINE 4A
`start=[0,0,0]`, `end=[120,21,0]`, deep-equal supported entities 4B–4E,
layers, coverage, and bounded unsupported INSERT identity (`54`). It is not an
independent recipient CAD check or proof of complete unsupported payload
fidelity. Whole-DWG bytes may vary between native runs; each run is checked
against its own receipt.

The local Storage limit is 50 MiB and is not 200 MiB performance evidence.
Professional fonts, Xrefs, layouts, recipient qualification, exact-approved R5
packages, and the two ledgered Minors (existing unrelated build/advisor warnings
and stronger pending-poll/readback/first-refusal controlled-promise coverage)
remain open. This task performs no deployment and does not complete R5.
