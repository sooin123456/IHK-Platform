# Isolated native DWG resave — implementation evidence

Status: **this local protocol unit is implemented, verified and reviewed; the full Universal Workspace goal remains active**. This is an experimental native processing unit, not a production delivery release. No commit, staging, push, deployment, paid service, dependency installation or remote database/Storage mutation is authorized or performed by this unit.

## Implemented boundary

- Exact bounded `resave-native-stdio` binary framing, strict v2 selected-edit requests and allowlisted source/request/output identity report.
- Original source preservation, complete supported-document no-edit comparison and post-edit readback. LINE, LWPOLYLINE, CIRCLE, ARC and TEXT reuse the existing compiler/native editor. Ordinary paper VIEWPORTs are passively inventoried and preserved rather than removed from the fixture.
- A fixed resaver profile shares the existing private Docker lifecycle. The resaver uses 2GiB memory/swap, while the reader remains 1GiB. No host fallback, arbitrary-command public API, host mount or new engine/dependency is added.
- Snapshot identity checks, bounded stream transport, exact actual image/container receipts, independent owned-container cleanup, cancellation/deadline handling and generic errors. These return bytes and verification only, never persistence authority.

Ponytail influenced reuse of the pinned ACadSharp 3.7.1 editor, reader, inventory/comparer, private sandbox lifecycle and finite test transport. It did not remove the remaining jobs, storage, UI, collaboration or delivery gates.

## Actual verification

| Check | Result | Evidence boundary |
| --- | --- | --- |
| Copied native build/self-tests | 0 warnings/errors; 41/41 | Real CLI, non-seekable framing, literal five-type edits, unchanged inventory, malformed/budget/generic-error cases |
| Existing native geometry integration | 1/1, three flows | Wrapped/full-turn/nonzero-full-turn ARC and existing full geometry/untouched comparisons |
| Additional framed CLI artifacts | Three actual success/readback flows | Exact frame/report/source/request/output hashes; no stderr |
| Current-image resaver integration | 3/3; no failures/skips | Existing app commands/compiler → actual isolated resave → actual isolated readback; literal geometry, hashes and untouched VIEWPORT/block inventory; native rejection/abort/deadline/foreign preservation |
| Existing actual reader isolation | 5/5; no failures/skips | Same new image; parallel reads, actual 1GiB confinement, inner deadline, invalid input and abort cleanup |
| Controller final reviewed-code regression | 186/186; no fail/cancel/skip | Seven regression files; host logic, unchanged reader, selected compiler and approved/source-free adapters; not 186 CAD/kernel proofs |
| Controller final actual integrations | Resaver3/3 + reader5/5; no fail/cancel/skip | Fresh invocation against the final formatted host code and same current native image |
| Controller typecheck and preservation | Exit0; all17 reviewed hashes stable before/after each check | No app build; HEAD/index unchanged, unrelated dirty files retained, live4173/PID80284 HTTP200 |
| Independent reviews | Task1, Task2 and final cross-task review accepted | No Critical/Important findings; one nonblocking legacy negative-test logging Minor retained for later test hygiene |

Actual new image: `sha256:c921c67ddb37d2a57969d04c7a4983f6d847e0b89901403e3b015ac25bf566ae`, uniquely owned tag `1hk-task2-resave-20260906-7ac831`. Built offline using pinned cached bases/restore layers; no pull or upgrade. The first invocation used an unsupported buildx `--progress` flag; the supported legacy build flags succeeded. This is a local command adjustment, not a production failure hidden by a dependency change.

Current-image resave artifact identities:

- Original generated DWG: SHA-256 `8d9ae187d7a046735149ce1dd2e362720bb0fb3c80b060c9d8ea31f0e697fcc1`, 10,987 bytes, `AC1024`.
- Exact compiled edit request: `b5bdbcdfba6754fa7ebdfd41cf2e829c220a6059cc4cac104278c44da48caeab`.
- Exact report: `7140063642e650bba2f7bd12197b31cb5aa480af3b9f99dfeba3494c14659643`.
- Resaved DWG: `0b4efe038e95b3fe8ee9e96f3d2f332e75bd7ae4265c4caa4ad340983cbf5616`, 11,019 bytes, `AC1024`.

The actual cgroup probe records memory 2,147,483,648 bytes, swap allowance 0 (Docker memory-swap equals memory), CPU quota/period 100000/100000, pids64, UID/GID65532, zero capabilities, NoNewPrivs1 and Seccomp2. Only loopback/no IPv4 routes, readonly root, writable bounded tmpfs and no host `/Users` visibility were observed. Finite transport doubles are separate host-logic evidence and are not substituted for this kernel/native proof.

