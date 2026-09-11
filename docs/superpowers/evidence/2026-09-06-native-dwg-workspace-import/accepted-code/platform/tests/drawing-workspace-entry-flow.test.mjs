import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import React from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { ThemeProvider } from "remix-themes";
import { createServer } from "vite";

import routes from "../app/routes.ts";

function routeData(result) {
  assert.ok(result && typeof result === "object", "loader must return data");
  assert.ok("data" in result, "loader must return a React Router data payload");
  assert.notEqual(result.data, undefined, "loader data must be defined");
  if (result.init?.headers !== undefined)
    assert.ok(
      result.init.headers instanceof Headers,
      "loader data headers must be a Headers instance",
    );
  return result.data;
}

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
const workspaceStarterKey = "__drawingWorkspaceStarter";
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
globalThis[workspaceStarterKey] = async () => {
  throw new Error("Workspace starter test boundary is not configured.");
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
        if (
          /\/app\/core\/lib\/supa-client\.server(?:\.ts)?$/.test(source) ||
          source === "../lib/supa-client.server"
        )
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
        if (id === "\0virtual:workspace-starter")
          return `export async function createDrawingWorkspaceStart(...args) { return globalThis[${JSON.stringify(workspaceStarterKey)}](...args); }`;
      },
      name: "workspace-loader-client",
      resolveId(source) {
        if (source.endsWith("/app/core/lib/supa-client.server"))
          return "\0virtual:workspace-loader-client";
        if (source.endsWith("/app/lukas/lib/drawing-collaboration.server"))
          return "\0virtual:workspace-loader-metrics";
        if (source.endsWith("/app/lukas/lib/drawing-starter-templates.server"))
          return "\0virtual:workspace-starter";
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
  privateLayout,
  publicLayout,
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
  actionVite.ssrLoadModule("/app/core/layouts/private.layout.tsx"),
  actionVite.ssrLoadModule("/app/core/layouts/public.layout.tsx"),
]);

