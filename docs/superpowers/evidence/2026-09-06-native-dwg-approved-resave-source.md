# Approved native DWG resave source — implementation evidence

Status: **this local integration unit is complete; the full Universal Workspace goal remains active**. No deployment, commit, staging, remote database mutation or new dependency was performed.

## Implemented

- Separate authenticated approved-source RPC plus private resolver. An exact approved/superseded snapshot is bound to the immutable analyzed report, reader attempt, original DWG file and single verified upload.
- Server-side canonical hydration and native handle/layer mapping. Original scope and IDs remain exact; differing-revision template/restore clones retain their original DWG anchors. Geometry and supported edits flow through the existing strict compiler.
- Rejects wrong scope/hash/units/anchors, incomplete or mixed object sets, unsupported name/style/layer changes, unapproved revisions, inaccessible actors and invalid source metadata. No-op remains `request:null`; no new artifact or persistence authority is invented.
- Existing source-free export and selected-edit compiler contracts are unchanged. Ponytail guided reuse of current schemas, hydration, source-report predicate and compiler, without a new framework, queue or dependency in this unit.

The new production files are the server adapter and CLI-generated SQL migration; tests extend the existing canonical import/approval/clone fixture. See `2026-09-06-native-dwg-approved-resave-source/accepted-files.json` for exact reviewed file hashes.

## Actual verification

| Check | Result | Scope |
| --- | --- | --- |
| Controller Node regression | 139/139; zero fail/cancel/skip | New adapter + unchanged source-free source and selected compiler |
| New actual PostgreSQL proof | 1/1; zero fail/skip | Complete migration harness, import, original approval, template-clone approval, restore-clone approval, actor/evidence denials |
| Controller typecheck and diff check | Both exit 0; five code hashes stable | Current source checkout; no app build writes |
| Existing native CLI integration | 1/1, three geometry flows | Real five-type edits, generated original, actual DWG write/readback and source preservation; lower-level regression, not the new approved-source job path |
| Copied runtime builds | App and collaboration passed | Frozen pre-bridge baseline copy, fresh native publication |
| Copied real DB gates | M1 1/1; M2 1/1; M5 3/3 | M2/M5 each also skip one configuration sentinel; no failing test |
| Authenticated Chromium | 23/23, 3.5 minutes | Existing R2/R5 blank/template start, retry identity, save/reopen, native examples/symbols and Viewer denial |
| Independent reviews | Task review, one fix/re-review, final architecture review clean | No remaining Critical/Important/Minor findings |

The task reviewer found original IDs were initially normalized alongside clones. Six poisoned same-revision cases reproduced the issue before the fix. Originals now retain exact scope/IDs; only a genuinely different revision uses clone mapping. The evidence keeps the finding and correction.

The browser run is deliberately not claimed as coverage of the new source bridge: its frozen canonical fixture and migration match the pre-implementation baseline. The bridge has its own real PostgreSQL and server-adapter proof. Neither substitutes for the pending imported-DWG worker/Storage/browser end-to-end test.

## Runtime failure diagnosed and resolved

The first two copied-runtime attempts stopped before app tests at Supabase startup. Docker treated `/root/index.ts` as a directory when bound from this host's `/tmp` or `/private/tmp`. A no-network cached-image control proved a regular file under the Docker-shared `/Users` path worked. A byte-preserving copy there passed the unchanged full runner. No app/test, Docker global setting, dependency or image change was used to hide a failing assertion.

Runtime logs are not claimed pristine. Nine protected-state connection closures, a final-scenario awareness reauthorization `P3A01`, and one aborted editor `.data` request remain unclassified. The `P3A01` is not demonstrated to be an intentional role-revocation case or runner cleanup; its timing suggests browser teardown, but does not prove the cause. A share-revocation 404 is expected by its scenario. Passing scenario assertions and process exit status are the reported outcomes; the retained runtime report distinguishes these from unresolved server/client noise.

## Preservation

- Existing dirty worktree retained on `codex/universal-workspace-m1`, HEAD `9f5f56d93db325ff935772252f9d4fb64d69f98c`; index unchanged.
- Of 1,852 pre-edit regular files, only the owned empty migration and existing canonical test fixture changed before evidence updates. Three code/test files were added; unrelated files were unchanged and none were missing.
- Original synthetic DWG SHA remains `5c287281fafa07f76a0158d5374dd7577910c107dcb55817688acf9fd8656c71`.
- Owned PostgreSQL and Supabase/test services stopped; no owned fixture databases/containers or port listeners remain. Stopped owned data and copied snapshots are retained with evidence.
- Live preview still uses PID 80284 on port 4173; controller independently received HTTP 200 from the exact drawing-workspace preview URL. Its build directory was not rebuilt or replaced.

## Not complete yet

The new result remains `experimental-unqualified` and `persistenceAuthority: not-issued`. This unit has no production resave job, isolated native write protocol, artifact publication, user-facing request/cancel/download flow, same-approved-revision DWG/PDF/BOQ package, or independent recipient-CAD acceptance. Unknown/proxy/vertex-ID preservation and representative licensed-corpus qualification remain full R4 gates. Template content rights and actual three-user delivery acceptance remain R5 gates.

Continue from the [dependency map](2026-09-06-universal-workspace-continuation-map.md); do not restart the completed source-bridge task or repeat the completed earlier geometry-resave task.

## Rulings made

1. Continue local implementation under the standing instruction without repeated approval, retaining the uncommitted diff and evidence. If the choice is wrong, local rework is needed; remote state was not changed.
2. Build the approved-source bridge separately from source-free export, then implement the isolated resave job/protocol. This preserves the authority distinction; if wrong, the later adapter may need rework. It is not a reduction of the full DWG delivery goal.

Detailed reports, reviewed code snapshots, checks and native artifacts are in the sibling `2026-09-06-native-dwg-approved-resave-source/` folder, with a SHA-256 manifest.
