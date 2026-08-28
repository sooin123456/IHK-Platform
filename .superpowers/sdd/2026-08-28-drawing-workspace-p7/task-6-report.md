# P7 Task 6 — Organization administration and entitlements

## Status

- Implementation commit: `42501a93d049d89f69e70bc6554da94a057003db`.
- Review hardening commit: `a9c7f78e0124410e2605791c24c653633a937305`.
- Final review-fix commit: `519cff0791e2efa1eb604cc6fc173dad8d23c513`.
- Source/build-bound performance refresh: `6612e72` (capture is bound to `519cff0`).
- Focused database, route, typecheck, production build, collaboration build, and complete Drawing Workspace regressions: **PASS**.
- Real PostgreSQL RLS/ACL/trigger counterexamples: **UNEXECUTED** (`DRAWING_P7_REAL_DATABASE_URL` unavailable).
- Required real-PostgreSQL mode exits nonzero instead of producing a synthetic pass.
- Hosted organization authority and production role sessions: **UNEXECUTED** because no authorized hosted database/session authority was supplied.
- Payment and checkout are deliberately absent.

## Delivered vertical slice

- One forward migration, `20260828073233_drawing_workspace_organization_administration.sql`; it reuses the existing organization, organization-membership, project, project-membership, company-library, drawing-capability, collaboration, retention, and export authorities.
- Exact, expiring organization invitations with accept, revoke, and same-request retry semantics. Expired invitations can be replaced under an organization/email advisory lock, and acceptance rechecks the signed-in user's exact normalized email and seat capacity.
- Invitation responses never disclose the internally resolved auth-user UUID. Registered and unregistered recipients use the same Resend delivery path and public response shape; missing delivery authority fails closed instead of returning a false success.
- Organization member role and library-access administration through RPC-only boundaries. Direct organization-role mutation is rejected, role changes append an immutable administration event, and removal is denied while the member owns or belongs to a project.
- Exact project-member lookup/add/update/remove and audited organization move. The old `auth.admin.listUsers` full-user scans are removed; routes accept exact email or stable UUID identity and return bounded 100-row keyset pages.
- Invitation, project, and managed-destination lists use independent deterministic UUID keysets and expose UI continuation beyond 100 rows. Every continuation preserves all four cursors, so a project after row 100 can still select a destination after row 100. Project moves conservatively reject approved drawing revisions, revision approvals, issue approvals, BOQ evidence, and any quantity, BOQ, material-plan, transaction, or drawing lineage, and stale retries after a later move cannot disclose the project's current organization.
- Organization plan versions covering plan name, seats, trial expiry, project/library quotas, and five explicit feature entitlements: Drawing Workspace, organization library, realtime collaboration, IFC workspace, and quantity lineage. Every version is append-only, idempotent by stable request identity, and records an immutable entitlement-change event.
- Seat and quota enforcement is serialized at the database boundary. Project creation, organization-library publication, Drawing Workspace capability, collaboration authorization/load/store/bootstrap, IFC loader, and quantity-lineage loader/action revalidate the exact project organization and feature entitlement. Hidden UI is never the authority.
- Known-ID company-library imports recheck both the project feature and the actor's exact library access inside the database. Price books/resources, material plans/transactions/carbon factors, BOQ tables, drawing lineage tables, and all public/private lineage RPCs are fenced by `quantity_lineage`; verified BOQ and material routes perform the same server revalidation.
- Unauthenticated invitation links carry one validated internal acceptance path through `/login`, the magic-link request, and confirmation. External, protocol-relative, backslash, and relative redirect targets are rejected.
- Organization settings UI for invitations, roles, library access, plan/trial/quota/feature versions, organization projects, membership, and project moves, plus exact invitation acceptance and dashboard navigation.
- Cross-organization invitation, feature, project, move, and library counterexamples; role escalation, direct role update, direct project move, quota overflow, expired invitation replacement, and immutable audit counterexamples.
- Task 5 archive/retention/hold/export/restore boundaries and all prior immutable drawing, approval, BOQ/material, source-hash, collaboration, and library invariants remain intact.

