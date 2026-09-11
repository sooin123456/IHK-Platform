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
const mod = await vite
  .ssrLoadModule("/app/lukas/components/drawing-team-preview.tsx")
  .catch(() => ({}));
function render(props = {}) {
  assert.equal(
    typeof mod.DrawingTeamPreview,
    "function",
    "team screen is implemented",
  );
  return renderToStaticMarkup(
    React.createElement(mod.DrawingTeamPreview, {
      ready: true,
      viewer: false,
      reviewState: "draft",
      ...props,
    }),
  );
}
test("team roster identifies example participants without claiming presence", () => {
  const html = render();
  assert.match(html, /참여자 예시/);
  assert.match(html, /실제 접속 상태가 아닙니다/);
  assert.match(html, /Reviewer/);
  assert.match(html, /Approver/);
});
test("missing source cannot fabricate a roster", () => {
  const html = render({ ready: false });
  assert.match(html, /도면을 먼저/);
  assert.doesNotMatch(html, /김검토/);
});
test("activity reflects current review state without creating a second approval", () => {
  const html = render({ section: "activity", reviewState: "changes" });
  assert.match(html, /변경 요청/);
  assert.match(html, /실제 감사 기록이 아닙니다/);
  assert.doesNotMatch(html, /<form/);
});
test("Viewer may inspect issues but cannot change sample resolution", () => {
  const html = render({ section: "issues", viewer: true });
  assert.match(html, /<fieldset disabled/);
  assert.match(html, /I01/);
});

test("connected sharing reads the same issue and cannot independently resolve it", async () => {
  const review=await vite.ssrLoadModule("/app/lukas/components/drawing-review-loop.tsx");
  const state={...review.createReviewLoop("changes"),issue:"출입문 간섭 보완",page:3,revision:2};
  const html=render({section:"issues",reviewLoop:state,onLocateReview(){}});
  assert.match(html,/출입문 간섭 보완/);assert.match(html,/3쪽/);assert.match(html,/미해결/);
  assert.doesNotMatch(html,/기준선과 축척|type="checkbox"|<textarea/);
  assert.match(render({section:"issues",reviewLoop:{...state,phase:"approved"},onLocateReview(){}}),/해결됨/);
});
