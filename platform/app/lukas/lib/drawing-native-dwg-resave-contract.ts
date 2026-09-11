import { z } from "zod";

const Uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const AttemptNumber = z.number().int().min(1).max(3);
export const NativeDrawingDwgResaveScopeSchema = z
  .object({
    projectId: Uuid,
    documentId: Uuid,
    revisionId: Uuid,
    revisionVersion: z.number().int().positive().safe(),
    canvasId: Uuid,
    snapshotSha256: Sha256,
  })
  .strict();
const ScopeSchema = NativeDrawingDwgResaveScopeSchema;
export const NATIVE_DWG_RESAVE_ARTIFACT_LIMITS = Object.freeze({
  dwg: 209715200,
  edit_request: 2097152,
  authority: 67108864,
  report: 1048576,
});

export const NativeDrawingDwgResaveArtifactKindSchema = z.enum([
  "dwg",
  "edit_request",
  "authority",
  "report",
]);
export type NativeDrawingDwgResaveArtifactKind = z.infer<
  typeof NativeDrawingDwgResaveArtifactKindSchema
>;

const artifactOrder = NativeDrawingDwgResaveArtifactKindSchema.options;
const ArtifactMetadataSchema = z
  .object({
    kind: NativeDrawingDwgResaveArtifactKindSchema,
    sha256: Sha256,
    byteSize: z.number().int().positive().safe(),
  })
  .strict()
  .superRefine((artifact, context) => {
    const minimum = artifact.kind === "dwg" ? 6 : 1;
    if (
      artifact.byteSize < minimum ||
      artifact.byteSize > NATIVE_DWG_RESAVE_ARTIFACT_LIMITS[artifact.kind]
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["byteSize"],
        message: "Invalid native DWG resave artifact size.",
      });
  });
const ArtifactMetadataArraySchema = z
  .array(ArtifactMetadataSchema)
  .length(4)
  .superRefine((artifacts, context) => {
    for (let index = 0; index < artifactOrder.length; index += 1)
      if (artifacts[index]?.kind !== artifactOrder[index])
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "kind"],
          message: "Native DWG resave artifacts are not in canonical order.",
        });
  });

export const NativeDrawingDwgResaveReceiptSchema = z
  .object({
    schemaVersion: z.literal("1hk-dwg-resave-receipt/1"),
    jobId: Uuid,
    attemptNumber: AttemptNumber,
    scope: ScopeSchema,
    resaverImageId: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    sourceSha256: Sha256,
    qualification: z.literal("experimental-unqualified"),
    persistenceAuthority: z.literal("not-issued"),
    artifacts: ArtifactMetadataArraySchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

const AcceptanceSchema = z
  .object({ jobId: Uuid, requestId: Uuid, hasChanges: z.boolean() })
  .strict();
const FailureCode = z.enum([
  "source_unavailable",
  "source_mismatch",
  "resaver_failed",
  "output_invalid",
  "worker_interrupted",
  "authority_revoked",
  "upload_failed",
  "publication_failed",
]);
const StatusSchema = AcceptanceSchema.extend({
  status: z.enum([
    "queued",
    "processing",
    "retry_wait",
    "cancel_requested",
    "cancelled",
    "no_changes",
    "failed",
    "completed",
  ]),
  attemptCount: z.number().int().min(0).max(3),
  failureCode: FailureCode.nullable(),
})
  .strict()
  .refine(
    (value) =>
      (value.status === "no_changes") === !value.hasChanges &&
      (value.status !== "no_changes" || value.attemptCount === 0) &&
      (!["processing", "retry_wait", "cancel_requested", "completed"].includes(
        value.status,
      ) ||
        value.attemptCount > 0),
  );

export {
  ArtifactMetadataSchema as NativeDrawingDwgResaveArtifactMetadataSchema,
  ArtifactMetadataArraySchema as NativeDrawingDwgResaveArtifactMetadataArraySchema,
  AcceptanceSchema as NativeDrawingDwgResaveAcceptanceSchema,
  StatusSchema as NativeDrawingDwgResaveStatusSchema,
};
export type NativeDrawingDwgResaveScope = z.infer<
  typeof NativeDrawingDwgResaveScopeSchema
>;