The implementation adds no dependency, state manager, collaboration server, queue, payment provider, checkout surface, or duplicate business schema.

## Strict TDD evidence

### RED

- Database contract: required invitation, entitlement-version, administration-event, exact role/project-move, seat/quota, and feature-gate authorities did not exist.
- Route contract: organization administration and invitation-acceptance routes did not exist; project membership performed administrative full-user scans.
- Executable counterexamples initially failed for cross-organization access, seat overflow, expired invitation replacement, direct privilege mutation, audited project move, and disabled Drawing Workspace/realtime capability.
- Pagination review added a failing route contract before replacing administrative loops with bounded keyset pages.

### GREEN

```text
node --test \
  tests/drawing-workspace-p7-organization-admin-database.test.mjs \
  tests/drawing-workspace-p7-organization-admin-route.test.mjs
tests 20; pass 19; fail 0; skipped 1 real PostgreSQL
```

Together with `tests/auth-link-flow.test.mjs`, the final focused gate is `25 total; 24 pass; 0 fail; 1 real PostgreSQL skip`.

PGlite executes exact invitation replacement/accept/retry, non-enumerating response shape, seat locking and overflow denial, append-only role/entitlement audit, direct privilege and project-move rejection, chained-move stale-retry denial, every approved/quantity/BOQ/material/issue-approval move blocker, cross-organization denial, and disabled Drawing Workspace/realtime boundaries. Contract and real-PostgreSQL gates additionally cover direct material-plan, material-transaction, and carbon-factor reads/writes while quantity lineage is disabled. PGlite proves executable SQL and catalog behavior but does not substitute for PostgreSQL RLS role/JWT execution.

```text
DRAWING_P7_REQUIRE_REAL_POSTGRES=1 node --test \
  tests/drawing-workspace-p7-organization-admin-database.test.mjs
FAIL: DRAWING_P7_REAL_DATABASE_URL is required
```

This required-mode failure is intentional. No local emulator result is promoted into real PostgreSQL or hosted authority evidence.

## Performance evidence refreshed after Task 6

The Task 4 source-tree digest intentionally invalidated the prior capture after the final Task 6 fixes. The exact production-build Playwright runner rebuilt the application and executed all three browser gates against `519cff0` on isolated ports, leaving port 5173 untouched:

- exact Playwright gates: `3/3 PASS`;
- warm reopen first usable: `2262.4 ms — MET` (`<= 2500 ms`);
- cold/cache-miss baseline: `2851.5 ms — NOT MET`;
- warm p95: zoom `0.2 ms`, pan `0.2 ms`, selection `8.3 ms` — all `MET` (`<= 16.7 ms`);
- hosted production: `UNEXECUTED`.

The cold/cache-miss miss remains explicit in the committed evidence and is not folded into a false all-environments pass.

## Final verification

```text
npm run typecheck
PASS

npm run build
PASS (existing Vite chunk, cookie, and React Router future warnings only)

npm run typecheck:collaboration
PASS

npm run build:collaboration
PASS

node --test tests/drawing-workspace-p7-performance.test.mjs
tests 14; pass 14; fail 0

npm run test:drawing-workspace
tests 823; pass 817; fail 0; skipped 6

git diff --check
PASS
```

The complete regression includes P0–P7 migrations, exact measurement/hash oracles, immutable PDF/IFC sources, collaboration/Yjs, approvals, BOQ/material lineage, organization libraries, performance provenance, and Task 5 retention/restore/export boundaries.

## Honest remaining gates

- A disposable real PostgreSQL or authorized hosted Supabase database is still required to execute the owner/admin/member/outsider/service RLS, ACL, append-trigger, invitation, role-escalation, project-move, library, and disabled-feature counterexample matrix with real role and JWT session context. Required mode fails nonzero while that URL is absent.
- Hosted production sessions are still required to prove end-to-end owner/admin/member/outsider behavior against deployed routes and database policies.
- Payment and checkout are not a missing Task 6 gate; they are explicitly outside the P7 plan.
- The user-owned P4 progress/images and `.superpowers/audits/` remain unmodified by Task 6 commits.
