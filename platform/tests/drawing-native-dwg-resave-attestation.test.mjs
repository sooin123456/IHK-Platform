import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";
import {
  allFiveEntityFixture,
  fixture,
  uuid,
} from "./fixtures/drawing-native-dwg-resave-source.mjs";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
test.after(() => vite.close());
const adapter = await vite
  .ssrLoadModule(
    "/app/lukas/lib/drawing-native-dwg-resave-attestation.server.ts",
  )
  .catch(() => ({}));
const build = adapter.buildNativeDrawingDwgResaveAttestation;
const parse = adapter.parseNativeDrawingDwgResaveAttestation;
const imageId = "sha256:" + "c".repeat(64);
const digest = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");
const invalid = (error) =>
  error.kind === "invalid" &&
  error.message === "Invalid native DWG resave attestation.";

function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, item]) => [key, reverseKeys(item)]),
  );
}

function changeAllFive(f) {
  const [line, text, polyline, circle, arc] = f.canonical.objects;
  line.geometry.end = { x: 55, y: -65 };
  text.geometry.origin = { x: 15, y: 25 };
  text.geometry.text = "Edited";
  text.style.fontSize = 30;
  polyline.geometry.points[1] = { x: 25, y: 35 };
  polyline.geometry.closed = true;
  circle.geometry.radius = 25;
  arc.geometry.center = { x: 75, y: 85 };
  f.rehash();
}

function cloneFive(f) {
  Object.assign(f.scope, {
    documentId: uuid(82),
    revisionId: uuid(83),
    canvasId: uuid(85),
  });
  Object.assign(f.payload.approved, {
    documentId: uuid(82),
    canvasId: uuid(85),
  });
  f.payload.approved.revision.id = uuid(83);
  Object.assign(f.canonical.revision, { id: uuid(83), documentId: uuid(82) });
  f.canonical.pages[0].revisionId = uuid(83);
  f.canonical.canvases[0].id = uuid(85);
  f.canonical.layers[0].canvasId = uuid(85);
  f.canonical.layers[0].id = uuid(60);
  f.canonical.objects.forEach((object, index) => {
    object.id = uuid(61 + index);
    object.layerId = uuid(60);
    f.canonical.sources[index].objectId = object.id;
    f.canonical.sources[index].id = uuid(71 + index);
    f.canonical.sources[index].revisionId = uuid(83);
  });
  f.rehash();
}

test("build fixes the literal native request and exact canonical authority bytes", async () => {
  assert.equal(typeof build, "function", "attestation builder must exist");
  assert.equal(typeof parse, "function", "attestation parser must exist");
  const { scope, payload, canonical, report, rehash } = fixture();
  const unchangedPayload = structuredClone(payload);
  canonical.objects[0].geometry.start.x = 20;
  rehash();

  const attestation = await build(scope, payload, imageId);
  const requestText = JSON.stringify({
    schemaVersion: "1hk-dwg-edits/2",
    sourceSha256: report.source.sha256,
    coordinateSystem: "WCS_NATIVE_UNITS",
    edits: [{ handle: "2A", type: "LINE", start: [2, 2, 0], end: [3, 4, 0] }],
  });
  assert.equal(attestation.request.text, requestText);
  assert.equal(attestation.request.sha256, digest(requestText));
  assert.equal(
    attestation.request.byteSize,
    Buffer.byteLength(requestText, "utf8"),
  );
  assert.deepEqual(attestation.request.handles, ["2A"]);

  const authority = JSON.parse(attestation.authority.text);
  assert.deepEqual(authority, {
    schemaVersion: "1hk-dwg-resave-authority/1",
    scope,
    approved: {
      revisionId: scope.revisionId,
      revisionVersion: scope.revisionVersion,
      snapshotSha256: scope.snapshotSha256,
      operationSequence: 19,
    },
    analysis: {
      scope: payload.analysis.scope,
      receipt: payload.analysis.result.receipt,
    },
    bindings: [{ objectId: uuid(7), handle: "2A" }],
    request: {
      sha256: digest(requestText),
      byteSize: Buffer.byteLength(requestText, "utf8"),
      handles: ["2A"],
    },
    resaverImageId: imageId,
    snapshotCanonicalJsonText: payload.approved.snapshot.canonicalJsonText,
    qualification: "experimental-unqualified",
  });
  assert.equal(
    attestation.authority.sha256,
    digest(attestation.authority.text),
  );
  assert.equal(
    attestation.authority.byteSize,
    Buffer.byteLength(attestation.authority.text, "utf8"),
  );
  assert.deepEqual(parse(attestation, scope), attestation);
  assert.equal(
    (
      await build(
        {
          ...scope,
          snapshotSha256: unchangedPayload.approved.snapshot.sha256,
        },
        unchangedPayload,
        imageId,
      )
    ).request,
    null,
  );
});

