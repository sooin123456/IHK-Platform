# Drawing Workspace P4 final fix 5 report

Date: 2026-08-27
Rereviewed source: `7daed80`
Product fix: `9a2321d170606777dcdac92e4e97a8d55b910c81`

## Implemented result

- Canonical Awareness normalization now reports the exact soft-lock entity IDs
  removed by dependency-aware visibility. The workspace routes those IDs to
  the real `createDrawingSoftLockLease` instance, atomically releases/removes a
  matching lease, and clears its five-second renewal interval.
- Hosted openings inherit their host wall's visibility at this boundary. A
  host hide therefore removes the opening selection, publication state, real
  lease state, and renewal timer before reconnect or reauthorization can emit
  stale presence.
- Restoring the host does not restore the lease. Only a later explicit focus or
  drag gesture can create a fresh lease.
- Unrelated visible leases are not revoked and continue to renew normally.
  Remote peer locks remain independent and are never rewritten.
- Lease objects are now created lazily on actual acquisition rather than during
  connection setup. Null/capability-loss cleanup releases and removes the lease
  without creating an empty replacement.
- The real mounted path exposed an unbound Web Crypto method: storing
  `crypto.randomUUID` as a callback caused browser acquisition to abort before
  publication. The default now calls `crypto.randomUUID()` with its receiver.
- A visibility-set effect covers a lock whose selection is already absent, so
  host/layer hide or object deletion still reaches the canonical revocation
  boundary.
- No dependency, state manager, CRDT protocol, migration, database, public API,
  controller ledger, or P5 product file changed.

## TDD evidence

- The fake-clock real-lease test failed first with the hidden opening lease
  retained after a hide-before-reconnect transition. It now wires real lease
  objects through the canonical coordinator and proves:
  - initial publication of opening plus unrelated leases;
  - host hide before passive correction/reconnect and reauthorization;
  - opening lease removal with empty hidden publication;
  - unrelated selection/lease retention and renewal after advancing six
    seconds;
  - host restoration without opening-lock resurrection;
  - deletion/layer-hide cleanup when the visible set becomes empty; and
  - unchanged remote lock state.
- A second RED cycle required an atomic `releaseIfEntityHidden` operation; the
  wished-for method failed before implementation and now prevents an expired
  lease from evading timer/reference cleanup.
- The mounted host-hide test failed first because the real browser lease path
  could not acquire through the unbound UUID method. It now acquires and
  publishes a real hosted-opening lease, hides the host, restores it, waits
  beyond the five-second renewal interval, and observes no resurrection.
- A separate mounted capability downgrade acquires a real visible lease,
  switches to viewer authority, waits beyond renewal, and confirms the local
  lock remains absent while the remote lock remains present.
- Focused Node verification passed **79/79**; focused mounted Chromium passed
  **2/2**.

## Fresh verification

- Full Drawing Workspace suite: **646 passed, 0 failed, 1 skipped**. The sole
  skip is the explicit unconfigured disposable real-PostgreSQL fixture.
- Application and collaboration typechecks: exit `0`.
- Application and collaboration production builds: exit `0`, with only the
  established bundle-size, React Router future, and unsigned-theme-cookie
  warnings.
- Canonical local Chromium functional/IndexedDB gate: **11/11 passed**.
- Exact source-bound local release at `9a2321d`: **`P4 LOCAL PASS`**. It also
  passed collaboration **33/33**, IFC/PDF/quantity/approval/Revit regressions
  **100/100**, production-build performance execution **1/1**, and license
  closure **7/7**.
- Application audit retains three moderate transitive `ajv` findings with no
  available fix and no high-severity finding; collaboration audit reports zero
  vulnerabilities. `git diff --check` passed.

## Honest status separation

- **P4 LOCAL IMPLEMENTATION: PASS.** Canonical visibility loss now revokes the
  real renewable lease as well as its outgoing projection.
- **REAL POSTGRESQL: UNEXECUTED.** No disposable PostgreSQL authority is
  configured; PGlite evidence is not relabelled as real PostgreSQL.
- **PRODUCTION: UNEXECUTED.** Hosted provider convergence, production RLS and
  freeze/source checks, provider p95, cleanup, deployment, and rollback are not
  claimed.
- **PERFORMANCE TARGET: NOT MET.** Refreshed commit-bound local evidence records
  first usable at `5916.199999988079 ms` versus the `2500 ms` target. Warm
  local p95 is zoom `0.19999998807907104 ms`, pan
  `0.20000004768371582 ms`, and selection `77.30000001192093 ms`. P7 60 fps
  and production-provider p95 remain `UNEXECUTED`.

The branch and worktree remain available for the parent integration workflow.
