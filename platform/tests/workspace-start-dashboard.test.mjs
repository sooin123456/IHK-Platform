import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React from "react";
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
const { WorkspaceDashboard } = await vite.ssrLoadModule(
  "/app/lukas/components/workspace-dashboard.tsx",
);
test.after(() => vite.close());

const project = {
  id: "00000000-0000-4000-8000-000000000101",
  name: "성수동 사무실",
  description: "",
  workflow_status: "confirmed",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-07T00:00:00Z",
};
const oldDrawingId = "00000000-0000-4000-8000-000000000102";
const newDrawingId = "00000000-0000-4000-8000-000000000103";
const metric = {
  canCreateWorkspace: true,
  fileCount: 8,
  ifcCount: 0,
  openReviewCount: 0,
  memberCount: 2,
  latestIfcId: null,
  latestDrawingId: oldDrawingId,
  unresolvedDrawingCount: 0,
  assignedToMeCount: 0,
  latestFilename: "A-101.pdf",
};
const requests = Object.fromEntries(
  ["blank", "template", "file"].map((kind, index) => [
    kind,
    {
      clientRequestId: `00000000-0000-4000-8000-00000000000${index}`,
      clientCreatedAt: "2026-09-07T00:00:00.000Z",
    },
  ]),
);
function render(overrides = {}) {
  const props = {
    projects: [],
    projectMetrics: {},
    activities: [],
    email: "architect@example.com",
    isStaff: false,
    quickStartRequests: requests,
    ...overrides,
  };
  const router = createMemoryRouter(
    [{ path: "*", element: React.createElement(WorkspaceDashboard, props) }],
    { initialEntries: ["/workspace"] },
  );
  const html = renderToStaticMarkup(
    React.createElement(RouterProvider, { router }),
  );
  router.dispose();
  return html;
}

// Wrong empty-state branching would hide start actions or suggest nonexistent work.
test("no accessible work offers direct blank/template/file starts, without a resume panel", () => {
  const html = render();
  assert.match(html, /data-workspace-state="start"/);
  assert.doesNotMatch(html, /aria-label="이어서 작업"/);
  for (const kind of ["blank", "template", "file"]) {
    assert.match(html, new RegExp(`name="intent"[^>]*value="quick_${kind}"`));
    assert.match(
      html,
      new RegExp(
        `name="client_request_id"[^>]*value="${requests[kind].clientRequestId}"`,
      ),
    );
  }
});

// A project without drawings is still existing work, not a first-use account.
test("an empty project opens its drawing list and does not expose a fake resume", () => {
  const html = render({
    projects: [project],
    projectMetrics: { [project.id]: { ...metric, latestDrawingId: null } },
  });
  assert.match(html, /data-workspace-state="projects"/);
  assert.ok(html.includes(`href="/projects/${project.id}/drawings"`));
  assert.doesNotMatch(html, /aria-label="이어서 작업"/);
});

// Choosing the first row or a file ID would resume the wrong document.
test("resume uses the newest accessible drawing while project cards open the drawing list", () => {
  const html = render({
    projects: [project],
    projectMetrics: { [project.id]: metric },
    drawings: [
      {
        id: oldDrawingId,
        project_id: project.id,
        title: "오래된 도면",
        updated_at: "2026-09-01T00:00:00Z",
      },
      {
        id: newDrawingId,
        project_id: project.id,
        title: "1층 평면도",
        updated_at: "2026-09-07T00:00:00Z",
      },
      {
        id: "inaccessible",
        project_id: "another-project",
        title: "다른 공간 도면",
        updated_at: "2026-09-08T00:00:00Z",
      },
    ],
  });
  assert.match(html, /aria-label="이어서 작업"/);
  assert.ok(
    html.includes(`href="/projects/${project.id}/workspaces/${newDrawingId}"`),
  );
  assert.ok(html.includes(`href="/projects/${project.id}/drawings"`));
  assert.doesNotMatch(html, /inaccessible|다른 공간 도면/);
});

test("shared work is not misclassified as a new account and keeps a shared-scope entry", () => {
  const html = render({ hasSharedProjects: true });
  assert.match(html, /data-workspace-state="projects"/);
  assert.match(html, /href="\/workspace\?space=shared"/);
});

test("real projects never display generated sample drawings as their own thumbnails", () => {
  const html = render({
    projects: [project],
    projectMetrics: { [project.id]: metric },
  });
  assert.doesNotMatch(html, /src="\/images\/workspace-start\/office-plan.png"/);
});

test("quick-start retry preserves the failed request instead of issuing a new request", () => {
  const html = render({
    quickStartFailure: {
      kind: "blank",
      message: "잠시 후 다시 시도하세요.",
      clientRequestId: "retry-request",
      clientCreatedAt: "2026-09-06T00:00:00.000Z",
    },
  });
  assert.match(html, /name="client_request_id"[^>]*value="retry-request"/);
  assert.match(html, /role="alert"/);
});

test("opening preview library or notifications preserves the empty account state", () => {
  const html = render({ previewMode: true });
  assert.ok(html.includes('href="/workspace-preview?state=empty&amp;panel=library"'));
  assert.ok(html.includes('href="/workspace-preview?state=empty&amp;panel=notifications"'));
});
