import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import React from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { ThemeProvider } from "remix-themes";
import { createServer } from "vite";

import routes from "../app/routes.ts";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});

const [drawingEntry, navigationLayout, projectDrawings, workspaceDashboard] =
  await Promise.all([
    vite
      .ssrLoadModule("/app/lukas/lib/drawing-entry.ts")
      .catch(() => ({})),
    vite.ssrLoadModule("/app/core/layouts/navigation.layout.tsx"),
    vite.ssrLoadModule("/app/lukas/screens/project-drawings.tsx"),
    vite.ssrLoadModule("/app/lukas/components/workspace-dashboard.tsx"),
  ]);

test.after(() => vite.close());

function withTheme(children) {
  return React.createElement(
    ThemeProvider,
    { specifiedTheme: "light", themeAction: "/theme" },
    children,
  );
}

async function renderNavigationRoute({ id, path, url }) {
  function Sentinel() {
    return React.createElement("p", null, "ROUTE-CONTENT-SENTINEL");
  }

  const layout = React.createElement(navigationLayout.default, {
    loaderData: { userPromise: Promise.resolve({ user: null }) },
  });
  const router = createMemoryRouter(
    [
      {
        id: "navigation-shell",
        path: "/",
        element: layout,
        children: [{ id, path, Component: Sentinel }],
      },
    ],
    { initialEntries: [url] },
  );
  const stream = await renderToReadableStream(
    withTheme(React.createElement(RouterProvider, { router })),
  );
  await stream.allReady;
  return new Response(stream).text();
}

function renderComponent(Component, props, url = "/workspace") {
  return renderToStaticMarkup(
    withTheme(
      React.createElement(
        MemoryRouter,
        { initialEntries: [url] },
        React.createElement(Component, props),
      ),
    ),
  );
}

function workspaceFixture({ drawingId = "file-a", previewMode = false } = {}) {
  return {
    projects: [
      {
        id: "project-a",
        name: "1HK 테스트 프로젝트",
        description: "도면 진입 흐름",
        workflow_status: "confirmed",
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-02T00:00:00.000Z",
      },
    ],
    projectMetrics: {
      "project-a": {
        fileCount: drawingId ? 1 : 0,
        ifcCount: 0,
        openReviewCount: 0,
        memberCount: 1,
        latestIfcId: null,
        latestDrawingId: drawingId,
        unresolvedDrawingCount: 0,
        assignedToMeCount: 0,
        latestFilename: drawingId ? "A-101.PDF" : null,
      },
    },
    activities: [],
    email: "architect@example.com",
    isStaff: false,
    previewMode,
  };
}

test("private-workspace route matches remove the public navigation and footer", async () => {
  const html = await renderNavigationRoute({
    id: "private-workspace",
    path: "projects/:projectId/drawings/:fileId/workspace",
    url: "/projects/project-a/drawings/file-a/workspace",
  });

  assert.match(html, /ROUTE-CONTENT-SENTINEL/);
  assert.doesNotMatch(html, /<nav/);
  assert.doesNotMatch(html, /<footer/);
});

test("public route matches retain the marketing navigation and footer", async () => {
  const html = await renderNavigationRoute({
    id: "public-news",
    path: "news",
    url: "/news",
  });

  assert.match(html, /ROUTE-CONTENT-SENTINEL/);
  assert.match(html, /<nav/);
  assert.match(html, /<footer/);
});

test("PDF is an upload kind with page-based help and exact browser acceptance", () => {
  assert.equal(drawingEntry.projectFileKindPolicy?.pdf?.label, "PDF 도면");
  assert.match(drawingEntry.projectFileKindPolicy?.pdf?.help ?? "", /페이지/);
  assert.equal(
    drawingEntry.projectFileKindPolicy?.pdf?.accept,
    ".pdf,application/pdf",
  );
  assert.equal(drawingEntry.fileMatchesProjectKind?.("pdf", "A-101.PDF"), true);
  assert.equal(drawingEntry.fileMatchesProjectKind?.("pdf", "A-101.ifc"), false);
});

