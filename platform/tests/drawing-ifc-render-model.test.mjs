import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as THREE from "three";
import { createServer } from "vite";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true },
});
const renderModel = await vite.ssrLoadModule(
  "/app/lukas/lib/ifc-render-model.client.ts",
);
test.after(() => vite.close());

const sha = {
  source: "a".repeat(64),
  glb: "b".repeat(64),
};
const sourceFileId = "10000000-0000-4000-8000-000000000001";
const previewSourceFileId = "00000000-0000-4000-8000-0000000000a1";

function manifest(overrides = {}) {
  return {
    schemaVersion: 1,
    source: { fileId: sourceFileId, sha256: sha.source },
    geometry: { sha256: sha.glb },
    elements: [
      {
        expressId: 42,
        globalId: "3ABCdefghijklmnopqrstu",
        typeName: "IfcWall",
        name: "Wall 42",
        properties: [
          { group: "Pset_WallCommon", name: "IsExternal", value: true },
        ],
        meshes: [
          { nodeId: "node-wall-a", primitiveIndices: [0] },
          { nodeId: "node-wall-b", primitiveIndices: [0] },
        ],
      },
    ],
    ...overrides,
  };
}

function encodeGlbJson(json) {
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const paddedLength = Math.ceil(encoded.byteLength / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + paddedLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(encoded, 20);
  bytes.fill(0x20, 20 + encoded.byteLength);
  return bytes;
}

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function descriptor({
  manifestSha256,
  geometrySha256,
  manifestByteSize = 1,
  geometryByteSize = 1,
}) {
  return {
    source: { fileId: sourceFileId, sha256: sha.source },
    derivative: {
      status: "ready",
      version: 1,
      sourceSha256: sha.source,
      manifestSha256,
      geometrySha256,
      manifestByteSize,
      geometryByteSize,
      manifestSignedUrl: "https://storage.test/manifest.json",
      geometrySignedUrl: "https://storage.test/model.glb",
    },
  };
}

test("manifest validation binds one strict element index to the selected IFC and GLB hashes", () => {
  const valid = renderModel.validateIfcRenderManifest(manifest(), {
    source: { fileId: sourceFileId, sha256: sha.source },
    geometrySha256: sha.glb,
  });
  assert.equal(valid.elements[0].expressId, 42);
  assert.deepEqual(valid.elements[0].properties[0], {
    group: "Pset_WallCommon",
    name: "IsExternal",
    value: true,
  });

  for (const invalid of [
    manifest({ elements: [{ ...manifest().elements[0], meshes: [] }] }),
    manifest({ extra: true }),
    manifest({ source: { fileId: sourceFileId, sha256: "c".repeat(64) } }),
    manifest({ geometry: { sha256: "d".repeat(64) } }),
    manifest({ schemaVersion: 2 }),
    manifest({
      elements: [
        manifest().elements[0],
        {
          ...manifest().elements[0],
          meshes: [{ nodeId: "node-wall-c", primitiveIndices: [0] }],
        },
      ],
    }),
    manifest({
      elements: [
        manifest().elements[0],
        {
          ...manifest().elements[0],
          expressId: 43,
          meshes: [{ nodeId: "node-wall-a", primitiveIndices: [1] }],
        },
      ],
    }),
    manifest({
      elements: [{ ...manifest().elements[0], globalId: "not-global-id" }],
    }),
  ])
    assert.throws(
      () =>
        renderModel.validateIfcRenderManifest(invalid, {
          source: { fileId: sourceFileId, sha256: sha.source },
          geometrySha256: sha.glb,
        }),
      /manifest/i,
    );
});

test("manifest mapping authority is unique by node and primitive pair, not node alone", () => {
  const sharedNode = manifest({
    elements: [
      {
        ...manifest().elements[0],
        meshes: [{ nodeId: "shared-node", primitiveIndices: [0] }],
      },
      {
        ...manifest().elements[0],
        expressId: 43,
        globalId: "2ABCdefghijklmnopqrstu",
        meshes: [{ nodeId: "shared-node", primitiveIndices: [1] }],
      },
    ],
  });
  assert.doesNotThrow(() =>
    renderModel.validateIfcRenderManifest(sharedNode, {
      source: { fileId: sourceFileId, sha256: sha.source },
      geometrySha256: sha.glb,
    }),
  );
  sharedNode.elements[1].meshes[0].primitiveIndices = [0];
  assert.throws(
    () =>
      renderModel.validateIfcRenderManifest(sharedNode, {
        source: { fileId: sourceFileId, sha256: sha.source },
        geometrySha256: sha.glb,
      }),
    /duplicate mesh primitive/i,
  );
});

test("scene mapping requires stable node refs and matching express IDs while retaining all sibling meshes", () => {
  const root = new THREE.Group();
  const first = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  );
  first.userData = {
    ifcNodeId: "node-wall-a",
    ifcExpressId: 42,
    ifcPrimitiveIndex: 0,
  };
  const nested = new THREE.Group();
  const second = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [
    new THREE.MeshBasicMaterial(),
    new THREE.MeshBasicMaterial(),
  ]);
  second.userData = {
    ifcNodeId: "node-wall-b",
    ifcExpressId: 42,
    ifcPrimitiveIndex: 0,
  };
  nested.add(second);
  root.add(first, nested);

  const mapping = renderModel.mapIfcRenderScene(root, manifest());
  assert.deepEqual(mapping.elementMeshes.get(42), [first, second]);
  assert.equal(first.userData.ifcResolvedExpressId, 42);
  assert.equal(second.userData.ifcResolvedExpressId, 42);
  assert.equal("expressId" in first.userData, false);
  assert.equal("expressId" in second.userData, false);

  second.userData.ifcExpressId = 99;
  assert.throws(
    () => renderModel.mapIfcRenderScene(root, manifest()),
    /expressId/i,
  );
  second.userData.ifcExpressId = 42;
  second.userData.ifcNodeId = "unknown-node";
  assert.throws(
    () => renderModel.mapIfcRenderScene(root, manifest()),
    /node.*primitive/i,
  );
});

