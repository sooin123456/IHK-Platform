import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { createServer } from "vite";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const { default: DrawingIssuePanel } = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-issue-panel.tsx",
);
test.after(() => vite.close());

const candidate = {
  issueId: "50000000-0000-4000-8000-000000000006",
  issueTitle: "개정 위치 확인",
  previousAnchorId: "50000000-0000-4000-8000-000000000003",
  previousFileId: "50000000-0000-4000-8000-000000000004",
  sourceKind: "pdf_region",
  kind: "manual_reanchor_required",
  ifcGlobalId: null,
};

function renderPanel(role) {
  const panel = createElement(DrawingIssuePanel, {
    anchors: [],
    approvals: [],
    assignees: [],
    comments: [],
    currentFileId: "50000000-0000-4000-8000-000000000001",
    currentUserId: "50000000-0000-4000-8000-000000000002",
    events: [],
    issuePage: { page: 1, pageSize: 50, totalCount: 0, totalPages: 1 },
    issues: [],
    onCancelRelinkCandidate() {},
    onFocusRelinkCandidate() {},
    onSelectIssue() {},
    pendingAnchor: null,
    projectId: "50000000-0000-4000-8000-000000000005",
    relinkCandidate: null,
    relinkNewAnchorId: null,
    revisionReview: [candidate],
    role,
    selectedIssueId: null,
  });
  const router = createMemoryRouter([{ path: "*", element: panel }], {
    initialEntries: ["/projects/project/drawings/file"],
  });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

test("legacy room advertises revision relink only to roles accepted by its action", () => {
  assert.match(renderPanel("reviewer"), /후보 검토/);
  for (const deniedRole of ["approver", "viewer"])
    assert.doesNotMatch(renderPanel(deniedRole), /후보 검토/);
});
