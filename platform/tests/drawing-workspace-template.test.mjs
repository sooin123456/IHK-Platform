import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as workspaceServer from "../app/lukas/lib/drawing-workspace.server.ts";

const ids = {
  project: "00000000-0000-4000-8000-000000000001",
  file: "00000000-0000-4000-8000-000000000002",
  document: "00000000-0000-4000-8000-000000000003",
};

test("template clone navigation is project and canonical document scoped", () => {
  assert.equal(
    typeof workspaceServer.drawingTemplateWorkspaceLocation,
    "function",
  );
  assert.equal(
    workspaceServer.drawingTemplateWorkspaceLocation(
      ids.project,
      ids.file,
      ids.document,
    ),
    `/projects/${ids.project}/workspaces/${ids.document}`,
  );
  assert.throws(() =>
    workspaceServer.drawingTemplateWorkspaceLocation(
      ids.project,
      ids.file,
      "bad",
    ),
  );
});

test("organization template entry moves to the universal start screen with exact import identity", async () => {
  const [screen, start] = await Promise.all([
    readFile(
      new URL("../app/lukas/screens/drawing-workspace-new.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-workspace-start.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(screen, /create_library_template/);
  assert.match(screen, /revisionId:\s*null/);
  assert.match(screen, /drawingWorkspacePath/);
  assert.match(start, /name="libraryVersionId"/);
  assert.match(start, /name="clientRequestId"/);
  assert.match(start, /useNavigation/);
  assert.match(start, /role="alert"/);
  assert.doesNotMatch(
    start,
    /name="title"[\s\S]{0,800}name="libraryVersionId"/,
  );
});

test("canonical template follow-up actions use only the exact workspace document scope", async () => {
  const screen = await readFile(
    new URL("../app/lukas/screens/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    screen,
    /workspaceId:\s*params\.workspaceId![\s\S]*revisionId:\s*searchParams\.get\("revision"\)/,
  );
  assert.doesNotMatch(screen, /params\.fileId/);
  assert.doesNotMatch(screen, /searchParams\.get\("document"\)/);
});
