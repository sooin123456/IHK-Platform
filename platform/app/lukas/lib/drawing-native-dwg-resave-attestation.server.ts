import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { NativeDrawingDwgScopeSchema } from "./drawing-native-dwg-jobs.server.ts";
import {
  NativeDrawingDwgImportReceiptSchema,
  NativeDrawingDwgImportScopeSchema,
} from "./drawing-native-dwg-import-jobs.server.ts";
import {
  NativeDrawingDwgResaveSourcePayloadSchema,
  projectApprovedNativeDrawingDwgResaveSource,
} from "./drawing-native-dwg-resave-source.server.ts";

const MAXIMUM_REQUEST_BYTES = 2 * 1024 * 1024;
const MAXIMUM_AUTHORITY_BYTES = 64 * 1024 * 1024;
const UuidText =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const ResaverImageId = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const PositiveSafeInteger = z.number().int().positive().safe();
const NativeHandle = z.string().regex(/^[1-9A-F][0-9A-F]{0,15}$/);
const NativePoint = z.tuple([z.number(), z.number(), z.number()]);

const NativeLineEditSchema = z
  .object({
    handle: NativeHandle,
    type: z.literal("LINE"),
    start: NativePoint,
    end: NativePoint,
  })
  .strict();
const NativePolylineEditSchema = z
  .object({
    handle: NativeHandle,
    type: z.literal("LWPOLYLINE"),
    points: z.array(NativePoint),
    closed: z.boolean(),
  })
  .strict();
const NativeCircleEditSchema = z
  .object({
    handle: NativeHandle,
    type: z.literal("CIRCLE"),
    center: NativePoint,
    radius: z.number(),
  })
  .strict();
const NativeArcEditSchema = z
  .object({
    handle: NativeHandle,
    type: z.literal("ARC"),
    center: NativePoint,
    radius: z.number(),
    startAngleRadians: z.number(),
    endAngleRadians: z.number(),
  })
  .strict();
const NativeTextEditSchema = z
  .object({
    handle: NativeHandle,
    type: z.literal("TEXT"),
    insert: NativePoint,
    height: z.number(),
    text: z.string(),
  })
  .strict();
const NativeRequestSchema = z
  .object({
    schemaVersion: z.literal("1hk-dwg-edits/2"),
    sourceSha256: Sha256,
    coordinateSystem: z.literal("WCS_NATIVE_UNITS"),
    edits: z
      .array(
        z.discriminatedUnion("type", [
          NativeLineEditSchema,
          NativePolylineEditSchema,
          NativeCircleEditSchema,
          NativeArcEditSchema,
          NativeTextEditSchema,
        ]),
      )
      .min(1)
      .max(10_000),
  })
  .strict();
const RequestIdentitySchema = z
  .object({
    sha256: Sha256,
    byteSize: PositiveSafeInteger.max(MAXIMUM_REQUEST_BYTES),
    handles: z.array(NativeHandle).min(1).max(10_000),
  })
  .strict();
const RequestAttestationSchema = z
  .object({
    text: z.string().min(1),
    sha256: Sha256,
    byteSize: PositiveSafeInteger.max(MAXIMUM_REQUEST_BYTES),
    handles: z.array(NativeHandle).min(1).max(10_000),
  })
  .strict();
const AuthorityEnvelopeSchema = z
  .object({
    schemaVersion: z.literal("1hk-dwg-resave-authority/1"),
    scope: NativeDrawingDwgScopeSchema,
    approved: z
      .object({
        revisionId: z.string().uuid(),
        revisionVersion: PositiveSafeInteger,
        snapshotSha256: Sha256,
        operationSequence: z.number().int().nonnegative().safe(),
      })
      .strict(),
    analysis: z
      .object({
        scope: NativeDrawingDwgImportScopeSchema,
        receipt: NativeDrawingDwgImportReceiptSchema,
      })
      .strict(),
    bindings: z
      .array(
        z
          .object({ objectId: z.string().uuid(), handle: NativeHandle })
          .strict(),
      )
      .max(10_000),
    request: RequestIdentitySchema.nullable(),
    resaverImageId: ResaverImageId,
    snapshotCanonicalJsonText: z.string().min(1),
    qualification: z.literal("experimental-unqualified"),
  })
  .strict();

export const NativeDrawingDwgResaveAttestationSchema = z
  .object({
    resaverImageId: ResaverImageId,
    request: RequestAttestationSchema.nullable(),
    authority: z
      .object({
        text: z.string().min(1),
        sha256: Sha256,
        byteSize: PositiveSafeInteger.max(MAXIMUM_AUTHORITY_BYTES),
      })
      .strict(),
  })
  .strict();

export type NativeDrawingDwgResaveAttestation = z.infer<
  typeof NativeDrawingDwgResaveAttestationSchema
>;

export class NativeDrawingDwgResaveAttestationError extends Error {
  readonly kind = "invalid" as const;

  constructor() {
    super("Invalid native DWG resave attestation.");
    this.name = "NativeDrawingDwgResaveAttestationError";
  }
}

function invalid(): never {
  throw new NativeDrawingDwgResaveAttestationError();
}

function sha256(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function lowercaseUuidValues<T>(value: T): T {
  if (typeof value === "string")
    return (UuidText.test(value) ? value.toLowerCase() : value) as T;
  if (Array.isArray(value))
    return value.map((item) => lowercaseUuidValues(item)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        lowercaseUuidValues(item),
      ]),
    ) as T;
  return value;
}

