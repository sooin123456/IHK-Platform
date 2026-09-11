import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { NativeDrawingDwgSourceSchema } from "./drawing-native-dwg-import.server.ts";

const REQUEST_BYTES = 2 * 1024 * 1024;
const REPORT_BYTES = 1024 * 1024;
const DWG_BYTES = 200 * 1024 * 1024;
const Source = NativeDrawingDwgSourceSchema.extend({
  byteSize: z.number().int().min(6).max(DWG_BYTES),
}).strict();
const Handle = z.string().regex(/^[1-9A-F][0-9A-F]{0,15}$/);
const Handles = z
  .array(Handle)
  .min(1)
  .max(10_000)
  .refine((handles) => new Set(handles).size === handles.length);
const RequestIdentity = z
  .object({
    schemaVersion: z.literal("1hk-dwg-edits/2"),
    sha256: Source.shape.sha256,
    byteSize: z.number().int().min(1).max(REQUEST_BYTES),
    handles: Handles,
  })
  .strict();

export const NativeDrawingDwgResaveReportSchema = z
  .object({
    schemaVersion: z.literal("1hk-dwg-resave/1"),
    qualification: z.literal("experimental-unqualified"),
    persistenceAuthority: z.literal("not-issued"),
    source: Source,
    request: RequestIdentity,
    output: Source,
    engine: z
      .object({ name: z.literal("ACadSharp"), version: z.literal("3.7.1") })
      .strict(),
    verification: z
      .object({
        noEditRoundTrip: z.literal("passed"),
        selectedEditRoundTrip: z.literal("passed"),
        geometryTolerance: z.literal(1e-9),
        inventoriedEntityCount: z.number().int().min(1).max(10_000),
        editedEntityCount: z.number().int().min(1).max(10_000),
        inventoryCoverage: z.literal("supported-fields-only"),
        independentCad: z.literal("not-performed"),
      })
      .strict(),
  })
  .strict()
  .refine(
    (report) =>
      report.source.headerVersion === report.output.headerVersion &&
      report.verification.editedEntityCount === report.request.handles.length &&
      report.verification.editedEntityCount <=
        report.verification.inventoriedEntityCount,
  );

// Only host metadata is interpreted here. Exact bytes go to the native v2
// validator, which enforces duplicate keys, eligible targets and full geometry.
const RequestMetadata = z
  .object({
    schemaVersion: z.literal("1hk-dwg-edits/2"),
    sourceSha256: Source.shape.sha256,
    coordinateSystem: z.literal("WCS_NATIVE_UNITS"),
    edits: z
      .array(
        z
          .object({
            handle: Handle,
            type: z.enum(["LINE", "LWPOLYLINE", "CIRCLE", "ARC", "TEXT"]),
          })
          .passthrough(),
      )
      .min(1)
      .max(10_000),
  })
  .strict();

function requireCondition(condition: unknown): asserts condition {
  if (!condition) throw new Error("Invalid native DWG resave protocol.");
}
function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
function json(bytes: Uint8Array): unknown {
  // ignoreBOM preserves the BOM, causing JSON.parse to reject it.
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
  );
}

/** Validates and snapshots synchronously, with no source/request concatenation. */
export function encodeNativeDrawingDwgResaveInput(input: {
  sourceBytes: Uint8Array;
  expectedSource: unknown;
  requestBytes: Uint8Array;
  expectedRequestSha256: string;
}) {
  const source = Object.freeze(Source.parse(input.expectedSource));
  const expectedRequestSha256 = Source.shape.sha256.parse(
    input.expectedRequestSha256,
  );
  requireCondition(
    input.sourceBytes instanceof Uint8Array &&
      input.requestBytes instanceof Uint8Array,
  );
  requireCondition(
    input.sourceBytes.byteLength === source.byteSize &&
      input.requestBytes.byteLength >= 1 &&
      input.requestBytes.byteLength <= REQUEST_BYTES,
  );
  const sourceSnapshot = Buffer.from(input.sourceBytes);
  const requestSnapshot = Buffer.from(input.requestBytes);
  requireCondition(
    sha256(sourceSnapshot) === source.sha256 &&
      sourceSnapshot
        .subarray(0, 6)
        .equals(Buffer.from(source.headerVersion, "ascii")),
  );
  requireCondition(sha256(requestSnapshot) === expectedRequestSha256);
  const metadata = RequestMetadata.parse(json(requestSnapshot));
  requireCondition(metadata.sourceSha256 === source.sha256);
  const request = RequestIdentity.parse({
    schemaVersion: metadata.schemaVersion,
    sha256: expectedRequestSha256,
    byteSize: requestSnapshot.length,
    handles: metadata.edits.map((edit) => edit.handle),
  });
  Object.freeze(request.handles);
  Object.freeze(request);
  const header = Buffer.alloc(16);
  header.write("1HKRSV01", 0, "ascii");
  header.writeUInt32BE(requestSnapshot.length, 8);
  header.writeUInt32BE(sourceSnapshot.length, 12);
  return { chunks: [header, requestSnapshot, sourceSnapshot], source, request };
}

/** Exact EOF, independent output identity and strict unqualified report. */
export function decodeNativeDrawingDwgResaveOutput(
  bytes: Uint8Array,
  expected: {
    source: z.infer<typeof Source>;
    request: z.infer<typeof RequestIdentity>;
  },
) {
  requireCondition(
    bytes instanceof Uint8Array &&
      bytes.byteLength >= 16 &&
      bytes.byteLength <= 16 + REPORT_BYTES + DWG_BYTES,
  );
  const frame = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  requireCondition(
    frame.subarray(0, 8).equals(Buffer.from("1HKRSO01", "ascii")),
  );
  const reportLength = frame.readUInt32BE(8);
  const dwgLength = frame.readUInt32BE(12);
  requireCondition(
    reportLength >= 1 &&
      reportLength <= REPORT_BYTES &&
      dwgLength >= 6 &&
      dwgLength <= DWG_BYTES &&
      frame.length === 16 + reportLength + dwgLength,
  );
  const reportBytes = frame.subarray(16, 16 + reportLength);
  const dwgBytes = frame.subarray(16 + reportLength);
  const report = NativeDrawingDwgResaveReportSchema.parse(json(reportBytes));
  requireCondition(
    isDeepStrictEqual(report.source, Source.parse(expected.source)) &&
      isDeepStrictEqual(
        report.request,
        RequestIdentity.parse(expected.request),
      ),
  );
  requireCondition(
    report.output.byteSize === dwgLength &&
      report.output.sha256 === sha256(dwgBytes) &&
      dwgBytes
        .subarray(0, 6)
        .equals(Buffer.from(report.output.headerVersion, "ascii")),
  );
  return { report, reportBytes, dwgBytes };
}