test("scene mapping accepts only canonical IFC extras and optional ifcExpressId", () => {
  const root = new THREE.Group();
  const canonical = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  );
  canonical.userData = {
    ifcNodeId: "node-wall-a",
    ifcPrimitiveIndex: 0,
  };
  const second = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  );
  second.userData = {
    ifcNodeId: "node-wall-b",
    ifcExpressId: 42,
    ifcPrimitiveIndex: 0,
  };
  root.add(canonical, second);
  assert.doesNotThrow(() => renderModel.mapIfcRenderScene(root, manifest()));

  canonical.userData = {
    nodeId: "node-wall-a",
    expressId: 42,
    ifcPrimitiveIndex: 0,
  };
  assert.throws(
    () => renderModel.mapIfcRenderScene(root, manifest()),
    /node ID.*missing/i,
  );
});

test("owned render-model disposal releases shared geometry, material arrays, and textures exactly once", () => {
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const texture = new THREE.Texture();
  const firstMaterial = new THREE.MeshBasicMaterial({ map: texture });
  const secondMaterial = new THREE.MeshBasicMaterial({ map: texture });
  const first = new THREE.Mesh(geometry, [firstMaterial, secondMaterial]);
  const second = new THREE.Mesh(geometry, firstMaterial);
  first.userData = {
    ifcNodeId: "node-wall-a",
    ifcExpressId: 42,
    ifcPrimitiveIndex: 0,
  };
  second.userData = {
    ifcNodeId: "node-wall-b",
    ifcExpressId: 42,
    ifcPrimitiveIndex: 0,
  };
  root.add(first, second);

  const counts = {
    geometry: 0,
    firstMaterial: 0,
    secondMaterial: 0,
    texture: 0,
  };
  geometry.addEventListener("dispose", () => (counts.geometry += 1));
  firstMaterial.addEventListener("dispose", () => (counts.firstMaterial += 1));
  secondMaterial.addEventListener(
    "dispose",
    () => (counts.secondMaterial += 1),
  );
  texture.addEventListener("dispose", () => (counts.texture += 1));

  const owned = renderModel.createOwnedIfcRenderModel(root, manifest());
  owned.dispose();
  owned.dispose();
  assert.deepEqual(counts, {
    geometry: 1,
    firstMaterial: 1,
    secondMaterial: 1,
    texture: 1,
  });
});

test("owned model disposal retains ownership of original resources after viewer highlighting", () => {
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const original = new THREE.MeshBasicMaterial();
  const highlight = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, original);
  mesh.userData = {
    ifcNodeId: "node-wall-a",
    ifcExpressId: 42,
    ifcPrimitiveIndex: 0,
  };
  const sibling = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  );
  sibling.userData = {
    ifcNodeId: "node-wall-b",
    ifcExpressId: 42,
    ifcPrimitiveIndex: 0,
  };
  root.add(mesh, sibling);
  let originalDisposals = 0;
  let highlightDisposals = 0;
  original.addEventListener("dispose", () => (originalDisposals += 1));
  highlight.addEventListener("dispose", () => (highlightDisposals += 1));

  const owned = renderModel.createOwnedIfcRenderModel(root, manifest());
  mesh.material = highlight;
  owned.dispose();
  assert.equal(originalDisposals, 1);
  assert.equal(highlightDisposals, 0);
});

