import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { MemoryRouter } from "react-router";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
test.after(() => vite.close());
const route = await vite.ssrLoadModule(
  "/app/lukas/screens/local-drawing-workspace-preview.tsx",
);
const unwrap = (value) => value?.data ?? value;

test("screen-only entry is explicit and does not replace the existing editor", async () => {
  const load = (query) =>
    unwrap(
      route.loader({
        request: new Request(
          `http://localhost:4181/workspace-preview/drawing-workspace${query}`,
        ),
        params: {},
      }),
    );
  assert.equal(load("?layout=pdf").layoutPreview, true);
  assert.equal(load("?awarenessTest=1").layoutPreview, false);
});

test("standalone Viewer preview remains readonly without a project return", () => {
 const result=unwrap(route.loader({request:new Request("http://localhost:4181/workspace-preview/drawing-workspace?layout=pdf&role=viewer"),params:{}}));
 assert.equal(result.capability,"viewer");
});

test("screen-only entry rejects mutation posts and remains unavailable in production", async () => {
  const result = await route.action({
    request: new Request(
      "http://localhost:4181/workspace-preview/drawing-workspace?layout=pdf",
      { method: "POST", body: new URLSearchParams({ intent: "anything" }) },
    ),
    params: {},
  });
  assert.equal(result.status, 405);
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.throws(
      () =>
        route.loader({
          request: new Request(
            "http://localhost:4181/workspace-preview/drawing-workspace?layout=pdf",
          ),
          params: {},
        }),
      (error) => error.status === 404,
    );
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test("screen-only empty state never invents a drawing, saved work, or collaborators", async () => {
  const { DrawingPdfScreenPreview } = await vite.ssrLoadModule(
    "/app/lukas/components/drawing-pdf-screen-preview.tsx",
  );
  const html = renderToStaticMarkup(
    React.createElement(DrawingPdfScreenPreview),
  );
  assert.match(html, /PDF 열기/);
  assert.match(html, /aria-label="물량·내역 화면 열기"/);
  assert.match(html, /aria-label="작업실 메뉴 열기"/);
  assert.match(html, /aria-label="작성 도구·명령 열기"/);
  assert.match(html, /<button[^>]*aria-pressed="false"[^>]*>3D 모델<\/button>/);
  assert.match(html, /<button[^>]*aria-pressed="false"[^>]*>분할 보기<\/button>/);
  assert.match(html, /브라우저에서만/);
  assert.match(html, /PDF 페이지/);
  assert.match(html, /편집·저장·공유는 아직 연결되지 않았습니다/);
  assert.doesNotMatch(html, /저장됨|모두 연결됨|김도윤|박서연|0원|송천동/);
  assert.equal((html.match(/type="file"/g) ?? []).length, 1);
  assert.match(html, /aria-controls="pdf-pages-panel"/);
  assert.match(html, /aria-controls="pdf-info-panel"/);
});

test("invalid and oversized selections are rejected before opening a document", async () => {
  const { localPdfSelectionError } = await vite.ssrLoadModule(
    "/app/lukas/components/drawing-pdf-screen-preview.tsx",
  );
  assert.equal(
    localPdfSelectionError({ name: "plan.PDF", size: 4812707 }),
    null,
  );
  assert.ok(localPdfSelectionError({ name: "plan.dwg", size: 10 }));
  assert.ok(localPdfSelectionError({ name: "plan.pdf", size: 0 }));
  assert.ok(
    localPdfSelectionError({ name: "plan.pdf", size: 51 * 1024 * 1024 }),
  );
});

test("expired PDF retains its prepared filename without pretending pages were restored", async () => {
 const {DrawingPdfScreenPreview}=await vite.ssrLoadModule("/app/lukas/components/drawing-pdf-screen-preview.tsx");
 const html=renderToStaticMarkup(React.createElement(DrawingPdfScreenPreview,{handoffToken:"expired",registrationRecord:{mode:"new",fileName:"구조 검토.pdf",targetTitle:"",reason:""}}));
 assert.match(html,/<h1>구조 검토.pdf<\/h1>/);
 assert.match(html,/PDF 다시 선택/);
 assert.match(html,/로컬 PDF를 다시 선택해 주세요/);
 assert.doesNotMatch(html,/aria-label="PDF 1쪽"/);
});

test("PDF document reopened from the project list requests its file while retaining its title", async () => {
 const {DrawingPdfScreenPreview}=await vite.ssrLoadModule("/app/lukas/components/drawing-pdf-screen-preview.tsx");
 const html=renderToStaticMarkup(React.createElement(DrawingPdfScreenPreview,{documentId:"saved-pdf",startKind:"pdf",title:"구조.pdf"}));
 assert.match(html,/<h1>구조.pdf<\/h1>/);
 assert.match(html,/PDF 다시 선택/);
 assert.doesNotMatch(html,/aria-label="PDF 1쪽"/);
});

test("PDF screen uses the validated return destination passed by its route", async () => {
  const loaderData = unwrap(
    route.loader({
      request: new Request(
        "http://localhost:4181/workspace-preview/drawing-workspace?layout=pdf&returnProject=00000000-0000-4000-8000-000000000101&role=viewer&returnTab=files&pdf=expired-token",
      ),
      params: {},
    }),
  );
  const html = renderToStaticMarkup(
    React.createElement(MemoryRouter, null, React.createElement(route.default, { loaderData })),
  );
  assert.match(
    html,
    /href="\/workspace-preview\?project=00000000-0000-4000-8000-000000000101&amp;role=viewer&amp;tab=files"/,
  );
  assert.match(html, /로컬 PDF를 다시 선택해 주세요/);
  assert.match(html, /PDF 다시 선택/);
});

test("blank and example starts use the same screen without requiring a PDF", () => {
  for (const [kind, expected] of [
    ["blank", /빈 도면/],
    ["office", /office-plan\.png/],
    ["house", /house-plan\.png/],
  ]) {
    const loaderData = unwrap(
      route.loader({
        request: new Request(
          `http://localhost:4181/workspace-preview/drawing-workspace?layout=pdf&startKind=${kind}&title=내%20도면`,
        ),
        params: {},
      }),
    );
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, null, React.createElement(route.default, { loaderData })),
    );
    assert.match(html, /내 도면/);
    assert.match(html, expected);
    assert.match(html, /검토/);
    assert.match(html, /내보내기/);
    assert.match(html, /aria-label="도면 화면 미리보기"/);
    assert.doesNotMatch(html, /aria-label="실제 PDF 도면 화면"/);
    assert.doesNotMatch(html, /도면을 중심에 두고 시작하세요/);
  }
});

