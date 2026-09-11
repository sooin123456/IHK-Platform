import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceBytes = Buffer.from("AC1024original");
const source = {
  sha256: sha(sourceBytes),
  byteSize: 14,
  headerVersion: "AC1024",
};
const requestJson = {
  schemaVersion: "1hk-dwg-edits/2",
  sourceSha256: source.sha256,
  coordinateSystem: "WCS_NATIVE_UNITS",
  edits: [{ handle: "4A", type: "LINE", start: [1, 2, 0], end: [3, 4, 0] }],
};
const requestBytes = Buffer.from(JSON.stringify(requestJson));
const request = {
  schemaVersion: "1hk-dwg-edits/2",
  sha256: sha(requestBytes),
  byteSize: requestBytes.length,
  handles: ["4A"],
};
const dwgBytes = Buffer.from("AC1024resaved");
const report = {
  schemaVersion: "1hk-dwg-resave/1",
  qualification: "experimental-unqualified",
  persistenceAuthority: "not-issued",
  source,
  request,
  output: {
    sha256: sha(dwgBytes),
    byteSize: dwgBytes.length,
    headerVersion: "AC1024",
  },
  engine: { name: "ACadSharp", version: "3.7.1" },
  verification: {
    noEditRoundTrip: "passed",
    selectedEditRoundTrip: "passed",
    geometryTolerance: 1e-9,
    inventoriedEntityCount: 9,
    editedEntityCount: 1,
    inventoryCoverage: "supported-fields-only",
    independentCad: "not-performed",
  },
};
// Deliberately independent wire fixture; never calls the production encoder.
function frame(reportValue = report, output = dwgBytes) {
  const bytes = Buffer.isBuffer(reportValue)
    ? reportValue
    : Buffer.from(JSON.stringify(reportValue));
  const header = Buffer.from([
    49, 72, 75, 82, 83, 79, 48, 49, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  header.writeUInt32BE(bytes.length, 8);
  header.writeUInt32BE(output.length, 12);
  return Buffer.concat([header, bytes, output]);
}
async function api() {
  const mod = await import(
    "../app/lukas/lib/drawing-native-dwg-resave-protocol.server.ts"
  ).catch(() => ({}));
  for (const name of [
    "NativeDrawingDwgResaveReportSchema",
    "encodeNativeDrawingDwgResaveInput",
    "decodeNativeDrawingDwgResaveOutput",
  ])
    assert.ok(mod[name], `Required protocol API absent: ${name}`);
  return mod;
}
const input = () => ({
  sourceBytes: Buffer.from(sourceBytes),
  expectedSource: { ...source },
  requestBytes: Buffer.from(requestBytes),
  expectedRequestSha256: request.sha256,
});

test("encoder snapshots exact bytes with a literal big endian 16 byte header and frozen identities", async () => {
  const { encodeNativeDrawingDwgResaveInput: encode } = await api();
  const supplied = input();
  const result = encode(supplied);
  const header = Buffer.from([
    49, 72, 75, 82, 83, 86, 48, 49, 0, 0, 0, 0, 0, 0, 0, 14,
  ]);
  header.writeUInt32BE(requestBytes.length, 8);
  assert.equal(result.chunks.length, 3);
  assert.deepEqual(result.chunks[0], header);
  assert.deepEqual(result.source, source);
  assert.deepEqual(result.request, request);
  supplied.sourceBytes.fill(0);
  supplied.requestBytes.fill(0);
  supplied.expectedSource.sha256 = "0".repeat(64);
  assert.deepEqual(result.chunks[1], requestBytes);
  assert.deepEqual(result.chunks[2], sourceBytes);
  assert.ok(Object.isFrozen(result.source));
  assert.ok(Object.isFrozen(result.request));
  assert.ok(Object.isFrozen(result.request.handles));
});

test("encoder rejects unbound source, malformed metadata, handles, types, UTF8, BOM and bounded lengths", async () => {
  const { encodeNativeDrawingDwgResaveInput: encode } = await api();
  const wrongRequests = [
    { ...requestJson, schemaVersion: "1hk-dwg-edits/1" },
    { ...requestJson, sourceSha256: "0".repeat(64) },
    { ...requestJson, coordinateSystem: "other" },
    { ...requestJson, extra: true },
    { ...requestJson, edits: [] },
    ...["0", "04A", "4a", "10000000000000000"].map((handle) => ({
      ...requestJson,
      edits: [{ ...requestJson.edits[0], handle }],
    })),
    { ...requestJson, edits: [requestJson.edits[0], requestJson.edits[0]] },
    { ...requestJson, edits: [{ handle: "4A", type: "INSERT" }] },
    {
      ...requestJson,
      edits: Array.from({ length: 10001 }, () => requestJson.edits[0]),
    },
    null,
    [],
  ];
  for (const bad of wrongRequests) {
    const bytes = Buffer.from(JSON.stringify(bad));
    assert.throws(() =>
      encode({
        ...input(),
        requestBytes: bytes,
        expectedRequestSha256: sha(bytes),
      }),
    );
  }
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.alloc(2 * 1024 * 1024 + 1),
    Buffer.from([255]),
    Buffer.concat([Buffer.from([239, 187, 191]), requestBytes]),
    Buffer.from("{}x"),
  ])
    assert.throws(() =>
      encode({
        ...input(),
        requestBytes: bytes,
        expectedRequestSha256: sha(bytes),
      }),
    );
  for (const change of [
    { expectedSource: { ...source, sha256: "0".repeat(64) } },
    { expectedSource: { ...source, byteSize: 6 } },
    { expectedSource: { ...source, extra: true } },
    { expectedRequestSha256: "0".repeat(64) },
    { expectedRequestSha256: request.sha256.toUpperCase() },
    { sourceBytes: new Uint8Array(5) },
    { sourceBytes: Buffer.from("AC1032original") },
    { sourceBytes: [] },
    { requestBytes: [] },
  ])
    assert.throws(() => encode({ ...input(), ...change }));
});

