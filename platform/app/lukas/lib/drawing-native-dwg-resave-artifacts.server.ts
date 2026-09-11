import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { NativeDrawingDwgScopeSchema } from "./drawing-native-dwg-jobs.server.ts";
import { buildNativeDrawingDwgResaveAttestation } from "./drawing-native-dwg-resave-attestation.server.ts";
import { parseNativeDrawingDwgResaveClaim } from "./drawing-native-dwg-resave-jobs.server.ts";
import { decodeNativeDrawingDwgResaveOutput } from "./drawing-native-dwg-resave-protocol.server.ts";

import {
  NATIVE_DWG_RESAVE_ARTIFACT_LIMITS,
  NativeDrawingDwgResaveArtifactKindSchema,
  NativeDrawingDwgResaveReceiptSchema,
  NativeDrawingDwgResaveArtifactMetadataSchema as ArtifactMetadataSchema,
  NativeDrawingDwgResaveArtifactMetadataArraySchema as ArtifactMetadataArraySchema,
  type NativeDrawingDwgResaveArtifactKind,
} from "./drawing-native-dwg-resave-contract.ts";
export {
  NATIVE_DWG_RESAVE_ARTIFACT_LIMITS,
  NativeDrawingDwgResaveArtifactKindSchema,
  NativeDrawingDwgResaveReceiptSchema,
  type NativeDrawingDwgResaveArtifactKind,
} from "./drawing-native-dwg-resave-contract.ts";
const Uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const AttemptNumber = z.number().int().min(1).max(3);
const ScopeSchema = NativeDrawingDwgScopeSchema.transform((scope) => ({
  ...scope,
  projectId: scope.projectId.toLowerCase(),
  documentId: scope.documentId.toLowerCase(),
  revisionId: scope.revisionId.toLowerCase(),
  canvasId: scope.canvasId.toLowerCase(),
}));
const filenames: Record<NativeDrawingDwgResaveArtifactKind, string> = {
  dwg: "resaved.dwg",
  edit_request: "edit-request.json",
  authority: "authority.json",
  report: "native-report.json",
};
const artifactOrder = NativeDrawingDwgResaveArtifactKindSchema.options;

const ManagedPath = z.string().min(1).max(1_000);
const StagedArtifactSchema = z
  .object({
    kind: NativeDrawingDwgResaveArtifactKindSchema,
    sha256: Sha256,
    byteSize: z.number().int().positive().safe(),
    path: ManagedPath,
  })
  .strict();
const StagedSchema = z
  .object({
    jobId: Uuid,
    attemptNumber: AttemptNumber,
    leaseToken: Uuid,
    uploadState: z.enum(["open", "closed"]),
    artifacts: z.array(StagedArtifactSchema).length(4),
  })
  .strict();

const ManagedPathPattern = new RegExp(
  "^projects/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/" +
    "native-dwg-resave/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/" +
    "([1-3])/([0-9a-f]{64})/([^/]+)$",
);

export const NativeDrawingDwgResaveDescriptorSchema = z
  .object({
    jobId: Uuid,
    attemptNumber: AttemptNumber,
    kind: NativeDrawingDwgResaveArtifactKindSchema,
    bucket: z.literal("lukas-qto"),
    path: ManagedPath,
    sha256: Sha256,
    byteSize: z.number().int().positive().safe(),
  })
  .strict()
  .superRefine((descriptor, context) => {
    const metadata = ArtifactMetadataSchema.safeParse({
      kind: descriptor.kind,
      sha256: descriptor.sha256,
      byteSize: descriptor.byteSize,
    });
    const match = ManagedPathPattern.exec(descriptor.path);
    if (
      !metadata.success ||
      !match ||
      match[2] !== descriptor.jobId ||
      Number(match[3]) !== descriptor.attemptNumber ||
      match[4] !== descriptor.sha256 ||
      match[5] !== filenames[descriptor.kind]
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["path"],
        message: "Invalid managed native DWG resave artifact path.",
      });
  });

type Claim = ReturnType<typeof parseNativeDrawingDwgResaveClaim>;
export type NativeDrawingDwgResaveArtifactMetadata = z.infer<
  typeof ArtifactMetadataSchema
>;

const ResultSchema = z
  .object({
    report: z.unknown(),
    reportBytes: z.custom<Uint8Array>((value) => value instanceof Uint8Array),
    dwgBytes: z.custom<Uint8Array>((value) => value instanceof Uint8Array),
  })
  .strict();

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function outputFrame(reportBytes: Uint8Array, dwgBytes: Uint8Array) {
  const header = Buffer.alloc(16);
  header.write("1HKRSO01", 0, "ascii");
  header.writeUInt32BE(reportBytes.byteLength, 8);
  header.writeUInt32BE(dwgBytes.byteLength, 12);
  return Buffer.concat([header, reportBytes, dwgBytes]);
}

