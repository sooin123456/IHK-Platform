# Task 1 report — approved imported-DWG resave source

Status: implementation complete, uncommitted, ready for independent review. This is the approved source/selected-edit bridge only; it does not complete native resave delivery or the full Universal Workspace goal.

## Exact changed files

1. `platform/supabase/migrations/20260906043637_drawing_native_dwg_resave_source_authority.sql` — filled the existing CLI-created empty migration; added the separate private resolver and authenticated public RPC, exact role revokes/grant, no new tables/indexes or patches to old functions.
2. `platform/app/lukas/lib/drawing-native-dwg-resave-source.server.ts` — new strict server projector/loader and bounded typed error.
3. `platform/tests/drawing-native-dwg-resave-source.test.mjs` — new adapter behavior tests, literal clone fixture and hand-derived native edit expectations.
4. `platform/tests/fixtures/drawing-native-dwg-resave-source-database.mjs` — new narrow real PostgreSQL proof invoked by the canonical fixture.
5. `platform/tests/fixtures/drawing-native-dwg-canonical-import-database.mjs` — connected draft/original approval/template-clone approval/restore-clone approval proof. Baseline diff contains only the import and these calls/clone approval operations.
6. `.superpowers/sdd/2026-09-06-native-dwg-approved-resave-source/task-1-report.md` — this report.

No changes to `drawing-workspace-m1-real-database.test.mjs`, compiler/export/jobs/UI, dependencies, builds, or native engine source.

## RED evidence

From `platform`:

```sh
NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-resave-source.test.mjs
```

Before implementation: 4 tests, 0 pass, 4 fail. Each failed its explicit real-export existence assertion (`undefined` versus `function`), including `approved resave projector must exist`; the adapter module did not exist. The initial tests already contained the literal accepted clone/no-op/centimeter LINE fixture, rehashed malicious anchors, strict payload/scope cases and RPC behavior. Geometry expected values are literal: canonical endpoint `(55,-65)` mm returns `[5.5,-6.5,0]` native cm, retaining start `[1,2,0]`.

Before SQL implementation, after wiring the real canonical fixture:

```sh
NODE_OPTIONS=--no-experimental-webstorage M1_REAL_POSTGRES_REQUIRED=1 M1_REAL_POSTGRES_DATABASE_URL=postgres://postgres@127.0.0.1:62430/postgres node --test tests/drawing-workspace-m1-real-database.test.mjs
```

Expected failure at `proveApprovedNativeDwgResaveSource` after the real canonical import: `function public.lukas_qto_drawing_native_dwg_resave_source(jsonb) does not exist`, actual `42883`, expected bounded authority code `PNR01`. One test failed, none skipped. Production adapter/SQL were written only after these failures.

Additional all-five-type geometry and poisoned-evidence regression cases were added after the first green run. They exercise the existing implementation; they are supplemental regression coverage, not claimed as independent preimplementation RED cycles.

## GREEN evidence

From `platform`:

```sh
NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-resave-source.test.mjs tests/drawing-native-dwg-source.test.mjs tests/drawing-native-dwg-selected-edits.test.mjs
```

132 tests passed, 0 failed, 0 skipped; duration 544 ms. After formatting and final fixture assertions the same three files were rerun with `--test-reporter=dot`: exit 0, 132 dots. This is 44 new adapter checks plus 88 unchanged source/compiler regression checks.

```sh
NODE_OPTIONS=--no-experimental-webstorage M1_REAL_POSTGRES_REQUIRED=1 M1_REAL_POSTGRES_DATABASE_URL=postgres://postgres@127.0.0.1:62430/postgres node --test tests/drawing-workspace-m1-real-database.test.mjs
```

Final real PostgreSQL run: 1 large integration test passed, 0 failed, 0 skipped; 3,413 ms total. It executes all migrations and existing M1/canonical-import proof plus this new proof. New resolver accepted five objects for the approved original, approved template clone and approved snapshot restore clone. Each projects to no-op while preserving current object ID/native handle bindings. Native handles are exactly `4A`, `4B`, `4C`, `4D`, `4E` in numeric order. Original historical analysis scope is retained across clones.

New DB checks cover draft denial, approved original/template/restore acceptance, viewer read access, outsider/null/anonymous/revoked-member denial, banned/deleted actors, foreign project/document/revision/canvas, wrong version/hash, extra scope field, project archive/deletion, historical deleted source row, corrupt source handle, changed verified header, reader-image mismatch, corrupt snapshot bytes and incompatible document source. Evidence corruption is confined to rolled-back owner transactions in the disposable database; write guards are disabled there solely to test the read boundary itself. No app-role production test hooks exist.

`has_function_privilege` verifies no `anon`, `authenticated`, `service_role`, or collaboration role can execute the private helper. Only `authenticated` can execute the public function. Public anon/service-role attempts receive `42501`; authenticated unavailable evidence receives exactly bounded `PNR01`. Imported scopes still fail the original source-free RPC with `PND01`.

