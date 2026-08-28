import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

function manifest(overrides = {}) {
  return {
    schemaVersion: 1,
    sourceIfcSha256: sha.source,
    glbSha256: sha.glb,
    elements: [
      {
        expressId: 42,
        globalId: "3ABCdefghijklmnopqrstu",
        typeName: "IfcWall",
        name: "Wall 42",
        properties: [{ key: "Pset_WallCommon · IsExternal", value: "true" }],
        nodeRefs: ["node-wall-a", "node-wall-b"],
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

test("manifest validation binds one strict element index to the selected IFC and GLB hashes", () => {
  const valid = renderModel.validateIfcRenderManifest(manifest(), {
    sourceIfcSha256: sha.source,
    glbSha256: sha.glb,
  });
  assert.equal(valid.elements[0].expressId, 42);
  assert.equal(valid.elements[0].properties[0].value, "true");

  for (const invalid of [
    manifest({ sourceIfcSha256: "c".repeat(64) }),
    manifest({ glbSha256: "d".repeat(64) }),
    manifest({ schemaVersion: 2 }),
    manifest({
      elements: [
        manifest().elements[0],
        { ...manifest().elements[0], nodeRefs: ["node-wall-c"] },
      ],
    }),
    manifest({
      elements: [
        manifest().elements[0],
        {
          ...manifest().elements[0],
          expressId: 43,
          nodeRefs: ["node-wall-a"],
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
          sourceIfcSha256: sha.source,
          glbSha256: sha.glb,
        }),
      /manifest/i,
    );
});

test("scene mapping requires stable node refs and matching express IDs while retaining all sibling meshes", () => {
  const root = new THREE.Group();
  const first = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  );
  first.userData = { ifcNodeRef: "node-wall-a", ifcExpressId: 42 };
  const nested = new THREE.Group();
  const second = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()],
  );
  second.userData = { ifcNodeRef: "node-wall-b", ifcExpressId: 42 };
  nested.add(second);
  root.add(first, nested);

  const mapping = renderModel.mapIfcRenderScene(root, manifest());
  assert.deepEqual(mapping.elementMeshes.get(42), [first, second]);
  assert.equal(first.userData.expressId, 42);
  assert.equal(second.userData.expressId, 42);

  second.userData.ifcExpressId = 99;
  assert.throws(
    () => renderModel.mapIfcRenderScene(root, manifest()),
    /expressId/i,
  );
  second.userData.ifcExpressId = 42;
  second.userData.ifcNodeRef = "unknown-node";
  assert.throws(
    () => renderModel.mapIfcRenderScene(root, manifest()),
    /node ref/i,
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
  first.userData = { ifcNodeRef: "node-wall-a", ifcExpressId: 42 };
  second.userData = { ifcNodeRef: "node-wall-b", ifcExpressId: 42 };
  root.add(first, second);

  const counts = { geometry: 0, firstMaterial: 0, secondMaterial: 0, texture: 0 };
  geometry.addEventListener("dispose", () => (counts.geometry += 1));
  firstMaterial.addEventListener("dispose", () => (counts.firstMaterial += 1));
  secondMaterial.addEventListener("dispose", () => (counts.secondMaterial += 1));
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
        glbSha256,
        elements: [],
      }),
    ),
  );
  const manifestSha256 = digest(manifestBytes);
  const requests = [];
  const fetcher = async (url) => {
    requests.push(url);
    return new Response(url.endsWith("manifest.json") ? manifestBytes : glbBytes);
  };

  const loaded = await renderModel.loadVerifiedIfcRenderBundle(
    {
      sourceIfcSha256: sha.source,
      manifest: {
        signedUrl: "https://storage.test/manifest.json",
        sha256: manifestSha256,
        byteSize: manifestBytes.byteLength,
        schemaVersion: 1,
      },
      glb: {
        signedUrl: "https://storage.test/model.glb",
        sha256: glbSha256,
        byteSize: glbBytes.byteLength,
      },
    },
    { fetcher },
  );
  assert.deepEqual(requests, [
    "https://storage.test/manifest.json",
    "https://storage.test/model.glb",
  ]);
  assert.equal(loaded.skipped, false);
  assert.deepEqual(loaded.glbBytes, glbBytes);
  assert.deepEqual(loaded.manifest.elements, []);
});

test("immutable bundle loader rejects byte mismatches and skips oversized GLB network work", async () => {
  const glbBytes = encodeGlbJson({ asset: { version: "2.0" } });
  const glbSha256 = digest(glbBytes);
  const manifestBytes = new TextEncoder().encode(
    JSON.stringify(manifest({ glbSha256, elements: [] })),
  );
  const manifestSha256 = digest(manifestBytes);
  const descriptors = {
    sourceIfcSha256: sha.source,
    manifest: {
      signedUrl: "https://storage.test/manifest.json",
      sha256: manifestSha256,
      byteSize: manifestBytes.byteLength,
      schemaVersion: 1,
    },
    glb: {
      signedUrl: "https://storage.test/model.glb",
      sha256: glbSha256,
      byteSize: glbBytes.byteLength,
    },
  };

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

  const requests = [];
  const skipped = await renderModel.loadVerifiedIfcRenderBundle(
    {
      ...descriptors,
      glb: { ...descriptors.glb, byteSize: 80 * 1024 * 1024 },
    },
    {
      maxGlbBytes: 75 * 1024 * 1024,
      fetcher: async (url) => {
        requests.push(url);
        return new Response(manifestBytes);
      },
    },
  );
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.glbBytes, null);
  assert.deepEqual(requests, ["https://storage.test/manifest.json"]);
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
      manifest({ glbSha256: digest(glbBytes), elements: [] }),
      { sourceIfcSha256: sha.source, glbSha256: digest(glbBytes) },
    ),
    glbBytes,
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
      glbBytes: null,
      skipped: true,
    }),
    /skipped/i,
  );
});
