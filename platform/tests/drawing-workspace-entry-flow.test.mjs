import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

const actionClientFactoryKey = "__drawingEntryActionClientFactory";
globalThis[actionClientFactoryKey] = () => {
  throw new Error("Upload action test client is not configured.");
};
const actionVite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  plugins: [
    {
      enforce: "pre",
      load(id) {
        if (id === "\0virtual:drawing-entry-action-client")
          return `export default (...args) => globalThis[${JSON.stringify(actionClientFactoryKey)}](...args);`;
      },
      name: "drawing-entry-action-client",
      resolveId(source) {
        if (source.endsWith("/app/core/lib/supa-client.server"))
          return "\0virtual:drawing-entry-action-client";
      },
    },
  ],
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});

const [
  drawingEntry,
  navigationLayout,
  projectDrawings,
  projectScreen,
  workspaceDashboard,
  projectAction,
] = await Promise.all([
  vite.ssrLoadModule("/app/lukas/lib/drawing-entry.ts"),
  vite.ssrLoadModule("/app/core/layouts/navigation.layout.tsx"),
  vite.ssrLoadModule("/app/lukas/screens/project-drawings.tsx"),
  vite.ssrLoadModule("/app/lukas/screens/project.tsx"),
  vite.ssrLoadModule("/app/lukas/components/workspace-dashboard.tsx"),
  actionVite.ssrLoadModule("/app/lukas/screens/project.tsx"),
]);

test.after(async () => {
  delete globalThis[actionClientFactoryKey];
  await Promise.all([vite.close(), actionVite.close()]);
});

const navigationRoute = routes.find(
  (route) => route.file === "core/layouts/navigation.layout.tsx",
);
const privateWorkspaceRoute = navigationRoute?.children?.find(
  (route) => route.file === "core/layouts/private.layout.tsx",
);
const notificationsRoute = privateWorkspaceRoute?.children?.find(
  (route) => route.file === "lukas/screens/drawing-notifications.tsx",
);
const publicNewsRoute = navigationRoute?.children?.find(
  (route) => route.file === "features/blog/screens/posts.tsx",
);

function withTheme(children) {
  return React.createElement(
    ThemeProvider,
    { specifiedTheme: "light", themeAction: "/theme" },
    children,
  );
}

