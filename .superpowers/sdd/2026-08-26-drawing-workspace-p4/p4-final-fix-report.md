# Drawing Workspace P4 final broad-review fix report

Date: 2026-08-27
Reviewed source: `91651890d084afc089976df9539ab0803df5234b`
Product fix: `cce27e7df7fd6f6393f7924ce08a54c7b99f0316`

## Implemented result

- **I1 — exact object-name authority parity.** `DrawingObjectNameSchema` and
  PostgreSQL now agree on nonempty, exact JavaScript `trim()` boundaries,
  255-or-fewer UTF-16 code units, Unicode scalar validity, NUL rejection, and
  the existing interior whitespace/control policy. A Supabase-CLI-created
  forward migration replaces only the private name helper, preflights existing
  rows, reinstalls the object check constraint through that helper, and revokes
  helper execution from API roles. No committed migration was edited and no new
  public RPC was added.
- **I2 — distinct property applicability.** The TypeScript property schema now
  rejects duplicate `appliesTo` values exactly as PostgreSQL does, while the
  complete existing primitive/P4/block-instance target set remains valid.
- **I3 — dependency-aware render order.** The shared live/export adapter now
  performs a stable host dependency ordering across all same-canvas layers.
  Every hosted opening follows its wall regardless of authored layer or UUID,
  unrelated items retain their relative order, and an opening inherits a
  hidden host wall's invisibility. Live canvas, SVG, PNG, and PDF all continue
  to consume this one adapter.
- **M1 — bounded semantic labels.** One deterministic, font-independent layout
  computes bounded lines, hard token splits, an ellipsis, height, and rotation.
  Konva and SVG/Canvas-backed PNG/PDF consume those exact lines and clipping
  bounds. SVG keeps the unabridged semantic label in `aria-label`; the live
  canvas continues to expose the unabridged object name through its screen
  reader object list.
- No dependency, lockfile, state manager, CRDT protocol, public API, or P5 file
  changed.

## TDD and parity evidence

- The initial focused red run had six intended failures: cross-layer host
  ordering, hidden-host visibility, missing bounded label lines, NUL/unpaired
  Unicode name parity, and two duplicate-`appliesTo` mutations. The migration
  contract separately failed because no final forward migration existed.
- The shared deterministic name corpus covers BMP and non-BMP UTF-16
  boundaries, 32 randomized mixed Unicode/interior-whitespace/control names,
  every ECMAScript trim code point at both boundaries and alone, NUL, lone
  surrogates, and the non-trim U+180E case.
- PGlite executes the complete P0-through-P4 migration chain and proves exact
  Zod/private-helper parity, authenticated RPC acceptance/rejection, atomic
  rejection with no object/operation residue, and strict loader reload of every
  accepted row. The populated P0-P3 upgrade remains byte/data stable.
- The shared property corpus proves valid compatibility and duplicate
  rejection in Zod, the SQL helper, and the authenticated mutation RPC with no
  property/operation residue.
- Sixty-four randomized layer/UUID adapter graphs and 32 randomized export
  graphs prove cross-layer host precedence and stable unrelated ordering. The
  real browser export test asserts the opening cut pixels in SVG, PNG, and PDF
  when the opening is authored below its wall.
- The long-label regression asserts the exact three-line layout and height,
  clipping, SVG full-label accessibility, and identical Canvas/PNG/PDF
  `fillText` line sequences. Chromium also verifies the updated accessible SVG
  grid-label structure.

## Fresh local verification

- Focused product/database/server run: **232/232 passed**.
- Database/server broad run: **200/200 passed**.
- Serial Drawing Workspace suite: **640 passed, 0 failed, 1 skipped**. The skip
  is explicitly `UNEXECUTED: disposable PostgreSQL concurrency fixture is not
  configured`.
- Whole Node suite: exit `0`.
- Collaboration service: **33/33 passed**. Explicit
  IFC/PDF/quantity/approval/Revit regressions: **99/99 passed**. License
  closure: **7/7 passed**.
- Application and collaboration typechecks and builds: exit `0`.
- Chromium functional/IndexedDB: **9/9 passed**. Production-build 10,000-object
  benchmark: **1/1 passed**. The exact local release orchestrator ended with
  **`P4 LOCAL PASS`**.
- Application high-severity audit exited `0` with the established three
  moderate `ajv` findings and no available fix; collaboration audit reported
  zero vulnerabilities. `git diff --check` passed.
- One intentionally parallel preliminary drawing run exceeded the existing
  250 ms 1,000-item timing budget at 256.9 ms while competing with the whole
  suite and both builds. It passed at 103.9 ms alone and 224.9 ms in the fresh
  serial full suite; the exact serial release runner also passed it at 195.8
  ms. No product or threshold change was made for that contention-only result.

## Honest status separation

- **LOCAL IMPLEMENTATION: PASS.** I1-I3 and M1 are closed by product changes,
  mutation-resistant focused tests, strict database/runtime reload coverage,
  browser pixels, and the exact local release contract.
- **REAL POSTGRESQL: UNEXECUTED.** No
  `P3_POSTGRES_CONCURRENCY_DATABASE_URL`, actor/project fixture, or local
  PostgreSQL/Docker/Podman executable was available. PGlite coverage is not
  relabelled as real PostgreSQL evidence.
- **PRODUCTION: UNEXECUTED.** The credential-free production command exited
  `1` before Playwright with `P4 production gate is UNEXECUTED` and listed the
  required hosted authorities. Hosted provider convergence, provider p95,
  production RLS/freeze/source checks, cleanup, deployment, and rollback are
  not claimed.
- **PERFORMANCE TARGET: NOT MET, unchanged in meaning.** Fresh source-bound
  local evidence records first usable at `5696.099999964237 ms` versus the
  `2500 ms` target (`firstUsableTargetMet: false`). P7 60 fps and production
  provider p95 remain `UNEXECUTED`.

The branch and worktree are intentionally preserved for the parent integration
workflow.
