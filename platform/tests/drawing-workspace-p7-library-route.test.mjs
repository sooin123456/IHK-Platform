import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ThemeProvider } from "remix-themes";
import { createServer } from "vite";

import {
  ORGANIZATION_LIBRARY_LIST_LIMIT,
  assertOrganizationDrawingLibraryMutationAllowed,
  listOrganizationDrawingLibrary,
  listOrganizationPriceBookReuseCandidates,
  parseOrganizationDrawingLibraryForm,
  parseOrganizationDrawingLibrarySearch,
  runOrganizationDrawingLibraryMutation,
} from "../app/lukas/lib/organization-drawing-library.server.ts";
import { buildNativeDrawingTemplate } from "../app/lukas/lib/drawing-native-templates.ts";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const libraryScreen = await vite.ssrLoadModule(
  "/app/lukas/screens/organization-drawing-library.tsx",
);

test.after(() => vite.close());

const ids = Object.freeze({
  organization: "71000000-0000-4000-8000-000000000001",
  project: "71000000-0000-4000-8000-000000000002",
  revision: "71000000-0000-4000-8000-000000000003",
  entity: "71000000-0000-4000-8000-000000000004",
  version: "71000000-0000-4000-8000-000000000005",
  predecessor: "71000000-0000-4000-8000-000000000006",
  request: "71000000-0000-4000-8000-000000000007",
  platformEntry: "71000000-0000-4000-8000-000000000008",
  platformVersion: "71000000-0000-4000-8000-000000000009",
  customEntry: "71000000-0000-4000-8000-000000000010",
  customVersion: "71000000-0000-4000-8000-000000000011",
  creator: "71000000-0000-4000-8000-000000000012",
  projectTwo: "71000000-0000-4000-8000-000000000013",
});

const platformPayload = {
  schemaVersion: "1hk-platform-starter/1",
  key: "interior-basic",
  version: 1,
  name: "실내건축 기본 적산",
  description: "바닥·벽·천장·문·창호·가구 기본 수량을 정리합니다.",
  layers: ["실측", "바닥", "벽", "천장", "문·창호", "가구"],
  categories: ["바닥", "벽", "천장", "문", "창호", "가구", "철거"],
  evidenceKinds: ["수기 입력", "현장 실측", "가정값", "원본 연결"],
  table: {
    name: "기본 내역",
    columns: ["적산 분류", "품목 코드", "측정 종류", "단위", "검토 규칙"],
    rows: [],
  },
};

function renderLibrary(props) {
  const router = createMemoryRouter(
    [
      {
        path: "/organizations/:organizationId/drawing-library",
        element: React.createElement(libraryScreen.default, props),
      },
    ],
    {
      initialEntries: [`/organizations/${ids.organization}/drawing-library`],
    },
  );
  return renderToStaticMarkup(
    React.createElement(
      ThemeProvider,
      { specifiedTheme: "light", themeAction: "/theme" },
      React.createElement(RouterProvider, { router }),
    ),
  );
}