async function renderNavigationRoute({ ancestors = [], leaf, url }) {
  function Sentinel() {
    return React.createElement("p", null, "ROUTE-CONTENT-SENTINEL");
  }

  let matchedRoute = {
    id: leaf.id ?? leaf.file,
    path: leaf.path,
    Component: Sentinel,
  };
  for (const ancestor of [...ancestors].reverse())
    matchedRoute = {
      id: ancestor.id ?? ancestor.file,
      children: [matchedRoute],
    };

  const layout = React.createElement(navigationLayout.default, {
    loaderData: { userPromise: Promise.resolve({ user: null }) },
  });
  const router = createMemoryRouter(
    [
      {
        id: navigationRoute.id ?? navigationRoute.file,
        path: "/",
        element: layout,
        children: [matchedRoute],
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

function renderProjectForm() {
  const loaderData = {
    project: {
      id: "00000000-0000-4000-8000-000000000001",
      name: "1HK 테스트 프로젝트",
      description: null,
      workflow_status: "confirmed",
      contact_name: null,
      contact_phone: null,
    },
    files: [],
    reviews: [],
    shares: [],
    suggestions: [],
    suggestionDecisions: [],
    suggestionEvaluation: [],
    takeoffArtifacts: [],
    takeoffApprovals: [],
    fileRevisions: [],
    preflightArtifacts: [],
    preflightApprovals: [],
    materialPlans: [],
    publicShareEnabled: true,
    isStaff: false,
    isOwner: true,
    suggestionPilotEnabled: false,
  };
  const router = createMemoryRouter(
    [
      {
        path: "/projects/:projectId/files",
        element: React.createElement(projectScreen.default, { loaderData }),
      },
    ],
    {
      initialEntries: [
        "/projects/00000000-0000-4000-8000-000000000001/files?kind=pdf",
      ],
    },
  );
  return renderToStaticMarkup(
    withTheme(React.createElement(RouterProvider, { router })),
  );
}

function uploadActionFixture(createdFileId) {
  const projectId = "00000000-0000-4000-8000-000000000001";
  const ownerId = "00000000-0000-4000-8000-000000000002";
  const userId = "00000000-0000-4000-8000-000000000003";
  const observations = {
    metadataInserts: [],
    priorFileFilters: [],
    storageUploads: [],
  };

  function query(result, onEq) {
    const chain = {
      eq(column, value) {
        onEq?.(column, value);
        return chain;
      },
      limit() {
        return chain;
      },
      maybeSingle: async () => result,
      order() {
        return chain;
      },
      select() {
        return chain;
      },
      single: async () => result,
    };
    return chain;
  }

  const client = {
    auth: {
      getUser: async () => ({
        data: {
          user: { id: userId, is_anonymous: false, app_metadata: {} },
        },
      }),
    },
    from(table) {
      if (table === "lukas_qto_projects")
        return query({ data: { id: projectId, owner_id: ownerId } });
      if (table === "lukas_qto_files")
        return {
          insert(row) {
            observations.metadataInserts.push(row);
            return {
              select() {
                return {
                  single: async () => ({
                    data: { id: createdFileId },
                    error: null,
                  }),
                };
              },
            };
          },
          select() {
            return query({ data: null, error: null }, (column, value) =>
              observations.priorFileFilters.push([column, value]),
            );
          },
        };
      throw new Error(`Unexpected table: ${table}`);
    },
    storage: {
      from(bucket) {
        return {
          async remove() {
            throw new Error("Successful upload must not roll back storage.");
          },
          async upload(path, bytes, options) {
            observations.storageUploads.push({
              bucket,
              path,
              bytes: Buffer.from(bytes),
              options,
            });
            return { error: null };
          },
        };
      },
    },
  };

  return { client, observations, ownerId, projectId, userId };
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

test("a real non-workspace private match removes public navigation and footer", async () => {
  assert.ok(navigationRoute);
  assert.equal(privateWorkspaceRoute?.id, "private-workspace");
  assert.ok(notificationsRoute);
  const html = await renderNavigationRoute({
    ancestors: [privateWorkspaceRoute],
    leaf: notificationsRoute,
    url: notificationsRoute.path,
  });

  assert.match(html, /ROUTE-CONTENT-SENTINEL/);
  assert.doesNotMatch(html, /<nav/);
  assert.doesNotMatch(html, /<footer/);
});

test("public route matches retain the marketing navigation and footer", async () => {
  assert.ok(navigationRoute);
  assert.ok(publicNewsRoute);
  const html = await renderNavigationRoute({
    leaf: publicNewsRoute,
    url: publicNewsRoute.path,
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
  assert.equal(
    drawingEntry.fileMatchesProjectKind?.("pdf", "A-101.ifc"),
    false,
  );
});

test("project upload form renders the selected PDF option, help, and exact accept", () => {
  const html = renderProjectForm();

  assert.match(html, /<option value="pdf" selected="">PDF 도면<\/option>/);
  assert.match(html, /id="kind-help"[^>]*>[^<]*페이지[^<]*\.pdf[^<]*<\/p>/);
  assert.match(
    html,
    /<input[^>]*accept="\.pdf,application\/pdf"[^>]*id="source_file"/,
  );
});

test("IFC upload matching and browser acceptance remain supported", () => {
  assert.equal(drawingEntry.projectFileKindPolicy?.ifc?.label, "IFC 모델");
  assert.equal(
    drawingEntry.projectFileKindPolicy?.ifc?.accept,
    ".ifc,application/octet-stream",
  );
  assert.equal(drawingEntry.fileMatchesProjectKind?.("ifc", "MODEL.IFC"), true);
  assert.equal(
    drawingEntry.fileMatchesProjectKind?.("ifc", "MODEL.pdf"),
    false,
  );
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

test("real project upload action persists source bytes and redirects by created kind", async () => {
  const cases = [
    {
      createdFileId: "00000000-0000-4000-8000-000000000011",
      filename: "A-101.PDF",
      kind: "pdf",
      mime: "application/pdf",
      source: "%PDF-1.7\n1HK drawing\n",
      location:
        "/projects/00000000-0000-4000-8000-000000000001/drawings/00000000-0000-4000-8000-000000000011/workspace",
    },
    {
      createdFileId: "00000000-0000-4000-8000-000000000012",
      filename: "MODEL.IFC",
      kind: "ifc",
      mime: "application/octet-stream",
      source: "ISO-10303-21;\nEND-ISO-10303-21;\n",
      location:
        "/projects/00000000-0000-4000-8000-000000000001/drawings/00000000-0000-4000-8000-000000000012/workspace",
    },
    {
      createdFileId: "00000000-0000-4000-8000-000000000013",
      filename: "quantity.csv",
      kind: "qto_csv",
      mime: "text/csv",
      source: "element_id,quantity\n1,2\n",
      location: "/projects/00000000-0000-4000-8000-000000000001",
    },
  ];

  for (const fixture of cases) {
    const { client, observations, projectId, userId } = uploadActionFixture(
      fixture.createdFileId,
    );
    globalThis[actionClientFactoryKey] = () => [client, new Headers()];
    const formData = new FormData();
    formData.set("intent", "upload");
    formData.set("kind", fixture.kind);
    formData.set(
      "source_file",
      new File([fixture.source], fixture.filename, { type: fixture.mime }),
    );

    const response = await projectAction.action({
      request: new Request(`http://app.test/projects/${projectId}`, {
        method: "POST",
        body: formData,
      }),
      params: { projectId },
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), fixture.location);
    assert.equal(observations.storageUploads.length, 1);
    assert.equal(observations.metadataInserts.length, 1);
    const stored = observations.storageUploads[0];
    const metadata = observations.metadataInserts[0];
    assert.equal(stored.bucket, "lukas-qto");
    assert.deepEqual(stored.bytes, Buffer.from(fixture.source));
    assert.deepEqual(stored.options, {
      contentType: fixture.mime,
      upsert: false,
    });
    assert.equal(metadata.project_id, projectId);
    assert.equal(metadata.uploaded_by, userId);
    assert.equal(metadata.kind, fixture.kind);
    assert.equal(metadata.original_filename, fixture.filename);
    assert.equal(metadata.content_type, fixture.mime);
    assert.equal(metadata.byte_size, Buffer.byteLength(fixture.source));
    assert.equal(
      metadata.sha256,
      createHash("sha256").update(fixture.source).digest("hex"),
    );
    assert.equal(metadata.immutable, true);
    assert.equal(metadata.storage_path, stored.path);
    assert.deepEqual(observations.priorFileFilters.slice(-1)[0], [
      "kind",
      fixture.kind,
    ]);
  }
});

test("private route tree retains both the legacy room and the workspace", () => {
  const registered = privateWorkspaceRoute?.children?.map(
    (route) => route.path,
  );

  assert.ok(registered?.includes("/projects/:projectId/drawings/:fileId"));
  assert.ok(
    registered?.includes("/projects/:projectId/drawings/:fileId/workspace"),
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
