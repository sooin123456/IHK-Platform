import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  loadDrawingIfcDerivative,
  publishManagedIfcDerivativeObject,
} from "../app/lukas/lib/drawing-workspace.server.ts";

const ids = {
  actor: "20000000-0000-4000-8000-000000000001",
  project: "20000000-0000-4000-8000-000000000002",
  source: "20000000-0000-4000-8000-000000000003",
  revision: "20000000-0000-4000-8000-000000000004",
  derivative1: "20000000-0000-4000-8000-000000000005",
  derivative2: "20000000-0000-4000-8000-000000000006",
};
const sourceSha = "a".repeat(64);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function glb(json, binary = null) {
  const source = new TextEncoder().encode(JSON.stringify(json));
  const padded = Math.ceil(source.byteLength / 4) * 4;
  const binaryPadded = binary ? Math.ceil(binary.byteLength / 4) * 4 : 0;
  const bytes = new Uint8Array(
    12 + 8 + padded + (binary ? 8 + binaryPadded : 0),
  );
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(source, 20);
  bytes.fill(0x20, 20 + source.byteLength);
  if (binary) {
    const binaryOffset = 20 + padded;
    view.setUint32(binaryOffset, binaryPadded, true);
    view.setUint32(binaryOffset + 4, 0x004e4942, true);
    bytes.set(binary, binaryOffset + 8);
  }
  return bytes;
}

function validGeometryGlb(overrides = {}) {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const binary = new Uint8Array(positions.buffer);
  const document = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: binary.byteLength }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
    nodes: [{ name: "ifc-42", mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    scenes: [{ nodes: [0] }],
    scene: 0,
    ...overrides,
  };
  return glb(document, binary);
}

function artifact(version, options = {}) {
  const geometryBytes = options.geometryBytes ?? validGeometryGlb();
  const geometrySha256 = sha256(geometryBytes);
  const manifest = {
    schemaVersion: 1,
    source: { fileId: ids.source, sha256: sourceSha },
    geometry: { sha256: geometrySha256 },
    elements: [
      {
        expressId: 42,
        globalId: "0VNYAWfXv8JvIRVfOzYH1j",
        typeName: "IFCWALL",
        name: "Wall",
        meshes: [{ nodeId: "ifc-42", primitiveIndices: [0] }],
        properties: [{ group: "Identity", name: "FireRating", value: "2h" }],
      },
    ],
  };
  const manifestBytes = new TextEncoder().encode(canonicalJson(manifest));
  const manifestSha256 = sha256(manifestBytes);
  const prefix = `projects/${ids.project}/ifc-derivatives/${sourceSha}/v${version}`;
  return {
    row: {
      id: `20000000-0000-4000-8000-${String(version + 4).padStart(12, "0")}`,
      project_id: ids.project,
      source_file_id: ids.source,
      source_sha256: sourceSha,
      version,
      schema_version: 1,
      status: "ready",
      manifest_json: manifest,
      manifest_storage_path: `${prefix}/${manifestSha256}.json`,
      manifest_byte_size: manifestBytes.byteLength,
      manifest_sha256: manifestSha256,
      geometry_storage_path: `${prefix}/${geometrySha256}.glb`,
      geometry_byte_size: geometryBytes.byteLength,
      geometry_sha256: geometrySha256,
    },
    manifestBytes,
    geometryBytes,
  };
}

const file = {
  id: ids.source,
  project_id: ids.project,
  kind: "ifc",
  original_filename: "model.ifc",
  storage_path: "projects/model.ifc",
  content_type: "application/x-step",
  byte_size: 1,
  sha256: sourceSha,
  immutable: true,
  created_at: "2026-08-28T00:00:00Z",
};

function clientFor({ derivatives, bindings = [], objects = {} }) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(["fetch", url, init]);
    const path = String(url).replace("https://storage.test/internal/", "");
    const bytes = objects[path];
    if (!bytes) return new Response(null, { status: 404 });
    return new Response(bytes, {
      status: 206,
      headers: {
        "content-length": String(bytes.byteLength),
        "content-range": `bytes 0-${bytes.byteLength - 1}/${bytes.byteLength}`,
      },
    });
  };
  return {
    calls,
    fetchImpl,
    from(table) {
      const filters = [];
      let descending = false;
      const builder = {
        select() {
          return builder;
        },
        eq(column, value) {
          filters.push([column, value]);
          return builder;
        },
        order(_column, options) {
          descending = options?.ascending === false;
          return builder;
        },
        limit(count) {
          const source =
            table === "lukas_drawing_revision_ifc_derivatives"
              ? bindings
              : derivatives;
          const data = source
            .filter((row) =>
              filters.every(([column, value]) => row[column] === value),
            )
            .sort((left, right) =>
              descending
                ? right.version - left.version
                : left.version - right.version,
            )
            .slice(0, count);
          return Promise.resolve({ data, error: null });
        },
      };
      return builder;
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "lukas-qto");
        return {
          async download(path) {
            calls.push(["download", path]);
            const bytes = objects[path];
            return bytes
              ? { data: new Blob([bytes]), error: null }
              : { data: null, error: new Error("missing") };
          },
          async createSignedUrl(path, ttl) {
            calls.push(["sign", path, ttl]);
            return {
              data: {
                signedUrl:
                  ttl <= 30
                    ? `https://storage.test/internal/${path}`
                    : `https://storage.test/${path}`,
              },
              error: null,
            };
          },
        };
      },
    },
  };
}

