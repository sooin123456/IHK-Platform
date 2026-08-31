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
globalThis[actionClientFactoryKey] = () => {
  throw new Error("Upload action test client is not configured.");
};
globalThis[adminClientFactoryKey] = () => {
  throw new Error("Upload action admin client is not configured.");
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

const [
  drawingEntry,
  rootScreen,
  navigationLayout,
  projectDrawings,
  projectScreen,
  projectFileUpload,
  workspaceDashboard,
  projectAction,
] = await Promise.all([
  vite.ssrLoadModule("/app/lukas/lib/drawing-entry.ts"),
  vite.ssrLoadModule("/app/root.tsx"),
  vite.ssrLoadModule("/app/core/layouts/navigation.layout.tsx"),
  vite.ssrLoadModule("/app/lukas/screens/project-drawings.tsx"),
  vite.ssrLoadModule("/app/lukas/screens/project.tsx"),
  vite.ssrLoadModule("/app/lukas/lib/project-file-upload.ts"),
  vite.ssrLoadModule("/app/lukas/components/workspace-dashboard.tsx"),
  actionVite.ssrLoadModule("/app/lukas/screens/project.tsx"),
]);

test.after(async () => {
  delete globalThis[actionClientFactoryKey];
  delete globalThis[adminClientFactoryKey];
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

test("a project workspace path does not require a drawing file id", () => {
  assert.equal(
    drawingEntry.drawingProjectWorkspacePath("project-a"),
    "/projects/project-a/workspace",
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
        "/projects/00000000-0000-4000-8000-000000000001/drawings/00000000-0000-4000-8000-000000000011/workspace",
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
        "/projects/00000000-0000-4000-8000-000000000001/drawings/00000000-0000-4000-8000-000000000012/workspace",
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
  assert.match(emptyHtml, /href="\/projects\/project-a\/workspace"/);
  assert.match(emptyHtml, /빈 작업실/);
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
  assert.match(emptyHtml, /href="\/projects\/project-a\/workspace"/);
  assert.match(
    previewHtml,
    /href="\/workspace-preview\/projects\/project-a\/drawings\/file-a"/,
  );
});