test("screen file information retains the source tab when it closes", async () => {
  const { resolveWorkspacePreview } = await vite.ssrLoadModule(
    "/app/lukas/screens/workspace-preview.tsx",
  );
  const data = resolveWorkspacePreview(
    "?project=00000000-0000-4000-8000-000000000101&tab=files&panel=project-files&role=viewer",
  );
  assert.equal(data.dialog.kind, "project-files");
  assert.match(data.closeHref, /tab=files/);
  assert.match(data.closeHref, /role=viewer/);
});

test("screen start does not accept arbitrary asset kinds or unbounded names", () => {
  const loaderData = unwrap(
    route.loader({
      request: new Request(
        `http://localhost:4181/workspace-preview/drawing-workspace?layout=pdf&startKind=https://example.com&title=${"x".repeat(100)}`,
      ),
      params: {},
    }),
  );
  assert.equal(loaderData.screenStartKind, "pdf");
  assert.equal(loaderData.screenTitle.length, 80);
});

test("review preview accepts only known states and opens the matching screen", () => {
  for (const state of ["requested", "changes", "approved"]) {
    const loaderData = unwrap(
      route.loader({
        request: new Request(
          `http://localhost:4181/workspace-preview/drawing-workspace?layout=pdf&startKind=office&reviewPreview=1&reviewState=${state}`,
        ),
        params: {},
      }),
    );
    assert.equal(loaderData.screenReviewState, state);
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, null, React.createElement(route.default, { loaderData })),
    );
    assert.match(html, new RegExp(`data-state="${state}"`));
  }

  const loaderData = unwrap(
    route.loader({
      request: new Request(
        "http://localhost:4181/workspace-preview/drawing-workspace?layout=pdf&startKind=office&reviewPreview=1&reviewState=draft",
      ),
      params: {},
    }),
  );
  assert.equal(loaderData.screenReviewState, undefined);
  const html = renderToStaticMarkup(
    React.createElement(MemoryRouter, null, React.createElement(route.default, { loaderData })),
  );
  assert.match(html, /data-state="requested"/);
});