test("encoder preserves native geometry and duplicate-key validation bytes without reserialization", async () => {
  const { encodeNativeDrawingDwgResaveInput: encode } = await api();
  const bytes = Buffer.from(
    JSON.stringify(requestJson).replace(
      '"start":[1,2,0]',
      '"start":[1,2,0],"start":[0,0,0]',
    ),
  );
  const result = encode({
    ...input(),
    requestBytes: bytes,
    expectedRequestSha256: sha(bytes),
  });
  assert.deepEqual(result.chunks[1], bytes);
});

test("decoder accepts strict literal success frame and exact output identities", async () => {
  const { decodeNativeDrawingDwgResaveOutput: decode } = await api();
  const result = decode(frame(), { source, request });
  assert.deepEqual(result.report, report);
  assert.deepEqual(result.dwgBytes, dwgBytes);
  assert.deepEqual(result.reportBytes, Buffer.from(JSON.stringify(report)));
  assert.equal(result.report.persistenceAuthority, "not-issued");
});

test("decoder rejects malformed framing, UTF8/BOM, lengths, altered DWG and trailing bytes", async () => {
  const { decodeNativeDrawingDwgResaveOutput: decode } = await api();
  const good = frame();
  const wrongMagic = Buffer.from(good);
  wrongMagic[7] = 50;
  const wrongLength = Buffer.from(good);
  wrongLength.writeUInt32LE(10, 8);
  const zero = Buffer.from(good);
  zero.writeUInt32BE(0, 8);
  const huge = Buffer.from(good);
  huge.writeUInt32BE(200 * 1024 * 1024 + 1, 12);
  const changed = Buffer.from(good);
  changed[changed.length - 1] ^= 1;
  for (const bad of [
    Buffer.alloc(0),
    good.subarray(0, 15),
    good.subarray(0, -1),
    Buffer.concat([good, Buffer.from([0])]),
    wrongMagic,
    wrongLength,
    zero,
    huge,
    changed,
    frame(Buffer.from([255])),
    frame(
      Buffer.concat([
        Buffer.from([239, 187, 191]),
        Buffer.from(JSON.stringify(report)),
      ]),
    ),
    frame(report, Buffer.from("AC1032resaved")),
    frame(
      {
        ...report,
        output: {
          ...report.output,
          headerVersion: "AC1032",
          sha256: sha(Buffer.from("AC1032resaved")),
        },
      },
      Buffer.from("AC1032resaved"),
    ),
  ])
    assert.throws(() => decode(bad, { source, request }));
});

test("decoder rejects extra shape, changed bindings, handle order/count and authority-bearing status", async () => {
  const {
    decodeNativeDrawingDwgResaveOutput: decode,
    NativeDrawingDwgResaveReportSchema: schema,
  } = await api();
  const changes = [
    { extra: true },
    { schemaVersion: "1hk-dwg-resave/2" },
    { qualification: "qualified" },
    { persistenceAuthority: "issued" },
    { source: { ...source, sha256: "0".repeat(64) } },
    { source: { ...source, byteSize: 5 } },
    { request: { ...request, sha256: "0".repeat(64) } },
    { request: { ...request, byteSize: request.byteSize + 1 } },
    { request: { ...request, handles: ["4B"] } },
    { request: { ...request, handles: ["4A", "4A"] } },
    { request: { ...request, handles: ["4a"] } },
    { request: { ...request, extra: true } },
    { output: { ...report.output, byteSize: dwgBytes.length + 1 } },
    { engine: { ...report.engine, version: "3.7.2" } },
    ...[
      { noEditRoundTrip: "failed" },
      { selectedEditRoundTrip: "failed" },
      { independentCad: "passed" },
      { inventoryCoverage: "complete" },
      { geometryTolerance: 1e-8 },
      { editedEntityCount: 2 },
      { inventoriedEntityCount: 0 },
      { inventoriedEntityCount: 10001 },
      { extra: true },
    ].map((v) => ({ verification: { ...report.verification, ...v } })),
  ];
  for (const change of changes)
    assert.throws(() =>
      decode(frame({ ...report, ...change }), { source, request }),
    );
  assert.equal(
    schema.safeParse({
      ...report,
      verification: { ...report.verification, editedEntityCount: 2 },
    }).success,
    false,
  );
  const ordered = { ...request, handles: ["4A", "4B"] };
  assert.throws(() =>
    decode(
      frame({
        ...report,
        request: { ...ordered, handles: ["4B", "4A"] },
        verification: { ...report.verification, editedEntityCount: 2 },
      }),
      { source, request: ordered },
    ),
  );
});
