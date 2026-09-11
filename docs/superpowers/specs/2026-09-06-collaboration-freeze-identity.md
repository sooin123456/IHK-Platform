# Collaboration freeze reconciliation identity

## Approved objective and bounded deliverable

Continue the active R2/R4/R5 Universal Workspace goal under the user's standing implementation authorization. This unit removes needless protected Yjs identities created by repeated freeze reconciliation. It does not claim the overall reconnect defect or R2 is complete.

Diagnosis: `Y.Map.set` creates new CRDT structs even for an equal scalar. Four reconciliation paths unconditionally write `freezeState` and `freezeRequestId`; several others conditionally enter a transaction but rewrite both fields when only one changed. Clients persist these identities. Matching logical JSON alone is not sufficient proof of replay safety.

## Contract

1. Reconcile `serverMeta.freezeState` and `freezeRequestId` through a single shared scalar-aware helper in the existing server-only `freeze.ts` module. If both values match, no transaction, event, state-vector change, or encoded-state change occurs. If one differs, write only that field, once, under `DRAWING_COLLABORATION_SERVER_ORIGIN`.
2. Apply the helper to foreign lease fencing, local in-flight owner fencing, local owner frozen projection, committed non-draft freezing/frozen projection, active projection, and server preparation fencing. Do not rewrite actual begin/complete/release persistence workflows.
3. Preserve returned freeze state, request identity, lease/ownership decisions, manifest verification, authorizations, protected-map client validation, and database call ordering. Frozen client writes remain rejected. Approved matching snapshots stay byte-identical.
4. Test actual production coordinator/server branches, not just a helper mock. Repeated reconciliation after the first transition must preserve full encoded update, state vector, and zero update events; the first necessary transition and write denial must still work. Cover independent state-only and request-only changes.

## Global constraints

- Work only in `/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1`; preserve pre-existing dirty changes using exact pre-task snapshots.
- Do not stage, commit, merge, push, deploy, upgrade dependencies, or mutate remote data.
- Do not rebuild or restart the existing port 4173 preview; use no app build in this checkout.
- Reuse installed Yjs 13.6.32 and Hocuspocus 4.6.0; add no dependencies.
- Do not weaken protected-map validation, Viewer restrictions, revision approval, freeze leases, or original-source preservation.
- Run Node checks with `NODE_OPTIONS=--no-experimental-webstorage`.

## Explicit remaining root-cause work

Absent-state bootstrap still needs a trusted atomic insert-or-return canonical persistence API shared by browser, service, and outcome receipt loaders. Real state transitions performed during load also need durability before exposure; transient lease fences cannot be persisted by bypassing freeze guards. This unit only eliminates redundant writes and is independently safe to accept. Actual authenticated two-client offline/reload and login restoration proof remains required for R2. R4 native DWG delivery and R5 qualified packages remain active.
