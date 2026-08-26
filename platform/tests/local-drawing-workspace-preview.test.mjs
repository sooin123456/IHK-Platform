import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

import routes from "../app/routes.ts";
import { resolveDrawingSemanticSchedule } from "../app/lukas/lib/drawing-semantic-schedules.ts";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const preview = await vite.ssrLoadModule(
  "/app/lukas/screens/local-drawing-workspace-preview.tsx",
);
test.after(() => vite.close());
const testEnvironment = process.env.NODE_ENV;
process.env.NODE_ENV = "development";
test.after(() => {
  process.env.NODE_ENV = testEnvironment;
});

function request(url, init) {
  return new Request(url, init);
}

function validOperation() {
  return {
    clientOperationId: "00000000-0000-4000-8000-000000000091",
    revisionId: "00000000-0000-4000-8000-000000000004",
    type: "update_layer",
    baseVersions: { "00000000-0000-4000-8000-000000000021": 1 },
    forward: {
      type: "update_layer",
      layerId: "00000000-0000-4000-8000-000000000021",
      patch: { visible: false },
    },
    inverse: {
      type: "update_layer",
      layerId: "00000000-0000-4000-8000-000000000021",
      patch: { visible: true },
    },
    createdAt: "2026-08-25T09:00:00.000Z",
  };
}

test("P2 local drawing preview is registered outside the authenticated workspace", () => {
  const paths = JSON.stringify(routes);
  assert.match(paths, /workspace-preview\/drawing-workspace/);
});