Each accepted DB scope verifies frozen snapshot text/hash and source file SHA again after all corruption probes, proving rollback and read-only behavior. The adapter receives actual PostgreSQL canonical JSON text and receipts through the real hydration/parser path.

```sh
npm run typecheck
```

Exit 0 after `react-router typegen && tsc`. Initial typecheck exposed the existing structure type's optional `sources`; changed the read to `Object.values(structure.sources ?? {})`, retaining the cardinality denial for missing sources. No application build was run.

`git diff --check`: exit 0. All four changed TS/MJS files formatted with the existing local Prettier binary, without new dependencies.

## Owned PostgreSQL runtime and cleanup

Tools: `/opt/homebrew/opt/postgresql@17/bin`. Fresh directory allocated with `mktemp -d /tmp/goagent-resave-pg.XXXXXX`, resulting in `/tmp/goagent-resave-pg.fs7Nd5`. A Node loopback listen-on-port-zero check returned free port `62430`; it is outside the independent runtime validation port ranges.

The first `initdb --no-locale` omitted UTF8 and defaulted to SQL_ASCII. The harness also requires the runtime role assumption preconfigured. Those preliminary setup failures were not feature RED evidence: first `exact_runtime_membership: false`, then an existing Korean property-schema name constraint under SQL_ASCII. The first cluster was stopped and replaced by a separate fresh UTF8 data directory; its files were retained.

Working setup commands:

```sh
/opt/homebrew/opt/postgresql@17/bin/initdb -D /tmp/goagent-resave-pg.fs7Nd5/utf8 -U postgres -A trust --no-locale --encoding=UTF8
/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /tmp/goagent-resave-pg.fs7Nd5/utf8 -l /tmp/goagent-resave-pg.fs7Nd5/utf8.log -o '-h 127.0.0.1 -p 62430 -k /tmp/goagent-resave-pg.fs7Nd5 -c wal_level=logical -c client_min_messages=warning' start
/opt/homebrew/opt/postgresql@17/bin/psql postgres://postgres@127.0.0.1:62430/postgres -v ON_ERROR_STOP=1 -c 'create role lukas_drawing_collaboration nologin noinherit; grant lukas_drawing_collaboration to postgres with inherit false, set true;'
```

The real test creates unique `m1_<pid>_<random>` databases and cleans them up. Final query of `pg_database` for `m1_%` returned no rows. Cleanup:

```sh
/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /tmp/goagent-resave-pg.fs7Nd5/utf8 stop -m fast
/opt/homebrew/opt/postgresql@17/bin/pg_isready -h 127.0.0.1 -p 62430
```

Server stopped successfully; readiness reports `127.0.0.1:62430 - no response`. Both stopped cluster data directories and logs remain under the owned temporary directory for inspection. No other database/port was used or mutated.

The added archive/deletion corruption fixtures initially violated the preexisting retention-state check because the paired actor/event/timestamp fields were missing. Corrected the fixture shape; those setup failures are not presented as resolver bugs or green evidence.

## Self-review and preservation

- Reuses strict scope/result/receipt schemas, canonical authority hydration, native import plan/projection and unchanged selected-edit compiler. The SQL resolver reuses `private.lukas_drawing_dwg_source_report_matches`; no duplicated native handle/unit predicate and no runtime patching of the source-free resolver.
- Frozen approved/superseded snapshot digest, size, schema, version, approval, live structure equality and homogeneous complete source anchors gate evidence. Historical analyzed jobs join verified immutable file/upload and matching reader attempt/result; DTO contains only the existing public source receipt, never private storage descriptors.
- Only verified identity/version normalization is performed. Canonical geometry, object names/styles and native layer name/visibility/lock/kind/order are checked or forwarded intact. Empty default layers and empty imported native layers are supported; unknown/nonempty unrelated layers reject. Compiler continues to reject unsupported edits atomically.
- `security definer set search_path=''` and explicit grants are applied to the two new functions; no index was added. `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)` on accepted seeded scopes reported resolver execution 3.398 ms, 3.393 ms, 3.529 ms in the final run. This measures the opaque function call on five entities, not a claimed large-project query-plan/performance qualification. Joins use existing project/revision/snapshot/job/attempt/file identities and existing constraints.
- Mutation review: removing the source equality/handle cardinality/layer semantics checks is covered by rehashed negative cases; wrong unit conversion/handle selection is caught by hand-derived LINE and all-five-type geometry assertions; dropping SQL actor/source/approval gates is covered by direct poisoned-evidence and actor probes.
- Parent's baseline hash comparison found exactly two changed preexisting files: the owned migration and canonical fixture. All other baseline files match, including compiler, source-free resolver, accepted native evidence, and existing dirty implementation. Three implementation/test files are newly created. No stage/commit/merge/push/deploy or remote API/data operations occurred.
- HEAD preserved: `9f5f56d93db325ff935772252f9d4fb64d69f98c`. Index hash preserved: `ab8778babeb2aa04f070a609cbd1240760b3158cb5aa1e6ced3da34bb9a9f84c`. Cached diff remains empty.
- Original synthetic DWG SHA unchanged: `5c287281fafa07f76a0158d5374dd7577910c107dcb55817688acf9fd8656c71` (`docs/superpowers/evidence/2026-09-06-native-dwg-import-projection/accepted-code/synthetic-source.dwg`). Compiler SHA: `7c9d08e9bade1ba5133edb1ab6d3a1feed9db71ad0a96c9a555150b8f7ddc449`; source-free adapter SHA: `93f263b688367ea396b2ff2fbc8a464314631faedda4406a0c6fc24a6a15cfb8`.
- No `platform/build` writes or live port 4173 operations. Vite was middleware-only for server module loading; no preview server was started.

