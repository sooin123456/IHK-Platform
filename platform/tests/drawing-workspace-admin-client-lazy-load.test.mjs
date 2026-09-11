import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer } from "vite";

const adminEvaluationsKey = "__drawingLazyAdminEvaluations";
globalThis[adminEvaluationsKey] = 0;

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  plugins: [
    {
      enforce: "pre",
      name: "drawing-lazy-admin-client",
      resolveId(source) {
        if (source.endsWith("core/lib/supa-admin-client.server"))
          return "\0virtual:drawing-lazy-admin-client";
      },
      load(id) {
        if (id === "\0virtual:drawing-lazy-admin-client")
          return `globalThis[${JSON.stringify(adminEvaluationsKey)}] += 1; throw new Error("eager admin evaluation");`;
      },
    },
  ],
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});

test.after(async () => {
  delete globalThis[adminEvaluationsKey];
  await vite.close();
});

test("drawing routes expose ordinary server behavior without evaluating elevated credentials", async () => {
  const [workspaceRoute, publicShareRoute] = await Promise.all([
    vite.ssrLoadModule("/app/lukas/screens/drawing-workspace.tsx"),
    vite.ssrLoadModule("/app/lukas/screens/shared-drawing.tsx"),
  ]);

  assert.equal(typeof workspaceRoute.shouldRevalidate, "function");
  assert.equal(typeof publicShareRoute.publicDrawingShareResponse, "function");
  assert.equal(globalThis[adminEvaluationsKey], 0);
});