The controller's fresh integration generated a separate synthetic source, SHA `bcc54d3c768444c9ade41a23e4ef2b9f5b5668d9972522ee4a4adbc98c670434`, and preserved that exact original. Its request/report/output hashes are respectively `b3ea896d4628e961e6c1219dfbd7ab8c6ff381973fd88178e2a3b305aea3c794`, `886f0f57248759d9502a1677d34701237a48cc42a1c685f2d18eef67b210ef65`, and `7af2c6b532127116dde6fbf245a88582eedebdf87be63082f0ca52f2232b9f25`. These are two generated fixture runs, not a claim that unrelated generation timestamps produce identical DWG bytes.

## Verification diagnostics and preservation

The controller's first recheck incorrectly applied a very long owned `TMPDIR` (needed only for retained real-reader evidence) to finite Unix-socket fixtures. That private runner produced 152 passes and 34 `listen EINVAL` setup failures before the tested Docker lifecycle. It was corrected to scope the environment to the real-reader command only. The unchanged reviewed application/tests then passed 186/186 and both actual integration suites; the failed transcript is retained, not overwritten or relabeled as a production RED. A separate private preservation checker initially assumed `lsof -Fp` omitted file-descriptor records; selecting the process records corrected that checker without changing the application or runtime.

Native legacy negative qualification tests intentionally print expected exception/path diagnostics. New resaver invalid-input tests separately assert fixed generic stderr and no success bytes. Docker's legacy-builder deprecation warning is also retained. These are not represented as pristine complete native/build logs or as leaks from the new public resaver API.

Preservation comparison covers all 1,914 nonignored baseline regular files: only owned code/design/evidence paths changed, none disappeared, and no unrelated file changed. Seventeen reviewed code/test/documentation files remained hash-stable during controller verification. The exact old reader image still exists. Current-image owned containers were absent after the tests; the new image and selected generated fixtures are retained. No image pruning or unrelated container/data deletion occurred. The live preview process remained PID80284/port4173 with HTTP200 and its app build was not rebuilt.

## Honest limitations and next work

The public report remains `experimental-unqualified`, `persistenceAuthority: not-issued`, `inventoryCoverage: supported-fields-only`, `independentCad: not-performed`. Synthetic same-engine readback is not independent CAD qualification or general appearance/plot/font/layout/XData/reference-payload preservation.

Still required: imported-resave request/status/cancel jobs; exact approved authority and immutable Storage artifacts; receipt-only authorized download; actual Auth/Storage/browser upload→edit→approve→resave→relogin/download; independent recipient CAD/corpus acceptance; and one exact-approved-revision DWG/PDF/BOQ handoff package. Existing source-free export contracts remain unchanged. See the [continuation map](2026-09-06-universal-workspace-continuation-map.md).

Separately, the [collaboration diagnosis](2026-09-06-collaboration-reconnect-diagnosis.md) now reproduces the honest-reconnect protected-state rejection using the actual production initializer/guard. This is a confirmed defect, not a completed fix. Do not weaken the guard. The bounded R2 audit also identifies two missing acceptance extensions: actual logout/full restoration and an independent expected-geometry oracle for offline/reconnect state on both clients. The prior 23/23 run is not promoted to full R2 completion.

## Rulings made

1. Continue safe local implementation without another approval ceremony and retain uncommitted work. If wrong, local code/protocol choices need rework; remote state is unchanged.
2. Preserve and passively inventory the ordinary default VIEWPORT instead of deleting it to make fixtures pass. If wrong, inventory field coverage needs rework; no broader editable-CAD or delivery qualification is asserted.

Detailed reports, exact accepted code hashes and selected synthetic/native/Docker evidence are in the sibling `2026-09-06-native-dwg-resave-protocol/` folder, with a SHA-256 manifest. No entire build cache, credentials or customer drawings are included. Final review's tracking observation was resolved by checking off the completed Task2 plan; its sole minor logging observation remains optional follow-up, not an unreported public API defect.

Package verification:154 artifacts,1,328,493 bytes; every copied artifact hash/length and all17 accepted current code hashes matched. Manifest SHA-256: `53737241cc5bf1653d42f783a4f2dc37124f6879fce6163f97c57d7d0d733f14`.
