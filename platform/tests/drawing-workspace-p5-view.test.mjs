import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServer } from "vite";
import * as THREE from "three";

import * as workspaceView from "../app/lukas/lib/drawing-workspace-view.ts";
import { adaptIfcRenderBundleDescriptor } from "../app/lukas/lib/ifc-render-descriptor.ts";

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
const ifcPropertyBrowser = await vite.ssrLoadModule(
  "/app/lukas/components/ifc-property-browser.client.tsx",
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

test("IFC fetch capability changes when signed URLs rotate without changing content identity", () => {
  const descriptor = {
    source: { fileId: ids.file, sha256: sha },
    derivative: {
      status: "ready",
      version: 1,
      sourceSha256: sha,
      manifestSha256: "b".repeat(64),
      geometrySha256: "c".repeat(64),
      manifestByteSize: 10,
      geometryByteSize: 20,
      manifestSignedUrl: "https://storage.test/manifest?token=old",
      geometrySignedUrl: "https://storage.test/model?token=old",
    },
  };
  assert.notEqual(
    ifcPropertyBrowser.ifcRenderCapabilityKey("source", descriptor),
    ifcPropertyBrowser.ifcRenderCapabilityKey("source", {
      ...descriptor,
      derivative: {
        ...descriptor.derivative,
        manifestSignedUrl: "https://storage.test/manifest?token=new",
        geometrySignedUrl: "https://storage.test/model?token=new",
      },
    }),
  );
});

test("backend ready derivative adapter preserves exact pinned hashes, byte sizes, and capabilities", () => {
  const derivative = {
    status: "ready",
    version: 7,
    sourceSha256: sha,
    manifestSha256: "b".repeat(64),
    geometrySha256: "c".repeat(64),
    manifestByteSize: 10,
    geometryByteSize: 20,
    manifestSignedUrl: "https://storage.test/manifest",
    geometrySignedUrl: "https://storage.test/geometry",
  };
  assert.deepEqual(
    adaptIfcRenderBundleDescriptor({ id: ids.file, sha256: sha, derivative }),
    {
      source: { fileId: ids.file, sha256: sha },
      derivative,
    },
  );
  assert.equal(
    adaptIfcRenderBundleDescriptor({ id: ids.file, sha256: sha }),
    undefined,
  );
  for (const unavailableDerivative of [
    {
      status: "pending",
      version: null,
      sourceSha256: sha,
      manifestSha256: null,
      geometrySha256: null,
      manifestByteSize: null,
      geometryByteSize: null,
      manifestSignedUrl: null,
      geometrySignedUrl: null,
    },
    {
      status: "failed",
      version: 7,
      sourceSha256: sha,
      manifestSha256: null,
      geometrySha256: null,
      manifestByteSize: null,
      geometryByteSize: null,
      manifestSignedUrl: null,
      geometrySignedUrl: null,
    },
    { ...derivative, manifestByteSize: 0 },
    { ...derivative, geometryByteSize: Number.NaN },
  ])
    assert.equal(
      adaptIfcRenderBundleDescriptor({
        id: ids.file,
        sha256: sha,
        derivative: unavailableDerivative,
      }),
      undefined,
    );
});

test("IFC focus treats supplied GlobalId as authoritative and only uses expressId when GlobalId is absent", () => {
  const elements = [
    { expressId: 42, globalId: "3ABCdefghijklmnopqrstu" },
    { expressId: 43, globalId: "2ABCdefghijklmnopqrstu" },
  ];
  assert.equal(
    ifcPropertyBrowser.resolveIfcFocusElement(elements, {
      ifcGlobalId: "missingGlobalId0000000",
      elementId: "42",
    }),
    undefined,
  );
  assert.equal(
    ifcPropertyBrowser.resolveIfcFocusElement(elements, {
      ifcGlobalId: "",
      elementId: "42",
    }),
    undefined,
  );
  assert.equal(
    ifcPropertyBrowser.resolveIfcFocusElement(elements, {
      ifcGlobalId: null,
      elementId: "42",
    })?.expressId,
    42,
  );
  assert.equal(
    ifcPropertyBrowser.resolveIfcFocusElement(elements, {
      ifcGlobalId: "2ABCdefghijklmnopqrstu",
      elementId: "42",
    })?.expressId,
    43,
  );
});

test("IFC element results stay bounded while retaining a focused element outside the first page", () => {
  const elements = Array.from({ length: 115 }, (_, index) => ({
    expressId: index + 1,
  }));
  assert.deepEqual(
    ifcPropertyBrowser
      .visibleIfcElementResults(elements, 50, null)
      .map((element) => element.expressId),
    Array.from({ length: 50 }, (_, index) => index + 1),
  );
  const focused = ifcPropertyBrowser.visibleIfcElementResults(
    elements,
    50,
    115,
  );
  assert.equal(focused.length, 51);
  assert.equal(focused.at(-1)?.expressId, 115);
  assert.equal(new Set(focused.map((element) => element.expressId)).size, 51);
  assert.deepEqual(
    ifcPropertyBrowser.visibleIfcElementResults(elements, 115, 40),
    elements,
  );
});

test("split IFC review starts with a compact result batch without shrinking the full viewer", () => {
  assert.equal(ifcPropertyBrowser.ifcElementResultPageSize(true), 8);
  assert.equal(ifcPropertyBrowser.ifcElementResultPageSize(false), 50);
});

test("IFC first-usable geometry requires a mapped visible finite nonempty rendered mesh", () => {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  );
  root.add(mesh);
  const mapped = new Map([[42, [mesh]]]);
  root.updateMatrixWorld(true);
  assert.equal(ifcViewer.hasVisibleIfcRenderGeometry(root, mapped), true);

  root.visible = false;
  assert.equal(ifcViewer.hasVisibleIfcRenderGeometry(root, mapped), false);
  root.visible = true;
  mesh.material.visible = false;
  assert.equal(ifcViewer.hasVisibleIfcRenderGeometry(root, mapped), false);
  mesh.material.visible = true;

  const empty = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial(),
  );
  root.add(empty);
  assert.equal(
    ifcViewer.hasVisibleIfcRenderGeometry(root, new Map([[42, [empty]]])),
    false,
  );

  mesh.geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(Number.NaN, 0, 0),
    new THREE.Vector3(1, 1, 1),
  );
  assert.equal(ifcViewer.hasVisibleIfcRenderGeometry(root, mapped), false);
});

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

test("controlled IFC focus frames the element before restoring its canonical camera", () => {
  const calls = [];
  const camera = { position: [1, 2, 3], target: [4, 5, 6] };
  ifcViewer.applyIfcControlledView(
    {
      focusElement: (expressId) => calls.push(["focus", expressId]),
      restoreViewState: (state) => calls.push(["restore", state]),
    },
    42,
    camera,
  );
  assert.deepEqual(calls, [
    ["focus", 42],
    ["restore", camera],
  ]);
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