test(
  "build is deterministic for reordered input keys, superseded approval and canonical UUID case",
  { skip: typeof build !== "function" },
  async () => {
    const f = fixture();
    const projectId = "93abcdef-0000-4000-8900-000000000001";
    f.scope.projectId = projectId;
    f.payload.approved.projectId = projectId;
    f.payload.analysis.scope.projectId = projectId;
    f.canonical.revision.projectId = projectId;
    f.canonical.objects[0].geometry.start.x = 20;
    f.rehash();
    const expected = await build(f.scope, f.payload, imageId);
    const reorderedScope = reverseKeys(f.scope);
    const reorderedPayload = reverseKeys(f.payload);
    const pending = build(reorderedScope, reorderedPayload, imageId);
    reorderedScope.canvasId = uuid(99);
    reorderedPayload.analysis.scope.sourceSha256 = "d".repeat(64);
    assert.deepEqual(await pending, expected);
    f.payload.approved.revision.status = "superseded";
    assert.deepEqual(await build(f.scope, f.payload, imageId), expected);

    const uppercaseScope = structuredClone(f.scope);
    uppercaseScope.projectId = uppercaseScope.projectId.toUpperCase();
    const uppercasePayload = structuredClone(f.payload);
    uppercasePayload.approved.projectId =
      uppercasePayload.approved.projectId.toUpperCase();
    uppercasePayload.analysis.scope.projectId =
      uppercasePayload.analysis.scope.projectId.toUpperCase();
    assert.deepEqual(
      await build(uppercaseScope, uppercasePayload, imageId),
      expected,
    );
  },
);

test(
  "build attests all five changed native types and clone source bindings",
  { skip: typeof build !== "function" },
  async () => {
    const f = allFiveEntityFixture();
    changeAllFive(f);
    const expectedEdits = [
      {
        handle: "3",
        type: "TEXT",
        insert: [1.5, 2.5, 0],
        height: 3,
        text: "Edited",
      },
      {
        handle: "4",
        type: "LWPOLYLINE",
        points: [
          [0, 0, 0],
          [2.5, 3.5, 0],
        ],
        closed: true,
      },
      { handle: "5", type: "CIRCLE", center: [4, 5, 0], radius: 2.5 },
      {
        handle: "6",
        type: "ARC",
        center: [7.5, 8.5, 0],
        radius: 3,
        startAngleRadians: 0.25,
        endAngleRadians: 2.5,
      },
      {
        handle: "2A",
        type: "LINE",
        start: [1, 2, 0],
        end: [5.5, -6.5, 0],
      },
    ];
    assert.deepEqual(
      JSON.parse((await build(f.scope, f.payload, imageId)).request.text).edits,
      expectedEdits,
    );

    cloneFive(f);
    const cloned = await build(f.scope, f.payload, imageId);
    const authority = JSON.parse(cloned.authority.text);
    assert.deepEqual(authority.bindings, [
      { objectId: uuid(62), handle: "3" },
      { objectId: uuid(63), handle: "4" },
      { objectId: uuid(64), handle: "5" },
      { objectId: uuid(65), handle: "6" },
      { objectId: uuid(61), handle: "2A" },
    ]);
    assert.deepEqual(cloned.request.handles, ["3", "4", "5", "6", "2A"]);
  },
);

test(
  "build rejects malformed immutable source, report, snapshot and image inputs with one bounded error",
  { skip: typeof build !== "function" },
  async (t) => {
    for (const [label, mutate, candidateImage = imageId] of [
      [
        "source",
        (f) => {
          f.payload.analysis.result.receipt.source.sha256 = "d".repeat(64);
        },
      ],
      [
        "report",
        (f) => {
          f.payload.analysis.result.reportText += " ";
        },
      ],
      [
        "snapshot",
        (f) => {
          f.payload.approved.snapshot.canonicalJsonText += " ";
        },
      ],
      ["image", () => {}, "latest"],
      [
        "scope",
        (f) => {
          f.scope.canvasId = "not-a-uuid";
        },
      ],
      [
        "extra payload field",
        (f) => {
          f.payload.actorId = uuid(90);
        },
      ],
    ])
      await t.test(label, async () => {
        const f = fixture();
        mutate(f);
        await assert.rejects(
          build(f.scope, f.payload, candidateImage),
          invalid,
        );
      });
  },
);

