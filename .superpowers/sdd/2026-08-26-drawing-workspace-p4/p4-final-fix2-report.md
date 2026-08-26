# Drawing Workspace P4 final rereview fix report

Date: 2026-08-27
Rereviewed source: `5b2be5c`
Product fix: `fcdc492728716815b5624492cbd966623b812653`

## Implemented result

- **I1 — hermetic committed local release.** `platform/.env.example` is now a
  tracked, non-secret template with the exact public configuration keys and an
  empty value for every credential or project authority. The release source
  contract proves the file is tracked and mutation-tests its secret-free
  defaults. A fresh detached checkout at the product commit, with one ordinary
  `platform` install and no symlink or untracked developer file, completed the
  exact local release with `P4 LOCAL PASS`.
- **I2 — one dependency-aware visible semantic set.** The shared canonical
  visibility function now filters active-canvas objects by both their own layer
  and, for hosted openings, their host wall's layer. The mounted canvas uses
  that exact set for rendering, snapping, hit/selection eligibility, rendered
  counts, Awareness, and its screen-reader list. The render/export adapter uses
  the same function. Restoring the host layer restores the wall and openings
  without changing authored order.
- **I3 — global exact persisted-name authority.** The new Supabase-CLI-created
  forward migration
  `20260826232400_drawing_workspace_p4_final_name_authority.sql` preflights and
  constrains every persisted consumer of `ExactTrimmedName`: pages, canvases,
  layers, objects, styles, block definitions, block primitives, block
  instances, property schemas, enum options, tables, and table columns. Scalar
  and nested JSON names now share the TypeScript contract: nonempty exact
  ECMAScript trim boundaries, at most 255 JavaScript UTF-16 code units, valid
  Unicode scalars, NUL rejection, and the existing interior control policy.
  Legacy rows that were valid only under the old PostgreSQL rule abort the
  migration transaction before any helper or constraint is installed; after
  explicit deterministic repair, migration and strict reload succeed. The
  separate document `Title` contract remains intentionally unchanged at its
  existing 240-character authority.
- **M1 — one semantic accessibility label.** A shared label function includes
  the complete space number/name/type/finish fields and the corresponding
  semantic fields for walls, openings, areas, grids, and arcs. The live
  screen-reader list and SVG `aria-label` consume this exact unabridged label;
  visual labels continue to use the shared deterministic bounded layout.
- No dependency, lockfile, state manager, CRDT protocol, public RPC, prior
  migration, progress ledger, or P5 file was changed.

## TDD and parity evidence

- Tests were written red for the ignored template, hidden-host mounted seams,
  each persisted name consumer, legacy upgrade poison, and live/SVG semantic
  label mismatch before the corresponding product changes.
- The canonical visibility test covers 64 deterministic randomized layer,
  UUID, and authored-order graphs. It proves host inheritance, restoration,
  host-before-opening order, and stability of unrelated objects. Adapter render
  and hit candidates are empty for hidden-host openings.
- Chromium mounts an opening on a visible layer whose wall layer is hidden and
  proves zero visible semantic objects, zero Awareness semantic objects, no
  screen-reader opening, and no hidden hit selection. Restoring the host layer
  restores all three semantic objects and the full door accessibility label.
- Shared PGlite fixtures cover all twelve exact-name consumers with BMP,
  non-BMP, whitespace-boundary, control, NUL, lone-surrogate, and randomized
  valid/invalid inputs. Authenticated structure/object RPCs accept the valid
  corpus, reject every mutation atomically, and strict Zod reload accepts every
  committed row. Rejection leaves no operation or revision poison.
- The populated P0-through-P3 upgrade preserves valid data byte-for-byte. A
  trailing-NBSP legacy page fixture proves the new migration fails with the
  stable preflight error and rolls back completely; repaired data upgrades and
  reloads without poison. All prior committed migrations remain byte-unchanged.
- Exact fixtures for all six semantic object kinds prove live and SVG
  accessibility-label identity. Existing long-label line, clipping, SVG,
  Canvas/PNG/PDF, pixel, and dependency-order mutations remain green.

## Fresh verification

- Full PGlite database runtime: **133/133 passed**.
- Focused P4/block/export and visibility/name runs: **127/127** and **53/53
  passed**.
- Drawing Workspace suite in the exact release: **645 passed, 0 failed, 1
  skipped**. The sole skip is the explicit unconfigured disposable real
  PostgreSQL fixture.
- Whole Node suite and collaboration suite: exit `0`; collaboration was
  **33/33 passed**.
- Application and collaboration typechecks and production builds: exit `0`.
- Chromium functional/IndexedDB: **10/10 passed**, including the new mounted
  hidden-host test. Production-build 10,000-object benchmark: **1/1 passed**.
- License closure: **7/7 passed**. Application audit has the established three
  moderate transitive `ajv` findings with no available fix and no high-severity
  finding; collaboration audit has zero findings. `git diff --check` passed.
- The exact release was repeated from a detached checkout at `fcdc492` after a
  clean `git status`, using a single root `npm ci`; it ended with **`P4 LOCAL
  PASS`**. A deliberately separate collaboration install was not used because
  it creates a second Yjs module instance, which is not the repository install
  contract.

## Honest status separation

- **LOCAL IMPLEMENTATION: PASS.** I1-I3 and M1 are closed in product code,
  source-contract mutations, PGlite, strict reloads, mounted Chromium, and a
  hermetic detached-checkout exact release.
- **REAL POSTGRESQL: UNEXECUTED.** No disposable PostgreSQL connection/fixture
  was configured. PGlite evidence is not relabelled as real PostgreSQL.
- **PRODUCTION: UNEXECUTED.** Hosted provider convergence, production RLS and
  freeze/source checks, provider p95, cleanup, deployment, and rollback remain
  outside the credential-free local closure and are not claimed.
- **PERFORMANCE TARGET: NOT MET.** The refreshed source-bound local evidence
  records first usable at `5935.899999976158 ms` versus the `2500 ms` target.
  Warm local p95 is zoom `0.19999998807907104 ms`, pan
  `0.30000001192092896 ms`, and selection `78.39999997615814 ms`. P7 60 fps
  and production-provider p95 remain `UNEXECUTED`.

The branch and worktree remain available for the parent integration workflow.
