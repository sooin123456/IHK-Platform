import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const vite = await createServer({
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
test.after(() => vite.close());
const mod = await vite
  .ssrLoadModule("/app/lukas/components/workspace-management-preview.tsx")
  .catch(() => ({}));
function render(props = {}) {
  assert.equal(typeof mod.WorkspaceManagementPreview, "function");
  return renderToStaticMarkup(
    React.createElement(mod.WorkspaceManagementPreview, {
      viewer: false,
      ...props,
    }),
  );
}
test("management groups settings without claiming saved organization changes", () => {
  const h = render();
  assert.match(h, /관리 화면/);
  assert.match(h, /실제 설정·저장 없음/);
  assert.match(h, /조직 이름/);
});
test("management distinguishes comment, review and approval responsibilities", () => {
  const html=render();
  assert.match(html, /<dt>댓글 작성자<\/dt><dd>댓글·수정 요청<\/dd>/);
  assert.match(html, /<dt>검토자<\/dt><dd>검토 결정·수정 요청<\/dd>/);
  assert.match(html, /<dt>승인자<\/dt><dd>검토된 개정의 최종 승인<\/dd>/);
  assert.match(html, /검토 완료만으로 최종 승인 권한이 생기지 않습니다/);
});
test("Viewer cannot alter settings or retention forms", () => {
  for (const section of ["organization", "retention", "templates"])
    assert.match(render({ viewer: true, section }), /<fieldset disabled/);
});
test("retention never invents available recoverable backups", () => {
  const h = render({ section: "retention" });
  assert.match(h, /복구 가능한 백업 미연결/);
  assert.doesNotMatch(h, /복구 완료/);
});
test("usage does not fabricate billing or real quotas", () => {
  const h = render({ section: "usage" });
  assert.match(h, /사용량 미집계/);
  assert.match(h, /결제 미연결/);
  assert.doesNotMatch(h, /구매하기/);
});
