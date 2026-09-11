import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { createServer } from "vite";
import { buildNativeDrawingTemplate } from "../app/lukas/lib/drawing-native-templates.ts";
import { createDrawingDocumentState } from "../app/lukas/lib/drawing-commands.ts";
import { listNativeDrawingTemplateKeys } from "../app/lukas/lib/drawing-native-templates.ts";
import {
  listNativeDrawingSymbols,
  nativeAssetSha256,
} from "../app/lukas/lib/drawing-native-symbols.ts";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
after(() => vite.close());
const start = await vite.ssrLoadModule(
  "/app/lukas/screens/drawing-workspace-new.tsx",
);
const panel = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-workspace-start.tsx",
);
const blocks = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-blocks-panel.tsx",
);
const requestId = "71000000-0000-4000-8000-000000000008";
const projectId = "71000000-0000-4000-8000-000000000002";

test("native start accepts a known key without title and rejects title, unknown keys and duplicate identity", () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    intent: "create_native_template",
    nativeKey: "measured-plan",
    nativeVersion: "1",
    clientRequestId: requestId,
  }))
    form.set(key, value);
  assert.equal(
    start.parseDrawingWorkspaceStartForm(form).nativeKey,
    "measured-plan",
  );
  form.set("title", "Client title");
  assert.throws(() => start.parseDrawingWorkspaceStartForm(form));
  form.delete("title");
  form.set("nativeKey", "invented");
  assert.throws(() => start.parseDrawingWorkspaceStartForm(form));
  form.set("nativeKey", "measured-plan");
  form.append("nativeKey", "office-layout");
  assert.throws(() => start.parseDrawingWorkspaceStartForm(form));
});

test("native catalog failure preserves blank start and gives a local notice", async () => {
  const result = await start.resolveDrawingWorkspaceStartResources({
    documents: Promise.resolve({ data: [], error: null }),
    files: Promise.resolve({ data: [], error: null }),
    starters: Promise.resolve([]),
    libraryVersions: Promise.resolve([]),
    nativeTemplates: Promise.reject(new Error("RPC unavailable")),
  });
  assert.deepEqual(result.nativeTemplates, []);
  assert.match(result.catalogNotices.nativeTemplates, /예제 도면/);
  assert.deepEqual(result.documents.data, []);
});

test("native start card renders a real authenticated SVG URL first and preserves request identity on error", () => {
  const loaderData = {
    project: { id: projectId, name: "내 작업실" },
    files: [],
    starters: [],
    organizationTemplates: [],
    nativeTemplates: [
      {
        key: "measured-plan",
        version: 1,
        name: "치수 평면 예제",
        description: "가정값",
      },
    ],
    requestPairs: {
      blank: { clientRequestId: requestId },
      nativeTemplates: { "measured-plan": { clientRequestId: requestId } },
    },
  };
  const router = createMemoryRouter([
    {
      path: "/",
      element: React.createElement(panel.DrawingWorkspaceStart, {
        loaderData,
        actionData: {
          ok: false,
          fieldErrors: {},
          formError: "다시 시도",
          clientRequestId: requestId,
          clientCreatedAt: null,
        },
      }),
    },
  ]);
  const html = renderToStaticMarkup(
    React.createElement(RouterProvider, { router }),
  );
  assert.match(html, /alt="치수 평면 예제 미리보기"/);
  assert.match(html, />1HK 기본 · 예제 · v1<\/p>/);
  assert.match(
    html,
    /drawing-native-assets\?kind=workspace_template&amp;key=measured-plan/,
  );
  assert.ok(
    html.indexOf("예제 도면으로 시작") < html.indexOf("blank-workspace-title"),
  );
  assert.match(html, /name="intent"[^>]+value="create_native_template"/);
  assert.match(html, /이 도면으로 시작/);
  assert.match(html, /다시 시도/);
});

test("native symbol search matches names and keys and combines with category", () => {
  const items = [
    {
      key: "door-single-900",
      name: "Single door 900 mm",
      classification: "door",
    },
    { key: "window-900", name: "Window 900 mm", classification: "window" },
  ];
  assert.deepEqual(
    blocks
      .filterNativeDrawingSymbols(items, "  900 ", "door")
      .map((x) => x.key),
    ["door-single-900"],
  );
  assert.deepEqual(
    blocks.filterNativeDrawingSymbols(items, "WINDOW", "all").map((x) => x.key),
    ["window-900"],
  );
  assert.deepEqual(
    blocks.filterNativeDrawingSymbols(items, "없는 이름", "all"),
    [],
  );
  assert.deepEqual(
    blocks.filterNativeDrawingSymbols(items, "문", "all").map((x) => x.key),
    ["door-single-900"],
  );
  assert.deepEqual(
    blocks.filterNativeDrawingSymbols(items, "창", "all").map((x) => x.key),
    ["window-900"],
  );
});

