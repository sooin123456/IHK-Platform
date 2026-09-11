import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createElement } from "react";
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
const { DrawingWorkspaceSourceAttachControl } = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-workspace.tsx",
);
test.after(() => vite.close());

const revisionId = "00000000-0000-4000-8000-000000000001";
const canvasId = "00000000-0000-4000-8000-000000000002";
const fileId = "00000000-0000-4000-8000-000000000003";

function render(props) {
  return renderToStaticMarkup(
    createElement(RouterProvider, {
      router: createMemoryRouter(
        [
          {
            path: "/",
            element: createElement(DrawingWorkspaceSourceAttachControl, props),
          },
        ],
        { initialEntries: ["/"] },
      ),
    }),
  );
}

test("source-free editor gets one bounded PDF attachment form", () => {
  const markup = render({
    attach: {
      canvasId,
      candidates: [
        {
          id: fileId,
          kind: "pdf",
          originalFilename: "A-201.pdf",
          byteSize: 2_048,
          sha256: "a".repeat(64),
          createdAt: "2026-09-02T00:00:00.000Z",
        },
      ],
      error: null,
    },
    canSubmit: true,
    pending: false,
    revisionId,
    roomUrl: "/projects/project/drawings",
  });
  assert.match(markup, /aria-label="PDF 원본 연결"/);
  assert.match(markup, /type="hidden" name="intent" value="attach_source"/);
  assert.match(markup, new RegExp(`name="revision_id" value="${revisionId}"`));
  assert.match(markup, new RegExp(`name="canvas_id" value="${canvasId}"`));
  assert.match(markup, /type="hidden" name="request_id"/);
  assert.match(markup, /name="source_file_id"/);
  assert.match(markup, /A-201\.pdf · 2\.0 KB · aaaaaaaa/);
  assert.doesNotMatch(markup, /disabled=""/);
});

test("source attachment stays read-only while local work is unsettled and degrades without candidates", () => {
  const blocked = render({
    attach: {
      canvasId,
      candidates: [
        {
          id: fileId,
          kind: "pdf",
          originalFilename: "A-201.pdf",
          byteSize: 2_048,
          sha256: "a".repeat(64),
          createdAt: "2026-09-02T00:00:00.000Z",
        },
      ],
      error: null,
    },
    canSubmit: false,
    pending: false,
    revisionId,
    roomUrl: "/projects/project/drawings",
  });
  assert.match(blocked, /disabled=""/);
  assert.match(blocked, /로컬 변경을 모두 저장한 뒤 연결할 수 있습니다/);
  assert.match(
    blocked,
    /title="로컬 변경을 모두 저장한 뒤 연결할 수 있습니다\."/,
  );
  assert.match(blocked, /class="sr-only" role="status"/);

  const empty = render({
    attach: { canvasId, candidates: [], error: null },
    canSubmit: true,
    pending: false,
    revisionId,
    roomUrl: "/projects/project/drawings",
  });
  assert.doesNotMatch(empty, /<form/);
  assert.match(empty, /PDF 업로드로 이동/);

  const failed = render({
    attach: { canvasId, candidates: [], error: "PDF 목록 실패" },
    canSubmit: true,
    pending: false,
    revisionId,
    roomUrl: "/projects/project/drawings",
  });
  assert.doesNotMatch(failed, /<form/);
  assert.match(failed, /role="alert"/);
  assert.match(failed, /PDF 목록 실패/);
});
