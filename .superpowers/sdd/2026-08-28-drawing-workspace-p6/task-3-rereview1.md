# P6 Task 3 rereview 1

Fix commit: `ed20787929cdbfaf631c63032fc2110f0460eaa9`

Verdict: **READY** — Critical 0 / Important 0 / Minor 1

## Resolution of prior Important findings

1. Resolved. `parseDrawingQuantityLineageSearch` now parses and bounds `revision`, `object`, and orphan `quantityCursor` before `loadDrawingWorkspace` is called. The loader maps failures to a fixed HTTP 400 response, so malformed revision identity cannot reach `Uuid.parse` in the workspace loader first.

2. Resolved. Before lineage is read, the loader now calls `assertDrawingQuantityWorkspaceScope` to bind route file, loaded document revision, and object. A document with direct source identity must match `workspace.file.id`; a document without direct source identity must resolve one exact active object-source file, which is also compared to `workspace.file.id`. Mismatch paths return a fixed 404 and never call the lineage reader.

## Remaining Minor

1. The production `DATABASE_URL` adapter in `drawing-quantity-lineage.server.ts` is still not executed by Task 3's focused tests because creation tests inject the authority seam. Task 2 covers the private PostgreSQL function, and static inspection finds the adapter correctly parameterized and closed, so this is a non-blocking external integration evidence gap rather than a correctness finding.

## Verification

```text
Focused + P4/P5/server regressions: 94 passed, 0 failed
TypeScript typecheck: exit 0
Prettier check: pass
git diff --check ed20787^ ed20787: exit 0
```

No remaining route/file/document/revision/object/source bypass was found in the reviewed path.
