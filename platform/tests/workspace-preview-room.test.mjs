import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  addPreviewAnchor,
  addPreviewComment,
  createPreviewIssue,
  defaultPreviewRoomState,
  updatePreviewIssueStatus,
} from "../app/lukas/lib/workspace-preview-state.ts";

test("local drawing review state supports issues, comments, status, and evidence", () => {
  const initial = defaultPreviewRoomState();
  const withIssue = createPreviewIssue(initial, {
    title: "창호 치수 확인",
    description: "평면도와 IFC 치수를 비교합니다.",
  });
  const issue = withIssue.issues.at(-1);
  assert.ok(issue);
  assert.equal(issue.status, "open");

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
