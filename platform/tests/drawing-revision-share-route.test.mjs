import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createServer } from "vite";

import routes from "../app/routes.ts";

const adminClientKey = "__drawingShareRouteAdminClient";
globalThis[adminClientKey] = null;
const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  plugins: [
    {
      enforce: "pre",
      name: "drawing-share-route-admin-client",
      resolveId(source) {
        if (source.endsWith("core/lib/supa-admin-client.server"))
          return "\0virtual:drawing-share-route-admin-client";
      },
      load(id) {
        if (id === "\0virtual:drawing-share-route-admin-client")
          return `export default globalThis[${JSON.stringify(adminClientKey)}];`;
      },
    },
  ],
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const routeModule = await vite
  .ssrLoadModule("/app/lukas/screens/shared-drawing.tsx")
  .catch(() => ({}));
const viewerModule = await vite
  .ssrLoadModule("/app/lukas/components/shared-drawing-viewer.client.tsx")
  .catch(() => ({}));
const entryModule = await vite
  .ssrLoadModule("/app/entry.server.tsx")
  .catch(() => ({}));
test.after(async () => {
  delete globalThis[adminClientKey];
  await vite.close();
});

const ids = {
  project: "20000000-0000-4000-8000-000000000001",
  document: "20000000-0000-4000-8000-000000000002",
  revision: "20000000-0000-4000-8000-000000000003",
  page: "20000000-0000-4000-8000-000000000004",
  canvas: "20000000-0000-4000-8000-000000000005",
  layer: "20000000-0000-4000-8000-000000000006",
  object: "20000000-0000-4000-8000-000000000007",
};
const token = "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI";
const view = {
  project: { id: ids.project, name: "성수 복합시설" },
  document: { id: ids.document, title: "건축 평면도" },
  revision: { id: ids.revision, sequence: 3, version: 7, status: "approved" },
  snapshotSha256: "a".repeat(64),
  expiresAt: "2026-09-11T00:00:00.000Z",
  pages: [
    {
      id: ids.page,
      revisionId: ids.revision,
      name: "A-101",
      sortOrder: 0,
      version: 1,
    },
  ],
  canvases: [
    {
      id: ids.canvas,
      pageId: ids.page,
      name: "1층 평면",
      spaceKind: "paper",
      widthMillimeters: 420,
      heightMillimeters: 297,
      background: null,
      sortOrder: 0,
      version: 1,
    },
  ],
  layers: [
    {
      id: ids.layer,
      canvasId: ids.canvas,
      name: "Work",
      visible: true,
      locked: false,
      systemKind: "work",
      sortOrder: 0,
      version: 1,
    },
  ],
  objects: [
    {
      id: ids.object,
      name: "기준선",
      layerId: ids.layer,
      geometry: { type: "line", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      styleId: null,
      style: { stroke: "#112233", strokeWidth: 2, fill: null },
      version: 1,
    },
  ],
  blockInstances: [],
  pdfSources: {},
};

function routePaths(nodes, result = []) {
  for (const node of nodes) {
    if (typeof node.path === "string") result.push(node.path);
    if (Array.isArray(node.children)) routePaths(node.children, result);
  }
  return result;
}

test("drawing share is a distinct public GET-only route", () => {
  assert.ok(routePaths(routes).includes("/share/:token/drawing"));
  assert.equal(typeof routeModule.loader, "function");
  assert.equal("action" in routeModule, false);
});

test("public share failures emit one bounded token-free server diagnostic", () => {
  assert.equal(typeof routeModule.logPublicDrawingShareFailure, "function");
  const entries = [];
  routeModule.logPublicDrawingShareFailure(
    new Error(`resolver failed for bearer ${token}`),
    (...entry) => entries.push(entry),
  );
  assert.deepEqual(entries, [
    [
      "Shared drawing resolution failed",
      { code: "DRAWING_SHARE_UNAVAILABLE", kind: "unexpected" },
    ],
  ]);
  assert.equal(JSON.stringify(entries).includes(token), false);
});

test("public drawing response has no-store, no-referrer, no-index headers and exact canvas selection", async () => {
  assert.equal(typeof routeModule.publicDrawingShareResponse, "function");
  assert.equal(typeof routeModule.headers, "function");
  const response = routeModule.publicDrawingShareResponse(view, ids.canvas);
  assert.equal(response.data.selectedCanvasId, ids.canvas);
  assert.equal(response.data.view.snapshotSha256, "a".repeat(64));
  assert.equal(response.init.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.init.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(response.init.headers.get("X-Robots-Tag"), "noindex, nofollow");
  const documentHeaders = routeModule.headers();
  assert.equal(documentHeaders.get("Cache-Control"), "private, no-store");
  assert.equal(documentHeaders.get("Referrer-Policy"), "no-referrer");
  assert.equal(documentHeaders.get("X-Robots-Tag"), "noindex, nofollow");
  assert.throws(() =>
    routeModule.publicDrawingShareResponse(view, ids.project),
  );
});

test("the final document security boundary preserves a stricter route referrer policy", () => {
  assert.equal(typeof entryModule.applyDocumentSecurityHeaders, "function");
  const headers = new Headers({ "Referrer-Policy": "no-referrer" });
  entryModule.applyDocumentSecurityHeaders(headers);
  assert.equal(headers.get("Referrer-Policy"), "no-referrer");

  const defaults = new Headers();
  entryModule.applyDocumentSecurityHeaders(defaults);
  assert.equal(
    defaults.get("Referrer-Policy"),
    "strict-origin-when-cross-origin",
  );
});

test("public screen renders lineage and navigation without mutation or collaboration controls", () => {
  assert.equal(typeof routeModule.default, "function");
  const html = renderToStaticMarkup(
    createElement(routeModule.default, {
      loaderData: { view, selectedCanvasId: ids.canvas },
    }),
  );
  assert.match(html, /건축 평면도/);
  assert.match(html, /1층 평면/);
  assert.match(html, /보기 전용/);
  assert.match(html, /원본 수정 불가/);
  assert.match(html, new RegExp(view.snapshotSha256));
  for (const forbidden of [
    "선 도구",
    "폴리라인 도구",
    "검토 요청",
    "최종 승인",
    "댓글 작성",
    "내보내기",
    "협업 이슈 열기",
  ])
    assert.equal(html.includes(forbidden), false, forbidden);
});

test("shared viewer exposes exact selected canvas and non-secret PDF evidence", () => {
  const sourceFileId = "20000000-0000-4000-8000-000000000008";
  const sourceSha256 = "b".repeat(64);
  const pdfView = {
    ...view,
    canvases: [
      {
        ...view.canvases[0],
        background: {
          sourceFileId,
          sourceSha256,
          pdfPageNumber: 2,
          calibration: null,
        },
      },
    ],
    pdfSources: {
      [sourceFileId]: {
        id: sourceFileId,
        sha256: sourceSha256,
        signedUrl: "https://storage.example/exact.pdf?signature=must-not-leak",
      },
    },
  };
  const html = renderToStaticMarkup(
    createElement(viewerModule.default, {
      selectedCanvasId: ids.canvas,
      view: pdfView,
    }),
  );
  assert.match(html, new RegExp(`data-active-canvas-id="${ids.canvas}"`));
  assert.match(html, /data-background-kind="pdf"/);
  assert.match(
    html,
    new RegExp(`data-background-source-file-id="${sourceFileId}"`),
  );
  assert.match(
    html,
    new RegExp(`data-background-source-sha256="${sourceSha256}"`),
  );
  assert.equal(html.includes("must-not-leak"), false);
});
