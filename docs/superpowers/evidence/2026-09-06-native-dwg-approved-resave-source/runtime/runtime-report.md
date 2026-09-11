# R2/R5 authenticated runtime validation

Status: **PASS for the existing frozen M1 suite**. The cause-directed shared-root
attempt completed the unchanged authenticated runner with exit 0. This validates
R2 quick-start persistence/idempotency and the existing R5 native-template/import
acceptance. It does not add or claim coverage for the separately identified R5
delivery-package gap.

## Frozen baseline

Attempt 3 used the owned Docker-shared snapshot:

```text
/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-approved-resave-source/runtime-validation/shared-runtime.ugp7sy
```

It is a byte-preserving copy of the original frozen snapshot
`/private/tmp/1hk-r2-r5-runtime.bQ2KdI`. The files called out for concurrency
safety remain byte-for-byte identical to this plan's `baseline-code` copies:

| File | SHA-256 | Comparison |
| --- | --- | --- |
| `tests/fixtures/drawing-native-dwg-canonical-import-database.mjs` | `2c3d73230e71e68eb867518c90c439d6a3b29417cb5fa68709df180ebc5abe84` | MATCH |
| `tests/drawing-workspace-m1-real-database.test.mjs` | `680deb210123e91b8301b310369b074e79802ba9c42284b8b30588369bff631d` | MATCH |
| `supabase/migrations/20260906043637_drawing_native_dwg_resave_source_authority.sql` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | MATCH; 0 bytes |

The original snapshot's relevant-source manifest SHA-256 is
`aa5a29ade3c8f651918dc88ad65f67c25ee4fdf1e0072146241f3ac8a59812ad`.
The copied native publication is byte-identical under the writer's canonical
build-hash algorithm:
`587421d582b26074eca33f1dc10047318d2ed444d058b7fd8e7ebde21075cbb8`.

## Commands and results

The native writer had already been freshly published into the frozen snapshot,
without touching source `obj/bin`:

```text
cwd=/private/tmp/1hk-r2-r5-runtime.bQ2KdI/tools/dwg-engine-qualification
/opt/homebrew/Cellar/dotnet@8/8.0.130/bin/dotnet publish --no-restore -c Release -o /private/tmp/1hk-r2-r5-runtime.bQ2KdI/runtime-native-publish /private/tmp/1hk-r2-r5-runtime.bQ2KdI/tools/dwg-engine-qualification/DwgEngineQualification.csproj
```

Result: exit 0.

Cause-directed attempt 3 wrapper:

```text
cwd=/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1
/opt/homebrew/Cellar/node/26.5.0/bin/node .superpowers/sdd/2026-09-06-native-dwg-approved-resave-source/runtime-validation/run-shared-runtime-attempt-3.mjs .superpowers/sdd/2026-09-06-native-dwg-approved-resave-source/runtime-validation/shared-runtime.ugp7sy
```

The wrapper hash-guarded the frozen sources and writer bytes, required fixed
ports 4000/12349/12350 to be free, ran an exact-root bind preflight, and then
invoked the unchanged runner:

```text
cwd=<shared snapshot>/platform
/opt/homebrew/Cellar/node/26.5.0/bin/node scripts/run-drawing-workspace-m1-e2e.mjs
```

It supplied the copied fresh native artifacts through
`NATIVE_DWG_DOTNET_PATH=/opt/homebrew/Cellar/dotnet@8/8.0.130/bin/dotnet` and
`NATIVE_DWG_PUBLISHED_DIRECTORY=<shared snapshot>/runtime-native-publish`.

Attempt 3 ran from 2026-09-06T05:05:59.660Z through
2026-09-06T05:10:57.447Z:

- Exact shared-root bind preflight: exit 0; container target was a regular file.
- Unchanged M1 runner: exit 0, no signal.
- M1 real PostgreSQL: 1 passed, 0 failed.
- M2 PDF attach real PostgreSQL: 1 passed, 0 failed, 1 configuration sentinel skipped.
- M5 storage real PostgreSQL: 3 passed, 0 failed, 1 configuration sentinel skipped.
- Authenticated Chromium suite: **23 passed in 3.5 minutes**.

Relevant browser scenarios in the full pass:

- `[2/23]` direct blank creation preserved retries, saved geometry, and recent reopen.
- `[3/23]` direct template/import reused the personal project and rejected forged Viewer targets.
- `[11/23]` starter/PDF creation was idempotent.
- `[23/23]` native examples cloned without upload, retained A3 output, imported editable symbols, and denied Viewer writes.

## Non-pristine runtime noise

The green exit is not presented as a warning-free run. Read-only correlation of
the full runner log, final scenario, collaboration hooks, and retained browser
evidence found:

- One `DRAWING_SHARE_UNAVAILABLE` / HTTP 404 server log is classified: scenario
  13 explicitly revokes the share and requires the next public reload to return
  404.
- Nine WebSocket connections were closed with `Clients cannot rewrite protected
  collaboration state.` This is the server's protected-state guard firing, but
  these log emissions are not explicit assertions in the corresponding browser
  scenarios. Six occur after scenario 23 starts and name its four native-example
  revisions. Their exact client-update triggers remain unclassified, so they are
  recorded as security-enforcement noise rather than silently called expected.
- One `P3A01` `Drawing collaboration target is unavailable` stack occurs in the
  scenario-23 room for its measured-plan revision, from
  `beforeHandleAwareness` reauthorization, after that revision was approved and
  immediately before the 23-pass summary. The scenario contains no project-role
  revocation, member deletion, or user deletion, and runner/Supabase cleanup had
  not begun. It is therefore **not tied to a deliberate revoked-role case or
  runner cleanup**. Its timing is consistent with concurrent browser-context
  close/awareness teardown, but the exact actor and database predicate cannot be
  proven from the retained log; classify it as unclassified teardown-time server
  noise.
- The final editor-context attachment contains one aborted React Router `.data`
  GET (`net::ERR_ABORTED`); viewer, reviewer, and approver page/console/request/
  response error arrays are empty, and all recorded page/console/response error
  arrays for the editor are empty. The editor abort was not asserted away by the
  scenario, so its exact navigation trigger is also unclassified.
- Non-fatal tool/framework warnings comprise one Vite large-chunk warning, five
  React Router future-flag warnings, two unsigned-theme-cookie warnings, three
  main-log and two diagnostic-log `NO_COLOR`/`FORCE_COLOR` warnings. PostgreSQL
  NOTICE payloads include function source text containing `raise exception`;
  those strings are not thrown failures.

No additional runtime `Error`, `Panic`, failed test outcome, page error, console
error, or HTTP response error was found beyond the items above. Thus the PASS
claim means the unchanged harness and its asserted outcomes passed; it does not
mean the runtime log was pristine.

## Prior environmental boundary and resolution

Attempts 1 and 2 under `/private/tmp` both stopped at `supabase start` before
build, seeded auth, browser execution, or an R2/R5 assertion. The owned Edge
Runtime container received `/root/index.ts` as a directory and logged
`failed to determine entrypoint`.

A bounded, no-network, `--pull=never` diagnosis showed Docker could not see an
already-existing source through `/private/tmp/...` or `/tmp/...`, while the same
cached image saw an owned `/Users/...` source as a regular file. Attempt 3 used
that proven prerequisite without changing the app, runner, tests, Docker global
settings, dependencies, or images. See `edge-bind-diagnostic.log`.

## Runtime ownership and cleanup

- Attempt 3 owned project: `1hk-m1-5ec586ae`.
- Attempt 3 owned ports: fixed 4000/12349/12350 and Supabase 54308–54317.
- `supabase stop --no-backup` exited 0.
- No attempt-3 project or bind-probe containers remain.
- All attempt-3 owned ports are free.
- The copied runner cache is empty and no copied-runtime process remains.
- Preview port 4173 remains PID 80284 and returned HTTP 200 after cleanup.
- Sanitized attempt-3 evidence contains no JWT, credential URL, or labeled secret pattern.
- No image was pulled, dependency installed, remote service queried, customer
  file accessed, source app/test/build modified, or external data mutated.

## Evidence index and SHA-256

| Evidence | SHA-256 |
| --- | --- |
| `attempt-3-bind-preflight.log` | `4f47283fd8ccca9fef17fd376f55bbfb01f5fdd26d4db7f7d20265ff254ffc87` |
| `m1-authenticated-runtime-attempt-3.log` | `779d22229f37c251faabd2430487ea73e8aaf85736cb20577c4c53e04e72e585` |
| `supabase-attempt-3-sanitized.log` | `6d05cf5b999e07be31bb0a2c99b2a7fce9d87b13e13ba7efdf89a6d1d9da5c22` |
| `runtime-summary-attempt-3.json` | `421e11ad3554698c770ea16ab68a67d789dd7ad4bccb6799397a3823b1d5de20` |
| `run-shared-runtime-attempt-3.mjs` | `afa271980da4eac97cb6d4f70b7d38967e9802b50e282f3133df98aed188bf7e` |

Earlier evidence remains unmodified: `runtime-summary.json`,
`runtime-summary-attempt-2.json`, `dotnet-publish.log`, the attempt 1/2 runner
logs, `supabase-attempt-2-sanitized.log`, `edge-bind-diagnostic.log`, and the
wrapper-only preflight log.
