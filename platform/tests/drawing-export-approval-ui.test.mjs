import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import { createDrawingDocumentState } from "../app/lukas/lib/drawing-commands.ts";
import { buildNativeDrawingTemplate } from "../app/lukas/lib/drawing-native-templates.ts";

test("audited export explains approval before rendering or uploading a draft artifact", async (t) => {
  const vite = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    resolve: { alias: { "~": path.resolve("app") } },
    server: { middlewareMode: true },
    plugins: [
      {
        name: "export-approval-dialog-shell",
        enforce: "pre",
        resolveId(id) {
          if (
            id === "~/core/components/ui/dialog" ||
            /\/core\/components\/ui\/dialog(?:\.tsx)?$/.test(id)
          )
            return "\0approval-dialog-shell";
        },
        load(id) {
          if (id !== "\0approval-dialog-shell") return;
          return `import { createElement } from "react";
          const shell=({children})=>createElement("div",null,children);
          export const Dialog=shell,DialogClose=shell,DialogContent=shell,DialogDescription=shell,DialogFooter=shell,DialogHeader=shell,DialogTitle=shell,DialogTrigger=shell;`;
        },
      },
    ],
  });
  t.after(() => vite.close());
  const { DrawingExportDialog } = await vite.ssrLoadModule(
    "/app/lukas/components/drawing-export-dialog.tsx",
  );
  const template = buildNativeDrawingTemplate("measured-plan");
  Object.values(template.structure.canvases)[0].outputProfile =
    template.outputProfile;
  const documentState = createDrawingDocumentState({
    revisionId: template.structure.revisionId,
    structure: template.structure,
  });
  const canvas = Object.values(template.structure.canvases)[0];
  const props = {
    auditRequired: true,
    checkpointSha256: "a".repeat(64),
    createdAt: "2026-09-05T00:00:00Z",
    documentState: {
      ...documentState,
      activeCanvasId: canvas.id,
      activePageId: canvas.pageId,
    },
    hideTrigger: true,
    open: true,
    operationCheckpoint: 0,
    outboxReady: true,
    projectId: "00000000-0000-4000-8000-000000000006",
    revisionId: template.structure.revisionId,
    revisionVersion: 1,
    saveStatus: "저장됨",
    sourceUrl: null,
    title: template.name,
    workspaceId: "00000000-0000-4000-8000-000000000007",
  };
  for (const revisionStatus of [
    undefined,
    "draft",
    "review_requested",
    "reviewed",
  ]) {
    const html = renderToStaticMarkup(
      createElement(DrawingExportDialog, { ...props, revisionStatus }),
    );
    assert.match(html, /승인된 개정만 내보낼 수 있습니다/);
    assert.match(
      html,
      /<button(?=[^>]*\sdisabled="")[^>]*>다운로드<\/button>/,
      revisionStatus,
    );
  }
  for (const override of [
    { revisionStatus: "approved" },
    { revisionStatus: "superseded" },
    { auditRequired: false, revisionStatus: "draft" },
  ]) {
    const html = renderToStaticMarkup(
      createElement(DrawingExportDialog, { ...props, ...override }),
    );
    assert.doesNotMatch(html, /승인된 개정만 내보낼 수 있습니다/);
    assert.match(html, /<button(?![^>]*\sdisabled="")[^>]*>다운로드<\/button>/);
  }
});
