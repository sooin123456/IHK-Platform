# Node regression diagnosis: native DWG export browser control

## Conclusion

The retained 899-pass/1-fail result is real, but the available evidence does **not** prove a source or dependency regression in `drawing-native-dwg-export-ui.test.mjs`.

The immediate failure was a fixture-readiness timeout before the duplicate-click behavior ran: after `page.goto(url)`, Chromium did not observe the `시험용 DWG 만들기` button within the fixed 5,000 ms default timeout at line 519. The preceding browser-resume test in the same file passed. The exact failing test then passed in isolation, and the entire file passed in a controlled run.

The best bounded hypothesis is transient Chromium/Vite startup starvation or shared-transform contention in the original highly parallel run. It is plausible, but not proven from one occurrence: the 38-file Node command ran with default test concurrency on a 14-logical-CPU host, 14 of the selected files create Vite servers, and it overlapped a full application build for 21.98 seconds plus the .NET build. The failing assertion concerns UI readiness rather than duplicate-click semantics.

Do not hide the retained failure by increasing the timeout or retrying the broad suite repeatedly. The root unit's planned final whole-regression run, after the C# review fixes and without concurrently launching the application/.NET builds, is the correct discriminating check.

## Retained first failure

- Evidence: `checks/node-regressions-final/{result.json,stdout.log,stderr.log}`
- Started: `2026-09-06T03:50:46.217Z`
- Ended: `2026-09-06T03:51:22.169Z`
- Result: 900 tests, 899 pass, 1 fail, exit code 1, no files changed during the run.
- Failure: `tests/drawing-native-dwg-export-ui.test.mjs:491`, timed out at line 519 after 5,236 ms waiting for the create-DWG button to become visible.
- The previous browser test passed in 1,125 ms.
- `stderr.log` is empty; the complete Playwright timeout and call log are in `stdout.log`.

Concurrent checks overlapped the retained failure run:

- Application build: `03:50:47.503Z`–`03:51:09.486Z` (exit 0).
- .NET build: `03:50:48.826Z`–`03:50:49.979Z` (exit 0).

## Controlled reproductions

Exact isolated diagnostic, run through the unit's `run-check.mjs` with TAP output:

```text
node --test --test-reporter=tap --test-name-pattern=browser control ignores a duplicate click tests/drawing-native-dwg-export-ui.test.mjs
```

- Evidence: `checks/regression-isolated-diagnostic/{result.json,stdout.log,stderr.log}`
- Result: 1/1 pass, target test 758.5 ms, total 1,164.6 ms, exit code 0.
- No files changed during the run; stderr is empty.

Single controlled whole-file follow-up:

```text
node --test --test-reporter=tap tests/drawing-native-dwg-export-ui.test.mjs
```

- Evidence: `checks/regression-wholefile-diagnostic/{result.json,stdout.log,stderr.log}`
- Result: 10/10 pass, target test 301.0 ms, total 1,265.5 ms, exit code 0.
- The preceding browser-resume test passed in 608.1 ms.
- No files changed during the run; stderr is empty.

Thus the failure is not consistently reproducible either alone or with all earlier tests in its own file. No production server was started and no existing port 4173 service was touched.

## Change and dependency checks

The following current files are byte-identical to the private baseline:

- `platform/tests/drawing-native-dwg-export-ui.test.mjs`
- `platform/app/lukas/components/drawing-native-dwg-export.tsx`
- `platform/app/lukas/lib/drawing-workspace-paths.ts`
- `platform/app/core/components/ui/button.tsx`
- `platform/package.json`
- `platform/package-lock.json`

The private baseline and the retained/diagnostic check hashes differ only for the nine intended geometry-resave unit files (including two new files); none is in the failing fixture's direct import chain. All three check captures report the same 723-file hash set and no mutation during execution.

Installed versions resolve exactly from the unchanged lockfile: Node `v26.5.0`, `@playwright/test` `1.62.1`, Vite `7.3.6`, React/React DOM `19.2.8`. There is no dependency drift linked to this failure.

## Why the appended browser diagnostics were absent

`withBrowserControl` appends browser errors and body text by mutating `error.message`, but Playwright's timeout stack has already been materialized. Node's reporter renders the cached `error.stack`; changing `message` afterward does not regenerate that stack. A local generic `Error` check reproduced this behavior: `message` included the appended text while `stack` retained only the original message. This explains why neither the spec-style output nor the retained failure block included `Browser diagnostics`.

No diagnostic body/error payload was available from this turn because both TAP reproductions passed. If the final controlled whole regression fails again, the diagnostic should throw a new error (or explicitly rebuild `stack`) containing the original stack plus captured page errors/body, then rerun only this test once; that would locate a transform/runtime error without weakening the readiness assertion.

## Disposition

- Preserve `checks/node-regressions-final` as the first-failure evidence.
- Treat the issue as a bounded, likely load-sensitive fixture-readiness flake unless the final controlled whole regression reproduces it.
- Make no source/test/timeout change from this diagnosis.
- If the final controlled whole regression passes, it is fresh acceptance evidence on unchanged relevant code and is consistent with (but does not prove) the startup-contention hypothesis; preserve the uncertainty and the first-failure evidence.
- If it fails again, the load-only hypothesis is weakened; collect the body/page/console diagnostics with a newly thrown error before considering any fix.
