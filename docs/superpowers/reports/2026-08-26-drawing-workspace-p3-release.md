# Drawing Workspace P3 release evidence — 2026-08-26

This record is evidence-scoped. It does not promote, deploy, migrate, create a
hosted user, or claim an unobserved result. The exact evidence baseline at the
start of Task 11 is commit
`573345de91059294f33dc472cc04025d4b827515` (`573345d`).

The P3 additive migration range present in that commit is
`20260825192113_drawing_workspace_p3_collaboration_state.sql` through
`20260826073708_drawing_workspace_p3_preload_store_fence.sql`. A real release
must attach the complete linked migration list; this filename range is local
source evidence only.

## IMPLEMENTED

- Tasks 1–10 provide Realtime invalidation, the bounded append-only collaboration
  protocol, private exact-byte Yjs storage, the Node 22 Hocuspocus service,
  y-indexeddb recovery, durable outbox/Yjs/Postgres repair, Awareness participants,
  cursor/selection overlays and soft locks, comments/mentions/history/restore,
  cross-instance leased atomic review freeze, and the fail-closed production P3
  fixture.
- `platform/DEPLOYMENT.md` now gives an executable backup→JWKS→database
  login→migration/types→image→service smoke→application preview→production
  fixture→promotion order plus forward-safe rollback and frozen/in-flight/rejected
  review recovery.
- The release status contract prevents local evidence from being presented as
  hosted proof and rejects missing ordering, security queries, rollback
  invariants, evidence categories, or invented external results.
- Production admission remains guarded by
  `npm run test:e2e:drawing-workspace-p3:production`; every required authority is
  validated before Playwright starts.

## LOCAL PASS

Fresh Task 11 verification from the source baseline and documentation diff:

| Gate | Result |
| --- | --- |
| P3 release documentation contract | PASS, 3 tests |
| Whole Node `node --test tests/*.test.mjs` | 735 total; 734 passed, 0 failed, 1 environment-only PostgreSQL gate `UNEXECUTED` |
| Drawing Workspace `npm run test:drawing-workspace` | 503 total; 502 passed, 0 failed, the same 1 environment-only gate `UNEXECUTED` |
| Collaboration service tests | PASS, 32 tests |
| IFC pinned geometry smoke | PASS: 413,681 bytes, 120 elements, 115 geometric elements, 119 placements, 14,694 triangles |
| Application TypeScript | PASS |
| Collaboration TypeScript | PASS |
| Application production build | PASS |
| Collaboration build | PASS |
| Fresh local Chromium shell | PASS, 10 tests |
| Collaboration dependency/license closure | PASS; exact pinned permissive closure and minimal runtime manifest contract |
| `npm audit --omit=dev` | completed; 3 moderate findings in pre-existing `@vercel/react-router`→`@vercel/static-config`→`ajv`, no available fix, 0 high/critical |
| Collaboration `npm audit --omit=dev` | PASS, 0 vulnerabilities |
| `git diff --check` | PASS |

Warnings observed by the application build are the existing chunk-size, React
Router future-flag, unsigned theme-cookie, and Node localStorage warnings. They
are not recast as failures or hidden as hosted evidence.

Locally available artifact SHA-256 evidence at the Task 11 baseline:

| Artifact | SHA-256 |
| --- | --- |
| `platform/collaboration/Dockerfile` | `2378617cca2ac96af719258265a9dc68b2de6d2d4dd17667f2dbf84ae35013bb` |
| `platform/collaboration/package-lock.json` | `3f166266d8ca3a67308b34c9789c471cdbe9c53a7515406622dfd7dc35b00516` |
| `platform/package-lock.json` | `a262c8f4a3155ba37adc987598025bf6e388e4b736dca25f7be44d783b38621e` |
| built collaboration `dist/collaboration/src/server.js` | `b6003db0a09068103ce06764214f45425662cce4152d845107a1a1fe4b7f8fa5` |
| built application `build/server/index.js` | `7263236de2122b3cf6fe8e2d6206da9b111ec06fc2c2f0bd5bf7a2197887a54f` |

These are local source artifacts, not pushed OCI digests or deployed assets.

## LOCAL ENV UNEXECUTED

- Docker CLI is not installed, so the OCI image build, `docker image inspect`,
  runtime container healthcheck, image push, and image digest verification are
  `UNEXECUTED`.
- No linked Supabase project authority is present. Managed backup creation,
  schema/migration snapshot against the target, `supabase db diff`, migration
  apply, hosted type generation, publication/private-role/grant/lease/freeze SQL,
  and the disposable two-connection PostgreSQL concurrency gate are
  `UNEXECUTED`.
- No asymmetric target JWKS or collaboration runtime secret is available, so
  hosted RS256/ES256 preflight, signing-key rotation, JWKS cache purge, database
  LOGIN/`SET ROLE`, and running service health/auth/storage/freeze smoke are
  `UNEXECUTED`. An empty or HS256-only JWKS remains fail-closed.
- No deployment host/image registry is configured. Collaboration build/push,
  one-replica rollout, lease takeover across deployed replicas, application
  preview, promotion, graceful drain, and rollback rehearsal are `UNEXECUTED`.

## PRODUCTION UNEXECUTED

All production fixture authorities were absent in this environment. Therefore
the credentialed five-role fixture, real Hocuspocus WebSocket traffic, hosted
RLS/private-role checks, actual source re-downloads, quantity artifact workflow,
cleanup, and two-user field check were not started.

- owner/editor/reviewer/viewer/nonmember results: `UNEXECUTED`
- two-user deployed workflow: `UNEXECUTED`
- three simultaneous browser contexts: `UNEXECUTED`
- exact 100-operation offline recovery against hosted Postgres/Yjs: `UNEXECUTED`
- hosted freeze/approval/rejection/child-draft recovery: `UNEXECUTED`
- PDF/IFC before/after Storage hashes: `UNEXECUTED`
- deployment, image, backup, schema snapshot and migration IDs: `UNEXECUTED`
- production cleanup: `UNEXECUTED`
- rollback rehearsal: `UNEXECUTED`

No production identifier, p95 value, source hash, role result, user, project,
storage object, or rollback outcome was simulated.

## MEASURED

- production p95 warm collaboration reflection: `UNEXECUTED`; no value recorded
- production cold collaboration reflection: `UNEXECUTED`; no value recorded
- production offline operation loss: `UNEXECUTED`; no value recorded
- production first usable, CPU, memory and viewport/object-mix result:
  `UNEXECUTED`; no value recorded
- local IFC fixture: 413,681 bytes; 120 elements; 115 geometric elements;
  119 placements; 14,694 triangles
- local Chromium shell: 10 scenarios; this is functional local evidence, not a
  latency or 60 fps measurement

Disposition: local implementation may be considered only after Task 11's
official review and the final broad P3 review. Operational/production completion
requires real migration, service, application, two-user, p95, source, cleanup and
rollback evidence; none is inferred from LOCAL PASS.
