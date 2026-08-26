# P4 Task 7 official-review fix report

Source implementation commit: `6d32d9decb101d6881329536110e7c0ae534f773`

## Result

- The local functional gate now runs through a dedicated launcher/config pair
  on fixed loopback port 4173, refuses an occupied port and existing server,
  strips inherited target/port values, and injects only local placeholder
  Supabase/Vite authority. A real listening-socket mutation proves fail-closed
  behavior.
- The runner uses an exact, ordered structured-argv manifest. Removing,
  reordering, relabelling, or replacing any gate fails its contract; execution
  is shell-free, fail-fast, and logs the correct `LOCAL` or `PRODUCTION` phase.
- Production invokes the exact P3 authority guard before Playwright, including
  every required authority and distinct internal/freeze secrets. Missing,
  placeholder, loopback, or equal-secret mutations fail nonzero.
- Hosted P4 evidence must be a confirmed current server result with exact
  revision/checkpoint/object/version/fingerprint lineage, exact
  `P4_MEASUREMENT_V1` values, and Room/Door/Finish tables labelled
  `서버 증거`. Null, stale, wrong-version, wrong-checkpoint, and derivation-error
  mutations fail.
- The production-build Chromium test writes the generated, source-bound
  `task-7-performance.json`. The runner validates the exact SHA, browser,
  hardware, viewport, 10,000-object mix, conditions, sample counts, targets,
  and computed decisions instead of trusting prose or reporter annotations.
- The mounted browser vertical authors two distinct openings, changes one to a
  window, deletes the host/door/window atomically, reloads the deletion, and
  restores all exact IDs through recorded undo. This exposed and fixed a Yjs
  replay bug: history restores must compare deleted objects against their latest
  realized tombstone versions, not only live entity versions.
- Repeated Chromium runs also made the same-ID two-realm IndexedDB recovery
  idempotent after one realm wins the race, and made the rapid opening move use
  an identity-bound mounted selection control rather than overlap-sensitive
  coordinates.

No dependency, lockfile, migration, RPC, new semantic store, or production
state changed.

## Fresh verification

- `env -i PATH="$PATH" npm run release:drawing-workspace-p4:local`:
  **exit 0, `P4 LOCAL PASS`** at the source commit above.
- Exact release/mutation contract plus durable Yjs replay focused run: **36/36
  passed**.
- Functional P4/IndexedDB Chromium: **9/9 passed**.
- Production-build performance Chromium: **1/1 passed**, followed by generated
  evidence validation.
- Both typechecks, both builds, IFC smoke, explicit
  IFC/PDF/quantity/approval/Revit regressions, license closure, application and
  collaboration audits, and `git diff --check`: **passed**. The application
  audit retains three known moderate `ajv` findings with no available fix; the
  high-severity gate exits 0.
- Flake-resistance probes: same-ID two-realm recovery **5/5 passed** and rapid
  hosted-wall/opening burst **5/5 passed**.
- `env -i PATH="$PATH" npm run release:drawing-workspace-p4:production` from
  `platform`: **exit 1 before Playwright**, `P4 production gate is UNEXECUTED`.

## Honest status

The generated JSON records the local production-build first-usable decision as
`firstUsableTargetMet: false` for the exact `2500 ms` target. It records the P7
60 fps gate and production-provider p95 as `UNEXECUTED`. Hosted provider
convergence, real provider-backed offline/reconnect loss, organization/RLS,
freeze/approved immutability, deployed source re-read, cleanup, deploy and
rollback remain **PRODUCTION UNEXECUTED**; none is inferred from local evidence.