## Remaining qualification boundaries

No unresolved blocker for this bounded implementation. Independent controller review is still required. This task did not run a native CLI or produce new DWG bytes, did not implement a resave queue/isolated write protocol/Storage publication/UI, and did not validate independent CAD recipients or a same-approved-revision delivery package. Results remain `experimental-unqualified` with `persistenceAuthority: not-issued`. Separate R2/R5 runtime validation belongs to the independent controller track.

## Review fix round 1 — original identity must not be normalized

The independent review found an Important spec issue in the initial implementation: layer/source/object IDs were normalized even when the historical analysis revision was the approved original revision. A fully rehashed same-scope identity rewrite could pass. The earlier all-five-types test incorrectly described same-revision identity rewriting as a clone. The initial self-review statement about clone-only normalization was therefore incomplete; this section records its correction.

Exact round-1 changed files relative to `task-1-code`:

1. `platform/app/lukas/lib/drawing-native-dwg-resave-source.server.ts`.
2. `platform/tests/drawing-native-dwg-resave-source.test.mjs`.
3. `.superpowers/sdd/2026-09-06-native-dwg-approved-resave-source/task-1-report.md` (this append).

The SQL migration and both DB fixture files are byte-identical to the reviewed `task-1-code` copies. No other implementation changes were made.

Change: clone normalization now requires `analysis.scope.revisionId !== scope.revisionId`. For the same revision, historical/current document and canvas must match and deterministic native layer/source/object IDs remain exact. Only versions retain their existing permitted normalization. The corrected all-five-types clone fixture has a different approved revision, document and canvas while retaining its historical analysis scope and source evidence. Actual template/restore clone behavior remains covered by the unchanged real DB fixture.

RED, before production fix, from `platform`:

```sh
NODE_OPTIONS=--no-experimental-webstorage node --test --test-name-pattern='same analysis revision' tests/drawing-native-dwg-resave-source.test.mjs
```

7 reported failures (six subcases plus their parent), zero pass/skip. Each of `layer`, `object`, `source`, combined `all` identity rewriting, and same-revision `document`/`canvas` mismatch failed with `Missing expected rejection (unavailable)`. Each case first proved the valid original no-op, then rehashed the changed canonical snapshot and expected rejection. This directly reproduced the finding before changing production code.

GREEN:

```sh
NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-resave-source.test.mjs tests/drawing-native-dwg-source.test.mjs tests/drawing-native-dwg-selected-edits.test.mjs
```

139 passed, 0 failed, 0 skipped; 605 ms. The six new subcases and corrected distinct-scope five-type clone pass.

```sh
NODE_OPTIONS=--no-experimental-webstorage M1_REAL_POSTGRES_REQUIRED=1 M1_REAL_POSTGRES_DATABASE_URL=postgres://postgres@127.0.0.1:62430/postgres node --test tests/drawing-workspace-m1-real-database.test.mjs
npm run typecheck
```

Real PostgreSQL: 1 passed, 0 failed, 0 skipped; 3,849 ms. Approved original, template clone and restore clone all accepted five entities and preserved the existing source-free rejection/denial probes. Accepted-scope resolver timings were 3.780, 4.175 and 4.056 ms. Typecheck (`react-router typegen && tsc`) exited 0. No build was run.

Reused only the previously owned, stopped UTF8 test cluster after checking port 62430 had no listener. Same `pg_ctl start` command as documented above. Final `pg_database` query found zero `m1_%` databases, then `pg_ctl -D /tmp/goagent-resave-pg.fs7Nd5/utf8 stop -m fast` completed. `pg_isready -h 127.0.0.1 -p 62430` reports no response. The owned stopped data/logs remain available for inspection.

Round-1 self-review: a document/canvas mismatch cannot label the same revision a clone; source equality now independently protects both source ID and object ID, and layer equality protects deterministic imported layer ID. The original object is forwarded unchanged to the compiler. Distinct historical/current revisions retain the previous fully validated source and layer anchor mapping. HEAD and index remain identical to the original baseline. No new qualification claims or broader scope changes.
