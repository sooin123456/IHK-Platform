# P6 Task 3 independent review 1

Commit: `db37500ab32c12f995b1ccdb682d4439eef5c363`

Verdict: **BLOCKED** — Critical 0 / Important 2 / Minor 1

## Important

1. `platform/app/lukas/screens/drawing-workspace.tsx:90-96,115-125` — the loader passes the unvalidated `revision` query parameter into `loadDrawingWorkspace` before the UUID guard runs. `loadDrawingWorkspace` calls `Uuid.parse(revisionId)` at `platform/app/lukas/lib/drawing-workspace.server.ts:2094-2096`, so a malformed revision throws a Zod error before the intended bounded 400 response. Validate the P6 URL identities before loading, or catch/map this parse failure; add a loader-level malformed-revision regression.

2. `platform/app/lukas/screens/drawing-workspace.tsx:131-148` — the lineage loader verifies that the object is in the selected revision, but never binds the loaded document to the route's `fileId`. `loadDrawingWorkspace` deliberately allows an explicit same-project document independent of the route file (`platform/app/lukas/lib/drawing-workspace.server.ts:2060-2074`), while the corresponding action does run `assertDrawingQuantityWorkspaceScope`. A crafted `/drawings/<file-A>/workspace?document=<doc-B>&revision=<rev-B>&object=<object-B>` can therefore render lineage under the wrong original-file route, especially for documentless/source-resolved entries. Apply the same exact file/document/source resolution check in the loader before listing lineage and add a loader-level mismatch regression.

## Minor

1. `platform/tests/drawing-quantity-lineage-server.test.mjs:45-143` and `platform/app/lukas/lib/drawing-quantity-lineage.server.ts:459-583` — all focused creation tests inject the optional authority seam, so the production `DATABASE_URL` path (static role switch, server-derived JWT claims, authority SQL, private-function call, and connection cleanup) is not executed by Task 3 tests. Task 2 proves the private function independently, but not this application adapter. Add a real-Postgres integration or a narrow adapter test when an authority is available; keep the gate explicitly UNEXECUTED otherwise.

## Confirmed strengths

- The form parser is strict and rejects browser-supplied quantity, unit, version, fingerprint, price, amount, and SHA fields.
- `auth.getUser()` verifies actor identity and anonymous state; staff authority uses `app_metadata`, not user-editable metadata.
- The direct transaction reconstructs `auth.uid()`/`auth.jwt()` from the verified server actor, uses a static `SET LOCAL ROLE service_role`, parameterizes values, and closes the connection in `finally`.
- Approved/superseded revision, approval, schema-v2 snapshot SHA, canonical object identity, live source/issue evidence, deterministic measurement, and private locked revalidation are all present.
- RLS-backed reads are project/revision/object scoped; pagination is descending `(created_at,id)` and capped at 200; errors expose only fixed messages, request IDs, and safe entity IDs.
- Exact workspace resolution checks project/revision/object/BOQ version/BOQ line and does not guess a source file.
- Ponytail pass: no material speculative dependency or abstraction to remove; the test seam is justified. **Lean already. Ship after the two route-boundary fixes.**

## Verification run

```text
node --test tests/drawing-quantity-lineage-server.test.mjs tests/drawing-workspace-p6-route.test.mjs tests/drawing-workspace-server.test.mjs tests/drawing-workspace-p4-release.test.mjs tests/drawing-workspace-p5-server.test.mjs
=> 92 passed, 0 failed

npm run typecheck
=> exit 0

npx prettier --check <five Task 3 files>
=> all matched files

git diff --check db37500^ db37500
=> exit 0
```

Current Supabase guidance still treats `app_metadata` as server-controlled authorization data and warns against `user_metadata`; no relevant August 2026 Auth/RLS breaking change was found in the changelog scan.