test("self-contained GLB validation rejects external buffer and image capabilities", () => {
  const external = encodeGlbJson({
    asset: { version: "2.0" },
    buffers: [{ byteLength: 12, uri: "mesh.bin" }],
    images: [{ uri: "texture.png" }],
  });
  assert.throws(
    () => renderModel.assertSelfContainedGlb(external),
    /self-contained/i,
  );

  const embedded = encodeGlbJson({
    asset: { version: "2.0" },
    buffers: [{ byteLength: 0 }],
    images: [{ uri: "data:image/png;base64," }],
  });
  assert.doesNotThrow(() => renderModel.assertSelfContainedGlb(embedded));
});

test("immutable bundle loader verifies manifest and GLB bytes before returning them", async () => {
  const glbBytes = encodeGlbJson({ asset: { version: "2.0" } });
  const glbSha256 = digest(glbBytes);
  const manifestBytes = new TextEncoder().encode(
    JSON.stringify(
      manifest({
        geometry: { sha256: glbSha256 },
        elements: [],
      }),
    ),
  );
  const manifestSha256 = digest(manifestBytes);
  const requests = [];
  const fetcher = async (url) => {
    requests.push(url);
    return new Response(
      url.endsWith("manifest.json") ? manifestBytes : glbBytes,
    );
  };

  const loaded = await renderModel.loadVerifiedIfcRenderBundle(
    descriptor({
      manifestSha256,
      geometrySha256: glbSha256,
      manifestByteSize: manifestBytes.byteLength,
      geometryByteSize: glbBytes.byteLength,
    }),
    { fetcher },
  );
  assert.deepEqual(requests, [
    "https://storage.test/manifest.json",
    "https://storage.test/model.glb",
  ]);
  assert.equal(loaded.skipped, false);
  assert.deepEqual(loaded.geometryBytes, glbBytes);
  assert.deepEqual(loaded.manifest.elements, []);
  assert.equal(Object.isFrozen(loaded.manifest), true);
  assert.equal(Object.isFrozen(loaded.manifest.source), true);
  loaded.geometryBytes[0] ^= 0xff;
  await assert.rejects(
    renderModel.instantiateVerifiedIfcRenderModel(loaded),
    /SHA-256 changed/i,
  );
});

test("immutable bundle loader rejects byte mismatches and skips oversized GLB buffering", async () => {
  const glbBytes = encodeGlbJson({ asset: { version: "2.0" } });
  const glbSha256 = digest(glbBytes);
  const manifestBytes = new TextEncoder().encode(
    JSON.stringify(manifest({ geometry: { sha256: glbSha256 }, elements: [] })),
  );
  const manifestSha256 = digest(manifestBytes);
  const descriptors = descriptor({
    manifestSha256,
    geometrySha256: glbSha256,
    manifestByteSize: manifestBytes.byteLength,
    geometryByteSize: glbBytes.byteLength,
  });

  await assert.rejects(
    renderModel.loadVerifiedIfcRenderBundle(descriptors, {
      fetcher: async (url) =>
        new Response(
          url.endsWith("manifest.json")
            ? manifestBytes
            : new Uint8Array(glbBytes.byteLength),
        ),
    }),
    /SHA-256/i,
  );
  await assert.rejects(
    renderModel.loadVerifiedIfcRenderBundle(
      {
        ...descriptors,
        derivative: { ...descriptors.derivative, sourceSha256: "f".repeat(64) },
      },
      { fetcher: async () => new Response(manifestBytes) },
    ),
    /source identity/i,
  );

  const requests = [];
  const oversized = {
    ...descriptors,
    derivative: {
      ...descriptors.derivative,
      geometryByteSize: 80 * 1024 * 1024,
    },
  };
  const skipped = await renderModel.loadVerifiedIfcRenderBundle(oversized, {
    maxGeometryBytes: 75 * 1024 * 1024,
    fetcher: async (url) => {
      requests.push(url);
      return url.endsWith("manifest.json")
        ? new Response(manifestBytes)
        : new Response(null);
    },
  });
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.geometryBytes, null);
  assert.deepEqual(requests, ["https://storage.test/manifest.json"]);
});