/** Snapshots the claim and result synchronously before rebuilding authority. */
export async function buildNativeDrawingDwgResaveArtifacts(
  rawClaim: unknown,
  rawResult: unknown,
  imageId: unknown,
): Promise<{
  claim: Claim;
  bytesByKind: Record<NativeDrawingDwgResaveArtifactKind, Buffer>;
  metadata: NativeDrawingDwgResaveArtifactMetadata[];
}> {
  const claim = parseNativeDrawingDwgResaveClaim(rawClaim, imageId);
  const result = ResultSchema.parse(rawResult);
  const report = structuredClone(result.report);
  const reportBytes = Buffer.from(result.reportBytes);
  const dwgBytes = Buffer.from(result.dwgBytes);
  const rebuilt = await buildNativeDrawingDwgResaveAttestation(
    claim.scope,
    claim.payload,
    imageId,
  );
  if (!rebuilt.request || !isDeepStrictEqual(rebuilt, claim.attestation))
    throw new Error("Invalid native DWG resave artifact authority.");
  const verified = decodeNativeDrawingDwgResaveOutput(
    outputFrame(reportBytes, dwgBytes),
    {
      source: {
        sha256: claim.source.sha256,
        byteSize: claim.source.byteSize,
        headerVersion: claim.source.headerVersion,
      },
      request: {
        schemaVersion: "1hk-dwg-edits/2",
        sha256: rebuilt.request.sha256,
        byteSize: rebuilt.request.byteSize,
        handles: rebuilt.request.handles,
      },
    },
  );
  if (!isDeepStrictEqual(verified.report, report))
    throw new Error("Invalid native DWG resave report identity.");

  const bytesByKind = {
    dwg: Buffer.from(verified.dwgBytes),
    edit_request: Buffer.from(rebuilt.request.text, "utf8"),
    authority: Buffer.from(rebuilt.authority.text, "utf8"),
    report: Buffer.from(verified.reportBytes),
  };
  const metadata = ArtifactMetadataArraySchema.parse(
    artifactOrder.map((kind) => ({
      kind,
      sha256: sha256(bytesByKind[kind]),
      byteSize: bytesByKind[kind].byteLength,
    })),
  );
  return { claim, bytesByKind, metadata };
}

export function nativeDrawingDwgResaveArtifactPath(
  rawScope: unknown,
  rawJobId: unknown,
  rawAttemptNumber: unknown,
  rawMetadata: unknown,
) {
  const scope = ScopeSchema.parse(rawScope);
  const jobId = Uuid.parse(rawJobId);
  const attemptNumber = AttemptNumber.parse(rawAttemptNumber);
  const metadata = ArtifactMetadataSchema.parse(rawMetadata);
  return `projects/${scope.projectId}/native-dwg-resave/${jobId}/${attemptNumber}/${metadata.sha256}/${filenames[metadata.kind]}`;
}

export function validateNativeDrawingDwgResaveStagedArtifacts(
  raw: unknown,
  claim: Claim,
  rawMetadata: unknown,
) {
  const metadata = ArtifactMetadataArraySchema.parse(rawMetadata);
  const staged = StagedSchema.parse(raw);
  if (
    staged.jobId !== claim.jobId.toLowerCase() ||
    staged.attemptNumber !== claim.attemptNumber ||
    staged.leaseToken !== claim.leaseToken.toLowerCase()
  )
    throw new Error("Native DWG resave stage identity changed.");
  for (let index = 0; index < artifactOrder.length; index += 1) {
    const artifact = staged.artifacts[index];
    const expected = metadata[index];
    if (
      !isDeepStrictEqual(
        {
          kind: artifact.kind,
          sha256: artifact.sha256,
          byteSize: artifact.byteSize,
        },
        expected,
      ) ||
      artifact.path !==
        nativeDrawingDwgResaveArtifactPath(
          claim.scope,
          claim.jobId,
          claim.attemptNumber,
          expected,
        )
    )
      throw new Error("Native DWG resave stage artifacts changed.");
  }
  return staged;
}

export function validateNativeDrawingDwgResaveReceipt(
  raw: unknown,
  claim: Claim,
  rawMetadata: unknown,
) {
  const metadata = ArtifactMetadataArraySchema.parse(rawMetadata);
  const receipt = NativeDrawingDwgResaveReceiptSchema.parse(raw);
  const scope = ScopeSchema.parse(claim.scope);
  if (
    receipt.jobId !== claim.jobId.toLowerCase() ||
    receipt.attemptNumber !== claim.attemptNumber ||
    !isDeepStrictEqual(receipt.scope, scope) ||
    receipt.resaverImageId !== claim.attestation.resaverImageId ||
    receipt.sourceSha256 !== claim.source.sha256 ||
    !isDeepStrictEqual(receipt.artifacts, metadata)
  )
    throw new Error("Native DWG resave receipt identity changed.");
  return receipt;
}
