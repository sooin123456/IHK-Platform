import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  addPreviewAnchor,
  addPreviewComment,
  createPreviewIssue,
  defaultPreviewRoomState,
  markPreviewNotificationRead,
  updatePreviewIssueAssignment,
  updatePreviewIssueSchedule,
  updatePreviewIssueStatus,
} from "../app/lukas/lib/workspace-preview-state.ts";

test("local drawing review state supports issues, comments, status, and evidence", () => {
  const initial = defaultPreviewRoomState();
  const withIssue = createPreviewIssue(initial, {
    title: "창호 치수 확인",
    description: "평면도와 IFC 치수를 비교합니다.",
    assigneeId: "preview-user-site",
  });
  const issue = withIssue.issues.at(-1);
  assert.ok(issue);
  assert.equal(issue.status, "open");
  assert.equal(
    withIssue.notifications.at(-1)?.recipientId,
    "preview-user-site",
  );

  const withComment = addPreviewComment(
    withIssue,
    issue.id,
    "설계자 확인 요청",
  );
  assert.equal(withComment.comments.at(-1)?.body, "설계자 확인 요청");

  const withAnchor = addPreviewAnchor(withComment, issue.id, {
    kind: "preview_element",
    label: "외벽 W-01",
  });
  assert.equal(withAnchor.anchors.at(-1)?.label, "외벽 W-01");

  const completed = updatePreviewIssueStatus(withAnchor, issue.id, "closed");
  assert.equal(completed.issues.at(-1)?.status, "closed");
  assert.deepEqual(
    completed.events.slice(-4).map((event) => event.kind),
    ["created", "comment_added", "anchor_added", "status_changed"],
  );
});

test("local review assignments create an unread notification and append-only audit events", () => {
  const initial = defaultPreviewRoomState();
  const issueId = initial.issues[0].id;
  const assigned = updatePreviewIssueAssignment(
    initial,
    issueId,
    "preview-user-site",
  );
  const scheduled = updatePreviewIssueSchedule(assigned, issueId, {
    dueDate: "2026-09-01",
    priority: "urgent",
  });

  assert.equal(scheduled.issues[0].assigneeId, "preview-user-site");
  assert.equal(scheduled.issues[0].dueDate, "2026-09-01");
  assert.equal(scheduled.issues[0].priority, "urgent");
  assert.deepEqual(
    scheduled.events.slice(-3).map((event) => event.kind),
    ["assignee_changed", "due_changed", "priority_changed"],
  );
  assert.equal(scheduled.notifications.at(-1)?.read, false);

  const notificationId = scheduled.notifications.at(-1)?.id;
  assert.ok(notificationId);
  const read = markPreviewNotificationRead(scheduled, notificationId);
  assert.equal(read.notifications.at(-1)?.read, true);
  assert.equal(scheduled.notifications.at(-1)?.read, false);
});

test("a drawing revision keeps the old anchor visible until a new anchor resolves it", () => {
  const initial = defaultPreviewRoomState();
  const pending = initial.revisionReviews[0];
  assert.equal(pending.status, "needs_reanchor");

  const resolved = addPreviewAnchor(initial, pending.issueId, {
    kind: "pdf_region",
    label: "A-101 Rev.2 · 1쪽 선택 영역",
  });

  assert.equal(resolved.revisionReviews[0].previousAnchorLabel, "창호 W-01");
  assert.equal(resolved.revisionReviews[0].status, "resolved");
  assert.equal(
    resolved.revisionReviews[0].replacementAnchorLabel,
    "A-101 Rev.2 · 1쪽 선택 영역",
  );
});

test("local preview collaboration route is public in development only", async () => {
  const [routes, screen, wrapper, dashboard] = await Promise.all([
    readFile(new URL("../app/routes.ts", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../app/lukas/screens/workspace-preview-room.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/workspace-preview-room.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/workspace-dashboard.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(
    routes,
    /workspace-preview\/projects\/:projectId\/drawings\/\:fileId/,
  );
  assert.match(screen, /components\/workspace-preview-room"/);
  assert.doesNotMatch(screen, /workspace-preview-room\.client/);
  assert.match(screen, /localWorkspacePreviewTarget/);
  assert.match(wrapper, /lazy\(/);
  assert.match(wrapper, /useEffect\(\(\) => setMounted\(true\)/);
  assert.match(dashboard, /workspace-preview\/projects/);
});
