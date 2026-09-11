import assert from "node:assert/strict";
import test from "node:test";

import * as drawingCollaborationPolicy from "../app/lukas/lib/drawing-collaboration-policy.ts";

test("revision relink uses one shared role boundary for the legacy UI and action", () => {
  assert.equal(
    typeof drawingCollaborationPolicy.canRelinkDrawingRevision,
    "function",
  );
  for (const role of [
    "owner",
    "staff",
    "reviewer",
    "estimator",
    "site",
    "procurement",
  ])
    assert.equal(
      drawingCollaborationPolicy.canRelinkDrawingRevision(role),
      true,
    );
  for (const role of ["approver", "viewer", "unknown"])
    assert.equal(
      drawingCollaborationPolicy.canRelinkDrawingRevision(role),
      false,
    );
});