test("symbol import stays disabled offline, during local work, revalidation or a pending import", () => {
  const ready = {
    canEdit: true,
    online: true,
    outboxReady: true,
    checkpointReady: true,
    localMutationCount: 0,
    volatileCount: 0,
    saved: true,
    pending: false,
  };
  assert.equal(blocks.nativeDrawingSymbolImportReady(ready), true);
  for (const change of [
    { canEdit: false },
    { online: false },
    { outboxReady: false },
    { checkpointReady: false },
    { localMutationCount: 1 },
    { volatileCount: 1 },
    { saved: false },
    { pending: true },
  ])
    assert.equal(
      blocks.nativeDrawingSymbolImportReady({ ...ready, ...change }),
      false,
    );
});

test("read-only native symbol panel exposes search, count and an empty status without import controls", () => {
  const { revisionId, ...structure } =
    buildNativeDrawingTemplate("measured-plan").structure;
  const state = createDrawingDocumentState({ revisionId, structure });
  const html = renderToStaticMarkup(
    React.createElement(blocks.DrawingBlocksPanel, {
      state,
      activeCanvasId: null,
      activeLayerId: null,
      actorId: projectId,
      canEdit: false,
      layers: state.layers,
      selectedIds: [],
      onCommand() {
        assert.fail("Unexpected edit");
      },
      onSelectionChange() {},
      nativeCatalogUrl: `/projects/${projectId}/drawing-native-assets?kind=block`,
    }),
  );
  assert.match(html, /기본 심볼 검색/);
  assert.match(html, /0개 심볼/);
  assert.match(html, /조건에 맞는 심볼이 없습니다/);
  assert.doesNotMatch(html, />블록에 추가<\/button>/);
});

test("native SVG resource authenticates first, emits canonical A3 geometry and never exposes catalog payload in metadata", async () => {
  const boundary = "__nativeCatalogResourceContext";
  const resourceVite = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    resolve: {
      alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
    },
    server: { middlewareMode: true },
    plugins: [
      {
        name: "native-resource-session-boundary",
        enforce: "pre",
        resolveId(source) {
          if (source.endsWith("/drawing-collaboration.server"))
            return "\0native-resource-context";
        },
        load(id) {
          if (id === "\0native-resource-context")
            return `export const drawingContext = (...args) => globalThis.${boundary}(...args);`;
        },
      },
    ],
  });
  try {
    const resource = await resourceVite.ssrLoadModule(
      "/app/lukas/screens/drawing-native-assets.ts",
    );
    const request = new Request(
      `http://localhost/projects/${projectId}/drawing-native-assets?kind=workspace_template&key=measured-plan`,
    );
    const definitions = listNativeDrawingTemplateKeys().map(
      buildNativeDrawingTemplate,
    );
    const rows = await Promise.all(
      definitions.map(async (definition) => ({
        kind: "workspace_template",
        key: definition.key,
        version: 1,
        name: definition.name,
        description: definition.description,
        definition,
        artifactSha256: await nativeAssetSha256(definition),
        contentSha256: "a".repeat(64),
      })),
    );
    globalThis[boundary] = async () => ({
      project: { id: projectId },
      headers: new Headers({ "X-Session-Test": "preserved" }),
      client: {
        rpc: async (name, args) => {
          assert.equal(name, "lukas_drawing_list_native_assets");
          assert.deepEqual(args, {
            p_project_id: projectId,
            p_kind: "workspace_template",
          });
          return { data: rows, error: null };
        },
      },
    });
    const response = await resource.loader({ request, params: { projectId } });
    assert.equal(
      response.headers.get("Content-Type"),
      "image/svg+xml; charset=utf-8",
    );
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("X-Session-Test"), "preserved");
    const svg = await response.text();
    assert.match(svg, /width="420mm" height="297mm" viewBox="0 0 21000 14850"/);
    assert.match(svg, /예제/);
    assert.equal(
      Object.values(definitions[0].structure.canvases)[0].outputProfile,
      undefined,
    );
    const symbolRows = await Promise.all(
      listNativeDrawingSymbols().map(async (definition) => ({
        kind: "block",
        key: definition.key,
        version: 1,
        name: definition.name,
        description: definition.description,
        definition,
        artifactSha256: await nativeAssetSha256(definition),
        contentSha256: "a".repeat(64),
      })),
    );
    globalThis[boundary] = async () => ({
      project: { id: projectId },
      headers: new Headers(),
      client: { rpc: async () => ({ data: symbolRows, error: null }) },
    });
    const symbols = await resource.loader({
      request: new Request("http://localhost/?kind=block"),
      params: { projectId },
    });
    const metadata = await symbols.json();
    assert.equal(metadata.items.length, 24);
    const door = metadata.items.find(
      (symbol) => symbol.key === "door-single-900",
    );
    assert.equal(door.classification, "door");
    assert.equal(typeof door.recommendedLayer, "string");
    assert.equal("definition" in door, false);
    assert.equal("contentSha256" in door, false);
    globalThis[boundary] = async () => {
      throw new Response(null, {
        status: 302,
        headers: { Location: "/login" },
      });
    };
    await assert.rejects(
      resource.loader({
        request: new Request("http://localhost/?unknown=invalid"),
        params: { projectId },
      }),
      (error) => error.status === 302,
    );
  } finally {
    delete globalThis[boundary];
    await resourceVite.close();
  }
});
