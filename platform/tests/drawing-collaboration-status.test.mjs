import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("retry and rejected access have distinct accessible guidance without claiming synchronization", async () => {
  const vite = await createServer({
    configFile: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    appType: "custom",
  });
  try {
    const { DrawingCollaborationConnectionStatus } = await vite.ssrLoadModule(
      "/app/lukas/components/drawing-collaboration-presence.tsx",
    );
    const store = { getSnapshot: () => [], subscribe: () => () => {} };
    const render = (phase, enabled = true) =>
      renderToStaticMarkup(
        createElement(DrawingCollaborationConnectionStatus, {
          phase,
          enabled,
          store,
          readOnly: false,
        }),
      );
    const retrying = render("retrying");
    assert.match(retrying, /role="status"/);
    assert.match(retrying, /재연결/);
    assert.match(retrying, /로컬 작업/);
    assert.doesNotMatch(retrying, /연결됨|오프라인/);
    const denied = render("denied");
    assert.match(denied, /권한.*로그인/);
    assert.doesNotMatch(denied, /재연결 중|연결됨|오프라인/);
    assert.match(render("denied", false), /공동 편집 꺼짐/);
  } finally {
    await vite.close();
  }
});
