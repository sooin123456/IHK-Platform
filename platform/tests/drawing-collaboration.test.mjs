import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canAssignDrawingIssue,
  canTransitionDrawingIssue,
  validatePdfRegion,
} from "../app/lukas/lib/drawing-collaboration-policy.ts";

test("only review roles can assign a drawing issue", () => {
  for (const role of ["owner", "staff", "reviewer"])
    assert.equal(canAssignDrawingIssue(role), true);
  for (const role of ["estimator", "site", "procurement", "viewer"])
    assert.equal(canAssignDrawingIssue(role), false);
});

test("only reviewers can close or reopen a drawing issue", () => {
  for (const role of ["owner", "staff", "reviewer"])
    assert.equal(
      canTransitionDrawingIssue(role, "resolution_requested", "closed"),
      true,
    );
  for (const role of ["estimator", "site", "procurement", "viewer"])
    assert.equal(
      canTransitionDrawingIssue(role, "resolution_requested", "closed"),
      false,
    );
  assert.equal(canTransitionDrawingIssue("reviewer", "closed", "open"), true);
  assert.equal(canTransitionDrawingIssue("site", "closed", "open"), false);
});

test("workers can request review but viewers cannot change status", () => {
  for (const role of ["owner", "staff", "reviewer", "estimator", "site", "procurement"])
    assert.equal(
      canTransitionDrawingIssue(role, "in_progress", "resolution_requested"),
      true,
    );
  for (const status of ["open", "in_progress", "resolution_requested", "closed"])
    assert.equal(canTransitionDrawingIssue("viewer", status, status), true);
  assert.equal(canTransitionDrawingIssue("viewer", "open", "in_progress"), false);
});

test("PDF anchors stay inside one page in normalized coordinates", () => {
  assert.equal(
    validatePdfRegion({ pageNumber: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.4 }),
    true,
  );
  assert.equal(
    validatePdfRegion({ pageNumber: 0, x: 0.1, y: 0.2, width: 0.3, height: 0.4 }),
    false,
  );
  assert.equal(
    validatePdfRegion({ pageNumber: 1, x: 0.8, y: 0.2, width: 0.3, height: 0.4 }),
    false,
  );
  assert.equal(
    validatePdfRegion({ pageNumber: 1, x: 0.1, y: 0.8, width: 0.3, height: 0.4 }),
    false,
  );
});