function numericHandlesAreCanonical(handles: string[]) {
  const seen = new Set<string>();
  let previous: bigint | null = null;
  for (const handle of handles) {
    const numeric = BigInt(`0x${handle}`);
    if (seen.has(handle) || (previous !== null && numeric <= previous))
      return false;
    seen.add(handle);
    previous = numeric;
  }
  return true;
}

export async function buildNativeDrawingDwgResaveAttestation(
  rawScope: unknown,
  rawPayload: unknown,
  rawImageId: unknown,
): Promise<NativeDrawingDwgResaveAttestation> {
  try {
    const scope = lowercaseUuidValues(
      NativeDrawingDwgScopeSchema.parse(rawScope),
    );
    const payload = lowercaseUuidValues(
      NativeDrawingDwgResaveSourcePayloadSchema.parse(rawPayload),
    );
    const resaverImageId = ResaverImageId.parse(rawImageId);
    const projected = await projectApprovedNativeDrawingDwgResaveSource(
      scope,
      payload,
    );
    const requestValue = projected.selectedEdits.request;
    const request = requestValue
      ? (() => {
          const text = JSON.stringify(requestValue);
          return {
            text,
            sha256: sha256(text),
            byteSize: Buffer.byteLength(text, "utf8"),
            handles: requestValue.edits.map((edit) => edit.handle),
          };
        })()
      : null;
    const authorityText = JSON.stringify({
      schemaVersion: "1hk-dwg-resave-authority/1",
      scope: projected.scope,
      approved: projected.approved,
      analysis: {
        scope: payload.analysis.scope,
        receipt: projected.analysisReceipt,
      },
      bindings: projected.bindings,
      request: request
        ? {
            sha256: request.sha256,
            byteSize: request.byteSize,
            handles: request.handles,
          }
        : null,
      resaverImageId,
      snapshotCanonicalJsonText: payload.approved.snapshot.canonicalJsonText,
      qualification: "experimental-unqualified",
    });
    return parseNativeDrawingDwgResaveAttestation(
      {
        resaverImageId,
        request,
        authority: {
          text: authorityText,
          sha256: sha256(authorityText),
          byteSize: Buffer.byteLength(authorityText, "utf8"),
        },
      },
      scope,
    );
  } catch {
    invalid();
  }
}

export function parseNativeDrawingDwgResaveAttestation(
  raw: unknown,
  rawScope: unknown,
): NativeDrawingDwgResaveAttestation {
  try {
    const scope = lowercaseUuidValues(
      NativeDrawingDwgScopeSchema.parse(rawScope),
    );
    const attestation = NativeDrawingDwgResaveAttestationSchema.parse(raw);
    const authorityBytes = Buffer.byteLength(
      attestation.authority.text,
      "utf8",
    );
    if (
      authorityBytes > MAXIMUM_AUTHORITY_BYTES ||
      authorityBytes !== attestation.authority.byteSize ||
      sha256(attestation.authority.text) !== attestation.authority.sha256
    )
      invalid();
    const authority = AuthorityEnvelopeSchema.parse(
      JSON.parse(attestation.authority.text) as unknown,
    );
    if (
      JSON.stringify(authority) !== attestation.authority.text ||
      !isDeepStrictEqual(lowercaseUuidValues(authority), authority) ||
      !isDeepStrictEqual(authority.scope, scope) ||
      authority.approved.revisionId !== scope.revisionId ||
      authority.approved.revisionVersion !== scope.revisionVersion ||
      authority.approved.snapshotSha256 !== scope.snapshotSha256 ||
      authority.analysis.scope.projectId !== scope.projectId ||
      authority.analysis.scope.sourceFileId !==
        authority.analysis.receipt.source.fileId ||
      authority.analysis.scope.sourceSha256 !==
        authority.analysis.receipt.source.sha256 ||
      authority.resaverImageId !== attestation.resaverImageId ||
      sha256(authority.snapshotCanonicalJsonText) !== scope.snapshotSha256
    )
      invalid();

    const bindingHandles = authority.bindings.map(({ handle }) => handle);
    if (
      !numericHandlesAreCanonical(bindingHandles) ||
      new Set(authority.bindings.map(({ objectId }) => objectId)).size !==
        authority.bindings.length
    )
      invalid();

    if (attestation.request === null) {
      if (authority.request !== null) invalid();
    } else {
      const requestBytes = Buffer.byteLength(attestation.request.text, "utf8");
      if (
        requestBytes > MAXIMUM_REQUEST_BYTES ||
        requestBytes !== attestation.request.byteSize ||
        sha256(attestation.request.text) !== attestation.request.sha256
      )
        invalid();
      const request = NativeRequestSchema.parse(
        JSON.parse(attestation.request.text) as unknown,
      );
      const handles = request.edits.map(({ handle }) => handle);
      const identity = {
        sha256: attestation.request.sha256,
        byteSize: attestation.request.byteSize,
        handles: attestation.request.handles,
      };
      if (
        JSON.stringify(request) !== attestation.request.text ||
        !numericHandlesAreCanonical(handles) ||
        !isDeepStrictEqual(handles, attestation.request.handles) ||
        !isDeepStrictEqual(identity, authority.request) ||
        request.sourceSha256 !== authority.analysis.receipt.source.sha256 ||
        handles.some((handle) => !bindingHandles.includes(handle))
      )
        invalid();
    }
    return attestation;
  } catch {
    invalid();
  }
}
