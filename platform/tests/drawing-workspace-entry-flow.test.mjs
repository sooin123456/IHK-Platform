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

const actionClientFactoryKey = "__drawingEntryActionClientFactory";
const adminClientFactoryKey = "__drawingEntryAdminClientFactory";
const workspaceClientFactoryKey = "__drawingWorkspaceLoaderClientFactory";
const workspaceMetricsKey = "__drawingWorkspaceLoaderMetrics";
globalThis[actionClientFactoryKey] = () => {
  throw new Error("Upload action test client is not configured.");
};
globalThis[adminClientFactoryKey] = () => {
  throw new Error("Upload action admin client is not configured.");
};
globalThis[workspaceClientFactoryKey] = () => {
  throw new Error("Workspace loader test client is not configured.");
};
globalThis[workspaceMetricsKey] = {};
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
        if (id === "\0virtual:drawing-entry-admin-client")
          return `export default new Proxy({}, { get(_target, property) { const client = globalThis[${JSON.stringify(adminClientFactoryKey)}](); const value = client[property]; return typeof value === "function" ? value.bind(client) : value; } });`;
      },
      name: "drawing-entry-action-client",
      resolveId(source) {
        if (source.endsWith("/app/core/lib/supa-admin-client.server"))
          return "\0virtual:drawing-entry-admin-client";
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
const workspaceLoaderVite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  plugins: [
    {
      enforce: "pre",
      load(id) {
        if (id === "\0virtual:workspace-loader-client")
          return `export default (...args) => globalThis[${JSON.stringify(workspaceClientFactoryKey)}](...args);`;
        if (id === "\0virtual:workspace-loader-metrics")
          return `export async function listDrawingIssueMetrics() { return globalThis[${JSON.stringify(workspaceMetricsKey)}]; }`;
      },
      name: "workspace-loader-client",
      resolveId(source) {
        if (source.endsWith("/app/core/lib/supa-client.server"))
          return "\0virtual:workspace-loader-client";
        if (source.endsWith("/app/lukas/lib/drawing-collaboration.server"))
          return "\0virtual:workspace-loader-metrics";
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
  rootScreen,
  navigationLayout,
  projectDrawings,
  projectScreen,
  projectFileUpload,
  workspaceDashboard,
  projectAction,
  drawingWorkspaceStart,
  workspaceScreen,
] = await Promise.all([
  vite.ssrLoadModule("/app/lukas/lib/drawing-entry.ts"),
  vite.ssrLoadModule("/app/root.tsx"),
  vite.ssrLoadModule("/app/core/layouts/navigation.layout.tsx"),
  vite.ssrLoadModule("/app/lukas/screens/project-drawings.tsx"),
  vite.ssrLoadModule("/app/lukas/screens/project.tsx"),
  vite.ssrLoadModule("/app/lukas/lib/project-file-upload.ts"),
  vite.ssrLoadModule("/app/lukas/components/workspace-dashboard.tsx"),
  actionVite.ssrLoadModule("/app/lukas/screens/project.tsx"),
  vite.ssrLoadModule("/app/lukas/components/drawing-workspace-start.tsx"),
  workspaceLoaderVite.ssrLoadModule("/app/lukas/screens/workspace.tsx"),
]);

test.after(async () => {
  delete globalThis[actionClientFactoryKey];
  delete globalThis[adminClientFactoryKey];
  delete globalThis[workspaceClientFactoryKey];
  delete globalThis[workspaceMetricsKey];
  await Promise.all([
    vite.close(),
    actionVite.close(),
    workspaceLoaderVite.close(),
  ]);
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

function projectLoaderData(overrides = {}) {
  return {
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
    drawingDocuments: [],
    canCreateWorkspace: true,
    publicShareEnabled: true,
    isStaff: false,
    isOwner: true,
    suggestionPilotEnabled: false,
    ...overrides,
  };
}

function renderProjectForm() {
  const loaderData = projectLoaderData();
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

function renderProjectRoot(loaderData) {
  const projectId = "00000000-0000-4000-8000-000000000001";
  const router = createMemoryRouter(
    [
      {
        path: "/projects/:projectId",
        element: React.createElement(projectScreen.default, { loaderData }),
      },
    ],
    { initialEntries: [`/projects/${projectId}`] },
  );
  return renderToStaticMarkup(
    withTheme(React.createElement(RouterProvider, { router })),
  );
}

function uploadActionFixture(
  storageBytes,
  {
    finalizationError = null,
    finalizedUpload = null,
    membershipRole = null,
    verifiedUpload = null,
  } = {},
) {
  const projectId = "00000000-0000-4000-8000-000000000001";
  const ownerId = "00000000-0000-4000-8000-000000000002";
  const userId = "00000000-0000-4000-8000-000000000003";
  const observations = {
    finalizationCalls: [],
    suggestionUpserts: [],
    storageDownloads: [],
    storageRemovals: [],
    verificationFilters: [],
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
      if (table === "lukas_qto_project_members")
        return query({
          data: membershipRole ? { role: membershipRole } : null,
        });
      throw new Error(`Unexpected table: ${table}`);
    },
    storage: {
      from(bucket) {
        return {
          download(path) {
            observations.storageDownloads.push({ bucket, path });
            return {
              asStream: async () => ({
                data: new Blob([storageBytes]).stream(),
                error: null,
              }),
            };
          },
          async remove(paths) {
            throw new Error(
              `Authenticated cleanup must not remove ${bucket}/${paths.join(",")}.`,
            );
          },
          async upload() {
            throw new Error("Source bytes must bypass the server action.");
          },
        };
      },
    },
  };

  const adminClient = {
    from(table) {
      if (table === "lukas_qto_verified_uploads")
        return {
          select() {
            return query(
              { data: verifiedUpload, error: null },
              (column, value) =>
                observations.verificationFilters.push([column, value]),
            );
          },
        };
      if (table === "lukas_qto_suggestions")
        return {
          async upsert(rows, options) {
            observations.suggestionUpserts.push({ options, rows });
            return { error: null };
          },
        };
      throw new Error(`Unexpected admin table: ${table}`);
    },
    async rpc(name, args) {
      observations.finalizationCalls.push({ args, name });
      return {
        data: finalizationError ? null : finalizedUpload,
        error: finalizationError,
      };
    },
  };

  return { adminClient, client, observations, ownerId, projectId, userId };
}

function projectRootLoaderFixture() {
  const projectId = "00000000-0000-4000-8000-000000000001";
  const observations = { filters: [] };
  const rows = {
    lukas_drawing_documents: [],
    lukas_qto_file_revisions: [],
    lukas_qto_files: [],
    lukas_qto_material_plans: [],
    lukas_qto_preflight_artifacts: [],
    lukas_qto_projects: {
      contact_name: null,
      contact_phone: null,
      created_at: "2026-08-31T00:00:00.000Z",
      description: null,
      id: projectId,
      name: "빈 프로젝트",
      owner_id: "00000000-0000-4000-8000-000000000002",
      updated_at: "2026-08-31T00:00:00.000Z",
      workflow_status: "confirmed",
    },
    lukas_qto_reviews: [],
    lukas_qto_shares: [],
    lukas_qto_suggestions: [],
    lukas_qto_takeoff_artifacts: [],
  };
  const client = {
    auth: {
      getUser: async () => ({
        data: {
          user: {
            app_metadata: {},
            id: "00000000-0000-4000-8000-000000000002",
            is_anonymous: false,
          },
        },
      }),
    },
    from(table) {
      const result = { data: rows[table] ?? [], error: null };
      const chain = {
        eq(column, value) {
          observations.filters.push({ column, table, value });
          return chain;
        },
        order() {
          return chain;
        },
        select() {
          return chain;
        },
        single: async () => result,
        then(resolve, reject) {
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return { client, observations, projectId };
}

function verifiedUploadFixture({
  createdFileId,
  filename,
  kind,
  mime,
  objectId,
  ownerId,
  projectId,
  source,
  userId,
  verificationId,
}) {
  const byteSize = Buffer.byteLength(source);
  const sha256 = objectId.replaceAll("-", "").padEnd(64, "a").slice(0, 64);
  const storagePath = `${ownerId}/${projectId}/source-uploads/${objectId}.${filename.split(".").at(-1).toLowerCase()}`;
  return {
    finalizedUpload: {
      byteSize,
      contentType: mime,
      fileId: createdFileId,
      kind,
      originalFilename: filename,
      previousByteSize: null,
      previousFileId: null,
      previousSha256: null,
      previousStoragePath: null,
      sha256,
      storagePath,
    },
    verifiedUpload: {
      actor_id: userId,
      byte_size: byteSize,
      consumed_file_id: null,
      content_type: mime,
      expires_at: "2099-01-01T00:00:00.000Z",
      id: verificationId,
      kind,
      original_filename: filename,
      project_id: projectId,
      sha256,
      storage_path: storagePath,
    },
  };
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

function renderStartComponent(props) {
  const path = "/projects/:projectId/workspaces/new";
  const router = createMemoryRouter(
    [
      {
        path,
        element: React.createElement(
          drawingWorkspaceStart.DrawingWorkspaceStart,
          props,
        ),
      },
    ],
    {
      initialEntries: [
        "/projects/00000000-0000-4000-8000-000000000001/workspaces/new",
      ],
    },
  );
  return renderToStaticMarkup(
    withTheme(React.createElement(RouterProvider, { router })),
  );
}

function workspaceFixture({
  drawingId = "00000000-0000-4000-8000-000000000002",
  previewMode = false,
} = {}) {
  return {
    projects: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        name: "1HK 테스트 프로젝트",
        description: "도면 진입 흐름",
        workflow_status: "confirmed",
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-02T00:00:00.000Z",
      },
    ],
    projectMetrics: {
      "00000000-0000-4000-8000-000000000001": {
        canCreateWorkspace: true,
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

function workspaceLoaderFixture() {
  const projectWithDocument = "00000000-0000-4000-8000-000000000041";
  const projectWithFileOnly = "00000000-0000-4000-8000-000000000042";
  const documentId = "00000000-0000-4000-8000-000000000043";
  const documentSourceFileId = "00000000-0000-4000-8000-000000000044";
  const fileOnlyId = "00000000-0000-4000-8000-000000000045";
  const observations = [];
  const rows = {
    lukas_qto_projects: [
      {
        id: projectWithDocument,
        owner_id: "00000000-0000-4000-8000-000000000046",
        name: "문서가 있는 프로젝트",
        description: "canonical document",
        workflow_status: "confirmed",
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-04T00:00:00.000Z",
      },
      {
        id: projectWithFileOnly,
        owner_id: "00000000-0000-4000-8000-000000000046",
        name: "파일만 있는 프로젝트",
        description: "no document",
        workflow_status: "confirmed",
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-03T00:00:00.000Z",
      },
    ],
    lukas_qto_organization_members: [],
    lukas_qto_files: [
      {
        id: documentSourceFileId,
        project_id: projectWithDocument,
        kind: "pdf",
        original_filename: "WITH-DOCUMENT.pdf",
        created_at: "2026-08-03T00:00:00.000Z",
      },
      {
        id: fileOnlyId,
        project_id: projectWithFileOnly,
        kind: "pdf",
        original_filename: "FILE-ONLY.pdf",
        created_at: "2026-08-02T00:00:00.000Z",
      },
    ],
    lukas_drawing_documents: [
      {
        id: documentId,
        project_id: projectWithDocument,
        updated_at: "2026-08-05T00:00:00.000Z",
      },
    ],
    lukas_qto_reviews: [],
    lukas_qto_project_members: [],
  };
  const client = {
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: "00000000-0000-4000-8000-000000000046",
            email: "architect@example.com",
            is_anonymous: false,
            app_metadata: {},
          },
        },
      }),
    },
    from(table) {
      const call = { table, filters: [], orders: [], select: null };
      observations.push(call);
      const chain = {
        in(column, values) {
          call.filters.push(["in", column, values]);
          return chain;
        },
        is(column, value) {
          call.filters.push(["is", column, value]);
          return chain;
        },
        limit(value) {
          call.limit = value;
          return chain;
        },
        order(column, options) {
          call.orders.push([column, options]);
          return chain;
        },
        select(columns) {
          call.select = columns;
          return chain;
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: structuredClone(rows[table] ?? []),
            error: null,
          }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return {
    client,
    documentId,
    documentSourceFileId,
    fileOnlyId,
    observations,
    projectWithDocument,
    projectWithFileOnly,
  };
}

test("the root boundary explains an oversized upload instead of hiding the 413", () => {
  const html = renderComponent(rootScreen.ErrorBoundary, {
    error: {
      data: null,
      internal: true,
      status: 413,
      statusText: "",
    },
  });

  assert.match(html, /파일 업로드 실패/);
  assert.match(html, /파일 페이지에서 다시 시도/);
  assert.doesNotMatch(html, /An unexpected error occurred/);
});

test("the root boundary preserves a route-specific 413 explanation", () => {
  const html = renderComponent(rootScreen.ErrorBoundary, {
    error: {
      data: "검증 파일은 20MB 이하여야 합니다.",
      internal: false,
      status: 413,
      statusText: "Payload Too Large",
    },
  });

  assert.match(html, /검증 파일은 20MB 이하여야 합니다/);
  assert.doesNotMatch(html, /파일 페이지에서 다시 시도/);
});

test("the root boundary explains a JavaScript failure in Korean", () => {
  const html = renderComponent(rootScreen.ErrorBoundary, {
    error: new Error("도면 문서를 불러오지 못했습니다."),
  });

  assert.match(html, /오류/);
  assert.doesNotMatch(html, /Oops!/);
  assert.doesNotMatch(html, /An unexpected error occurred/);
});

test("the root boundary uses Korean copy when the failure has no route payload", () => {
  const html = renderComponent(rootScreen.ErrorBoundary, {
    error: null,
  });

  assert.match(html, /오류/);
  assert.match(html, /다시 시도/);
  assert.doesNotMatch(html, /Oops!/);
  assert.doesNotMatch(html, /An unexpected error occurred/);
});

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
  assert.doesNotMatch(html, /enctype="multipart\/form-data"/);
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

test("verified PDF uploads prefill the workspace start while IFC and other uploads remain compatible", () => {
  const input = {
    projectId: "00000000-0000-4000-8000-000000000001",
    fileId: "00000000-0000-4000-8000-000000000002",
    returnPath: "/projects/00000000-0000-4000-8000-000000000001",
  };

  assert.equal(
    drawingEntry.projectUploadDestination?.({ ...input, kind: "ifc" }),
    "/projects/00000000-0000-4000-8000-000000000001/drawings/00000000-0000-4000-8000-000000000002",
  );
  assert.equal(
    drawingEntry.projectUploadDestination?.({ ...input, kind: "pdf" }),
    "/projects/00000000-0000-4000-8000-000000000001/workspaces/new?sourceFileId=00000000-0000-4000-8000-000000000002",
  );
  assert.equal(
    drawingEntry.projectUploadDestination?.({ ...input, kind: "qto_csv" }),
    "/projects/00000000-0000-4000-8000-000000000001",
  );
});

test("only owner, staff, and estimator roles may register official artifacts", () => {
  assert.equal(drawingEntry.canRegisterOfficialArtifacts("owner"), true);
  assert.equal(drawingEntry.canRegisterOfficialArtifacts("staff"), true);
  assert.equal(drawingEntry.canRegisterOfficialArtifacts("estimator"), true);
  assert.equal(drawingEntry.canRegisterOfficialArtifacts("reviewer"), false);
  assert.equal(drawingEntry.canRegisterOfficialArtifacts("site"), false);
  assert.equal(drawingEntry.canRegisterOfficialArtifacts("procurement"), false);
  assert.equal(drawingEntry.canRegisterOfficialArtifacts(null), false);
  assert.equal(
    drawingEntry.projectActorRole({
      membershipRole: "reviewer",
      ownerId: "owner-a",
      staff: false,
      userId: "user-b",
    }),
    "reviewer",
  );
  assert.equal(
    drawingEntry.projectActorRole({
      membershipRole: "reviewer",
      ownerId: "owner-a",
      staff: true,
      userId: "user-b",
    }),
    "staff",
  );
});

test("a PDF larger than the Vercel body limit goes only to the Storage adapter", async () => {
  const bytes = new Uint8Array(5 * 1024 * 1024);
  bytes.set(new TextEncoder().encode("%PDF-1.7\n"));
  const file = new File([bytes], "A-201.PDF", { type: "application/pdf" });
  const uploads = [];

  const metadata = await projectFileUpload.uploadProjectFileDirect({
    file,
    kind: "pdf",
    ownerId: "00000000-0000-4000-8000-000000000002",
    projectId: "00000000-0000-4000-8000-000000000001",
    async upload(storagePath, source, options) {
      uploads.push({ options, source, storagePath });
      return { error: null };
    },
  });

  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].source, file);
  assert.deepEqual(uploads[0].options, {
    contentType: "application/pdf",
    upsert: false,
  });
  assert.match(
    uploads[0].storagePath,
    /^00000000-0000-4000-8000-000000000002\/00000000-0000-4000-8000-000000000001\/source-uploads\/[0-9a-f-]{36}\.pdf$/,
  );
  assert.equal(metadata.byteSize, bytes.byteLength);
  assert.equal("sha256" in metadata, false);
  assert.equal(
    Object.values(metadata).some((value) => value instanceof File),
    false,
  );
});

test("browser, verifier and finalizer share the same trimmed original filename", async () => {
  const file = new File(["%PDF-1.7\n"], " A-201.PDF  ", {
    type: "application/pdf",
  });
  const uploads = [];

  const metadata = await projectFileUpload.uploadProjectFileDirect({
    file,
    kind: "pdf",
    ownerId: "00000000-0000-4000-8000-000000000002",
    projectId: "00000000-0000-4000-8000-000000000001",
    async upload(storagePath) {
      uploads.push(storagePath);
      return { error: null };
    },
  });

  assert.equal(metadata.originalFilename, "A-201.PDF");
  assert.match(uploads[0], /\/source-uploads\/[0-9a-f-]{36}\.pdf$/);
});

test("project upload action trusts only a service-side verification record and atomically finalizes metadata", async () => {
  const cases = [
    {
      createdFileId: "00000000-0000-4000-8000-000000000011",
      filename: "A-101.PDF",
      kind: "pdf",
      mime: "application/pdf",
      objectId: "00000000-0000-4000-8000-000000000021",
      verificationId: "00000000-0000-4000-8000-000000000031",
      source: "%PDF-1.7\n1HK drawing\n",
      location:
        "/projects/00000000-0000-4000-8000-000000000001/workspaces/new?sourceFileId=00000000-0000-4000-8000-000000000011",
    },
    {
      createdFileId: "00000000-0000-4000-8000-000000000012",
      filename: "MODEL.IFC",
      kind: "ifc",
      mime: "application/octet-stream",
      objectId: "00000000-0000-4000-8000-000000000022",
      verificationId: "00000000-0000-4000-8000-000000000032",
      source: "ISO-10303-21;\nEND-ISO-10303-21;\n",
      location:
        "/projects/00000000-0000-4000-8000-000000000001/drawings/00000000-0000-4000-8000-000000000012",
    },
    {
      createdFileId: "00000000-0000-4000-8000-000000000013",
      filename: "quantity.csv",
      kind: "qto_csv",
      mime: "text/csv",
      objectId: "00000000-0000-4000-8000-000000000023",
      verificationId: "00000000-0000-4000-8000-000000000033",
      source: "element_id,quantity\n1,2\n",
      location: "/projects/00000000-0000-4000-8000-000000000001",
    },
  ];

  for (const fixture of cases) {
    const identities = {
      ownerId: "00000000-0000-4000-8000-000000000002",
      projectId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000003",
    };
    const upload = verifiedUploadFixture({ ...fixture, ...identities });
    const { adminClient, client, observations, projectId, userId } =
      uploadActionFixture(Buffer.from(fixture.source), upload);
    globalThis[actionClientFactoryKey] = () => [client, new Headers()];
    globalThis[adminClientFactoryKey] = () => adminClient;
    const formData = new FormData();
    formData.set("intent", "upload");
    formData.set("upload_verification_id", fixture.verificationId);

    const response = await projectAction.action({
      request: new Request(`http://app.test/projects/${projectId}`, {
        method: "POST",
        body: formData,
      }),
      params: { projectId },
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), fixture.location);
    assert.equal(observations.storageDownloads.length, 0);
    assert.equal(observations.storageRemovals.length, 0);
    assert.deepEqual(observations.verificationFilters, [
      ["id", fixture.verificationId],
    ]);
    assert.deepEqual(observations.finalizationCalls, [
      {
        args: {
          p_actor_id: userId,
          p_project_id: projectId,
          p_verification_id: fixture.verificationId,
        },
        name: "lukas_qto_finalize_verified_upload",
      },
    ]);
  }
});

test("upload finalization rejects a browser-only verification claim without touching Storage", async () => {
  const { adminClient, client, observations, projectId } = uploadActionFixture(
    Buffer.alloc(99),
  );
  globalThis[actionClientFactoryKey] = () => [client, new Headers()];
  globalThis[adminClientFactoryKey] = () => adminClient;
  const formData = new FormData();
  formData.set("intent", "upload");
  formData.set(
    "upload_verification_id",
    "00000000-0000-4000-8000-000000000031",
  );

  const response = await projectAction.action({
    request: new Request(`http://app.test/projects/${projectId}`, {
      method: "POST",
      body: formData,
    }),
    params: { projectId },
  });

  assert.equal(response.init.status, 400);
  assert.equal(observations.finalizationCalls.length, 0);
  assert.equal(observations.storageDownloads.length, 0);
  assert.deepEqual(observations.storageRemovals, []);
});

test("replaying a consumed verification returns the same immutable file without deleting bytes", async () => {
  const source = Buffer.from("%PDF-1.7\ntrusted source\n");
  const createdFileId = "00000000-0000-4000-8000-000000000011";
  const verificationId = "00000000-0000-4000-8000-000000000031";
  const identities = {
    ownerId: "00000000-0000-4000-8000-000000000002",
    projectId: "00000000-0000-4000-8000-000000000001",
    userId: "00000000-0000-4000-8000-000000000003",
  };
  const upload = verifiedUploadFixture({
    createdFileId,
    filename: "A-101.pdf",
    kind: "pdf",
    mime: "application/pdf",
    objectId: "00000000-0000-4000-8000-000000000021",
    source,
    verificationId,
    ...identities,
  });
  upload.verifiedUpload.consumed_file_id = createdFileId;
  const { adminClient, client, observations, projectId } = uploadActionFixture(
    source,
    upload,
  );
  globalThis[actionClientFactoryKey] = () => [client, new Headers()];
  globalThis[adminClientFactoryKey] = () => adminClient;
  const formData = new FormData();
  formData.set("intent", "upload");
  formData.set("upload_verification_id", verificationId);

  const response = await projectAction.action({
    request: new Request(`http://app.test/projects/${projectId}`, {
      method: "POST",
      body: formData,
    }),
    params: { projectId },
  });

  assert.equal(response.status, 302);
  assert.match(response.headers.get("location"), new RegExp(createdFileId));
  assert.equal(observations.finalizationCalls.length, 1);
  assert.equal(observations.storageDownloads.length, 0);
  assert.deepEqual(observations.storageRemovals, []);
});

test("reviewer and site roles cannot register official preflight or takeoff artifacts", async () => {
  for (const [intent, role] of [
    ["preflight_upload", "reviewer"],
    ["takeoff_upload", "site"],
  ]) {
    const { adminClient, client, observations, projectId } =
      uploadActionFixture(Buffer.from("not-used"), {
        membershipRole: role,
      });
    globalThis[actionClientFactoryKey] = () => [client, new Headers()];
    globalThis[adminClientFactoryKey] = () => adminClient;
    const formData = new FormData();
    formData.set("intent", intent);
    formData.set("preflight_report", new File(["a"], "report.csv"));
    formData.set("preflight_manifest", new File(["b"], "manifest.csv"));
    formData.set("takeoff_report", new File(["a"], "report.csv"));
    formData.set("takeoff_manifest", new File(["b"], "manifest.csv"));

    const response = await projectAction.action({
      request: new Request(`http://app.test/projects/${projectId}`, {
        method: "POST",
        body: formData,
      }),
      params: { projectId },
    });

    assert.equal(response.init.status, 403, intent);
    assert.match(response.data.error, /적산 담당자만/);
    assert.equal(observations.storageDownloads.length, 0);
    assert.equal(observations.finalizationCalls.length, 0);
  }
});

test("atomic finalization failure preserves the verified object for a safe retry", async () => {
  const source = Buffer.from("%PDF-1.7\nverified source\n");
  const verificationId = "00000000-0000-4000-8000-000000000031";
  const identities = {
    ownerId: "00000000-0000-4000-8000-000000000002",
    projectId: "00000000-0000-4000-8000-000000000001",
    userId: "00000000-0000-4000-8000-000000000003",
  };
  const upload = verifiedUploadFixture({
    createdFileId: "00000000-0000-4000-8000-000000000011",
    filename: "A-101.pdf",
    kind: "pdf",
    mime: "application/pdf",
    objectId: "00000000-0000-4000-8000-000000000021",
    source,
    verificationId,
    ...identities,
  });
  const { adminClient, client, observations, projectId } = uploadActionFixture(
    source,
    {
      ...upload,
      finalizationError: { code: "XX000", message: "database unavailable" },
    },
  );
  globalThis[actionClientFactoryKey] = () => [client, new Headers()];
  globalThis[adminClientFactoryKey] = () => adminClient;
  const formData = new FormData();
  formData.set("intent", "upload");
  formData.set("upload_verification_id", verificationId);

  const response = await projectAction.action({
    request: new Request(`http://app.test/projects/${projectId}`, {
      method: "POST",
      body: formData,
    }),
    params: { projectId },
  });

  assert.equal(response.init.status, 500);
  assert.match(response.data.error, /파일 기록에 실패/);
  assert.equal(observations.finalizationCalls.length, 1);
  assert.deepEqual(observations.storageRemovals, []);
});

test("private route tree retains both the legacy room and the workspace", () => {
  const registered = privateWorkspaceRoute?.children?.map(
    (route) => route.path,
  );

  assert.ok(registered?.includes("/projects/:projectId/drawings/:fileId"));
  assert.ok(
    registered?.includes("/projects/:projectId/drawings/:fileId/workspace"),
  );
  assert.ok(registered?.includes("/projects/:projectId/workspace"));
});

test("drawing documents open canonically, original sources remain usable, and empty projects start without upload", () => {
  const cardHtml = renderComponent(projectDrawings.default, {
    loaderData: {
      canCreateWorkspace: true,
      project: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "1HK 테스트 프로젝트",
      },
      documents: [
        {
          id: "00000000-0000-4000-8000-000000000003",
          title: "A-101 적산",
          source_file_id: "00000000-0000-4000-8000-000000000002",
          updated_at: "2026-08-03T00:00:00.000Z",
        },
      ],
      files: [
        {
          id: "00000000-0000-4000-8000-000000000002",
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
      canCreateWorkspace: true,
      project: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "1HK 테스트 프로젝트",
      },
      documents: [],
      files: [],
    },
  });
  const ifcHtml = renderComponent(projectDrawings.default, {
    loaderData: {
      canCreateWorkspace: true,
      project: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "1HK 테스트 프로젝트",
      },
      documents: [],
      files: [
        {
          id: "00000000-0000-4000-8000-000000000004",
          kind: "ifc",
          original_filename: "MODEL.ifc",
          byte_size: 2048,
          created_at: "2026-08-02T00:00:00.000Z",
        },
      ],
    },
  });

  assert.match(
    cardHtml,
    /href="\/projects\/00000000-0000-4000-8000-000000000001\/workspaces\/00000000-0000-4000-8000-000000000003"/,
  );
  assert.match(cardHtml, /새 작업실/);
  assert.match(
    emptyHtml,
    /href="\/projects\/00000000-0000-4000-8000-000000000001\/workspaces\/new"/,
  );
  assert.match(emptyHtml, /새 작업실/);
  assert.match(
    ifcHtml,
    /href="\/projects\/00000000-0000-4000-8000-000000000001\/drawings\/00000000-0000-4000-8000-000000000004"/,
  );
  assert.doesNotMatch(
    ifcHtml,
    /drawings\/00000000-0000-4000-8000-000000000004\/workspace/,
  );
});

test("read-only drawing lists never expose workspace creation or legacy source creation traps", () => {
  const projectId = "00000000-0000-4000-8000-000000000001";
  const fileId = "00000000-0000-4000-8000-000000000002";
  const html = renderComponent(projectDrawings.default, {
    loaderData: {
      canCreateWorkspace: false,
      project: { id: projectId, name: "Viewer project" },
      documents: [],
      files: [
        {
          id: fileId,
          kind: "pdf",
          original_filename: "A-101.pdf",
          byte_size: 1024,
          created_at: "2026-08-02T00:00:00.000Z",
        },
      ],
    },
  });

  assert.doesNotMatch(
    html,
    new RegExp(`/projects/${projectId}/workspaces/new`),
  );
  assert.doesNotMatch(html, new RegExp(`/drawings/${fileId}/workspace`));
  assert.match(html, new RegExp(`href="/projects/${projectId}/files"`));
});

test("project root exposes the canonical workspace start and labels a file-and-drawing empty project", () => {
  const projectId = "00000000-0000-4000-8000-000000000001";
  const emptyHtml = renderProjectRoot(projectLoaderData());
  const populatedHtml = renderProjectRoot(
    projectLoaderData({
      drawingDocuments: [{ id: "00000000-0000-4000-8000-000000000003" }],
    }),
  );

  assert.match(emptyHtml, /아직 등록된 도면이 없습니다\./);
  assert.match(
    emptyHtml,
    new RegExp(
      `href="/projects/${projectId}/workspaces/new"[^>]*>[^<]*새 작업실`,
    ),
  );
  assert.match(populatedHtml, /새 작업실/);
  assert.match(
    populatedHtml,
    new RegExp(`href="/projects/${projectId}/workspaces/new"`),
  );
  assert.doesNotMatch(populatedHtml, /아직 등록된 도면이 없습니다\./);
});

test("read-only project root routes the workspace card to the drawing list", () => {
  const projectId = "00000000-0000-4000-8000-000000000001";
  const html = renderProjectRoot(
    projectLoaderData({ canCreateWorkspace: false, isOwner: false }),
  );
  assert.doesNotMatch(
    html,
    new RegExp(`/projects/${projectId}/workspaces/new`),
  );
  assert.match(html, new RegExp(`href="/projects/${projectId}/drawings"`));
  assert.match(html, /도면 목록/);
});

test("project root loader preserves zero drawing rows for the canonical empty entry", async () => {
  const fixture = projectRootLoaderFixture();
  globalThis[actionClientFactoryKey] = () => [fixture.client, new Headers()];

  const loaderData = await projectAction.loader({
    params: { projectId: fixture.projectId },
    request: new Request(`http://app.test/projects/${fixture.projectId}`),
  });

  assert.deepEqual(loaderData.files, []);
  assert.deepEqual(loaderData.drawingDocuments, []);
  assert.ok(
    fixture.observations.filters.some(
      (filter) =>
        filter.table === "lukas_drawing_documents" &&
        filter.column === "project_id" &&
        filter.value === fixture.projectId,
    ),
  );
  const html = renderProjectRoot(loaderData);
  assert.match(
    html,
    new RegExp(`href="/projects/${fixture.projectId}/workspaces/new"`),
  );
});

test("workspace dashboard opens documents canonically, starts empty projects, and preserves preview routing", () => {
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
    /href="\/projects\/00000000-0000-4000-8000-000000000001\/workspaces\/00000000-0000-4000-8000-000000000002"/,
  );
  assert.match(
    emptyHtml,
    /href="\/projects\/00000000-0000-4000-8000-000000000001\/workspaces\/new"/,
  );
  assert.match(emptyHtml, /새 작업실/);
  assert.match(
    previewHtml,
    /href="\/workspace-preview\/projects\/00000000-0000-4000-8000-000000000001\/drawings\/00000000-0000-4000-8000-000000000002"/,
  );
});

test("read-only dashboard project cards open the drawing list instead of workspace creation", () => {
  const projectId = "00000000-0000-4000-8000-000000000001";
  const fixture = workspaceFixture({ drawingId: null });
  fixture.projectMetrics[projectId].canCreateWorkspace = false;
  const html = renderComponent(workspaceDashboard.WorkspaceDashboard, fixture);

  assert.doesNotMatch(
    html,
    new RegExp(`/projects/${projectId}/workspaces/new`),
  );
  assert.match(html, new RegExp(`href="/projects/${projectId}/drawings"`));
  assert.match(html, /도면 목록/);
});

test("workspace loader renders only drawing document IDs as canonical dashboard destinations", async () => {
  const fixture = workspaceLoaderFixture();
  globalThis[workspaceClientFactoryKey] = () => [fixture.client];
  globalThis[workspaceMetricsKey] = {};

  const loaderData = await workspaceScreen.loader({
    request: new Request("http://app.test/workspace"),
    params: {},
  });
  const html = renderComponent(workspaceScreen.default, { loaderData });

  assert.match(
    html,
    new RegExp(
      `href="/projects/${fixture.projectWithDocument}/workspaces/${fixture.documentId}"`,
    ),
  );
  assert.match(
    html,
    new RegExp(
      `href="/projects/${fixture.projectWithFileOnly}/workspaces/new"`,
    ),
  );
  assert.doesNotMatch(
    html,
    new RegExp(
      `/projects/${fixture.projectWithDocument}/workspaces/${fixture.documentSourceFileId}`,
    ),
  );
  assert.doesNotMatch(
    html,
    new RegExp(
      `/projects/${fixture.projectWithFileOnly}/workspaces/${fixture.fileOnlyId}`,
    ),
  );
  const documentQuery = fixture.observations.find(
    ({ table }) => table === "lukas_drawing_documents",
  );
  assert.deepEqual(documentQuery?.orders, [
    ["updated_at", { ascending: false }],
    ["id", { ascending: false }],
  ]);
});

test("every start choice has a contextual submit name and the failed field owns its error", () => {
  const blankPair = {
    clientRequestId: "00000000-0000-4000-8000-000000000051",
    clientCreatedAt: "2026-08-31T01:02:03.000Z",
  };
  const starterPair = {
    clientRequestId: "00000000-0000-4000-8000-000000000052",
    clientCreatedAt: "2026-08-31T01:02:03.000Z",
  };
  const libraryPair = {
    clientRequestId: "00000000-0000-4000-8000-000000000053",
  };
  const pdfPair = {
    clientRequestId: "00000000-0000-4000-8000-000000000054",
    clientCreatedAt: "2026-08-31T01:02:03.000Z",
  };
  const starter = {
    definition: {
      key: "interior-basic",
      name: "실내건축 기본 적산",
      description: "기본 적산 템플릿",
    },
  };
  const template = {
    id: "00000000-0000-4000-8000-000000000055",
    version_no: 3,
    entry: { name: "표준 템플릿" },
  };
  const file = {
    id: "00000000-0000-4000-8000-000000000056",
    original_filename: "A-101.pdf",
  };
  const html = renderStartComponent({
    actionData: {
      ok: false,
      fieldErrors: { title: "작업실 이름을 입력하세요." },
      formError: "입력값을 확인하세요.",
      clientRequestId: blankPair.clientRequestId,
      clientCreatedAt: blankPair.clientCreatedAt,
    },
    loaderData: {
      project: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "1HK 테스트 프로젝트",
      },
      starters: [starter],
      organizationTemplates: [template],
      files: [file],
      requestPairs: {
        blank: blankPair,
        starters: { [starter.definition.key]: starterPair },
        libraryTemplates: { [template.id]: libraryPair },
        pdfs: { [file.id]: pdfPair },
      },
    },
  });

  assert.match(html, /<button[^>]*>빈 작업실로 시작<\/button>/);
  assert.match(
    html,
    /<button[^>]*>실내건축 기본 적산 템플릿으로 시작<\/button>/,
  );
  assert.match(html, /<button[^>]*>표준 템플릿 회사 템플릿으로 시작<\/button>/);
  assert.match(html, /<button[^>]*>A-101\.pdf PDF로 시작<\/button>/);
  assert.doesNotMatch(html, />이 선택으로 시작<\/button>/);
  assert.match(
    html,
    /<input(?=[^>]*id="start-blank-title")(?=[^>]*aria-invalid="true")(?=[^>]*aria-describedby="start-blank-title-error")[^>]*>/,
  );
  assert.match(
    html,
    /<p[^>]*id="start-blank-title-error"[^>]*>작업실 이름을 입력하세요\.<\/p>/,
  );
  assert.equal(html.match(/aria-invalid="true"/g)?.length, 1);
});