test("immutable bundle loader rejects authoritative and HTTP byte-size mismatches before commit", async () => {
  const glbBytes = encodeGlbJson({ asset: { version: "2.0" } });
  const glbSha256 = digest(glbBytes);
  const manifestBytes = new TextEncoder().encode(
    JSON.stringify(manifest({ geometry: { sha256: glbSha256 }, elements: [] })),
  );
  const manifestSha256 = digest(manifestBytes);
  const valid = descriptor({
    manifestSha256,
    geometrySha256: glbSha256,
    manifestByteSize: manifestBytes.byteLength,
    geometryByteSize: glbBytes.byteLength,
  });

  await assert.rejects(
    renderModel.loadVerifiedIfcRenderBundle(
      {
        ...valid,
        derivative: {
          ...valid.derivative,
          manifestByteSize: manifestBytes.byteLength + 1,
        },
      },
      { fetcher: async () => new Response(manifestBytes) },
    ),
    /byte size/i,
  );

  await assert.rejects(
    renderModel.loadVerifiedIfcRenderBundle(valid, {
      fetcher: async (url) =>
        url.endsWith("manifest.json")
          ? new Response(manifestBytes, {
              headers: {
                "content-length": String(manifestBytes.byteLength + 1),
              },
            })
          : new Response(glbBytes),
    }),
    /byte size/i,
  );

  await assert.rejects(
    renderModel.loadVerifiedIfcRenderBundle(valid, {
      fetcher: async (url) =>
        url.endsWith("manifest.json")
          ? new Response(manifestBytes)
          : new Response(glbBytes.subarray(0, glbBytes.byteLength - 1)),
    }),
    /byte size/i,
  );
});

test("verified self-contained GLB bytes instantiate a fresh owned model for every viewer mount", async () => {
  const glbBytes = encodeGlbJson({
    asset: { version: "2.0", generator: "1HK test" },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
  });
  const bundle = {
    manifest: renderModel.validateIfcRenderManifest(
      manifest({ geometry: { sha256: digest(glbBytes) }, elements: [] }),
      {
        source: { fileId: sourceFileId, sha256: sha.source },
        geometrySha256: digest(glbBytes),
      },
    ),
    geometryBytes: glbBytes,
    skipped: false,
  };

  const first = await renderModel.instantiateVerifiedIfcRenderModel(bundle);
  const second = await renderModel.instantiateVerifiedIfcRenderModel(bundle);
  assert.notEqual(first.root, second.root);
  assert.equal(first.renderedElementCount, 0);
  assert.equal(second.renderedElementCount, 0);
  first.dispose();
  second.dispose();

  await assert.rejects(
    renderModel.instantiateVerifiedIfcRenderModel({
      ...bundle,
      geometryBytes: null,
      skipped: true,
    }),
    /skipped/i,
  );
});

test("bundle loading forwards source cancellation to immutable fetch work", async () => {
  const controller = new AbortController();
  const seenSignals = [];
  const pending = renderModel.loadVerifiedIfcRenderBundle(
    descriptor({ manifestSha256: "c".repeat(64), geometrySha256: sha.glb }),
    {
      signal: controller.signal,
      fetcher: async (_url, init) => {
        seenSignals.push(init?.signal);
        if (!init?.signal)
          throw new Error("source cancellation signal missing");
        return await new Promise((_resolve, reject) =>
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          ),
        );
      },
    },
  );
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.deepEqual(seenSignals, [controller.signal]);
});

test("synthetic mapping fixture maps 115 GLB primitives without claiming source-faithful IFC geometry", async () => {
  const geometryBytes = new Uint8Array(
    await readFile(
      new URL("../public/examples/synthetic-ifc-mapping.glb", import.meta.url),
    ),
  );
  const manifestInput = JSON.parse(
    await readFile(
      new URL(
        "../public/examples/synthetic-ifc-mapping.manifest.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const geometrySha256 = digest(geometryBytes);
  const glbView = new DataView(
    geometryBytes.buffer,
    geometryBytes.byteOffset,
    geometryBytes.byteLength,
  );
  const glbJsonLength = glbView.getUint32(12, true);
  const glbDocument = JSON.parse(
    new TextDecoder()
      .decode(geometryBytes.subarray(20, 20 + glbJsonLength))
      .trim(),
  );
  assert.equal(glbDocument.asset.generator, "1HK synthetic mapping fixture");
  assert.equal(glbDocument.nodes.length, 115);
  for (const node of glbDocument.nodes) {
    assert.deepEqual(Object.keys(node.extras).sort(), [
      "ifcExpressId",
      "ifcNodeId",
    ]);
    assert.equal(typeof node.extras.ifcNodeId, "string");
    assert.equal(Number.isSafeInteger(node.extras.ifcExpressId), true);
    assert.equal("nodeId" in node.extras, false);
    assert.equal("expressId" in node.extras, false);
  }
  const canonical = renderModel.validateIfcRenderManifest(manifestInput, {
    source: {
      fileId: previewSourceFileId,
      sha256: manifestInput.source.sha256,
    },
    geometrySha256,
  });
  const owned = await renderModel.instantiateVerifiedIfcRenderModel({
    manifest: canonical,
    geometryBytes,
    skipped: false,
  });
  assert.equal(owned.renderedElementCount, 115);
  assert.equal(owned.elementMeshes.get(2863)?.length, 1);
  owned.dispose();
});