test.after(async () => {
  delete globalThis[actionClientFactoryKey];
  delete globalThis[adminClientFactoryKey];
  delete globalThis[workspaceClientFactoryKey];
  delete globalThis[workspaceMetricsKey];
  delete globalThis[workspaceStarterKey];
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

function routeFiles(route) {
  return [route.file, ...(route.children ?? []).flatMap(routeFiles)];
}

test("every private route guard keeps the requested return address", () => {
  assert.ok(privateWorkspaceRoute);
  for (const file of routeFiles(privateWorkspaceRoute)) {
    const source = readFileSync(
      new URL(`../app/${file}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /redirect\(\s*["']\/(?:login|auth\/magic-link)["']\s*(?:,|\))/,
      `${file} drops the requested return address`,
    );
  }
});

test("every request-derived private auth redirect preserves Supabase headers", () => {
  assert.ok(privateWorkspaceRoute);
  for (const file of [
    ...routeFiles(privateWorkspaceRoute),
    "lukas/lib/drawing-collaboration.server.ts",
  ]) {
    const source = readFileSync(
      new URL(`../app/${file}`, import.meta.url),
      "utf8",
    );
    if (!/auth(?:Login|MagicLink)Path\(request\.url\)/.test(source)) continue;
    assert.match(
      source,
      /redirect\(auth(?:Login|MagicLink)Path\(request\.url\), \{ headers \}\)/,
      `${file} drops Supabase response headers during authentication redirect`,
    );
    assert.doesNotMatch(
      source,
      /redirect\(auth(?:Login|MagicLink)Path\(request\.url\)\)/,
      `${file} has an authentication redirect without Supabase response headers`,
    );
  }
});

test("private layout redirects anonymous deep links with refreshed session cookies", async () => {
  const headers = new Headers({
    "Set-Cookie": "session=layout; Path=/; HttpOnly",
  });
  globalThis[actionClientFactoryKey] = () => [
    { auth: { getUser: async () => ({ data: { user: null } }) } },
    headers,
  ];

  await assert.rejects(
    privateLayout.loader({
      params: {},
      request: new Request("http://app.test/projects/project-42?tab=review"),
    }),
    (response) => {
      assert.equal(response.status, 302);
      assert.equal(
        response.headers.get("Location"),
        "/login?next=%2Fprojects%2Fproject-42%3Ftab%3Dreview",
      );
      assert.equal(
        response.headers.get("Set-Cookie"),
        "session=layout; Path=/; HttpOnly",
      );
      return true;
    },
  );
});

test("private layout keeps refreshed cookies for authenticated requests", async () => {
  const headers = new Headers({
    "Set-Cookie": "session=private-success; Path=/; HttpOnly",
  });
  globalThis[actionClientFactoryKey] = () => [
    {
      auth: {
        getUser: async () => ({ data: { user: { is_anonymous: false } } }),
      },
    },
    headers,
  ];

  const response = await privateLayout.loader({
    params: {},
    request: new Request("http://app.test/workspace"),
  });
  assert.deepEqual(response.data, {});
  assert.equal(
    response.init.headers.get("Set-Cookie"),
    "session=private-success; Path=/; HttpOnly",
  );
});

test("public layout preserves refreshed cookies for both redirect and success", async () => {
  const redirectHeaders = new Headers({
    "Set-Cookie": "session=public-redirect; Path=/; HttpOnly",
  });
  globalThis[actionClientFactoryKey] = () => [
    {
      auth: {
        getUser: async () => ({ data: { user: { is_anonymous: false } } }),
      },
    },
    redirectHeaders,
  ];
  await assert.rejects(
    publicLayout.loader({
      params: {},
      request: new Request("http://app.test/login"),
    }),
    (response) => {
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("Location"), "/workspace");
      assert.equal(
        response.headers.get("Set-Cookie"),
        "session=public-redirect; Path=/; HttpOnly",
      );
      return true;
    },
  );

  const successHeaders = new Headers({
    "Set-Cookie": "session=public-success; Path=/; HttpOnly",
  });
  globalThis[actionClientFactoryKey] = () => [
    { auth: { getUser: async () => ({ data: { user: null } }) } },
    successHeaders,
  ];
  const response = await publicLayout.loader({
    params: {},
    request: new Request("http://app.test/login"),
  });
  assert.deepEqual(response.data, {});
  assert.equal(
    response.init.headers.get("Set-Cookie"),
    "session=public-success; Path=/; HttpOnly",
  );
});

test("private leaf actions redirect unauthenticated requests with their return address", () => {
  const actionFiles = [
    "lukas/screens/project.tsx",
    "lukas/screens/workspace.tsx",
    "lukas/screens/material-control.tsx",
    "lukas/screens/information-requirements.tsx",
  ];
  for (const file of actionFiles) {
    const source = readFileSync(
      new URL(`../app/${file}`, import.meta.url),
      "utf8",
    );
    const actionSource = source.slice(
      source.indexOf("export async function action"),
    );
    assert.match(actionSource, /authLoginPath\(request\.url\)/, file);
    assert.doesNotMatch(actionSource, /status:\s*401/, file);
  }
});

test("workspace and project actions authenticate before parsing request bodies", () => {
  for (const file of [
    "lukas/screens/workspace.tsx",
    "lukas/screens/project.tsx",
    "lukas/screens/drawing-workspace-new.tsx",
    "lukas/screens/organization-drawing-library.tsx",
    "lukas/screens/organization-retention.tsx",
    "lukas/screens/organization-settings.tsx",
  ]) {
    const source = readFileSync(
      new URL(`../app/${file}`, import.meta.url),
      "utf8",
    );
    const actionSource = source.slice(
      source.indexOf("export async function action"),
    );
    const authIndex = Math.max(
      actionSource.indexOf("await client.auth.getUser()"),
      actionSource.indexOf("await context("),
      actionSource.indexOf("await drawingContext("),
    );
    assert.ok(
      authIndex < actionSource.indexOf("await request.formData()"),
      `${file} parses an unauthenticated request body before redirecting`,
    );
  }
});

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

function renderProjectForm(kind = "pdf", overrides = {}, returnTo = null) {
  const loaderData = projectLoaderData(overrides);
  const search = new URLSearchParams({ kind });
  if (returnTo) search.set("returnTo", returnTo);
  const router = createMemoryRouter(
    [
      {
        path: "/projects/:projectId/files",
        element: React.createElement(projectScreen.default, { loaderData }),
      },
    ],
    {
      initialEntries: [
        `/projects/00000000-0000-4000-8000-000000000001/files?${search}`,
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
    workspaceRevision = null,
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
    workspaceFilters: [],
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
      if (table === "lukas_drawing_revisions")
        return query(
          { data: workspaceRevision, error: null },
          (column, value) =>
            observations.workspaceFilters.push({ column, table, value }),
        );
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
          select(fields) {
            return query(
              {
                data:
                  verifiedUpload &&
                  Object.fromEntries(
                    fields
                      .split(",")
                      .map((field) => [
                        field.trim(),
                        verifiedUpload[field.trim()],
                      ]),
                  ),
                error: null,
              },
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
      ...(kind === "dwg" ? { dwgHeaderVersion: "AC1032" } : {}),
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
      ...(kind === "dwg" ? { dwg_header_version: "AC1032" } : {}),
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
  const router = createMemoryRouter(
    [{ path: "*", element: React.createElement(Component, props) }],
    { initialEntries: [url] },
  );
  return renderToStaticMarkup(
    withTheme(React.createElement(RouterProvider, { router })),
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
        title: "문서가 있는 프로젝트 도면",
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
        eq(column, value) {
          call.filters.push(["eq", column, value]);
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

function workspaceScopeLoaderFixture({ isStaff = false } = {}) {
  const userId = "00000000-0000-4000-8000-000000000101";
  const otherUserId = "00000000-0000-4000-8000-000000000102";
  const personalOrganizationId = "00000000-0000-4000-8000-000000000103";
  const teamOrganizationId = "00000000-0000-4000-8000-000000000104";
  const outsideOrganizationId = "00000000-0000-4000-8000-000000000105";
  const personalProjectId = "00000000-0000-4000-8000-000000000106";
  const teamProjectId = "00000000-0000-4000-8000-000000000107";
  const sharedProjectId = "00000000-0000-4000-8000-000000000108";
  const otherPersonalOrganizationId = "00000000-0000-4000-8000-000000000109";
  const globalOrganizationId = "00000000-0000-4000-8000-000000000110";
  const globalProjectId = "00000000-0000-4000-8000-000000000111";
  const observations = [];
  const rows = {
    lukas_qto_projects: [
      {
        id: personalProjectId,
        organization_id: personalOrganizationId,
        owner_id: userId,
        name: "내 프로젝트",
        description: "personal",
        workflow_status: "confirmed",
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-04T00:00:00.000Z",
      },
      {
        id: teamProjectId,
        organization_id: teamOrganizationId,
        owner_id: otherUserId,
        name: "팀 프로젝트",
        description: "team",
        workflow_status: "confirmed",
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-03T00:00:00.000Z",
      },
      {
        id: sharedProjectId,
        organization_id: outsideOrganizationId,
        owner_id: otherUserId,
        name: "직접 공유 프로젝트",
        description: "shared",
        workflow_status: "confirmed",
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-02T00:00:00.000Z",
      },
      ...(isStaff
        ? [
            {
              id: globalProjectId,
              organization_id: globalOrganizationId,
              owner_id: otherUserId,
              name: "운영자에게만 보이는 전역 프로젝트",
              description: "staff global",
              workflow_status: "confirmed",
              created_at: "2026-08-01T00:00:00.000Z",
              updated_at: "2026-08-01T00:00:00.000Z",
            },
          ]
        : []),
    ],
    lukas_qto_organization_members: [
      {
        organization_id: personalOrganizationId,
        user_id: userId,
        role: "owner",
      },
      {
        organization_id: teamOrganizationId,
        user_id: userId,
        role: "member",
      },
      {
        organization_id: teamOrganizationId,
        user_id: otherUserId,
        role: "admin",
      },
      {
        organization_id: otherPersonalOrganizationId,
        user_id: userId,
        role: "member",
      },
    ],
    lukas_qto_organizations: [
      {
        id: otherPersonalOrganizationId,
        is_personal: true,
        name: "다른 사람의 개인 공간",
        owner_id: otherUserId,
      },
      {
        id: personalOrganizationId,
        is_personal: true,
        name: "내 공간",
        owner_id: userId,
      },
      {
        id: teamOrganizationId,
        is_personal: false,
        name: "설계팀",
        owner_id: otherUserId,
      },
      {
        id: outsideOrganizationId,
        is_personal: false,
        name: "가입하지 않은 회사",
        owner_id: otherUserId,
      },
    ],
    lukas_qto_files: [],
    lukas_drawing_documents: [],
    lukas_qto_reviews: [],
    lukas_qto_project_members: [
      { project_id: sharedProjectId, user_id: userId, role: "viewer" },
    ],
  };
  const client = {
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: userId,
            email: "member@example.com",
            is_anonymous: false,
            app_metadata: isStaff ? { role: "hangil_staff" } : {},
          },
        },
      }),
    },
    from(table) {
      const call = { table, filters: [], orders: [], select: null };
      observations.push(call);
      const chain = {
        eq(column, value) {
          call.filters.push(["eq", column, value]);
          return chain;
        },
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
    globalProjectId,
    observations,
    otherPersonalOrganizationId,
    personalOrganizationId,
    personalProjectId,
    sharedProjectId,
    teamOrganizationId,
    teamProjectId,
    userId,
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

test("DXF import stays separate from the first-class stored DWG original", () => {
  assert.equal(drawingEntry.projectFileKindPolicy?.dxf?.label, "DXF 도면");
  assert.match(drawingEntry.projectFileKindPolicy?.dxf?.help ?? "", /DXF/);
  assert.equal(
    drawingEntry.projectFileKindPolicy?.dxf?.accept,
    ".dxf,application/dxf,application/x-dxf,image/vnd.dxf,text/plain,application/octet-stream",
  );
  assert.equal(drawingEntry.fileMatchesProjectKind?.("dxf", "PLAN.DXF"), true);
  assert.equal(drawingEntry.fileMatchesProjectKind?.("dxf", "PLAN.DWG"), false);
  assert.equal(
    drawingEntry.contentTypeMatchesProjectKind?.("dxf", "application/dxf"),
    true,
  );
  assert.equal(
    drawingEntry.contentTypeMatchesProjectKind?.("dxf", "application/pdf"),
    false,
  );
  assert.match(
    drawingEntry.projectFileKindMismatchMessage?.("dxf", "PLAN.DWG") ?? "",
    /DWG.*DWG 원본 종류/,
  );
  assert.equal(
    drawingEntry.fileMatchesProjectKind?.("other", "PLAN.DWG"),
    true,
  );
  assert.equal(
    drawingEntry.projectFileKindMismatchMessage?.("other", "PLAN.DWG"),
    null,
  );

  const html = renderProjectForm("dxf");
  assert.match(html, /<option value="dxf" selected="">DXF 도면<\/option>/);
  assert.match(
    html,
    /<input[^>]*accept="\.dxf,application\/dxf,application\/x-dxf,image\/vnd\.dxf,text\/plain,application\/octet-stream"[^>]*id="source_file"/,
  );
});

test("DWG uploader and both responsive file lists expose native workspace entry", () => {
  const fileId = "00000000-0000-4000-8000-000000000099";
  const html = renderProjectForm("dwg", {
    files: [
      {
        id: fileId,
        kind: "dwg",
        original_filename: "PLAN.DWG",
        byte_size: 9,
        sha256: "a".repeat(64),
      },
    ],
  });
  assert.match(html, /<option value="dwg" selected="">DWG 원본<\/option>/);
  assert.doesNotMatch(html, /원본 보관 완료 · 편집 호환성 미검증/);
  assert.match(html, new RegExp(`/files/${fileId}/download`));
  assert.match(
    html,
    new RegExp(`/workspaces/new\\?sourceFileId=${fileId}`),
  );
});

test("verified PDF, IFC, DXF, and DWG uploads all continue in the canonical workspace start", () => {
  const input = {
    projectId: "00000000-0000-4000-8000-000000000001",
    fileId: "00000000-0000-4000-8000-000000000002",
    returnPath: "/projects/00000000-0000-4000-8000-000000000001",
  };

  assert.equal(
    drawingEntry.projectUploadDestination?.({ ...input, kind: "ifc" }),
    "/projects/00000000-0000-4000-8000-000000000001/workspaces/new?sourceFileId=00000000-0000-4000-8000-000000000002",
  );
  assert.equal(
    drawingEntry.projectUploadDestination?.({ ...input, kind: "pdf" }),
    "/projects/00000000-0000-4000-8000-000000000001/workspaces/new?sourceFileId=00000000-0000-4000-8000-000000000002",
  );
  assert.equal(
    drawingEntry.projectUploadDestination?.({ ...input, kind: "qto_csv" }),
    "/projects/00000000-0000-4000-8000-000000000001",
  );
  assert.equal(
    drawingEntry.projectUploadDestination?.({ ...input, kind: "dxf" }),
    "/projects/00000000-0000-4000-8000-000000000001/workspaces/new?sourceFileId=00000000-0000-4000-8000-000000000002",
  );
  assert.equal(
    drawingEntry.projectUploadDestination?.({ ...input, kind: "dwg" }),
    "/projects/00000000-0000-4000-8000-000000000001/workspaces/new?sourceFileId=00000000-0000-4000-8000-000000000002",
  );
});

test("workspace-return uploads preserve PDF, DXF, and native DWG kinds", () => {
  const returnTo =
    "/projects/00000000-0000-4000-8000-000000000001/workspaces/00000000-0000-4000-8000-000000000003";
  for (const kind of ["pdf", "dxf", "dwg"]) {
    const html = renderProjectForm(kind, {}, returnTo);
    assert.match(html, /<option[^>]*value="dwg"/);
    assert.match(html, new RegExp(`<option value="${kind}" selected="">`));
    assert.match(
      html,
      new RegExp(
        `<input[^>]*accept="\\.${kind}[^"]*"[^>]*id="source_file"`,
      ),
    );
    assert.match(html, new RegExp(`name="return_to"[^>]*value="${returnTo}"`));
  }
  assert.match(renderProjectForm("dwg"), /<option value="dwg" selected="">/);
});

test("a workspace DWG upload returns to the canonical workspace with native preselection", () => {
  const projectId = "00000000-0000-4000-8000-000000000001";
  const fileId = "00000000-0000-4000-8000-000000000002";
  const workspaceId = "00000000-0000-4000-8000-000000000003";
  const returnTo = `/projects/${projectId}/workspaces/${workspaceId}`;

  assert.equal(
    drawingEntry.drawingWorkspaceDwgUploadPath?.(projectId, workspaceId),
    `/projects/${projectId}/files?kind=dwg&returnTo=%2Fprojects%2F${projectId}%2Fworkspaces%2F${workspaceId}#upload`,
  );
  assert.equal(
    drawingEntry.projectUploadDestination?.({
      fileId,
      kind: "dwg",
      projectId,
      returnPath: `/projects/${projectId}/files`,
      returnTo,
    }),
    `${returnTo}?dwgSourceFileId=${fileId}`,
  );
});

test("a workspace DXF upload returns only to the exact same-project workspace and selects the verified file", () => {
  const projectId = "00000000-0000-4000-8000-000000000001";
  const fileId = "00000000-0000-4000-8000-000000000002";
  const workspaceId = "00000000-0000-4000-8000-000000000003";
  const returnTo = `/projects/${projectId}/workspaces/${workspaceId}`;

  assert.equal(
    drawingEntry.drawingWorkspaceDxfUploadPath?.(projectId, workspaceId),
    `/projects/${projectId}/files?kind=dxf&returnTo=%2Fprojects%2F${projectId}%2Fworkspaces%2F${workspaceId}#upload`,
  );
  assert.equal(
    drawingEntry.parseDrawingWorkspaceUploadReturnPath?.(projectId, returnTo),
    returnTo,
  );
  assert.equal(
    drawingEntry.projectUploadDestination?.({
      fileId,
      kind: "dxf",
      projectId,
      returnPath: `/projects/${projectId}/files`,
      returnTo,
    }),
    `${returnTo}?dxfSourceFileId=${fileId}`,
  );
  for (const unsafe of [
    "https://attacker.invalid/collect",
    `/projects/00000000-0000-4000-8000-000000000099/workspaces/${workspaceId}`,
    `${returnTo}?view=split`,
    `/projects/${projectId}/workspaces/new`,
  ])
    assert.throws(
      () =>
        drawingEntry.parseDrawingWorkspaceUploadReturnPath?.(projectId, unsafe),
      /작업실 복귀 주소/,
      unsafe,
    );

  const formHtml = renderProjectForm("dxf", {}, returnTo);
  assert.match(
    formHtml,
    new RegExp(
      `<input[^>]*name="return_to"[^>]*value="${returnTo}"|<input[^>]*value="${returnTo}"[^>]*name="return_to"`,
    ),
  );
});

test("a workspace PDF upload returns to the exact source-free workspace for attachment", () => {
  const projectId = "00000000-0000-4000-8000-000000000001";
  const fileId = "00000000-0000-4000-8000-000000000002";
  const workspaceId = "00000000-0000-4000-8000-000000000003";
  const returnTo = `/projects/${projectId}/workspaces/${workspaceId}`;

  assert.equal(
    drawingEntry.drawingWorkspacePdfUploadPath?.(projectId, workspaceId),
    `/projects/${projectId}/files?kind=pdf&returnTo=%2Fprojects%2F${projectId}%2Fworkspaces%2F${workspaceId}#upload`,
  );
  assert.equal(
    drawingEntry.projectUploadDestination?.({
      fileId,
      kind: "pdf",
      projectId,
      returnPath: `/projects/${projectId}/files`,
      returnTo,
    }),
    returnTo,
  );
});

test("verified PDF finalization preserves the validated workspace return", async () => {
  const fixture = {
    createdFileId: "00000000-0000-4000-8000-000000000013",
    filename: "PLAN.PDF",
    kind: "pdf",
    mime: "application/pdf",
    objectId: "00000000-0000-4000-8000-000000000023",
    ownerId: "00000000-0000-4000-8000-000000000002",
    projectId: "00000000-0000-4000-8000-000000000001",
    source: "%PDF-1.7\n%%EOF\n",
    userId: "00000000-0000-4000-8000-000000000003",
    verificationId: "00000000-0000-4000-8000-000000000033",
  };
  const workspaceId = "00000000-0000-4000-8000-000000000041";
  const returnTo = `/projects/${fixture.projectId}/workspaces/${workspaceId}`;
  const upload = verifiedUploadFixture(fixture);
  const { adminClient, client, observations } = uploadActionFixture(
    Buffer.from(fixture.source),
    {
      ...upload,
      membershipRole: "estimator",
      workspaceRevision: {
        document_id: workspaceId,
        id: "00000000-0000-4000-8000-000000000042",
        project_id: fixture.projectId,
        status: "draft",
      },
    },
  );
  globalThis[actionClientFactoryKey] = () => [client, new Headers()];
  globalThis[adminClientFactoryKey] = () => adminClient;
  const formData = new FormData();
  formData.set("intent", "upload");
  formData.set("upload_verification_id", fixture.verificationId);
  formData.set("return_to", returnTo);

  const response = await projectAction.action({
    request: new Request(
      `http://app.test/projects/${fixture.projectId}/files`,
      { method: "POST", body: formData },
    ),
    params: { projectId: fixture.projectId },
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), returnTo);
  assert.equal(observations.finalizationCalls.length, 1);
});

test("browser upload recovery receives a confirmed same-origin destination instead of an early redirect", async () => {
  const fixture = {
    createdFileId: "00000000-0000-4000-8000-000000000013",
    filename: "PLAN.PDF",
    kind: "pdf",
    mime: "application/pdf",
    objectId: "00000000-0000-4000-8000-000000000023",
    ownerId: "00000000-0000-4000-8000-000000000002",
    projectId: "00000000-0000-4000-8000-000000000001",
    source: "%PDF-1.7\n%%EOF\n",
    userId: "00000000-0000-4000-8000-000000000003",
    verificationId: "00000000-0000-4000-8000-000000000033",
  };
  const workspaceId = "00000000-0000-4000-8000-000000000041";
  const returnTo = `/projects/${fixture.projectId}/workspaces/${workspaceId}`;
  const upload = verifiedUploadFixture(fixture);
  const { adminClient, client, observations } = uploadActionFixture(
    Buffer.from(fixture.source),
    {
      ...upload,
      membershipRole: "estimator",
      workspaceRevision: {
        document_id: workspaceId,
        id: "00000000-0000-4000-8000-000000000042",
        project_id: fixture.projectId,
        status: "draft",
      },
    },
  );
  globalThis[actionClientFactoryKey] = () => [client, new Headers()];
  globalThis[adminClientFactoryKey] = () => adminClient;
  const formData = new FormData();
  formData.set("intent", "upload");
  formData.set("upload_verification_id", fixture.verificationId);
  formData.set("upload_response_mode", "browser_recovery");
  formData.set("return_to", returnTo);

  const response = await projectAction.action({
    request: new Request(
      `http://app.test/projects/${fixture.projectId}/files`,
      { method: "POST", body: formData },
    ),
    params: { projectId: fixture.projectId },
  });

  assert.deepEqual(response.data, { destination: returnTo });
  assert.equal(response.init.headers instanceof Headers, true);
  assert.equal(observations.finalizationCalls.length, 1);
});

test("authenticated browser recovery carries refreshed session headers without reauthenticating the stale request", async () => {
  const fixture = {
    createdFileId: "00000000-0000-4000-8000-000000000013",
    filename: "PLAN.PDF",
    kind: "pdf",
    mime: "application/pdf",
    objectId: "00000000-0000-4000-8000-000000000023",
    ownerId: "00000000-0000-4000-8000-000000000002",
    projectId: "00000000-0000-4000-8000-000000000001",
    source: "%PDF-1.7\n%%EOF\n",
    userId: "00000000-0000-4000-8000-000000000003",
    verificationId: "00000000-0000-4000-8000-000000000033",
  };
  const workspaceId = "00000000-0000-4000-8000-000000000041";
  const returnTo = `/projects/${fixture.projectId}/workspaces/${workspaceId}`;
  const upload = verifiedUploadFixture(fixture);
  const { adminClient, client, observations } = uploadActionFixture(
    Buffer.from(fixture.source),
    {
      ...upload,
      membershipRole: "estimator",
      workspaceRevision: {
        document_id: workspaceId,
        id: "00000000-0000-4000-8000-000000000042",
        project_id: fixture.projectId,
        status: "draft",
      },
    },
  );
  let repeatedAuthenticationCalls = 0;
  client.auth.getUser = async () => {
    repeatedAuthenticationCalls += 1;
    throw new Error("the stale request cookie must not be authenticated again");
  };
  globalThis[adminClientFactoryKey] = () => adminClient;
  const headers = new Headers({
    "Set-Cookie": "session=refreshed; Path=/; HttpOnly",
  });

  const formData = new FormData();
  formData.set("intent", "upload");
  formData.set("upload_response_mode", "browser_recovery");
  formData.set("upload_verification_id", fixture.verificationId);
  formData.set("return_to", returnTo);
  const user = {
    app_metadata: {},
    id: fixture.userId,
    is_anonymous: false,
  };

  const response = await projectAction.action(
    {
      params: { projectId: fixture.projectId },
      request: new Request(
        `http://app.test/projects/${fixture.projectId}/files`,
        {
          body: formData,
          headers: { Cookie: "session=stale" },
          method: "POST",
        },
      ),
    },
    {
      client,
      headers,
      user,
    },
  );

  assert.deepEqual(response.data, { destination: returnTo });
  assert.equal(
    response.init.headers.get("Set-Cookie"),
    "session=refreshed; Path=/; HttpOnly",
  );
  assert.equal(repeatedAuthenticationCalls, 0);
  assert.equal(observations.finalizationCalls.length, 1);
});

test("read-only project files hide upload controls that the server will reject", () => {
  const html = renderProjectForm("pdf", {
    canCreateWorkspace: false,
    files: [
      {
        id: "00000000-0000-4000-8000-000000000009",
        kind: "pdf",
        original_filename: "VIEW-ONLY.pdf",
        byte_size: 1024,
        sha256: "a".repeat(64),
      },
    ],
    isOwner: false,
  });

  assert.doesNotMatch(html, /<h2[^>]*>파일 추가<\/h2>/);
  assert.doesNotMatch(html, /name="source_file"/);
  assert.doesNotMatch(html, />파일 업로드<\/button>/);
  assert.match(html, /프로젝트 파일 \(1\)/);
  assert.match(html, /VIEW-ONLY\.pdf/);
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

test("DXF upload validates extension and MIME before Storage while DWG can remain an other source", async () => {
  const uploads = [];
  const upload = async (storagePath) => {
    uploads.push(storagePath);
    return { error: null };
  };
  const scope = {
    ownerId: "00000000-0000-4000-8000-000000000002",
    projectId: "00000000-0000-4000-8000-000000000001",
    upload,
  };

  const dxf = await projectFileUpload.uploadProjectFileDirect({
    ...scope,
    file: new File(["0\nSECTION\n0\nEOF\n"], " PLAN.DXF ", {
      type: "application/dxf",
    }),
    kind: "dxf",
  });
  assert.equal(dxf.kind, "dxf");
  assert.equal(dxf.originalFilename, "PLAN.DXF");
  assert.match(uploads.at(-1), /\/source-uploads\/[0-9a-f-]{36}\.dxf$/);

  await assert.rejects(
    projectFileUpload.uploadProjectFileDirect({
      ...scope,
      file: new File(["dwg"], "PLAN.DWG", {
        type: "application/octet-stream",
      }),
      kind: "dxf",
    }),
    /DWG.*DWG 원본 종류/,
  );
  await assert.rejects(
    projectFileUpload.uploadProjectFileDirect({
      ...scope,
      file: new File(["0\nEOF\n"], "PLAN.DXF", {
        type: "application/pdf",
      }),
      kind: "dxf",
    }),
    /DXF.*파일 형식 정보/,
  );
  assert.equal(uploads.length, 1);

  const retainedDwg = await projectFileUpload.uploadProjectFileDirect({
    ...scope,
    file: new File(["dwg"], "PLAN.DWG", {
      type: "application/octet-stream",
    }),
    kind: "other",
  });
  assert.equal(retainedDwg.kind, "other");
  assert.match(uploads.at(-1), /\/source-uploads\/[0-9a-f-]{36}\.dwg$/);
});

test("project upload action trusts only a service-side verification record and atomically finalizes metadata", async () => {
  const cases = [
    {
      createdFileId: "00000000-0000-4000-8000-000000000016",
      filename: "PLAN.DWG",
      kind: "dwg",
      mime: "application/octet-stream",
      objectId: "00000000-0000-4000-8000-000000000026",
      verificationId: "00000000-0000-4000-8000-000000000036",
      source: "AC1032body",
      location:
        "/projects/00000000-0000-4000-8000-000000000001/workspaces/new?sourceFileId=00000000-0000-4000-8000-000000000016",
    },
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
        "/projects/00000000-0000-4000-8000-000000000001/workspaces/new?sourceFileId=00000000-0000-4000-8000-000000000012",
    },
    {
      createdFileId: "00000000-0000-4000-8000-000000000013",
      filename: "PLAN.DXF",
      kind: "dxf",
      mime: "application/dxf",
      objectId: "00000000-0000-4000-8000-000000000023",
      verificationId: "00000000-0000-4000-8000-000000000033",
      source: "0\nSECTION\n0\nEOF\n",
      location:
        "/projects/00000000-0000-4000-8000-000000000001/workspaces/new?sourceFileId=00000000-0000-4000-8000-000000000013",
    },
    {
      createdFileId: "00000000-0000-4000-8000-000000000014",
      filename: "MODEL.DWG",
      kind: "other",
      mime: "application/octet-stream",
      objectId: "00000000-0000-4000-8000-000000000024",
      verificationId: "00000000-0000-4000-8000-000000000034",
      source: "retained-dwg",
      location: "/projects/00000000-0000-4000-8000-000000000001",
    },
    {
      createdFileId: "00000000-0000-4000-8000-000000000015",
      filename: "quantity.csv",
      kind: "qto_csv",
      mime: "text/csv",
      objectId: "00000000-0000-4000-8000-000000000025",
      verificationId: "00000000-0000-4000-8000-000000000035",
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

test("verified DXF finalization preserves a validated workspace handoff and rejects open redirects before consumption", async () => {
  const fixture = {
    createdFileId: "00000000-0000-4000-8000-000000000013",
    filename: "PLAN.DXF",
    kind: "dxf",
    mime: "application/dxf",
    objectId: "00000000-0000-4000-8000-000000000023",
    ownerId: "00000000-0000-4000-8000-000000000002",
    projectId: "00000000-0000-4000-8000-000000000001",
    source: "0\nSECTION\n0\nEOF\n",
    userId: "00000000-0000-4000-8000-000000000003",
    verificationId: "00000000-0000-4000-8000-000000000033",
  };
  const workspaceId = "00000000-0000-4000-8000-000000000041";
  const returnTo = `/projects/${fixture.projectId}/workspaces/${workspaceId}`;

  {
    const upload = verifiedUploadFixture(fixture);
    const { adminClient, client, observations } = uploadActionFixture(
      Buffer.from(fixture.source),
      {
        ...upload,
        membershipRole: "estimator",
        workspaceRevision: {
          document_id: workspaceId,
          id: "00000000-0000-4000-8000-000000000042",
          project_id: fixture.projectId,
          status: "draft",
        },
      },
    );
    globalThis[actionClientFactoryKey] = () => [client, new Headers()];
    globalThis[adminClientFactoryKey] = () => adminClient;
    const formData = new FormData();
    formData.set("intent", "upload");
    formData.set("upload_verification_id", fixture.verificationId);
    formData.set("return_to", returnTo);

    const response = await projectAction.action({
      request: new Request(
        `http://app.test/projects/${fixture.projectId}/files`,
        { method: "POST", body: formData },
      ),
      params: { projectId: fixture.projectId },
    });

    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get("location"),
      `${returnTo}?dxfSourceFileId=${fixture.createdFileId}`,
    );
    assert.equal(observations.finalizationCalls.length, 1);
    assert.deepEqual(observations.workspaceFilters, [
      {
        column: "project_id",
        table: "lukas_drawing_revisions",
        value: fixture.projectId,
      },
      {
        column: "document_id",
        table: "lukas_drawing_revisions",
        value: workspaceId,
      },
    ]);
  }

  {
    const upload = verifiedUploadFixture(fixture);
    const { adminClient, client, observations } = uploadActionFixture(
      Buffer.from(fixture.source),
      upload,
    );
    globalThis[actionClientFactoryKey] = () => [client, new Headers()];
    globalThis[adminClientFactoryKey] = () => adminClient;
    const formData = new FormData();
    formData.set("intent", "upload");
    formData.set("upload_verification_id", fixture.verificationId);
    formData.set("return_to", "https://attacker.invalid/collect");

    const response = await projectAction.action({
      request: new Request(
        `http://app.test/projects/${fixture.projectId}/files`,
        { method: "POST", body: formData },
      ),
      params: { projectId: fixture.projectId },
    });

    assert.equal(response.init.status, 400);
    assert.match(response.data.error, /작업실 복귀 주소/);
    assert.equal(observations.finalizationCalls.length, 0);
  }

  for (const denied of [
    {
      label: "deleted workspace",
      membershipRole: "estimator",
      workspaceDocument: null,
      workspaceRevision: null,
      status: 409,
      message: /복귀할 작업실을 찾을 수 없습니다/,
    },
    {
      label: "approved workspace",
      membershipRole: "estimator",
      workspaceRevision: {
        document_id: workspaceId,
        id: "00000000-0000-4000-8000-000000000042",
        project_id: fixture.projectId,
        status: "approved",
      },
      status: 409,
      message: /초안 작업실에서만 PDF 또는 DXF를 올릴 수 있습니다/,
    },
    {
      label: "viewer workspace",
      membershipRole: "viewer",
      workspaceRevision: {
        document_id: workspaceId,
        id: "00000000-0000-4000-8000-000000000042",
        project_id: fixture.projectId,
        status: "draft",
      },
      status: 403,
      message: /작업실을 편집할 권한이 없습니다/,
    },
  ]) {
    const upload = verifiedUploadFixture(fixture);
    const { adminClient, client, observations } = uploadActionFixture(
      Buffer.from(fixture.source),
      { ...upload, ...denied },
    );
    globalThis[actionClientFactoryKey] = () => [client, new Headers()];
    globalThis[adminClientFactoryKey] = () => adminClient;
    const formData = new FormData();
    formData.set("intent", "upload");
    formData.set("upload_verification_id", fixture.verificationId);
    formData.set("return_to", returnTo);

    const response = await projectAction.action({
      request: new Request(
        `http://app.test/projects/${fixture.projectId}/files`,
        { method: "POST", body: formData },
      ),
      params: { projectId: fixture.projectId },
    });

    assert.equal(response.init.status, denied.status, denied.label);
    assert.match(
      response.data.error,
      denied.label === "approved workspace"
        ? /초안 작업실에서만 PDF, DXF 또는 DWG를 올릴 수 있습니다/
        : denied.message,
      denied.label,
    );
    assert.equal(observations.finalizationCalls.length, 0, denied.label);
  }
});

test("verified DWG cannot be mislabeled as a DXF import and remains retryable", async () => {
  const fixture = {
    createdFileId: "00000000-0000-4000-8000-000000000016",
    filename: "MODEL.DWG",
    kind: "dxf",
    mime: "application/octet-stream",
    objectId: "00000000-0000-4000-8000-000000000026",
    ownerId: "00000000-0000-4000-8000-000000000002",
    projectId: "00000000-0000-4000-8000-000000000001",
    source: "dwg",
    userId: "00000000-0000-4000-8000-000000000003",
    verificationId: "00000000-0000-4000-8000-000000000036",
  };
  const upload = verifiedUploadFixture(fixture);
  const { adminClient, client, observations, projectId } = uploadActionFixture(
    Buffer.from(fixture.source),
    upload,
  );
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

  assert.equal(response.init.status, 400);
  assert.match(response.data.error, /DWG.*DWG 원본 종류/);
  assert.equal(observations.finalizationCalls.length, 0);
  assert.equal(observations.storageDownloads.length, 0);
});

test("verified DWG finalization preserves an authorized canonical workspace handoff", async () => {
  const fixture = {
    createdFileId: "00000000-0000-4000-8000-000000000016",
    filename: "MODEL.DWG",
    kind: "dwg",
    mime: "application/octet-stream",
    objectId: "00000000-0000-4000-8000-000000000026",
    ownerId: "00000000-0000-4000-8000-000000000002",
    projectId: "00000000-0000-4000-8000-000000000001",
    source: "AC1032body",
    userId: "00000000-0000-4000-8000-000000000003",
    verificationId: "00000000-0000-4000-8000-000000000036",
  };
  const workspaceId = "00000000-0000-4000-8000-000000000041";
  const returnTo = `/projects/${fixture.projectId}/workspaces/${workspaceId}`;
  const upload = verifiedUploadFixture(fixture);
  const { adminClient, client, observations } = uploadActionFixture(
    Buffer.from(fixture.source),
    {
      ...upload,
      membershipRole: "estimator",
      workspaceRevision: {
        document_id: workspaceId,
        id: "00000000-0000-4000-8000-000000000042",
        project_id: fixture.projectId,
        status: "draft",
      },
    },
  );
  globalThis[actionClientFactoryKey] = () => [client, new Headers()];
  globalThis[adminClientFactoryKey] = () => adminClient;
  const formData = new FormData();
  formData.set("intent", "upload");
  formData.set("upload_verification_id", fixture.verificationId);
  formData.set("return_to", returnTo);

  const response = await projectAction.action({
    request: new Request(
      `http://app.test/projects/${fixture.projectId}/files`,
      { method: "POST", body: formData },
    ),
    params: { projectId: fixture.projectId },
  });

  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get("location"),
    `${returnTo}?dwgSourceFileId=${fixture.createdFileId}`,
  );
  assert.equal(observations.finalizationCalls.length, 1);
});

test("first-class DWG finalization rejects forged evidence and unauthorized workspace targets", async () => {
  const fixture = {
    createdFileId: "00000000-0000-4000-8000-000000000011",
    filename: "PLAN.DWG",
    kind: "dwg",
    mime: "application/octet-stream",
    objectId: "00000000-0000-4000-8000-000000000021",
    verificationId: "00000000-0000-4000-8000-000000000031",
    ownerId: "00000000-0000-4000-8000-000000000002",
    projectId: "00000000-0000-4000-8000-000000000001",
    userId: "00000000-0000-4000-8000-000000000003",
    source: "AC1032body",
  };
  for (const rejected of [
    "missing-service-header",
    "workspace-return",
    "wrong-stored-mime",
  ]) {
    const upload = verifiedUploadFixture(fixture);
    if (rejected === "missing-service-header")
      delete upload.verifiedUpload.dwg_header_version;
    if (rejected === "wrong-stored-mime")
      upload.verifiedUpload.content_type = "application/acad";
    const { adminClient, client, observations, projectId } =
      uploadActionFixture(Buffer.from(fixture.source), upload);
    globalThis[actionClientFactoryKey] = () => [client, new Headers()];
    globalThis[adminClientFactoryKey] = () => adminClient;
    const form = new FormData();
    form.set("intent", "upload");
    form.set("upload_verification_id", fixture.verificationId);
    form.set("dwg_header_version", "AC1032");
    form.set("dwgHeaderVersion", "AC1032");
    if (rejected === "workspace-return")
      form.set(
        "return_to",
        `/projects/${projectId}/workspaces/${fixture.createdFileId}`,
      );
    const response = await projectAction.action({
      request: new Request(`http://app.test/projects/${projectId}/files`, {
        method: "POST",
        body: form,
      }),
      params: { projectId },
    });
    assert.equal(
      response.init.status,
      rejected === "workspace-return" ? 403 : 400,
      rejected,
    );
    if (rejected === "wrong-stored-mime") {
      assert.match(response.data.error, /^DWG .*파일 형식 정보/);
      assert.doesNotMatch(response.data.error, /DXF/);
    }
    assert.equal(observations.finalizationCalls.length, 0, rejected);
    assert.equal(observations.storageDownloads.length, 0);
    assert.equal(observations.storageRemovals.length, 0);
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
        {
          id: "00000000-0000-4000-8000-000000000005",
          kind: "dxf",
          original_filename: "PLAN.dxf",
          byte_size: 1024,
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
    /href="\/projects\/00000000-0000-4000-8000-000000000001\/workspaces\/new\?sourceFileId=00000000-0000-4000-8000-000000000004"/,
  );
  assert.match(
    ifcHtml,
    /href="\/projects\/00000000-0000-4000-8000-000000000001\/workspaces\/new\?sourceFileId=00000000-0000-4000-8000-000000000005"/,
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

  const loaderResult = await projectAction.loader({
    params: { projectId: fixture.projectId },
    request: new Request(`http://app.test/projects/${fixture.projectId}`),
  });
  const loaderData = routeData(loaderResult);

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

test("workspace dashboard renders Korean calendar dates identically across server timezones", () => {
  const fixture = workspaceFixture();
  const boundary = "2026-08-30T22:02:34.027Z";
  fixture.projects[0].updated_at = boundary;
  fixture.activities = [
    {
      id: "file-00000000-0000-4000-8000-000000000003",
      projectId: fixture.projects[0].id,
      projectName: fixture.projects[0].name,
      kind: "file",
      title: "model.ifc",
      detail: "IFC 3D 모델이 추가되었습니다.",
      createdAt: boundary,
    },
  ];
  const originalTimezone = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    const utcHtml = renderComponent(
      workspaceDashboard.WorkspaceDashboard,
      fixture,
    );
    process.env.TZ = "America/Los_Angeles";
    const pacificHtml = renderComponent(
      workspaceDashboard.WorkspaceDashboard,
      fixture,
    );
    const calendarDates = (html) =>
      [...html.matchAll(/[0-9]+월 [0-9]+일/g)].map(([date]) => date);
    assert.deepEqual(calendarDates(utcHtml), [
      "8월 31일",
      "8월 31일",
      "8월 31일",
    ]);
    assert.deepEqual(calendarDates(pacificHtml), calendarDates(utcHtml));
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test("creating a project redirects directly to the canonical workspace start", async () => {
  const projectId = "00000000-0000-4000-8000-000000000081";
  const inserted = [];
  const client = {
    auth: {
      getUser: async () => ({
        data: {
          user: {
            app_metadata: {},
            id: "00000000-0000-4000-8000-000000000082",
            is_anonymous: false,
          },
        },
      }),
    },
    from(table) {
      assert.equal(table, "lukas_qto_projects");
      return {
        insert(row) {
          inserted.push(row);
          return {
            select(columns) {
              assert.equal(columns, "id");
              return {
                single: async () => ({ data: { id: projectId }, error: null }),
              };
            },
          };
        },
      };
    },
  };
  globalThis[workspaceClientFactoryKey] = () => [client, new Headers()];
  const formData = new FormData();
  formData.set("name", "바로 여는 프로젝트");

  const response = await workspaceScreen.action({
    params: {},
    request: new Request("http://app.test/workspace", {
      body: formData,
      method: "POST",
    }),
  });

  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get("Location"),
    `/projects/${projectId}/workspaces/new`,
  );
  assert.equal(inserted.length, 1);
});

test("workspace action redirects anonymous requests and preserves session cookies", async () => {
  const headers = new Headers({
    "Set-Cookie": "session=refresh; Path=/; HttpOnly",
  });
  globalThis[workspaceClientFactoryKey] = () => [
    { auth: { getUser: async () => ({ data: { user: null } }) } },
    headers,
  ];
  const formData = new FormData();
  formData.set("name", "로그인 후 만들 프로젝트");

  await assert.rejects(
    workspaceScreen.action({
      params: {},
      request: new Request("http://app.test/workspace?entry=dashboard", {
        body: formData,
        method: "POST",
      }),
    }),
    (response) => {
      assert.equal(response.status, 302);
      assert.equal(
        response.headers.get("Location"),
        "/login?next=%2Fworkspace%3Fentry%3Ddashboard",
      );
      assert.equal(
        response.headers.get("Set-Cookie"),
        "session=refresh; Path=/; HttpOnly",
      );
      return true;
    },
  );
});

test("workspace action redirects anonymous malformed requests before validation", async () => {
  globalThis[workspaceClientFactoryKey] = () => [
    { auth: { getUser: async () => ({ data: { user: null } }) } },
    new Headers(),
  ];

  await assert.rejects(
    workspaceScreen.action({
      params: {},
      request: new Request("http://app.test/workspace?from=malformed", {
        body: new FormData(),
        method: "POST",
      }),
    }),
    (response) => {
      assert.equal(response.status, 302);
      assert.equal(
        response.headers.get("Location"),
        "/login?next=%2Fworkspace%3Ffrom%3Dmalformed",
      );
      return true;
    },
  );
});

test("workspace action keeps malformed authenticated requests at 400", async () => {
  globalThis[workspaceClientFactoryKey] = () => [
    {
      auth: {
        getUser: async () => ({
          data: { user: { id: "00000000-0000-4000-8000-000000000099" } },
        }),
      },
    },
    new Headers(),
  ];

  const response = await workspaceScreen.action({
    params: {},
    request: new Request("http://app.test/workspace", {
      body: new FormData(),
      method: "POST",
    }),
  });
  assert.equal(response.init.status, 400);
});

const quickStartIds = {
  userId: "00000000-0000-4000-8000-000000000301",
  organizationId: "00000000-0000-4000-8000-000000000302",
  projectId: "00000000-0000-4000-8000-000000000303",
  documentId: "00000000-0000-4000-8000-000000000304",
  revisionId: "00000000-0000-4000-8000-000000000305",
  pageId: "00000000-0000-4000-8000-000000000306",
  canvasId: "00000000-0000-4000-8000-000000000307",
  operationId: "00000000-0000-4000-8000-000000000308",
  requestId: "00000000-0000-4000-8000-000000000309",
  createdAt: "2026-09-05T07:08:09.000Z",
};

function quickStartClient({ failEnsure = false } = {}) {
  const calls = [];
  return {
    calls,
    client: {
      auth: {
        getUser: async () => ({
          data: {
            user: {
              id: quickStartIds.userId,
              is_anonymous: false,
              app_metadata: {},
            },
          },
        }),
      },
      async rpc(name, args) {
        calls.push({ name, args });
        if (name === "lukas_drawing_ensure_personal_project")
          return failEnsure
            ? { data: null, error: { message: "raw database detail" } }
            : {
                data: {
                  projectId: quickStartIds.projectId,
                  organizationId: quickStartIds.organizationId,
                },
                error: null,
              };
        if (name === "lukas_drawing_create_document_idempotent")
          return {
            data: {
              documentId: quickStartIds.documentId,
              revisionId: quickStartIds.revisionId,
              pageId: quickStartIds.pageId,
              canvasId: quickStartIds.canvasId,
            },
            error: null,
          };
        if (name === "lukas_drawing_apply_operation") {
          const resultVersions = Object.fromEntries(
            args.p_forward.actions.map((action) => [action.entity.id, 1]),
          );
          return {
            data: {
              operationId: quickStartIds.operationId,
              sequence: 1,
              clientOperationId: args.p_client_operation_id,
              resultVersions,
            },
            error: null,
          };
        }
        throw new Error(`Unexpected RPC: ${name}`);
      },
    },
  };
}

function quickStartForm(intent, overrides = {}) {
  const formData = new FormData();
  formData.set("intent", intent);
  formData.set(
    "client_request_id",
    overrides.clientRequestId ?? quickStartIds.requestId,
  );
  formData.set(
    "client_created_at",
    overrides.clientCreatedAt ?? quickStartIds.createdAt,
  );
  return formData;
}

test("authenticated users create a blank drawing without project or contact input", async () => {
  const fixture = quickStartClient();
  const starts = [];
  globalThis[workspaceStarterKey] = async (client, input) => {
    assert.equal(client, fixture.client);
    starts.push(input);
    return { documentId: quickStartIds.documentId };
  };
  const headers = new Headers({
    "Set-Cookie": "session=quick-start; Path=/; HttpOnly",
  });
  globalThis[workspaceClientFactoryKey] = () => [fixture.client, headers];

  const response = await workspaceScreen.action({
    params: {},
    request: new Request("http://app.test/workspace", {
      method: "POST",
      body: quickStartForm("quick_blank"),
    }),
  });

  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get("Location"),
    `/projects/${quickStartIds.projectId}/workspaces/${quickStartIds.documentId}`,
  );
  assert.equal(
    response.headers.get("Set-Cookie"),
    "session=quick-start; Path=/; HttpOnly",
  );
  assert.deepEqual(
    fixture.calls.map(({ name }) => name),
    ["lukas_drawing_ensure_personal_project"],
  );
  assert.deepEqual(fixture.calls[0].args, undefined);
  assert.deepEqual(starts, [
    {
      projectId: quickStartIds.projectId,
      organizationId: quickStartIds.organizationId,
      title: "새 도면",
      sourceFile: null,
      definition: null,
      clientRequestId: quickStartIds.requestId,
      clientCreatedAt: quickStartIds.createdAt,
    },
  ]);
});

test("quick-start template and file choices ensure storage without creating a blank document", async () => {
  for (const [intent, suffix] of [
    ["quick_template", "/workspaces/new#starter-workspace-title"],
    ["quick_file", "/files"],
  ]) {
    const fixture = quickStartClient();
    globalThis[workspaceClientFactoryKey] = () => [
      fixture.client,
      new Headers(),
    ];
    const response = await workspaceScreen.action({
      params: {},
      request: new Request("http://app.test/workspace", {
        method: "POST",
        body: quickStartForm(intent),
      }),
    });
    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get("Location"),
      `/projects/${quickStartIds.projectId}${suffix}`,
    );
    assert.deepEqual(
      fixture.calls.map(({ name }) => name),
      ["lukas_drawing_ensure_personal_project"],
    );
  }
});

test("quick-start rejects unknown, duplicate, and forged fields before RPC", async () => {
  const invalidForms = [
    quickStartForm("quick_unknown"),
    (() => {
      const value = quickStartForm("quick_blank");
      value.append("client_request_id", crypto.randomUUID());
      return value;
    })(),
    (() => {
      const value = quickStartForm("quick_blank");
      value.set("owner_id", quickStartIds.userId);
      return value;
    })(),
  ];
  for (const body of invalidForms) {
    const fixture = quickStartClient();
    globalThis[workspaceClientFactoryKey] = () => [
      fixture.client,
      new Headers(),
    ];
    const response = await workspaceScreen.action({
      params: {},
      request: new Request("http://app.test/workspace", {
        method: "POST",
        body,
      }),
    });
    assert.equal(response.init.status, 400);
    assert.deepEqual(fixture.calls, []);
  }
});

test("quick-start authenticates before reading the request body", async () => {
  let bodyRead = false;
  globalThis[workspaceClientFactoryKey] = () => [
    { auth: { getUser: async () => ({ data: { user: null } }) } },
    new Headers(),
  ];
  const request = new Request("http://app.test/workspace", { method: "POST" });
  request.formData = async () => {
    bodyRead = true;
    throw new Error("body must not be read");
  };
  await assert.rejects(
    workspaceScreen.action({ params: {}, request }),
    (response) => response.status === 302,
  );
  assert.equal(bodyRead, false);
});

test("quick-start rejects anonymous sessions before reading the request body", async () => {
  let bodyRead = false;
  globalThis[workspaceClientFactoryKey] = () => [
    {
      auth: {
        getUser: async () => ({
          data: { user: { id: quickStartIds.userId, is_anonymous: true } },
        }),
      },
    },
    new Headers(),
  ];
  const request = new Request("http://app.test/workspace", { method: "POST" });
  request.formData = async () => {
    bodyRead = true;
    throw new Error("body must not be read");
  };
  await assert.rejects(
    workspaceScreen.action({ params: {}, request }),
    (response) => response.status === 302,
  );
  assert.equal(bodyRead, false);
});

test("quick-start failure is bounded and retries with the original request identity", async () => {
  const fixture = quickStartClient({ failEnsure: true });
  globalThis[workspaceClientFactoryKey] = () => [fixture.client, new Headers()];
  const result = await workspaceScreen.action({
    params: {},
    request: new Request("http://app.test/workspace", {
      method: "POST",
      body: quickStartForm("quick_blank"),
    }),
  });
  assert.equal(result.init.status, 409);
  assert.deepEqual(result.data.quickStartFailure, {
    kind: "blank",
    clientRequestId: quickStartIds.requestId,
    clientCreatedAt: quickStartIds.createdAt,
    message:
      "새 도면을 시작하지 못했습니다. 잠시 후 다시 시도하거나 프로젝트에서 시작하세요.",
  });
  assert.doesNotMatch(JSON.stringify(result.data), /raw database detail/);

  const dashboardFixture = workspaceFixture();
  const html = renderComponent(workspaceScreen.default, {
    loaderData: {
      ...dashboardFixture,
      drawings: [],
      quickStartRequests: {
        blank: {
          clientRequestId: "00000000-0000-4000-8000-000000000311",
          clientCreatedAt: "2026-09-05T08:00:00.000Z",
        },
        template: {
          clientRequestId: "00000000-0000-4000-8000-000000000312",
          clientCreatedAt: "2026-09-05T08:00:00.000Z",
        },
        file: {
          clientRequestId: "00000000-0000-4000-8000-000000000313",
          clientCreatedAt: "2026-09-05T08:00:00.000Z",
        },
      },
    },
    actionData: result.data,
  });
  assert.match(
    html,
    new RegExp(`name="client_request_id" value="${quickStartIds.requestId}"`),
  );
  assert.match(
    html,
    new RegExp(`name="client_created_at" value="${quickStartIds.createdAt}"`),
  );
  assert.match(html, /프로젝트에서 시작/);
  assert.match(html, /<details[^>]*open=""[^>]*>/);
});

test("dashboard exposes one quick-start disclosure and real recent drawing links", () => {
  const fixture = workspaceFixture({ drawingId: null });
  fixture.quickStartRequests = {
    blank: {
      clientRequestId: quickStartIds.requestId,
      clientCreatedAt: quickStartIds.createdAt,
    },
    template: {
      clientRequestId: "00000000-0000-4000-8000-000000000321",
      clientCreatedAt: quickStartIds.createdAt,
    },
    file: {
      clientRequestId: "00000000-0000-4000-8000-000000000322",
      clientCreatedAt: quickStartIds.createdAt,
    },
  };
  fixture.drawings = [
    {
      id: quickStartIds.documentId,
      project_id: fixture.projects[0].id,
      title: "소스 없는 새 도면",
      updated_at: quickStartIds.createdAt,
    },
  ];
  const html = renderComponent(workspaceDashboard.WorkspaceDashboard, fixture);
  assert.equal(html.match(/<summary[^>]*>.*?새 도면/s)?.length, 1);
  assert.match(html, /빈 도면으로 시작/);
  assert.match(html, /템플릿에서 시작/);
  assert.match(html, /파일 가져오기/);
  assert.match(html, /개인 공간의 기본 프로젝트에 안전하게 저장/);
  assert.match(html, /aria-label="최근 도면"/);
  assert.match(
    html,
    new RegExp(
      `href="/projects/${fixture.projects[0].id}/workspaces/${quickStartIds.documentId}"`,
    ),
  );
  assert.match(html, /소스 없는 새 도면/);
  assert.match(html, /1HK 테스트 프로젝트 이전 도면 보기/);
  assert.doesNotMatch(html, /아직 등록된 도면이 없습니다\./);
});

test("workspace preview shows disabled quick-start choices without production forms", () => {
  const fixture = workspaceFixture({ previewMode: true });
  fixture.quickStartRequests = undefined;
  const html = renderComponent(
    workspaceDashboard.WorkspaceDashboard,
    fixture,
    "/workspace-preview",
  );
  assert.match(html, /<summary[^>]*>.*?새 도면/s);
  assert.match(html, /<button[^>]*disabled=""[^>]*>.*?빈 도면으로 시작/s);
  assert.doesNotMatch(html, /method="post"/);
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
  let rpcCalls = 0;
  fixture.client.rpc = async () => {
    rpcCalls += 1;
    throw new Error("the loader must not mutate drawing state");
  };
  globalThis[workspaceClientFactoryKey] = () => [fixture.client];
  globalThis[workspaceMetricsKey] = {};

  const loaderResult = await workspaceScreen.loader({
    request: new Request("http://app.test/workspace"),
    params: {},
  });
  const loaderData = routeData(loaderResult);
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
  assert.equal(documentQuery?.select, "id,project_id,title,updated_at");
  assert.equal(rpcCalls, 0);
  assert.deepEqual(loaderData.drawings, [
    {
      id: fixture.documentId,
      project_id: fixture.projectWithDocument,
      title: "문서가 있는 프로젝트 도면",
      updated_at: "2026-08-05T00:00:00.000Z",
    },
  ]);
});

test("workspace loader authorizes organization roles with the current user's uncapped memberships", async () => {
  const fixture = workspaceScopeLoaderFixture();
  const headers = new Headers({
    "Set-Cookie": "session=workspace-scope; Path=/; HttpOnly",
  });
  globalThis[workspaceClientFactoryKey] = () => [fixture.client, headers];
  globalThis[workspaceMetricsKey] = {};

  const result = await workspaceScreen.loader({
    params: {},
    request: new Request("http://app.test/workspace?space=not-authorized"),
  });
  const loaderData = routeData(result);
  const membershipQuery = fixture.observations.find(
    ({ table }) => table === "lukas_qto_organization_members",
  );
  const organizationQuery = fixture.observations.find(
    ({ table }) => table === "lukas_qto_organizations",
  );

  assert.deepEqual(membershipQuery?.filters, [
    ["eq", "user_id", fixture.userId],
  ]);
  assert.equal(membershipQuery?.limit, undefined);
  assert.equal(organizationQuery?.limit, undefined);
  assert.deepEqual(
    loaderData.organizations.map(({ id }) => id),
    [
      fixture.otherPersonalOrganizationId,
      fixture.personalOrganizationId,
      fixture.teamOrganizationId,
    ],
  );
  assert.equal(
    loaderData.organizations.find(({ id }) => id === fixture.teamOrganizationId)
      ?.can_manage,
    false,
    "another member's admin role must not grant management UI",
  );
  assert.equal(loaderData.activeScope.key, fixture.personalOrganizationId);
  assert.deepEqual(
    loaderData.projects.map(({ id }) => id),
    [fixture.personalProjectId],
  );
  assert.equal(
    result.init.headers.get("Set-Cookie"),
    "session=workspace-scope; Path=/; HttpOnly",
  );
});

test("workspace loader does not mistake another owner's personal organization for the user's default", async () => {
  const fixture = workspaceScopeLoaderFixture();
  globalThis[workspaceClientFactoryKey] = () => [fixture.client, new Headers()];
  globalThis[workspaceMetricsKey] = {};

  const loaderData = routeData(
    await workspaceScreen.loader({
      params: {},
      request: new Request("http://app.test/workspace"),
    }),
  );

  assert.equal(loaderData.activeScope.key, fixture.personalOrganizationId);
  assert.notEqual(
    loaderData.activeScope.key,
    fixture.otherPersonalOrganizationId,
  );
});

test("workspace loader filters projects and metrics to a validated selected organization", async () => {
  const fixture = workspaceScopeLoaderFixture();
  globalThis[workspaceClientFactoryKey] = () => [fixture.client, new Headers()];
  globalThis[workspaceMetricsKey] = {
    [fixture.personalProjectId]: { assignedToMeCount: 8, unresolvedCount: 9 },
    [fixture.teamProjectId]: { assignedToMeCount: 2, unresolvedCount: 3 },
    [fixture.sharedProjectId]: { assignedToMeCount: 4, unresolvedCount: 5 },
  };

  const loaderData = routeData(
    await workspaceScreen.loader({
      params: {},
      request: new Request(
        `http://app.test/workspace?space=${fixture.teamOrganizationId}`,
      ),
    }),
  );

  assert.equal(loaderData.activeScope.key, fixture.teamOrganizationId);
  assert.deepEqual(
    loaderData.projects.map(({ id }) => id),
    [fixture.teamProjectId],
  );
  assert.deepEqual(Object.keys(loaderData.projectMetrics), [
    fixture.teamProjectId,
  ]);
  assert.equal(
    loaderData.projectMetrics[fixture.teamProjectId].assignedToMeCount,
    2,
  );
});

test("workspace loader keeps directly shared projects reachable outside organization scope", async () => {
  const fixture = workspaceScopeLoaderFixture();
  globalThis[workspaceClientFactoryKey] = () => [fixture.client, new Headers()];
  globalThis[workspaceMetricsKey] = {};

  const loaderData = routeData(
    await workspaceScreen.loader({
      params: {},
      request: new Request("http://app.test/workspace?space=shared"),
    }),
  );

  assert.equal(loaderData.activeScope.key, "shared");
  assert.equal(loaderData.activeScope.can_manage, false);
  assert.equal(loaderData.hasSharedProjects, true);
  assert.deepEqual(
    loaderData.projects.map(({ id }) => id),
    [fixture.sharedProjectId],
  );
});

test("staff shared scope excludes RLS-visible projects without direct membership", async () => {
  const fixture = workspaceScopeLoaderFixture({ isStaff: true });
  globalThis[workspaceClientFactoryKey] = () => [fixture.client, new Headers()];
  globalThis[workspaceMetricsKey] = {};

  const loaderData = routeData(
    await workspaceScreen.loader({
      params: {},
      request: new Request("http://app.test/workspace?space=shared"),
    }),
  );

  assert.deepEqual(
    loaderData.projects.map(({ id }) => id),
    [fixture.sharedProjectId],
  );
  assert.ok(
    !loaderData.projects.some(({ id }) => id === fixture.globalProjectId),
  );
  const directMembershipQuery = fixture.observations.find(
    ({ table, filters }) =>
      table === "lukas_qto_project_members" &&
      filters.some(
        ([operator, column, value]) =>
          operator === "eq" && column === "user_id" && value === fixture.userId,
      ),
  );
  assert.ok(directMembershipQuery);
  assert.equal(directMembershipQuery.limit, undefined);
});

test("workspace dashboard renders one active space menu with an accessible selector and drawer", () => {
  const fixture = workspaceFixture();
  fixture.projects.push({
    ...fixture.projects[0],
    id: "00000000-0000-4000-8000-000000000202",
    name: fixture.projects[0].name,
    updated_at: "2026-08-03T00:00:00.000Z",
  });
  fixture.projectMetrics[fixture.projects[0].id].latestFilename = "A-101.pdf";
  fixture.projectMetrics[fixture.projects[1].id] = {
    ...fixture.projectMetrics[fixture.projects[0].id],
    latestDrawingId: null,
    latestFilename: "B-202.dxf",
  };
  fixture.organizations = [
    {
      id: "00000000-0000-4000-8000-000000000203",
      is_personal: true,
      name: "내 공간",
      can_manage: true,
    },
    {
      id: "00000000-0000-4000-8000-000000000204",
      is_personal: false,
      name: "설계팀",
      can_manage: true,
    },
  ];
  fixture.activeScope = {
    key: fixture.organizations[1].id,
    kind: "organization",
    name: "설계팀",
    organizationId: fixture.organizations[1].id,
    is_personal: false,
    can_manage: true,
  };
  fixture.hasSharedProjects = true;

  const html = renderComponent(workspaceDashboard.WorkspaceDashboard, fixture);
  const occurrences = (pattern) => html.match(pattern)?.length ?? 0;

  assert.match(html, /aria-label="작업 공간 선택"/);
  assert.match(
    html,
    new RegExp(`value="${fixture.organizations[1].id}" selected=""`),
  );
  assert.match(html, /value="shared">공유받은 항목/);
  assert.match(html, /aria-label="작업공간 메뉴 열기"/);
  assert.match(html, /id="workspace-navigation"/);
  assert.equal(occurrences(/설계팀 라이브러리/g), 1);
  assert.equal(occurrences(/>설정</g), 1);
  assert.equal(occurrences(/회사 관리/g), 1);
  assert.equal(occurrences(/보존 관리/g), 1);
  assert.equal(occurrences(/내 공간 라이브러리/g), 0);
  assert.match(html, /최근 프로젝트/);
  assert.match(html, /A-101\.pdf/);
  assert.match(html, /B-202\.dxf/);
  assert.match(html, /개인 공간에 저장/);
});

test("shared workspace scope never implies organization management authority", () => {
  const fixture = workspaceFixture();
  fixture.organizations = [
    {
      id: "00000000-0000-4000-8000-000000000211",
      is_personal: false,
      name: "설계팀",
      can_manage: true,
    },
  ];
  fixture.activeScope = {
    key: "shared",
    kind: "shared",
    name: "공유받은 항목",
    can_manage: false,
  };
  fixture.hasSharedProjects = true;

  const html = renderComponent(workspaceDashboard.WorkspaceDashboard, fixture);
  assert.match(html, /value="shared" selected="">공유받은 항목/);
  assert.doesNotMatch(html, /\/organizations\//);
  assert.doesNotMatch(html, /회사 관리|보존 관리|설계팀 라이브러리/);
  assert.match(html, /개인 공간에 저장/);
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
    kind: "pdf",
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

test("bounded catalog recovery notices leave blank and PDF creation usable", () => {
  const blankPair = {
    clientRequestId: "00000000-0000-4000-8000-000000000061",
    clientCreatedAt: "2026-09-02T01:02:03.000Z",
  };
  const pdfPair = {
    clientRequestId: "00000000-0000-4000-8000-000000000062",
    clientCreatedAt: "2026-09-02T01:02:03.000Z",
  };
  const file = {
    id: "00000000-0000-4000-8000-000000000063",
    kind: "pdf",
    original_filename: "A-101.pdf",
    workspaceId: null,
  };
  const html = renderStartComponent({
    loaderData: {
      catalogNotices: {
        organizationTemplates:
          "회사 템플릿을 불러오지 못했습니다. 빈 작업실이나 PDF로 시작해 주세요.",
        starters:
          "기본 템플릿을 불러오지 못했습니다. 빈 작업실이나 PDF로 시작해 주세요.",
      },
      files: [file],
      organizationTemplates: [],
      project: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "1HK 테스트 프로젝트",
      },
      requestPairs: {
        blank: blankPair,
        libraryTemplates: {},
        pdfs: { [file.id]: pdfPair },
        starters: {},
      },
      starters: [],
    },
  });

  assert.match(html, /기본 템플릿을 불러오지 못했습니다/);
  assert.match(html, /회사 템플릿을 불러오지 못했습니다/);
  assert.match(html, /<button[^>]*>빈 작업실로 시작<\/button>/);
  assert.match(html, /<button[^>]*>A-101\.pdf PDF로 시작<\/button>/);
  assert.equal(html.match(/role="status"/g)?.length, 2);
  assert.doesNotMatch(html, /private|database|RPC|unexpected/i);
});

test("workspace start presents verified IFC, DXF, and DWG uploads as canonical source choices", () => {
  const ifc = {
    id: "00000000-0000-4000-8000-000000000071",
    kind: "ifc",
    original_filename: "MODEL.ifc",
    workspaceId: null,
  };
  const dxf = {
    id: "00000000-0000-4000-8000-000000000072",
    kind: "dxf",
    original_filename: "PLAN.dxf",
    workspaceId: null,
  };
  const dwg = {
    id: "00000000-0000-4000-8000-000000000076",
    kind: "dwg",
    original_filename: "NATIVE.dwg",
    workspaceId: null,
  };
  const pair = (id) => ({
    clientRequestId: id,
    clientCreatedAt: "2026-09-02T01:02:03.000Z",
  });
  const html = renderStartComponent({
    loaderData: {
      catalogNotices: {},
      files: [ifc, dxf, dwg],
      organizationTemplates: [],
      project: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "1HK 테스트 프로젝트",
      },
      requestPairs: {
        blank: pair("00000000-0000-4000-8000-000000000073"),
        libraryTemplates: {},
        pdfs: {
          [ifc.id]: pair("00000000-0000-4000-8000-000000000074"),
          [dxf.id]: pair("00000000-0000-4000-8000-000000000075"),
          [dwg.id]: pair("00000000-0000-4000-8000-000000000077"),
        },
        starters: {},
      },
      sourceFileId: dxf.id,
      starters: [],
    },
  });

  assert.match(html, /<button[^>]*>MODEL\.ifc IFC로 시작<\/button>/);
  assert.match(html, /<button[^>]*>PLAN\.dxf DXF로 시작<\/button>/);
  assert.match(html, /<button[^>]*>NATIVE\.dwg DWG로 시작<\/button>/);
  assert.match(
    html,
    /<input(?=[^>]*name="intent")(?=[^>]*value="create_ifc")[^>]*>/,
  );
  assert.match(
    html,
    /<input(?=[^>]*name="intent")(?=[^>]*value="create_dxf")[^>]*>/,
  );
  assert.match(
    html,
    /<input(?=[^>]*name="intent")(?=[^>]*value="create_dwg")[^>]*>/,
  );
});
