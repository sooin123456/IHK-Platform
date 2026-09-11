# Final-review normalization test fix

Status: DONE — the whole-unit review's only finding (Minor) is resolved as a test-only change. Production code is unchanged and the files are frozen for controller review.

Authoritative worktree: `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1`. No dependency installation, build, preview, git/remote mutation, private `.superpowers/sdd` access, or production change was used.

## Finding and exact fix

The normalization case at `platform/tests/drawing-native-dwg-resave-jobs.test.mjs:201` previously uppercased numeric-only fixture UUIDs, so the input was unchanged and the adapter normalization assertion was vacuous.

The test now:

- installs lowercase alphabetic project UUID `93abcdef-0000-4000-8900-000000000001` consistently in the request scope, approved payload, analysis scope, and canonical snapshot revision, then rehashes the snapshot;
- uses lowercase alphabetic request UUID `93fedcba-0000-4000-8900-000000000091` and an acceptance response with that normalized identity;
- asserts the browser request contains the genuinely different uppercase values `93ABCDEF-0000-4000-8900-000000000001` and `93FEDCBA-0000-4000-8900-000000000091`;
- asserts a hand-derived literal normalized scope reaches `lukas_qto_drawing_native_dwg_resave_source` and that the same literal scope plus lowercase request ID reaches `lukas_drawing_admit_native_dwg_resave`;
- retains the existing parent-abort proof against an RPC whose `abortSignal` implementation never settles.

No RED run was manufactured because existing production normalization is correct and the controller explicitly scoped this to repairing deficient test evidence.

## Covering verification

Run from the authoritative `platform` directory against existing dependencies:

```sh
NODE_OPTIONS=--no-experimental-webstorage node --experimental-strip-types --test \
  tests/drawing-native-dwg-resave-attestation.test.mjs \
  tests/drawing-native-dwg-resave-source.test.mjs \
  tests/drawing-native-dwg-resave-jobs.test.mjs
```

Observed exit: `0`.

```text
tests 82
pass 82
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 600.695542
```

Full output log: `/tmp/1hk-resave-control-m6Q9WS/final-review-fix-green.log`.

Formatting and whitespace verification also passed:

```sh
./node_modules/.bin/prettier --check tests/drawing-native-dwg-resave-jobs.test.mjs
git diff --check -- tests/drawing-native-dwg-resave-jobs.test.mjs
```

## Frozen identities

| Artifact | SHA-256 |
| --- | --- |
| Exact controller pre-fix copy `/tmp/1hk-resave-control-m6Q9WS/final-review-jobs.test.mjs` | `a51d944f5d173653def64878995ec88c538922b24fedad20076b2c3bdb16aa40` |
| Final `platform/tests/drawing-native-dwg-resave-jobs.test.mjs` | `a323adea06176d96ca3f9028b3fedff951650b329e601c075c468f3c30c3fe5c` |
| Unchanged production adapter `platform/app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts` | `7f20ed2c958ac7789a3a4ba673c2cfd3fc038f2b39bb2828ab8fedb2c96cd4d5` |
| Covering log `/tmp/1hk-resave-control-m6Q9WS/final-review-fix-green.log` | `abf4b53d66c99ffce22426aea664b0670eef41f1ed573b6ada57e89791a233af` |

Only the jobs test and this public report were edited for this fix wave.
