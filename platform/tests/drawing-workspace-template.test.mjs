import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as workspaceServer from "../app/lukas/lib/drawing-workspace.server.ts";

const ids = {
  project: "00000000-0000-4000-8000-000000000001",
  file: "00000000-0000-4000-8000-000000000002",
  document: "00000000-0000-4000-8000-000000000003",
};

test("template clone navigation is project, file, and document scoped", () => {
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
    `/projects/${ids.project}/drawings/${ids.file}/workspace?document=${ids.document}`,
  );
  assert.throws(() =>
    workspaceServer.drawingTemplateWorkspaceLocation(
      ids.project,
      ids.file,
      "bad",
    ),
  );
});

test("template entry is an editor-only native dialog with an explicit source choice", async () => {
  const [screen, dialog] = await Promise.all([
    readFile(
      new URL("../app/lukas/screens/drawing-workspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/lukas/components/drawing-template-dialog.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(screen, /<DrawingTemplateDialog/);
  assert.match(
    screen,
    /form\.get\("intent"\) === "create_from_template"[\s\S]*redirect\(/,
  );
  assert.match(dialog, /<Dialog/);
  assert.match(dialog, /템플릿에서 시작/);
  assert.match(dialog, /name="source_revision_id"/);
  assert.match(dialog, /name="source_file_id"/);
  assert.match(dialog, /name="client_request_id"/);
  assert.match(dialog, /name="title"/);
  assert.match(dialog, /useNavigation/);
  assert.match(dialog, /disabled=\{saving/);
  assert.match(dialog, /role="alert"/);
  assert.doesNotMatch(dialog, /company|organization|global/i);
});

test("template follow-up actions preserve the clone document scope", async () => {
  const screen = await readFile(
    new URL("../app/lukas/screens/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  const scope = /new URL\(request\.url\)\.searchParams\.get\("document"\) \?\? undefined/g;
  assert.equal([...screen.matchAll(scope)].length, 2);
});
