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
const { default: ProjectDrawings } = await vite.ssrLoadModule(
  "/app/lukas/screens/project-drawings.tsx",
);
const { ProjectDrawingsBrowser } = await vite.ssrLoadModule(
  "/app/lukas/components/project-drawings-browser.tsx",
);
test.after(() => vite.close());

const projectId = "00000000-0000-4000-8000-000000000101";
const documentId = "00000000-0000-4000-8000-000000000111";
const sourceId = "00000000-0000-4000-8000-000000000121";
const source = {
  id: sourceId,
  kind: "pdf",
  original_filename: "A-101.pdf",
  byte_size: 2048,
  created_at: "2026-09-01T00:00:00Z",
};
const document = {
  id: documentId,
  title: "사무실 평면",
  source_file_id: sourceId,
  updated_at: "2026-09-07T00:00:00Z",
};
const secondDocument = {
  id: "00000000-0000-4000-8000-000000000112",
  title: "가구 배치",
  source_file_id: null,
  updated_at: "2026-09-06T00:00:00Z",
};

function render(overrides = {}, query = "") {
  const loaderData = {
    project: { id: projectId, name: "성수동 사무실" },
    documents: [document, secondDocument],
    files: [source],
    canCreateWorkspace: true,
    ...overrides,
  };
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: React.createElement(ProjectDrawings, { loaderData }),
      },
    ],
    { initialEntries: [`/projects/${projectId}/drawings${query}`] },
  );
  const html = renderToStaticMarkup(
    React.createElement(RouterProvider, { router }),
  );
  router.dispose();
  return html;
}

// A linked source and its editable document must not masquerade as two drawings.
test("default project view renders each editable document once, separately from sources", () => {
  const html = render();
  const target = `href="/projects/${projectId}/workspaces/${documentId}"`;
  assert.equal(html.split(target).length - 1, 1);
  assert.match(html, /aria-label="도면 검색"/);
  assert.match(html, /aria-pressed="true"[^>]*>편집 도면/);
  assert.doesNotMatch(html, /원본 IFC·PDF·DXF/);
});

test("source-name search finds the associated drawing without unrelated results", () => {
  const html = render({}, "?q=a-101.PDF");
  assert.match(html, /사무실 평면/);
  assert.doesNotMatch(html, /가구 배치/);
});

test("unmatched search has a reset affordance instead of a first-project creation prompt", () => {
  const html = render({}, "?q=존재하지않음");
  assert.match(html, /검색 결과가 없습니다/);
  assert.match(html, /검색 초기화/);
  assert.doesNotMatch(html, /사무실 평면|가구 배치/);
});

test("original tab retains the latest linked document destination without duplicating editable cards", () => {
  const older = {
    ...document,
    id: "00000000-0000-4000-8000-000000000113",
    title: "지난 개정",
    updated_at: "2026-09-01T00:00:00Z",
  };
  const html = render({ documents: [older, document] }, "?tab=files");
  assert.match(html, /A-101.pdf/);
  assert.ok(
    html.includes(`href="/projects/${projectId}/workspaces/${documentId}"`),
  );
  assert.doesNotMatch(html, /지난 개정/);
  assert.match(html, /편집 도면 열기/);
});

test("source-only projects default to source entries with editor-only creation targets", () => {
  const html = render({ documents: [] });
  assert.ok(
    html.includes(
      `href="/projects/${projectId}/workspaces/new?sourceFileId=${sourceId}"`,
    ),
  );
  assert.match(html, /작업실 만들기/);
});

test("viewer can open documents but never receives creation or upload entry links", () => {
  const html = render({ canCreateWorkspace: false });
  const originals = render(
    { canCreateWorkspace: false, documents: [] },
    "?tab=files",
  );
  assert.ok(
    html.includes(`href="/projects/${projectId}/workspaces/${documentId}"`),
  );
  for (const result of [html, originals]) {
    assert.doesNotMatch(result, /workspaces\/new|#upload/);
  }
  assert.ok(originals.includes(`href="/projects/${projectId}/files"`));
  assert.match(originals, /파일 보기/);
});

test("empty source tab does not imply that existing blank drawings are gone", () => {
  const html = render({ files: [], documents: [secondDocument] }, "?tab=files");
  assert.match(html, /원본 파일이 없습니다/);
  assert.match(html, /편집 도면/);
  assert.doesNotMatch(html, /아직 등록된 도면이 없습니다/);
});

test("title sorting and list view are reflected in server-rendered initial state", () => {
  const html = render({}, "?sort=title&view=list");
  assert.ok(html.indexOf("가구 배치") < html.indexOf("사무실 평면"));
  assert.match(html, /data-drawing-view="list"/);
});

test("truly empty viewer gets a read-only empty state and project overview escape", () => {
  const html = render({ canCreateWorkspace: false, files: [], documents: [] });
  assert.match(html, /아직 도면이 없습니다/);
  assert.ok(html.includes(`href="/projects/${projectId}"`));
  assert.doesNotMatch(html, /workspaces\/new|#upload/);
});

test("real documents never use preview illustrations as customer thumbnails", () => {
  const html = render({
    documents: [
      { ...document, thumbnailUrl: "/images/workspace-start/office-plan.png" },
    ],
  });
  assert.doesNotMatch(html, /src="\/images\/workspace-start/);
});

test("read-only preview keeps its role on editor and project navigation links", () => {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: React.createElement(ProjectDrawingsBrowser, {
          project: { id: projectId, name: "성수동 사무실" },
          documents: [document],
          files: [source],
          canCreateWorkspace: false,
          previewMode: true,
        }),
      },
    ],
    { initialEntries: [`/workspace-preview?project=${projectId}&role=viewer`] },
  );
  const html = renderToStaticMarkup(
    React.createElement(RouterProvider, { router }),
  );
  router.dispose();
  const link = html.match(
    /href="(\/workspace-preview\/drawing-workspace\?[^"]+)"/,
  )?.[1];
  assert.ok(link);
  const target = new URL(link.replaceAll("&amp;", "&"), "http://localhost");
  assert.equal(target.searchParams.get("layout"), "pdf");
  assert.equal(target.searchParams.get("startKind"), "office");
  assert.equal(target.searchParams.get("title"), "사무실 평면");
  assert.equal(target.searchParams.get("returnProject"), projectId);
  assert.equal(target.searchParams.get("role"), "viewer");
  assert.ok(
    html.includes(
      `href="/workspace-preview?project=${projectId}&amp;role=viewer&amp;panel=project-reviews"`,
    ),
  );
  assert.doesNotMatch(html, /\/projects\/|start=blank|start=file/);
});

test("non-PDF preview information keeps the original-files tab and viewer origin", () => {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: React.createElement(ProjectDrawingsBrowser, {
          project: { id: projectId, name: "성수동 사무실" },
          documents: [],
          files: [
            { ...source, kind: "ifc", original_filename: "structure.ifc" },
          ],
          canCreateWorkspace: false,
          previewMode: true,
        }),
      },
    ],
    {
      initialEntries: [
        `/workspace-preview?project=${projectId}&role=viewer&tab=files`,
      ],
    },
  );
  const html = renderToStaticMarkup(
    React.createElement(RouterProvider, { router }),
  );
  router.dispose();
  assert.match(html, /파일 정보/);
  assert.ok(
    html.includes(
      `href="/workspace-preview?project=${projectId}&amp;role=viewer&amp;tab=files&amp;panel=project-files"`,
    ),
  );
  assert.doesNotMatch(html, /drawing-workspace\?layout=pdf/);
});
