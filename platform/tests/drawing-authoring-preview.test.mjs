import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
test.after(() => vite.close());
const authoring = await vite
  .ssrLoadModule("/app/lukas/components/drawing-authoring-preview.tsx")
  .catch(() => ({}));
const document = await vite
  .ssrLoadModule("/app/lukas/components/drawing-document-preview.tsx")
  .catch(() => ({}));
const render = (module, name, props = {}) => {
  assert.equal(typeof module[name], "function", `missing ${name}`);
  return renderToStaticMarkup(React.createElement(module[name], props));
};
test("drawing tools expose distinct architectural and geometry options", () => {
  for (const [toolId, label] of [
    ["polyline", "경로 닫기"],
    ["arc", "시작 각도"],
    ["wall", "벽 두께"],
    ["opening", "개구부 폭"],
    ["space", "공간 이름"],
    ["dimension", "기준 길이"],
  ]) {
    const html = render(authoring, "AuthoringToolOptions", {
      toolId,
      viewer: false,
      ready: true,
    });
    assert.match(html, new RegExp(label));
    assert.match(html, /실제 도형·측정에 반영되지 않습니다/);
  }
});
test("tool options keep Viewer fields disabled and absent drawings unmeasured", () => {
  const html = render(authoring, "AuthoringToolOptions", {
    toolId: "dimension",
    viewer: true,
    ready: true,
  });
  assert.match(html, /<fieldset[^>]*disabled/);
  const empty = render(authoring, "AuthoringToolOptions", {
    toolId: "space",
    viewer: false,
    ready: false,
  });
  assert.match(empty, /도면을 먼저 열어/);
  assert.doesNotMatch(empty, /<input|면적 확정/);
});
test("command search is labelled and no source geometry selection is invented", () => {
  assert.match(
    render(authoring, "AuthoringPreviewBody", { ready: true, viewer: false }),
    /도구·명령 검색/,
  );
  const html = render(authoring, "AuthoringSelectionPreview", {
    ready: true,
    viewer: false,
  });
  assert.match(html, /선택 0개/);
  assert.match(html, /도면에서 선택한 객체가 아닙니다/);
  assert.match(html, /<button[^>]*disabled[^>]*>실행 취소 · 예시<\/button>/);
});
test("preview history can undo and redo, but a new action invalidates the redo branch", () => {
  assert.equal(typeof authoring.advanceAuthoringHistory, "function");
  const initial = { past: [], present: "시작", future: [] };
  const copied = authoring.advanceAuthoringHistory(initial, {
    type: "record",
    label: "복사",
  });
  const undone = authoring.advanceAuthoringHistory(copied, { type: "undo" });
  assert.equal(undone.present, "시작");
  assert.deepEqual(undone.future, ["복사"]);
  assert.equal(
    authoring.advanceAuthoringHistory(undone, { type: "redo" }).present,
    "복사",
  );
  assert.deepEqual(
    authoring.advanceAuthoringHistory(undone, { type: "record", label: "회전" })
      .future,
    [],
  );
  assert.deepEqual(initial, { past: [], present: "시작", future: [] });
  assert.deepEqual(
    authoring.advanceAuthoringHistory(initial, { type: "undo" }),
    initial,
  );
});
test("layer movement preserves identity and does not mutate or wrap boundaries", () => {
  assert.equal(typeof document.movePreviewLayer, "function");
  const layers = [
    { id: "a", name: "A", visible: true, locked: true },
    { id: "b", name: "B", visible: false, locked: false },
  ];
  assert.deepEqual(document.movePreviewLayer(layers, "a", -1), layers);
  assert.deepEqual(document.movePreviewLayer(layers, "missing", 1), layers);
  assert.deepEqual(
    document.movePreviewLayer(layers, "a", 1).map((x) => x.id),
    ["b", "a"],
  );
  assert.equal(layers[0].id, "a");
});
test("layer inspector has visible and locked states, and readonly mutation controls are disabled", () => {
  const html = render(document, "DrawingLayerPreview", {
    viewer: true,
    layers: [{ id: "a", name: "검토", visible: false, locked: true }],
    onChange() {},
  });
  assert.match(html, /검토 표시하기 예시/);
  assert.match(html, /검토 잠금 해제 예시/);
  assert.match(html, /<fieldset[^>]*disabled/);
  assert.match(html, /원본 도면에는 적용되지 않습니다/);
});
test("document settings separate page and canvas presentation from real PDF mutation", () => {
  const html = render(document, "DrawingDocumentPreview", {
    ready: true,
    viewer: false,
    layers: [],
    onLayersChange() {},
  });
  assert.match(html, /용지 크기/);
  assert.match(html, /캔버스 공간/);
  assert.match(html, /그리드 표시/);
  assert.match(html, /PDF 페이지를 추가·삭제하거나 크기를 변경하지 않습니다/);
});
test("authoring and document panels are reachable through the existing workbench", async () => {
  const workbench = await vite.ssrLoadModule(
    "/app/lukas/components/drawing-workbench-preview.tsx",
  );
  for (const [section, content] of [
    ["authoring", "도구·명령 검색"],
    ["documents", "용지 크기"],
  ]) {
    const html = render(workbench, "WorkbenchPreviewBody", {
      section,
      documentName: "구조.pdf",
      page: 2,
      ready: true,
      viewer: false,
      layers: [],
      onLayersChange() {},
    });
    assert.match(html, new RegExp(content));
    assert.match(html, /구조.pdf/);
    assert.match(html, /2쪽/);
  }
});
