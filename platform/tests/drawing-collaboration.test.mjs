import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canAssignDrawingIssue,
  canTransitionDrawingIssue,
  validatePdfRegion,
} from "../app/lukas/lib/drawing-collaboration-policy.ts";
import {
  DrawingIssueCreateSchema,
  DrawingIssueUpdateSchema,
  DrawingAnchorSchema,
} from "../app/lukas/lib/drawing-collaboration.types.ts";
import { parseDrawingMutationForm } from "../app/lukas/lib/drawing-collaboration.server.ts";
import routes from "../app/routes.ts";

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

test("drawing issue input rejects blank titles and stale version values", () => {
  assert.equal(
    DrawingIssueCreateSchema.safeParse({
      title: " ",
      description: "",
      priority: "normal",
      assigneeUserId: null,
      dueAt: null,
    }).success,
    false,
  );
  assert.equal(
    DrawingIssueUpdateSchema.safeParse({
      issueId: "11111111-1111-4111-8111-111111111111",
      expectedVersion: 0,
      status: "in_progress",
    }).success,
    false,
  );
});

test("drawing anchors reject malformed IFC identity and overflow PDF regions", () => {
  assert.equal(
    DrawingAnchorSchema.safeParse({
      kind: "ifc_element",
      fileId: "11111111-1111-4111-8111-111111111111",
      elementId: "1001",
      ifcGlobalId: "short",
      camera: { position: [1, 2, 3], target: [0, 0, 0] },
    }).success,
    false,
  );
  assert.equal(
    DrawingAnchorSchema.safeParse({
      kind: "pdf_region",
      fileId: "11111111-1111-4111-8111-111111111111",
      pageNumber: 1,
      x: 0.9,
      y: 0.2,
      width: 0.2,
      height: 0.3,
    }).success,
    false,
  );
});

test("drawing mutation parser requires a positive optimistic-lock version", () => {
  const valid = new FormData();
  valid.set("intent", "set_status");
  valid.set("issue_id", "11111111-1111-4111-8111-111111111111");
  valid.set("expected_version", "2");
  valid.set("status", "closed");
  assert.deepEqual(parseDrawingMutationForm(valid), {
    intent: "set_status",
    issueId: "11111111-1111-4111-8111-111111111111",
    expectedVersion: 2,
    status: "closed",
  });

  valid.set("expected_version", "0");
  assert.throws(() => parseDrawingMutationForm(valid));
});

test("drawing mutation parser preserves issue and PDF anchor evidence", () => {
  const create = new FormData();
  create.set("intent", "create_issue");
  create.set("title", " 창호 치수 확인 ");
  create.set("description", "A-101과 모델 확인");
  create.set("priority", "high");
  create.set("assignee_user_id", "");
  create.set("due_at", "");
  assert.deepEqual(parseDrawingMutationForm(create), {
    intent: "create_issue",
    title: "창호 치수 확인",
    description: "A-101과 모델 확인",
    priority: "high",
    assigneeUserId: null,
    dueAt: null,
  });

  const anchor = new FormData();
  anchor.set("intent", "add_anchor");
  anchor.set("issue_id", "11111111-1111-4111-8111-111111111111");
  anchor.set(
    "anchor_json",
    JSON.stringify({
      kind: "pdf_region",
      fileId: "22222222-2222-4222-8222-222222222222",
      pageNumber: 2,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
      label: "창호 상세",
    }),
  );
  assert.deepEqual(parseDrawingMutationForm(anchor), {
    intent: "add_anchor",
    issueId: "11111111-1111-4111-8111-111111111111",
    anchor: {
      kind: "pdf_region",
      fileId: "22222222-2222-4222-8222-222222222222",
      pageNumber: 2,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
      label: "창호 상세",
    },
  });
});

test("drawing mutation parser covers comments, assignment, due date, priority, and deactivation", () => {
  const issueId = "11111111-1111-4111-8111-111111111111";
  const actorId = "22222222-2222-4222-8222-222222222222";
  const anchorId = "33333333-3333-4333-8333-333333333333";
  const cases = [
    {
      fields: { intent: "comment", issue_id: issueId, body: "현장 확인 완료" },
      expected: { intent: "comment", issueId, body: "현장 확인 완료" },
    },
    {
      fields: { intent: "set_assignee", issue_id: issueId, expected_version: "3", assignee_user_id: actorId },
      expected: { intent: "set_assignee", issueId, expectedVersion: 3, assigneeUserId: actorId },
    },
    {
      fields: { intent: "set_due", issue_id: issueId, expected_version: "4", due_at: "2026-08-31T09:00:00+09:00" },
      expected: { intent: "set_due", issueId, expectedVersion: 4, dueAt: "2026-08-31T09:00:00+09:00" },
    },
    {
      fields: { intent: "set_priority", issue_id: issueId, expected_version: "5", priority: "urgent" },
      expected: { intent: "set_priority", issueId, expectedVersion: 5, priority: "urgent" },
    },
    {
      fields: { intent: "deactivate_anchor", anchor_id: anchorId, note: "잘못 지정한 영역" },
      expected: { intent: "deactivate_anchor", anchorId, note: "잘못 지정한 영역" },
    },
  ];
  for (const item of cases) {
    const form = new FormData();
    for (const [key, value] of Object.entries(item.fields)) form.set(key, value);
    assert.deepEqual(parseDrawingMutationForm(form), item.expected);
  }
});

test("React Router exposes the drawing library and collaboration room", () => {
  const registered = JSON.stringify(routes);
  assert.match(registered, /\/projects\/:projectId\/drawings/);
  assert.match(registered, /\/projects\/:projectId\/drawings\/:fileId/);
});
