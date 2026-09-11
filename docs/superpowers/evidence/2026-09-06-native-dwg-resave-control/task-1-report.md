# Task 1 — Exact server attestation report

Date: 2026-09-06  
Worktree: `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1`  
Scope: Task 1 only; no stage, commit, push, deployment, dependency install, remote mutation, platform build, or preview lifecycle action.

## Outcome

Implemented exact approved imported-DWG resave attestation around the existing approved-source projector.

- `buildNativeDrawingDwgResaveAttestation` validates and clones scope/payload/image synchronously, normalizes UUID case, invokes the existing projector, and fixes exact request and nine-field authority bytes with independent UTF-8 byte counts and SHA-256 digests.
- `parseNativeDrawingDwgResaveAttestation` accepts only strict nested shapes, exact canonical JSON encoding, bounded/digested bytes, canonical numeric handle lists, and consistent scope/approved/snapshot/source/request/image identities.
- The parser intentionally validates structural identity rather than duplicating native geometry semantics. Worker recompilation and the existing native validator remain responsible for those semantics.
- No-op compilation yields `request: null`; approved-to-superseded status does not alter immutable attestation identity.

## Files

- Created `platform/app/lukas/lib/drawing-native-dwg-resave-attestation.server.ts`.
- Modified `platform/app/lukas/lib/drawing-native-dwg-resave-source.server.ts` only to export its existing strict payload schema as `NativeDrawingDwgResaveSourcePayloadSchema` and consume that renamed export. Projector behavior is unchanged.
- Created `platform/tests/drawing-native-dwg-resave-attestation.test.mjs`.
- Created `platform/tests/fixtures/drawing-native-dwg-resave-source.mjs` by extracting the literal source fixture and the existing five-entity setup.
- Modified `platform/tests/drawing-native-dwg-resave-source.test.mjs` to import the extracted fixture; its existing assertions remain intact.

## Behavioral coverage

The new suite covers:

- Literal centimeter LINE edit serialized as native `{start:[2,2,0],end:[3,4,0]}` with independently derived request text, SHA-256, UTF-8 size and decoded authority envelope.
- No-op request, all five supported entity types, numeric handle order and clone object/handle bindings.
- Reordered input object keys, synchronous snapshotting before the first asynchronous boundary, lowercase UUID normalization and approved-to-superseded stability.
- Malformed source, report, snapshot, scope, image and extra payload fields.
- Changed/truncated request bytes, wrong digest/byte count/handles/scope/image and strict extra-field rejection.
- Reordered request/authority encodings and an authority mutation whose outer digest/size were recomputed; canonical inconsistency remains rejected.

## TDD evidence

Exact missing-feature RED command:

```sh
NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-resave-attestation.test.mjs
```

Observed exit: `1`.

```text
✖ build fixes the literal native request and exact canonical authority bytes
AssertionError [ERR_ASSERTION]: attestation builder must exist
+ actual - expected
+ 'undefined'
- 'function'
tests 6; pass 0; fail 1; skipped 5
```

Raw RED log: `/tmp/1hk-resave-control-m6Q9WS/task1-attestation-red.log`.

Final focused GREEN command:

```sh
NODE_OPTIONS=--no-experimental-webstorage node --test \
  tests/drawing-native-dwg-resave-attestation.test.mjs \
  tests/drawing-native-dwg-resave-source.test.mjs \
  tests/drawing-native-dwg-selected-edits.test.mjs \
  tests/drawing-native-dwg-resave-protocol.test.mjs
```

Observed exit: `0`.

```text
tests 125
pass 125
fail 0
skipped 0
duration_ms 541.833625
```

Raw final GREEN log: `/tmp/1hk-resave-control-m6Q9WS/task1-focused-regressions-final.log`.

Fixture extraction was separately verified against the original source suite: `51` tests passed, `0` failed. Logs:

- `/tmp/1hk-resave-control-m6Q9WS/task1-fixture-extraction-green.log`
- `/tmp/1hk-resave-control-m6Q9WS/task1-fixture-all-five-green.log`

No-emit TypeScript verification:

```sh
./node_modules/.bin/tsc --noEmit --pretty false
```

Observed exit: `0`, no diagnostics. Raw log: `/tmp/1hk-resave-control-m6Q9WS/task1-typescript-final.log`.

## Source identity

Saved exact pre-task hashes:

```text
2da86f08e24ffb922cc9b8a13c69c8dad9f691aec62cf3f98cc59f82e13dde64  drawing-native-dwg-resave-source.server.ts
93f94087a5754f470ae0528ec1e51d5c5bfbf6c0aedf3bb5d8ea6a9b4581e8e6  drawing-native-dwg-resave-source.test.mjs
```

Final owned-file hashes:

```text
079dff673720b997c9dfb7f923815d003d0139d5ebad55bcb3b0beeee1cebb42  drawing-native-dwg-resave-attestation.server.ts
18a23184ceea87002ed12f79a95a05fd63417bdf3ecd912e01b53ed1007c5787  drawing-native-dwg-resave-source.server.ts
98d109ca10bde90c938276180663cf1444f6c1730478b7a392a802ceee92934b  drawing-native-dwg-resave-attestation.test.mjs
e9d39fa3191640f25cfa5766a1483ed18c5367d1f453161acf3fe04ce7804beb  drawing-native-dwg-resave-source.test.mjs
d064a19d1e5b81fe5ac15e06320363806f8171a2ab567b483157d5e2fa0ec3e9  drawing-native-dwg-resave-source.mjs
```

Raw final hash log: `/tmp/1hk-resave-control-m6Q9WS/task1-source-hashes-final.log`.

## Review and concerns

- Independent exact-delta spec/quality review was requested from the main agent after GREEN verification.
- The full `npm run typecheck` command was not used because it runs React Router type generation; the task prohibited platform build/generated artifact lifecycle. Direct `tsc --noEmit` passed.
- No platform build or preview verification was run by design. Task 3 must still recompile the admitted payload and compare exact attestation before native execution.

## Independent-review normalization test fix

Independent spec/quality review approved the implementation and identified one minor test-only defect: the original normalization case uppercased a numeric-only fixture UUID, so that particular case conversion was vacuous.

The exact pre-fix test was saved at:

```text
/tmp/1hk-resave-control-m6Q9WS/task1-prefixed-normalization.test.mjs
```

Only `platform/tests/drawing-native-dwg-resave-attestation.test.mjs` changed. The test now installs the valid lowercase project UUID `93abcdef-0000-4000-8900-000000000001` in the scope, approved payload, analysis scope and canonical snapshot revision, rehashes the snapshot, and compares the lowercase build with inputs whose corresponding UUID fields are uppercase. Production code was unchanged.

Focused verification command:

```sh
NODE_OPTIONS=--no-experimental-webstorage node --test \
  tests/drawing-native-dwg-resave-attestation.test.mjs \
  tests/drawing-native-dwg-resave-source.test.mjs
```

Observed exit: `0`.

```text
tests 72
pass 72
fail 0
skipped 0
duration_ms 535.732542
```

Evidence:

- `/tmp/1hk-resave-control-m6Q9WS/task1-normalization-fix-green.log`
- `/tmp/1hk-resave-control-m6Q9WS/task1-normalization-fix.diff`
- `/tmp/1hk-resave-control-m6Q9WS/task1-normalization-fix-hashes.log`

Test hash changed from `98d109ca10bde90c938276180663cf1444f6c1730478b7a392a802ceee92934b` to `eaf6058225af7992e234be163bb038f057586e6dbe7ff08c2d145fcfddfe1b74`.
