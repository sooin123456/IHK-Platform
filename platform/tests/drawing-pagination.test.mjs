import assert from "node:assert/strict";
import test from "node:test";

import {
  drawingIssuePageHref,
  drawingIssuePageInfo,
  drawingIssueRange,
  mergeFocusedIssue,
  mergeFocusedIssues,
  reconcileDrawingIssueSelection,
  parseDrawingIssueId,
  parseDrawingIssuePage,
} from "../app/lukas/lib/drawing-pagination.ts";
import * as drawingPagination from "../app/lukas/lib/drawing-pagination.ts";

test("drawing issue pages use stable 50-row database ranges", () => {
  assert.equal(parseDrawingIssuePage(null), 1);
  assert.equal(parseDrawingIssuePage("0"), 1);
  assert.equal(parseDrawingIssuePage("2.5"), 1);
  assert.equal(parseDrawingIssuePage("999999999999"), 1);
  assert.equal(parseDrawingIssuePage("3"), 3);
  assert.deepEqual(drawingIssueRange(3), { from: 100, to: 149 });
  assert.deepEqual(drawingIssuePageInfo(3, 121), {
    page: 3,
    pageSize: 50,
    totalCount: 121,
    totalPages: 3,
  });
  assert.deepEqual(drawingIssuePageInfo(9, 2), {
    page: 1,
    pageSize: 50,
    totalCount: 2,
    totalPages: 1,
  });
});

test("drawing issue deep links accept only canonical UUIDs", () => {
  assert.equal(
    parseDrawingIssueId("123e4567-e89b-42d3-a456-426614174000"),
    "123e4567-e89b-42d3-a456-426614174000",
  );
  assert.equal(parseDrawingIssueId("not-a-uuid"), null);
  assert.equal(parseDrawingIssueId(null), null);
});

test("page links preserve an active IFC and issue deep link", () => {
  assert.equal(
    drawingIssuePageHref(
      "?globalId=3%23abc&issue=123e4567-e89b-42d3-a456-426614174000&page=1",
      2,
    ),
    "?globalId=3%23abc&issue=123e4567-e89b-42d3-a456-426614174000&page=2",
  );
});

test("a directly opened old issue remains available outside the current page", () => {
  const page = [{ id: "new-1" }, { id: "new-2" }];
  const focused = { id: "old-99" };
  assert.deepEqual(mergeFocusedIssue(page, focused), [focused, ...page]);
  assert.equal(mergeFocusedIssue(page, page[1]), page);
  assert.equal(mergeFocusedIssue(page, null), page);
});

test("revision review keeps every off-page issue once and preserves candidate order", () => {
  const page = [{ id: "new-1" }, { id: "shared" }];
  const focused = [
    { id: "old-2" },
    { id: "shared" },
    { id: "old-1" },
    { id: "old-2" },
  ];

  assert.deepEqual(mergeFocusedIssues(page, focused), [
    { id: "old-2" },
    { id: "old-1" },
    ...page,
  ]);
  assert.equal(mergeFocusedIssues(page, []), page);
});

test("revision review pagination keeps the in-progress relink candidate visible", () => {
  const active = { previousAnchorId: "anchor-old", issueId: "issue-old" };
  const page = [
    { previousAnchorId: "anchor-new-1", issueId: "issue-new-1" },
    { previousAnchorId: "anchor-new-2", issueId: "issue-new-2" },
  ];

  assert.equal(typeof drawingPagination.mergeFocusedRevisionReview, "function");
  assert.deepEqual(drawingPagination.mergeFocusedRevisionReview(page, active), [
    active,
    ...page,
  ]);
  assert.equal(
    drawingPagination.mergeFocusedRevisionReview(page, page[1]),
    page,
  );
  assert.equal(drawingPagination.mergeFocusedRevisionReview(page, null), page);
});

test("URL issue changes win once without undoing a later manual selection", () => {
  const issues = [{ id: "a" }, { id: "b" }];
  assert.equal(reconcileDrawingIssueSelection(issues, "a", "b", "a"), "b");
  assert.equal(reconcileDrawingIssueSelection(issues, "a", "b", "b"), "a");
  assert.equal(
    reconcileDrawingIssueSelection([{ id: "c" }], "a", null, null),
    "c",
  );
});

test("canonical workspace selection keeps a valid manual issue and otherwise falls back to the first current issue", () => {
  const issues = [{ id: "a" }, { id: "b" }];
  assert.equal(reconcileDrawingIssueSelection(issues, "b", null, null), "b");
  assert.equal(
    reconcileDrawingIssueSelection(issues, "missing", null, null),
    "a",
  );
  assert.equal(reconcileDrawingIssueSelection([], "b", null, null), null);
});