function listClient() {
  const entries = [
    {
      id: ids.platformEntry,
      organization_id: ids.organization,
      kind: "workspace_template",
      name: platformPayload.name,
      created_by: ids.creator,
      created_at: "2026-08-31T00:00:00.000Z",
    },
    {
      id: ids.customEntry,
      organization_id: ids.organization,
      kind: "workspace_template",
      name: "회사 표준 템플릿",
      created_by: ids.creator,
      created_at: "2026-08-30T00:00:00.000Z",
    },
  ];
  const common = {
    organization_id: ids.organization,
    version_no: 1,
    status: "published",
    predecessor_version_id: null,
    source_entity_id: null,
    created_by: ids.creator,
    published_by: ids.creator,
    created_at: "2026-08-31T00:00:00.000Z",
    published_at: "2026-08-31T00:00:00.000Z",
    deprecated_at: null,
  };
  const versions = [
    {
      ...common,
      id: ids.platformVersion,
      registry_id: ids.platformEntry,
      canonical_payload: platformPayload,
      content_sha256: "a".repeat(64),
      source_kind: "platform_starter",
      source_project_id: null,
      source_revision_id: null,
      platform_starter_key: "interior-basic",
      platform_starter_version: 1,
    },
    {
      ...common,
      id: ids.customVersion,
      registry_id: ids.customEntry,
      canonical_payload: {
        schemaVersion: 2,
        revision: {},
        pages: [],
        layers: [],
        objects: [],
        operationSequence: 0,
      },
      content_sha256: "b".repeat(64),
      source_kind: "project_revision",
      source_project_id: ids.project,
      source_revision_id: ids.revision,
      platform_starter_key: null,
      platform_starter_version: null,
    },
  ];
  return {
    from(table) {
      const result = {
        data: table === "lukas_drawing_library_entries" ? entries : versions,
        error: null,
      };
      const chain = {
        eq() {
          return chain;
        },
        in() {
          return chain;
        },
        limit() {
          return chain;
        },
        order() {
          return chain;
        },
        select() {
          return chain;
        },
        then(resolve, reject) {
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}

function form(entries) {
  const value = new FormData();
  for (const [key, item] of Object.entries(entries)) value.set(key, item);
  return value;
}

test("organization library mutations accept stable authority inputs only", () => {
  assert.deepEqual(
    parseOrganizationDrawingLibraryForm(
      form({
        intent: "create_draft",
        kind: "style",
        name: "회사 표준선",
        source_revision_id: ids.revision,
        source_entity_id: ids.entity,
        predecessor_version_id: ids.predecessor,
      }),
    ),
    {
      intent: "create_draft",
      kind: "style",
      name: "회사 표준선",
      sourceRevisionId: ids.revision,
      sourceEntityId: ids.entity,
      predecessorVersionId: ids.predecessor,
    },
  );
  assert.deepEqual(
    parseOrganizationDrawingLibraryForm(
      form({ intent: "publish", version_id: ids.version }),
    ),
    { intent: "publish", versionId: ids.version },
  );
  assert.deepEqual(
    parseOrganizationDrawingLibraryForm(
      form({ intent: "deprecate", version_id: ids.version }),
    ),
    { intent: "deprecate", versionId: ids.version },
  );
  assert.deepEqual(
    parseOrganizationDrawingLibraryForm(
      form({
        intent: "import",
        version_id: ids.version,
        project_id: ids.project,
        revision_id: ids.revision,
        client_request_id: ids.request,
      }),
    ),
    {
      intent: "import",
      versionId: ids.version,
      projectId: ids.project,
      revisionId: ids.revision,
      clientRequestId: ids.request,
    },
  );

  for (const injected of [
    { content_sha256: "a".repeat(64) },
    { canonical_payload: "{}" },
    { organization_id: ids.organization },
    { status: "published" },
    { target_entity_id: ids.entity },
  ])
    assert.throws(
      () =>
        parseOrganizationDrawingLibraryForm(
          form({
            intent: "publish",
            version_id: ids.version,
            ...injected,
          }),
        ),
      /허용되지 않은 필드/,
    );
});

test("workspace template drafts have no polymorphic entity and imports keep exact optional revision", () => {
  assert.deepEqual(
    parseOrganizationDrawingLibraryForm(
      form({
        intent: "create_draft",
        kind: "workspace_template",
        name: "기본 작업실",
        source_revision_id: ids.revision,
      }),
    ),
    {
      intent: "create_draft",
      kind: "workspace_template",
      name: "기본 작업실",
      sourceRevisionId: ids.revision,
      sourceEntityId: null,
      predecessorVersionId: null,
    },
  );
  assert.deepEqual(
    parseOrganizationDrawingLibraryForm(
      form({
        intent: "import",
        version_id: ids.version,
        project_id: ids.project,
        client_request_id: ids.request,
      }),
    ),
    {
      intent: "import",
      versionId: ids.version,
      projectId: ids.project,
      revisionId: null,
      clientRequestId: ids.request,
    },
  );
  assert.throws(
    () =>
      parseOrganizationDrawingLibraryForm(
        form({
          intent: "create_draft",
          kind: "block",
          name: "문",
          source_revision_id: ids.revision,
        }),
      ),
    /원본 객체/,
  );
});

test("organization library search is bounded and cursor identity is exact", () => {
  assert.equal(ORGANIZATION_LIBRARY_LIST_LIMIT, 100);
  assert.deepEqual(
    parseOrganizationDrawingLibrarySearch(
      new URLSearchParams({ kind: "block", status: "published" }),
    ),
    { kind: "block", status: "published" },
  );
  assert.throws(
    () =>
      parseOrganizationDrawingLibrarySearch(
        new URLSearchParams({ kind: "unknown" }),
      ),
    /필터/,
  );
});

test("platform starter rows keep nullable provenance, a closed payload, and read-only project-explicit use links", async () => {
  const versions = await listOrganizationDrawingLibrary(
    listClient(),
    ids.organization,
    {},
  );
  const platform = versions.find(
    ({ source_kind }) => source_kind === "platform_starter",
  );
  const custom = versions.find(
    ({ source_kind }) => source_kind === "project_revision",
  );
  assert.equal(platform.source_project_id, null);
  assert.equal(platform.source_revision_id, null);
  assert.equal(platform.source_entity_id, null);
  assert.equal(platform.platform_starter_key, "interior-basic");
  assert.deepEqual(platform.canonical_payload, platformPayload);
  assert.equal(custom.source_project_id, ids.project);
  assert.equal(custom.source_revision_id, ids.revision);

  const html = renderLibrary({
    actionData: undefined,
    loaderData: {
      organization: { id: ids.organization, name: "1HK 조직" },
      importRequestId: ids.request,
      mayManage: true,
      filters: {},
      projects: [
        {
          id: ids.project,
          name: "서울 프로젝트",
          organization_id: ids.organization,
          can_create_workspace: true,
        },
        {
          id: ids.projectTwo,
          name: "부산 프로젝트",
          organization_id: ids.organization,
          can_create_workspace: true,
        },
      ],
      revisions: [],
      sources: { style: [], block: [], property_schema: [] },
      versions,
      allVersions: versions,
    },
  });
  assert.match(html, /1HK 기본 · 읽기 전용/);
  assert.match(
    html,
    new RegExp(
      `href="/projects/${ids.project}/workspaces/new\\?starterKey=interior-basic"[^>]*>서울 프로젝트 · 사용<`,
    ),
  );
  assert.match(
    html,
    new RegExp(
      `href="/projects/${ids.projectTwo}/workspaces/new\\?starterKey=interior-basic"[^>]*>부산 프로젝트 · 사용<`,
    ),
  );
  assert.equal(
    (html.match(/name="intent" value="deprecate"/g) ?? []).length,
    1,
  );
  assert.equal((html.match(/name="intent" value="import"/g) ?? []).length, 2);
  assert.doesNotMatch(
    html,
    new RegExp(`name="version_id" value="${ids.platformVersion}"`),
  );
});

test("native library entry visibly identifies its authored asset version and stays read-only", async () => {
  const [existing] = await listOrganizationDrawingLibrary(listClient(), ids.organization, {});
  const definition = buildNativeDrawingTemplate("measured-plan");
  const native = {
    ...existing,
    source_kind: "platform_native",
    version_no: 7,
    native_asset_key: "measured-plan",
    native_asset_version: 1,
    platform_starter_key: null,
    platform_starter_version: null,
    canonical_payload: definition,
    entry: { ...existing.entry, name: definition.name },
  };
  const html = renderLibrary({
    actionData: undefined,
    loaderData: {
      organization: { id: ids.organization, name: "1HK 조직" },
      importRequestId: ids.request,
      mayManage: true,
      filters: {},
      projects: [],
      revisions: [],
      sources: { style: [], block: [], property_schema: [] },
      versions: [native],
      allVersions: [native],
    },
  });
  assert.match(html, />1HK 기본 · 예제 · v1 · 읽기 전용<\/p>/);
  assert.doesNotMatch(html, /name="intent" value="(?:publish|deprecate)"/);
});

test("a platform starter without an accessible project renders no ambient use target", async () => {
  const versions = await listOrganizationDrawingLibrary(
    listClient(),
    ids.organization,
    {},
  );
  const html = renderLibrary({
    actionData: undefined,
    loaderData: {
      organization: { id: ids.organization, name: "1HK 조직" },
      importRequestId: ids.request,
      mayManage: true,
      filters: {},
      projects: [],
      revisions: [],
      sources: { style: [], block: [], property_schema: [] },
      versions: versions.filter(
        ({ source_kind }) => source_kind === "platform_starter",
      ),
      allVersions: versions,
    },
  });
  assert.match(html, /사용 가능한 프로젝트가 없습니다/);
  assert.doesNotMatch(html, /workspaces\/new\?starterKey=/);
});

test("library workspace creation targets only projects with server-derived create capability", async () => {
  const versions = await listOrganizationDrawingLibrary(
    listClient(),
    ids.organization,
    {},
  );
  const html = renderLibrary({
    actionData: undefined,
    loaderData: {
      organization: { id: ids.organization, name: "1HK 조직" },
      importRequestId: ids.request,
      mayManage: false,
      filters: {},
      projects: [
        {
          id: ids.project,
          name: "편집 가능",
          organization_id: ids.organization,
          can_create_workspace: true,
        },
        {
          id: ids.projectTwo,
          name: "읽기 전용",
          organization_id: ids.organization,
          can_create_workspace: false,
        },
      ],
      revisions: [],
      sources: { style: [], block: [], property_schema: [] },
      versions,
      allVersions: versions,
    },
  });

  assert.match(html, new RegExp(`/projects/${ids.project}/workspaces/new`));
  assert.doesNotMatch(
    html,
    new RegExp(`/projects/${ids.projectTwo}/workspaces/new`),
  );
  assert.doesNotMatch(html, />읽기 전용 · 사용</);
  assert.doesNotMatch(
    html,
    new RegExp(`name="project_id" value="${ids.projectTwo}"`),
  );
});

test("generic library publish, deprecate, and import mutations reject platform starters server-side", () => {
  for (const intent of ["publish", "deprecate", "import"])
    assert.throws(
      () =>
        assertOrganizationDrawingLibraryMutationAllowed(
          { source_kind: "platform_starter" },
          intent,
        ),
      /platform|기본|읽기 전용/i,
    );
  for (const intent of ["publish", "deprecate", "import"])
    assert.doesNotThrow(() =>
      assertOrganizationDrawingLibraryMutationAllowed(
        { source_kind: "project_revision" },
        intent,
      ),
    );
});

test("every mutation binds the route organization into database authority", async () => {
  const calls = [];
  const client = {
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve({ data: {}, error: null });
    },
  };
  for (const mutation of [
    { intent: "publish", versionId: ids.version },
    { intent: "deprecate", versionId: ids.version },
    {
      intent: "import",
      versionId: ids.version,
      projectId: ids.project,
      revisionId: ids.revision,
      clientRequestId: ids.request,
    },
  ])
    await runOrganizationDrawingLibraryMutation(
      client,
      ids.organization,
      mutation,
    );
  assert.equal(calls.length, 3);
  for (const call of calls)
    assert.equal(call.args.p_organization_id, ids.organization, call.name);
});

test("organization library route is mounted in authenticated navigation", () => {
  const routes = readFileSync(
    new URL("../app/routes.ts", import.meta.url),
    "utf8",
  );
  const screen = readFileSync(
    new URL(
      "../app/lukas/screens/organization-drawing-library.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const dashboard = readFileSync(
    new URL("../app/lukas/components/workspace-dashboard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(routes, /organizations\/:organizationId\/drawing-library/);
  assert.match(screen, /회사 도면 라이브러리/);
  assert.match(screen, /create_draft/);
  assert.match(screen, /publish/);
  assert.match(screen, /deprecate/);
  assert.match(screen, /client_request_id/);
  assert.doesNotMatch(screen, /원본 객체 UUID|직전 버전 UUID/);
  assert.match(screen, /predecessorOptions/);
  assert.match(dashboard, /drawing-library/);
});

test("price-book reuse candidates are parsed from the organization-authorized RPC", async () => {
  const calls = [];
  const candidates = await listOrganizationPriceBookReuseCandidates(
    {
      rpc(name, args) {
        calls.push({ name, args });
        return Promise.resolve({
          data: [
            {
              source_sha256: "c".repeat(64),
              project_count: 2,
              price_book_count: 3,
              projects: [
                { id: ids.projectTwo, name: "부산 프로젝트" },
                { id: ids.project, name: "서울 프로젝트" },
              ],
            },
          ],
          error: null,
        });
      },
    },
    ids.organization,
  );
  assert.deepEqual(calls, [
    {
      name: "lukas_qto_list_organization_price_book_reuse_candidates",
      args: { p_organization_id: ids.organization },
    },
  ]);
  assert.equal(candidates[0].project_count, 2);
  assert.equal(candidates[0].price_book_count, 3);
  assert.deepEqual(
    candidates[0].projects.map(({ name }) => name),
    ["부산 프로젝트", "서울 프로젝트"],
  );
});

test("optional price-book reuse evidence failure settles as unavailable", async () => {
  const library = await import(
    "../app/lukas/lib/organization-drawing-library.server.ts"
  );
  assert.equal(
    typeof library.loadOrganizationPriceBookReuseEvidence,
    "function",
    "the optional evidence loader must settle RPC failures",
  );
  const evidence = await library.loadOrganizationPriceBookReuseEvidence(
    {
      rpc() {
        return Promise.resolve({
          data: null,
          error: { message: "schema cache has not reloaded" },
        });
      },
    },
    ids.organization,
  );
  assert.deepEqual(evidence, { candidates: [], status: "unavailable" });
});

test("price-book reuse evidence rejects duplicate project rows that disagree with its count", async () => {
  await assert.rejects(
    listOrganizationPriceBookReuseCandidates(
      {
        rpc() {
          return Promise.resolve({
            data: [
              {
                source_sha256: "d".repeat(64),
                project_count: 2,
                price_book_count: 3,
                projects: [
                  { id: ids.project, name: "서울 프로젝트" },
                  { id: ids.project, name: "서울 프로젝트" },
                  { id: ids.projectTwo, name: "부산 프로젝트" },
                ],
              },
            ],
            error: null,
          });
        },
      },
      ids.organization,
    ),
    /단가표 반복 사용 근거/,
  );
});

test("organization managers see read-only reuse evidence or the explicit no-registry reason", async () => {
  const versions = await listOrganizationDrawingLibrary(
    listClient(),
    ids.organization,
    {},
  );
  const baseLoaderData = {
    organization: { id: ids.organization, name: "1HK 조직" },
    importRequestId: ids.request,
    mayManage: true,
    filters: {},
    projects: [],
    revisions: [],
    sources: { style: [], block: [], property_schema: [] },
    versions,
    allVersions: versions,
  };
  const evidence = renderLibrary({
    actionData: undefined,
    loaderData: {
      ...baseLoaderData,
      priceBookReuseEvidence: {
        status: "available",
        candidates: [
          {
            source_sha256: "c".repeat(64),
            project_count: 2,
            price_book_count: 3,
            projects: [
              { id: ids.projectTwo, name: "부산 프로젝트" },
              { id: ids.project, name: "서울 프로젝트" },
            ],
          },
        ],
      },
    },
  });
  assert.match(evidence, /단가표 반복 사용 증거/);
  assert.match(evidence, /2개 프로젝트 · 3개 단가표/);
  assert.match(evidence, /부산 프로젝트/);
  assert.match(evidence, /서울 프로젝트/);
  assert.match(evidence, new RegExp(`SHA-256 ${"c".repeat(64)}`));
  assert.doesNotMatch(evidence, /단가표 레지스트리 만들기/);

  const empty = renderLibrary({
    actionData: undefined,
    loaderData: {
      ...baseLoaderData,
      priceBookReuseEvidence: { status: "available", candidates: [] },
    },
  });
  assert.match(empty, /2개 이상의 프로젝트에서 반복 사용한 근거가 없어/);
  assert.match(empty, /단가표 레지스트리를 만들지 않았습니다/);

  const unavailable = renderLibrary({
    actionData: undefined,
    loaderData: {
      ...baseLoaderData,
      priceBookReuseEvidence: { status: "unavailable", candidates: [] },
    },
  });
  assert.match(unavailable, /단가표 반복 사용 증거를 현재 불러올 수 없습니다/);
  assert.match(unavailable, /회사 표준 템플릿/);
  assert.doesNotMatch(
    unavailable,
    /반복 사용한 근거가 없어 조직 단가표 레지스트리를 만들지 않았습니다/,
  );

  const member = renderLibrary({
    actionData: undefined,
    loaderData: {
      ...baseLoaderData,
      mayManage: false,
      priceBookReuseEvidence: { status: "unavailable", candidates: [] },
    },
  });
  assert.doesNotMatch(member, /단가표 반복 사용 증거/);
});