function objectsFor(...artifacts) {
  return Object.fromEntries(
    artifacts.flatMap(({ row, manifestBytes, geometryBytes }) => [
      [row.manifest_storage_path, manifestBytes],
      [row.geometry_storage_path, geometryBytes],
    ]),
  );
}

test("an approved revision keeps its pin after pending, failed, and ready appends", async () => {
  const first = artifact(1);
  const laterReady = artifact(4);
  const pending = {
    ...laterReady.row,
    id: ids.derivative2,
    version: 2,
    status: "pending",
    manifest_json: null,
    manifest_storage_path: null,
    manifest_byte_size: null,
    manifest_sha256: null,
    geometry_storage_path: null,
    geometry_byte_size: null,
    geometry_sha256: null,
  };
  const failed = {
    ...pending,
    id: "20000000-0000-4000-8000-000000000007",
    version: 3,
    status: "failed",
  };
  const binding = {
    revision_id: ids.revision,
    revision_version: 7,
    project_id: ids.project,
    source_file_id: ids.source,
    source_sha256: sourceSha,
    derivative_id: first.row.id,
    derivative_version: 1,
    manifest_sha256: first.row.manifest_sha256,
    geometry_sha256: first.row.geometry_sha256,
    version: 1,
  };
  const client = clientFor({
    derivatives: [first.row, pending, failed, laterReady.row],
    bindings: [binding],
    objects: objectsFor(first, laterReady),
  });
  const loaded = await loadDrawingIfcDerivative(
    client,
    file,
    { id: ids.revision, status: "approved", version: 7 },
    { fetch: client.fetchImpl },
  );
  assert.equal(loaded.version, 1);
  assert.equal(loaded.manifestSha256, first.row.manifest_sha256);
  assert.deepEqual(
    client.calls.filter(([kind]) => kind === "fetch").map(([, url]) => url),
    [
      `https://storage.test/internal/${first.row.manifest_storage_path}`,
      `https://storage.test/internal/${first.row.geometry_storage_path}`,
    ],
  );
});

test("a protected revision without an exact derivative binding fails closed", async () => {
  const first = artifact(1);
  const client = clientFor({
    derivatives: [first.row],
    objects: objectsFor(first),
  });
  await assert.rejects(
    loadDrawingIfcDerivative(client, file, {
      id: ids.revision,
      status: "superseded",
      version: 7,
    }),
    (error) => error instanceof Response && error.status === 409,
  );
  assert.deepEqual(client.calls, []);
});

test("a draft deterministically resolves the newest ready derivative", async () => {
  const first = artifact(1);
  const latest = artifact(4);
  const pending = {
    ...latest.row,
    id: "20000000-0000-4000-8000-000000000008",
    version: 5,
    status: "pending",
    manifest_json: null,
    manifest_storage_path: null,
    manifest_byte_size: null,
    manifest_sha256: null,
    geometry_storage_path: null,
    geometry_byte_size: null,
    geometry_sha256: null,
  };
  const client = clientFor({
    derivatives: [pending, first.row, latest.row],
    objects: objectsFor(first, latest),
  });
  const loaded = await loadDrawingIfcDerivative(
    client,
    file,
    { id: ids.revision, status: "draft", version: 7 },
    { fetch: client.fetchImpl },
  );
  assert.equal(loaded.version, 4);
  assert.equal(loaded.geometrySha256, latest.row.geometry_sha256);
});

test("a draft exposes the latest failed status when no ready derivative exists", async () => {
  const failed = {
    ...artifact(1).row,
    status: "failed",
    manifest_json: null,
    manifest_storage_path: null,
    manifest_byte_size: null,
    manifest_sha256: null,
    geometry_storage_path: null,
    geometry_byte_size: null,
    geometry_sha256: null,
  };
  const client = clientFor({ derivatives: [failed] });
  const loaded = await loadDrawingIfcDerivative(client, file, {
    id: ids.revision,
    status: "draft",
    version: 7,
  });
  assert.deepEqual(loaded, {
    status: "failed",
    version: 1,
    sourceSha256: sourceSha,
    manifestSha256: null,
    geometrySha256: null,
    manifestSignedUrl: null,
    geometrySignedUrl: null,
  });
});

