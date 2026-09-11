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
  .ssrLoadModule("/app/lukas/components/drawing-state-preview.tsx")
  .catch(() => ({}));
const render = (state) => {
  assert.equal(typeof mod.DrawingStatePreview, "function");
  return renderToStaticMarkup(
    React.createElement(mod.DrawingStatePreview, { state }),
  );
};
test("state demonstrations never claim an actual network or persistence result", () => {
  for (const state of ["loading", "error", "offline", "conflict", "approved"]) {
    assert.match(render(state), /실제 연결·저장 상태가 아닙니다/);
  }
});
test("offline preview warns of unsaved work instead of inventing outbox durability", () => {
  assert.match(render("offline"), /영구 보관되지 않습니다/);
});
test("approved state disables direct edit and describes a new revision", () => {
  const h = render("approved");
  assert.match(h, /새 개정/);
  assert.match(h, /disabled=""[^>]*>승인본 직접 수정/);
});