test("P2 preview server module does not import browser-only state modules", async () => {
  const source = await readFile(
    new URL(
      "../app/lukas/screens/local-drawing-workspace-preview.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(source, /drawing-document-store\.client/);
});

test("P2 local drawing preview loader allows only development loopback", async () => {
  const allowed = await preview.loader({
    request: request(
      "http://127.0.0.1:5173/workspace-preview/drawing-workspace",
    ),
    params: {},
  });
  assert.equal(allowed.workspace.document.revision.status, "draft");
  assert.equal(allowed.capability, "editor");
  assert.throws(
    () =>
      preview.loader({
        request: request(
          "http://192.168.0.20/workspace-preview/drawing-workspace",
        ),
        params: {},
      }),
    (error) => error instanceof Response && error.status === 404,
  );
  process.env.NODE_ENV = "production";
  assert.throws(
    () =>
      preview.loader({
        request: request(
          "http://127.0.0.1/workspace-preview/drawing-workspace",
        ),
        params: {},
      }),
    (error) => error instanceof Response && error.status === 404,
  );
  process.env.NODE_ENV = "development";
});

test("P2 preview fixture is a strict, hydrated P2 graph", () => {
  const fixture = preview.localDrawingWorkspacePreviewFixture();
  assert.doesNotThrow(() =>
    preview.validateLocalDrawingWorkspacePreviewFixture(fixture),
  );
  const revision = fixture.workspace.document.revision;
  assert.equal(revision.pages.length, 3);
  assert.ok(revision.canvases.some((canvas) => canvas.spaceKind === "paper"));
  assert.ok(revision.canvases.some((canvas) => canvas.spaceKind === "model"));
  assert.ok(revision.layers.some((layer) => layer.locked));
  assert.ok(revision.layers.some((layer) => !layer.locked && layer.visible));
  assert.ok(revision.objects.length >= 8);
  assert.equal(revision.styles.length, 2);
  assert.equal(revision.blocks.length, 2);
  assert.ok(revision.blockInstances.length >= 3);
  assert.equal(revision.issueLinks.length, 1);
});

test("P4 preview is visibly populated with canonical hosted objects and schedules", () => {
  const fixture = preview.localDrawingWorkspacePreviewFixture();
  const revision = fixture.workspace.document.revision;
  const beforeSource = {
    byteSize: fixture.workspace.file.byte_size,
    documentSha256: fixture.workspace.document.source_sha256,
    fileSha256: fixture.workspace.file.sha256,
  };
  const semantic = revision.objects.filter((object) =>
    ["wall", "opening", "space", "area", "grid", "arc"].includes(
      object.geometry.type,
    ),
  );
  assert.deepEqual(
    [...new Set(semantic.map((object) => object.geometry.type))].sort(),
    ["arc", "area", "grid", "opening", "space", "wall"],
  );
  const walls = semantic.filter((object) => object.geometry.type === "wall");
  assert.equal(walls.length, 2);
  assert.ok(
    walls.some((wall, index) =>
      walls.slice(index + 1).some(
        (other) =>
          wall.geometry.end.x === other.geometry.start.x &&
          wall.geometry.end.y === other.geometry.start.y,
      ),
    ),
  );
  const openings = semantic.filter(
    (object) => object.geometry.type === "opening",
  );
  assert.deepEqual(
    openings.map((object) => object.geometry.openingKind).sort(),
    ["door", "window"],
  );
  for (const opening of openings) {
    const hostIndex = revision.objects.findIndex(
      (object) => object.id === opening.geometry.hostWallId,
    );
    assert.ok(hostIndex >= 0);
    assert.equal(revision.objects[hostIndex].geometry.type, "wall");
    assert.ok(hostIndex < revision.objects.indexOf(opening));
  }
  const state = {
    revisionId: revision.id,
    objects: Object.fromEntries(
      revision.objects.map((object) => [object.id, object]),
    ),
  };
  assert.equal(resolveDrawingSemanticSchedule("room", state).rows.length, 1);
  assert.equal(resolveDrawingSemanticSchedule("door", state).rows.length, 1);
  assert.equal(resolveDrawingSemanticSchedule("finish", state).rows.length, 1);
  assert.ok(revision.checkpoints.length >= 1);
  assert.doesNotThrow(() =>
    preview.validateLocalDrawingWorkspacePreviewFixture(fixture),
  );
  assert.deepEqual(
    {
      byteSize: fixture.workspace.file.byte_size,
      documentSha256: fixture.workspace.document.source_sha256,
      fileSha256: fixture.workspace.file.sha256,
    },
    beforeSource,
  );
});

test("P2 preview action validates operations and only echoes safe local operations", async () => {
  const form = new FormData();
  form.set("intent", "apply_operation");
  form.set("operation_json", JSON.stringify(validOperation()));
  const accepted = await preview.action({
    request: request(
      "http://localhost:5173/workspace-preview/drawing-workspace",
      { method: "POST", body: form },
    ),
    params: {},
  });
  assert.deepEqual(accepted.data, {
    ok: true,
    clientOperationId: "00000000-0000-4000-8000-000000000091",
  });

  const malformed = new FormData();
  malformed.set("intent", "apply_operation");
  malformed.set(
    "operation_json",
    JSON.stringify({ ...validOperation(), authority: "admin" }),
  );
  const rejected = await preview.action({
    request: request(
      "http://localhost:5173/workspace-preview/drawing-workspace",
      { method: "POST", body: malformed },
    ),
    params: {},
  });
  assert.equal(rejected.init.status, 400);

  const forbidden = new FormData();
  forbidden.set("intent", "create_layer");
  forbidden.set("name", "권한 우회");
  const forbiddenResult = await preview.action({
    request: request(
      "http://localhost:5173/workspace-preview/drawing-workspace",
      { method: "POST", body: forbidden },
    ),
    params: {},
  });
  assert.equal(forbiddenResult.init.status, 400);

  const wrongRevision = new FormData();
  wrongRevision.set("intent", "apply_operation");
  wrongRevision.set(
    "operation_json",
    JSON.stringify({
      ...validOperation(),
      revisionId: "00000000-0000-4000-8000-000000000003",
    }),
  );
  const wrongRevisionResult = await preview.action({
    request: request(
      "http://localhost:5173/workspace-preview/drawing-workspace",
      { method: "POST", body: wrongRevision },
    ),
    params: {},
  });
  assert.equal(wrongRevisionResult.init.status, 400);
});