test("the loader verifies actual manifest and official GLB errors before final signing", async (context) => {
  const valid = artifact(1);
  const corrupt = artifact(1, { geometryBytes: new Uint8Array([1, 2, 3, 4]) });
  const external = artifact(1, {
    geometryBytes: glb({
      asset: { version: "2.0" },
      buffers: [{ byteLength: 4, uri: "https://evil.test/a.bin" }],
      nodes: [{ name: "ifc-42", mesh: 0 }],
      meshes: [{ primitives: [{}] }],
    }),
  });
  const missingAttributes = artifact(1, {
    geometryBytes: glb({
      asset: { version: "2.0" },
      nodes: [{ name: "ifc-42", mesh: 0 }],
      meshes: [{ primitives: [{}] }],
      scenes: [{ nodes: [0] }],
      scene: 0,
    }),
  });
  const invalidAccessorReference = artifact(1, {
    geometryBytes: validGeometryGlb({
      accessors: [
        {
          bufferView: 99,
          componentType: 5126,
          count: 3,
          type: "VEC3",
        },
      ],
    }),
  });
  const invalidNodeReference = artifact(1, {
    geometryBytes: validGeometryGlb({
      nodes: [{ name: "ifc-42", mesh: 99 }],
    }),
  });
  const invalidChunkBytes = validGeometryGlb();
  new DataView(invalidChunkBytes.buffer).setUint32(12, 0xfffffffc, true);
  const invalidChunk = artifact(1, { geometryBytes: invalidChunkBytes });
  const cases = [
    [
      "substituted manifest",
      valid,
      {
        ...objectsFor(valid),
        [valid.row.manifest_storage_path]: new TextEncoder().encode("{}"),
      },
    ],
    ["corrupt GLB", corrupt, objectsFor(corrupt)],
    ["external GLB URI", external, objectsFor(external)],
    [
      "primitive missing attributes",
      missingAttributes,
      objectsFor(missingAttributes),
    ],
    [
      "invalid accessor reference",
      invalidAccessorReference,
      objectsFor(invalidAccessorReference),
    ],
    [
      "invalid node reference",
      invalidNodeReference,
      objectsFor(invalidNodeReference),
    ],
    ["invalid chunk length", invalidChunk, objectsFor(invalidChunk)],
  ];
  for (const [name, selected, objects] of cases) {
    await context.test(name, async () => {
      const client = clientFor({ derivatives: [selected.row], objects });
      await assert.rejects(
        loadDrawingIfcDerivative(
          client,
          file,
          { id: ids.revision, status: "draft", version: 1 },
          { fetch: client.fetchImpl },
        ),
        (error) => error instanceof Response && error.status === 409,
      );
      assert.equal(
        client.calls
          .filter(([kind]) => kind === "sign")
          .some(([, , ttl]) => ttl > 30),
        false,
      );
    });
  }
});

test("actual storage bytes exceeding metadata are aborted without materializing the object", async () => {
  const valid = artifact(1);
  let pulls = 0;
  let cancelled = false;
  const client = clientFor({
    derivatives: [valid.row],
    objects: objectsFor(valid),
  });
  client.fetchImpl = async (_url, init) => {
    client.calls.push(["bounded-fetch", init]);
    const chunk = new Uint8Array(valid.row.manifest_byte_size);
    return new Response(
      new ReadableStream({
        pull(controller) {
          pulls += 1;
          controller.enqueue(chunk);
          if (pulls > 2) controller.close();
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 200 },
    );
  };
  await assert.rejects(
    loadDrawingIfcDerivative(
      client,
      file,
      { id: ids.revision, status: "draft", version: 1 },
      { fetch: client.fetchImpl },
    ),
    (error) => error instanceof Response && error.status === 409,
  );
  assert.equal(cancelled, true);
  assert.ok(
    pulls <= 3,
    `stream pulled ${pulls} chunks after exceeding metadata`,
  );
  const boundedCall = client.calls.find(([kind]) => kind === "bounded-fetch");
  assert.match(boundedCall?.[1]?.headers?.Range ?? "", /^bytes=0-/);
});

test("the loader refuses oversized artifact metadata before download", async () => {
  const valid = artifact(1);
  const row = { ...valid.row, geometry_byte_size: 200 * 1024 * 1024 + 1 };
  const client = clientFor({ derivatives: [row], objects: objectsFor(valid) });
  await assert.rejects(
    loadDrawingIfcDerivative(client, file, {
      id: ids.revision,
      status: "draft",
      version: 1,
    }),
    (error) => error instanceof Response && error.status === 409,
  );
  assert.deepEqual(client.calls, []);
});

test("managed ingestion publishes a content-addressed object without replacement", async () => {
  const bytes = new TextEncoder().encode("immutable derivative");
  const expectedSha = sha256(bytes);
  const calls = [];
  const storage = {
    from(bucket) {
      assert.equal(bucket, "lukas-qto");
      return {
        async upload(path, body, options) {
          calls.push({ path, body: new Uint8Array(body), options });
          return { data: { path }, error: null };
        },
      };
    },
  };
  const result = await publishManagedIfcDerivativeObject(storage, {
    projectId: ids.project,
    sourceSha256: sourceSha,
    version: 3,
    bytes,
    extension: "glb",
    contentType: "model/gltf-binary",
  });
  assert.deepEqual(result, {
    path: `projects/${ids.project}/ifc-derivatives/${sourceSha}/v3/${expectedSha}.glb`,
    byteSize: bytes.byteLength,
    sha256: expectedSha,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.upsert, false);
  assert.equal(calls[0].options.contentType, "model/gltf-binary");
  assert.deepEqual(calls[0].body, bytes);
});
