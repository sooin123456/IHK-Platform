import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { localWorkspacePreviewTarget } from "../app/features/auth/lib/local-workspace-preview.server.ts";

test("local development login opens the workspace preview", () => {
  assert.equal(
    localWorkspacePreviewTarget(
      "http://127.0.0.1:4173/auth/magic-link",
      "development",
    ),
    "/workspace-preview",
  );
  assert.equal(
    localWorkspacePreviewTarget(
      "http://localhost:5173/auth/magic-link",
      "development",
    ),
    "/workspace-preview",
  );
});

test("production and non-loopback requests never bypass authentication", () => {
  assert.equal(
    localWorkspacePreviewTarget(
      "https://lukas-qto-platform.vercel.app/auth/magic-link",
      "production",
    ),
    null,
  );
  assert.equal(
    localWorkspacePreviewTarget(
      "http://192.168.0.20:4173/auth/magic-link",
      "development",
    ),
    null,
  );
  assert.equal(
    localWorkspacePreviewTarget(
      "http://127.0.0.1:4173/auth/magic-link",
      "production",
    ),
    null,
  );
});

test("the preview route stays outside the authenticated workspace layout", async () => {
  const [routes, login, preview] = await Promise.all([
    readFile(new URL("../app/routes.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/features/auth/screens/magic-link.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/lukas/screens/workspace-preview.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  const publicRoute = routes.indexOf(
    'route("/workspace-preview", "lukas/screens/workspace-preview.tsx")',
  );
  const privateLayout = routes.indexOf(
    'layout("core/layouts/private.layout.tsx"',
  );
  assert.ok(publicRoute >= 0 && publicRoute < privateLayout);
  assert.match(login, /localWorkspacePreviewTarget/);
  assert.match(login, /export function loader/);
  assert.match(preview, /previewMode/);
  assert.match(preview, /로컬 미리보기/);
});