test(
  "parse rejects changed request bytes, digest, byte count, handles, scope, image and extra fields",
  { skip: typeof parse !== "function" },
  async (t) => {
    const f = fixture();
    f.canonical.objects[0].geometry.start.x = 20;
    f.rehash();
    const original = await build(f.scope, f.payload, imageId);
    for (const [label, mutate, parsedScope = f.scope] of [
      [
        "request bytes",
        (value) => {
          value.request.text = value.request.text.slice(0, -1);
        },
      ],
      [
        "request digest",
        (value) => {
          value.request.sha256 = "d".repeat(64);
        },
      ],
      [
        "request byte count",
        (value) => {
          value.request.byteSize++;
        },
      ],
      [
        "request handles",
        (value) => {
          value.request.handles = ["2B"];
        },
      ],
      [
        "authority scope",
        (value) => {
          const envelope = JSON.parse(value.authority.text);
          envelope.scope.canvasId = uuid(99);
          value.authority.text = JSON.stringify(envelope);
          value.authority.sha256 = digest(value.authority.text);
          value.authority.byteSize = Buffer.byteLength(value.authority.text);
        },
      ],
      ["parsed scope", () => {}, { ...f.scope, canvasId: uuid(99) }],
      [
        "image",
        (value) => {
          value.resaverImageId = "sha256:" + "d".repeat(64);
        },
      ],
      [
        "root extra field",
        (value) => {
          value.actorId = uuid(90);
        },
      ],
      [
        "request extra field",
        (value) => {
          value.request.path = "private";
        },
      ],
    ])
      await t.test(label, () => {
        const changed = structuredClone(original);
        mutate(changed);
        assert.throws(() => parse(changed, parsedScope), invalid);
      });
  },
);

test(
  "parse rejects noncanonical request and authority encodings even when outer metadata is rehashed",
  { skip: typeof parse !== "function" },
  async () => {
    const f = fixture();
    f.canonical.objects[0].geometry.start.x = 20;
    f.rehash();
    const original = await build(f.scope, f.payload, imageId);

    const reorderedRequest = structuredClone(original);
    reorderedRequest.request.text = JSON.stringify(
      reverseKeys(JSON.parse(reorderedRequest.request.text)),
    );
    reorderedRequest.request.sha256 = digest(reorderedRequest.request.text);
    reorderedRequest.request.byteSize = Buffer.byteLength(
      reorderedRequest.request.text,
    );
    const requestEnvelope = JSON.parse(reorderedRequest.authority.text);
    Object.assign(requestEnvelope.request, {
      sha256: reorderedRequest.request.sha256,
      byteSize: reorderedRequest.request.byteSize,
    });
    reorderedRequest.authority.text = JSON.stringify(requestEnvelope);
    reorderedRequest.authority.sha256 = digest(reorderedRequest.authority.text);
    reorderedRequest.authority.byteSize = Buffer.byteLength(
      reorderedRequest.authority.text,
    );
    assert.throws(() => parse(reorderedRequest, f.scope), invalid);

    const reorderedAuthority = structuredClone(original);
    reorderedAuthority.authority.text = JSON.stringify(
      reverseKeys(JSON.parse(reorderedAuthority.authority.text)),
    );
    reorderedAuthority.authority.sha256 = digest(
      reorderedAuthority.authority.text,
    );
    reorderedAuthority.authority.byteSize = Buffer.byteLength(
      reorderedAuthority.authority.text,
    );
    assert.throws(() => parse(reorderedAuthority, f.scope), invalid);

    const extraAuthority = structuredClone(original);
    const extraEnvelope = JSON.parse(extraAuthority.authority.text);
    extraEnvelope.actorId = uuid(90);
    extraAuthority.authority.text = JSON.stringify(extraEnvelope);
    extraAuthority.authority.sha256 = digest(extraAuthority.authority.text);
    extraAuthority.authority.byteSize = Buffer.byteLength(
      extraAuthority.authority.text,
    );
    assert.throws(() => parse(extraAuthority, f.scope), invalid);
  },
);