test("IFC upload matching and browser acceptance remain supported", () => {
  assert.equal(drawingEntry.projectFileKindPolicy?.ifc?.label, "IFC 모델");
  assert.equal(
    drawingEntry.projectFileKindPolicy?.ifc?.accept,
    ".ifc,application/octet-stream",
  );
  assert.equal(drawingEntry.fileMatchesProjectKind?.("ifc", "MODEL.IFC"), true);
  assert.equal(drawingEntry.fileMatchesProjectKind?.("ifc", "MODEL.pdf"), false);
});

test("drawing uploads enter the exact file workspace while other uploads return", () => {
  const input = {
    projectId: "project-a",
    fileId: "file-a",
    returnPath: "/projects/project-a",
  };

  assert.equal(
    drawingEntry.projectUploadDestination?.({ ...input, kind: "ifc" }),
    "/projects/project-a/drawings/file-a/workspace",
  );
  assert.equal(
    drawingEntry.projectUploadDestination?.({ ...input, kind: "pdf" }),
    "/projects/project-a/drawings/file-a/workspace",
  );
  assert.equal(
    drawingEntry.projectUploadDestination?.({ ...input, kind: "qto_csv" }),
    "/projects/project-a",
  );
});

test("private route tree retains both the legacy room and the workspace", () => {
  const navigation = routes.find(
    (route) => route.file === "core/layouts/navigation.layout.tsx",
  );
  const privateWorkspace = navigation?.children?.find(
    (route) => route.id === "private-workspace",
  );
  const registered = privateWorkspace?.children?.map((route) => route.path);

  assert.ok(registered?.includes("/projects/:projectId/drawings/:fileId"));
  assert.ok(
    registered?.includes(
      "/projects/:projectId/drawings/:fileId/workspace",
    ),
  );
});

test("drawing cards open the workspace and no-drawing upload defaults to PDF", () => {
  const cardHtml = renderComponent(projectDrawings.default, {
    loaderData: {
      project: { id: "project-a", name: "1HK 테스트 프로젝트" },
      files: [
        {
          id: "file-a",
          kind: "pdf",
          original_filename: "A-101.pdf",
          byte_size: 1024,
          created_at: "2026-08-02T00:00:00.000Z",
        },
      ],
    },
  });
  const emptyHtml = renderComponent(projectDrawings.default, {
    loaderData: {
      project: { id: "project-a", name: "1HK 테스트 프로젝트" },
      files: [],
    },
  });

  assert.match(
    cardHtml,
    /href="\/projects\/project-a\/drawings\/file-a\/workspace"/,
  );
  assert.match(cardHtml, /도면 작업실 열기 →/);
  assert.match(
    emptyHtml,
    /href="\/projects\/project-a\/files\?kind=pdf#upload"/,
  );
});

test("workspace dashboard opens latest drawings in workspace and preserves preview routing", () => {
  const dashboardHtml = renderComponent(
    workspaceDashboard.WorkspaceDashboard,
    workspaceFixture(),
  );
  const emptyHtml = renderComponent(
    workspaceDashboard.WorkspaceDashboard,
    workspaceFixture({ drawingId: null }),
  );
  const previewHtml = renderComponent(
    workspaceDashboard.WorkspaceDashboard,
    workspaceFixture({ previewMode: true }),
    "/workspace-preview",
  );

  assert.match(
    dashboardHtml,
    /href="\/projects\/project-a\/drawings\/file-a\/workspace"/,
  );
  assert.match(
    emptyHtml,
    /href="\/projects\/project-a\/files\?kind=pdf#upload"/,
  );
  assert.match(
    previewHtml,
    /href="\/workspace-preview\/projects\/project-a\/drawings\/file-a"/,
  );
});
