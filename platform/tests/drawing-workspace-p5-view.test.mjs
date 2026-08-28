import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServer } from "vite";

import * as workspaceView from "../app/lukas/lib/drawing-workspace-view.ts";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const ifcViewer = await vite.ssrLoadModule(
  "/app/lukas/components/ifc-model-viewer.client.ts",
);
test.after(() => vite.close());

const ids = {
  object1: "20000000-0000-4000-8000-000000000001",
  object2: "20000000-0000-4000-8000-000000000002",
  source1: "20000000-0000-4000-8000-000000000003",
  source2: "20000000-0000-4000-8000-000000000004",
  revision: "20000000-0000-4000-8000-000000000005",
  file: "20000000-0000-4000-8000-000000000006",
  otherFile: "20000000-0000-4000-8000-000000000007",
};
const sha = "a".repeat(64);

test("IFC initial fit waits until armed with a ready visible non-zero viewport and runs once", () => {
  let fits = 0;
  const initialFit = ifcViewer.createIfcInitialFitOnce(() => {
    fits += 1;
  });

  assert.equal(
    initialFit.attempt({
      ready: true,
      visible: true,
      width: 640,
      height: 480,
    }),
    false,
  );
  initialFit.arm();
  assert.equal(
    initialFit.attempt({
      ready: false,
      visible: true,
      width: 640,
      height: 480,
    }),
    false,
  );
  assert.equal(
    initialFit.attempt({
      ready: true,
      visible: false,
      width: 640,
      height: 480,
    }),
    false,
  );
  assert.equal(
    initialFit.attempt({ ready: true, visible: true, width: 0, height: 0 }),
    false,
  );
  assert.equal(
    initialFit.attempt({
      ready: true,
      visible: true,
      width: 640,
      height: 480,
    }),
    true,
  );
  assert.equal(
    initialFit.attempt({
      ready: true,
      visible: true,
      width: 800,
      height: 600,
    }),
    false,
  );
  assert.equal(fits, 1);

  const canceled = ifcViewer.createIfcInitialFitOnce(() => {
    fits += 1;
  });
  canceled.cancel();
  canceled.arm();
  assert.equal(
    canceled.attempt({
      ready: true,
      visible: true,
      width: 640,
      height: 480,
    }),
    false,
  );
  assert.equal(fits, 1);
});

function source(overrides = {}) {
  return {
    id: ids.source1,
    objectId: ids.object1,
    revisionId: ids.revision,
    sourceFileId: ids.file,
    sourceSha256: sha,
    sourceKind: "ifc_element",
    ifcGlobalId: "3ABCdefghijklmnopqrstu",
    elementId: "42",
    camera: {
      position: [1, 2, 3],
      target: [4, 5, 6],
    },
    version: 1,
    ...overrides,
  };
}

test("single drawing selection creates an exact-file IFC focus target without transient URL state", () => {
  const target = workspaceView.drawingIfcFocusTarget({
    selectedIds: [ids.object1],
    sources: { [ids.source1]: source() },
    sourceFileId: ids.file,
    sourceSha256: sha,
  });
  assert.deepEqual(target, {
    ifcGlobalId: "3ABCdefghijklmnopqrstu",
    elementId: "42",
    camera: {
      position: [1, 2, 3],
      target: [4, 5, 6],
    },
  });
  assert.equal(JSON.stringify(target).includes("url"), false);
  for (const changes of [
    { selectedIds: [] },
    { selectedIds: [ids.object1, ids.object2] },
    { sourceFileId: ids.otherFile },
    { sourceSha256: "b".repeat(64) },
  ])
    assert.equal(
      workspaceView.drawingIfcFocusTarget({
        selectedIds: [ids.object1],
        sources: { [ids.source1]: source() },
        sourceFileId: ids.file,
        sourceSha256: sha,
        ...changes,
      }),
      null,
    );
});

test("remote Awareness drawing selections resolve to same-SHA IFC highlights without schema changes", () => {
  const sources = {
    [ids.source1]: source(),
    [ids.source2]: source({
      id: ids.source2,
      objectId: ids.object2,
      ifcGlobalId: "2ABCdefghijklmnopqrstu",
      elementId: null,
      camera: null,
    }),
  };
  assert.deepEqual(
    workspaceView.drawingIfcRemoteHighlightGlobalIds({
      peers: [
        { selectedIds: [ids.object2, ids.object1] },
        { selectedIds: [ids.object1] },
      ],
      sources,
      sourceFileId: ids.file,
      sourceSha256: sha,
    }),
    ["2ABCdefghijklmnopqrstu", "3ABCdefghijklmnopqrstu"],
  );
  assert.deepEqual(
    workspaceView.drawingIfcRemoteHighlightGlobalIds({
      peers: [{ selectedIds: [ids.object1] }],
      sources,
      sourceFileId: ids.file,
      sourceSha256: "b".repeat(64),
    }),
    [],
  );
});

test("controlled IFC focus frames the element before restoring its canonical camera", async () => {
  const source = await readFile(
    new URL(
      "../app/lukas/components/ifc-property-browser.client.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    source,
    /viewerRef\.current\?\.focusElement\(element\.expressId\);\s*if \(focusRequest\.camera\)\s*viewerRef\.current\?\.restoreViewState\(focusRequest\.camera\)/s,
  );
});

test("controlled IFC focus selects semantic data before WebGL is ready and binds camera work to the current source", async () => {
  const source = await readFile(
    new URL(
      "../app/lukas/components/ifc-property-browser.client.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /const \[elementsSourceKey, setElementsSourceKey\]/);
  assert.match(
    source,
    /elementsSourceKey !== sourceKey[\s\S]*void choose\(element, "focus-request"\);[\s\S]*if \(!viewerReady\) return;[\s\S]*viewerRef\.current\?\.focusElement\(element\.expressId\)/,
  );
  assert.match(
    source,
    /const focusLifecycleKey = `\$\{sourceKey\}:\$\{focusRequest\.requestId\}`/,
  );
});

test("IFC initialization is generation-fenced and stale loads dispose only owned resources", async () => {
  const source = await readFile(
    new URL(
      "../app/lukas/components/ifc-property-browser.client.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /const isCurrentLoad = \(\) =>/);
  assert.match(
    source,
    /const webIfc = await import\("web-ifc"\);\s*if \(!isCurrentLoad\(\)\) return;/s,
  );
  assert.match(source, /function disposeOwnedIfc\(\)/);
  assert.match(
    source,
    /if \(!isCurrentLoad\(\)\) \{\s*disposeOwnedIfc\(\);\s*return;/s,
  );
});

test("mounted reverse focus and already-linked checks include the selected IFC SHA", async () => {
  const source = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /matchDrawingObjectsForIfcSelection\(ifcSourceIndex, \{[\s\S]*sourceFileId: selectedIfc\.id,[\s\S]*sourceSha256: selectedIfc\.sha256,[\s\S]*ifcGlobalId: selection\.ifcGlobalId/,
  );
  assert.match(
    source,
    /source\.sourceFileId === selectedIfc\.id &&\s*source\.sourceSha256 === selectedIfc\.sha256/,
  );
});
