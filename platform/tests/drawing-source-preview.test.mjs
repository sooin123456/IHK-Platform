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
const source = await vite
  .ssrLoadModule("/app/lukas/components/drawing-source-preview.tsx")
  .catch(() => ({}));
const render = (name, props = {}) => {
  assert.equal(typeof source[name], "function", `missing ${name} screen`);
  return renderToStaticMarkup(React.createElement(source[name], props));
};
test("connected revisions show the current review history rather than independent sample revisions", () => {
 const html=render("ConnectedRevisionPreview",{state:{revision:3,page:2,phase:"approved",history:[{revision:2,page:2,phase:"changes",position:2,before:1,message:"실제 화면 요청",issue:"위치 확인"}]},onReview(){}});
 assert.match(html,/R3 · 2쪽/);
 assert.match(html,/승인된 개정/);
 assert.match(html,/실제 화면 요청/);
 assert.match(html,/현재 도면에서 검토 계속하기/);
 assert.doesNotMatch(html,/복원 실행/);
});
test("IFC viewport has no invented loaded geometry and offers a way back to 2D", () => {
  const html = render("IfcViewportPreview", { onInspect() {}, onReturn() {} });
  assert.match(html, /연결된 IFC 모델이 없습니다/);
  assert.match(html, /IFC 연결 정보 보기/);
  assert.match(html, /2D 도면으로 돌아가기/);
  assert.doesNotMatch(html, /<canvas|<img|모델 로드 완료/);
});
test("DWG readiness defaults to uninspected rather than claiming compatibility", () => {
  const html = render("DwgReadinessPreview", {
    state: "uninspected",
    onStateChange() {},
  });
  assert.match(html, /실제 DWG를 검사하지 않았습니다/);
  assert.match(html, /미검사/);
  assert.doesNotMatch(html, /검사 합격|다운로드 완료/);
});
test("DWG dependency, read-only, failure and ready examples keep the real file unqualified", () => {
  for (const state of ["dependencies", "readonly", "failed", "ready"]) {
    const html = render("DwgReadinessPreview", { state, onStateChange() {} });
    assert.match(html, /실제 DWG를 검사하지 않았습니다/);
    assert.match(html, /상태 예시/);
    assert.doesNotMatch(html, /href=.*\.dwg|download=/);
  }
  assert.match(
    render("DwgReadinessPreview", {
      state: "dependencies",
      onStateChange() {},
    }),
    /SHX/,
  );
  assert.match(
    render("DwgReadinessPreview", { state: "failed", onStateChange() {} }),
    /납품 차단/,
  );
});
test("revision screen never fabricates saved revisions for the current drawing", () => {
  const html = render("RevisionComparisonPreview", {
    ready: true,
    viewer: false,
  });
  assert.match(html, /등록된 개정이 없습니다/);
  assert.match(html, /개정 목록 예시 보기/);
  assert.doesNotMatch(html, /R01|R02|복원 완료/);
});
test("revision empty source has guidance and Viewer example cannot confirm restoration", () => {
  assert.match(
    render("RevisionComparisonPreview", { ready: false, viewer: false }),
    /도면을 먼저 열어/,
  );
  const html = render("RevisionRestorePreview", {
    viewer: true,
    revision: "R01",
    onCancel() {},
    onConfirm() {},
  });
  assert.match(html, /보기 전용/);
  assert.match(html, /<button[^>]*disabled[^>]*>복원 결과 예시 보기<\/button>/);
  assert.match(html, /새 개정/);
});
test("workbench source section is discoverable from the existing menu body", async () => {
  const { WorkbenchPreviewBody } = await vite.ssrLoadModule(
    "/app/lukas/components/drawing-workbench-preview.tsx",
  );
  const html = renderToStaticMarkup(
    React.createElement(WorkbenchPreviewBody, {
      section: "sources",
      documentName: "구조.pdf",
      page: 4,
      ready: true,
      viewer: false,
    }),
  );
  assert.match(html, /구조.pdf/);
  assert.match(html, /4쪽/);
  assert.match(html, /DWG 점검/);
  assert.match(html, /개정·비교/);
});
