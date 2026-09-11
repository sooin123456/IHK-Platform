import { z } from "zod";

import { projectFileKinds } from "~/lukas/lib/drawing-entry";

const normalizedFilename = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => value === value.trim());

export const uploadVerificationIdSchema = z.string().uuid();

const dwgHeaderVersion = z
  .string()
  .length(6)
  .regex(/^AC[0-9]{4}$/)
  .nullish();

export const verifiedProjectUploadSchema = z
  .object({
    actor_id: z.string().uuid(),
    byte_size: z
      .number()
      .int()
      .positive()
      .max(200 * 1024 * 1024),
    consumed_file_id: z.string().uuid().nullable(),
    content_type: z.string().max(255),
    dwg_header_version: dwgHeaderVersion,
    expires_at: z.string().datetime({ offset: true }),
    id: z.string().uuid(),
    kind: z.enum(projectFileKinds),
    original_filename: normalizedFilename,
    project_id: z.string().uuid(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    storage_path: z.string().min(1).max(1024),
  })
  .refine(
    (value) =>
      value.kind === "dwg"
        ? value.dwg_header_version != null
        : value.dwg_header_version == null,
    {
      path: ["dwg_header_version"],
      message: "DWG header evidence must match the file kind.",
    },
  );

export const finalizedProjectUploadSchema = z
  .object({
    byteSize: z
      .number()
      .int()
      .positive()
      .max(200 * 1024 * 1024),
    contentType: z.string().max(255),
    dwgHeaderVersion,
    fileId: z.string().uuid(),
    kind: z.enum(projectFileKinds),
    originalFilename: normalizedFilename,
    previousByteSize: z.number().int().nonnegative().nullable(),
    previousFileId: z.string().uuid().nullable(),
    previousSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    previousStoragePath: z.string().min(1).max(1024).nullable(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    storagePath: z.string().min(1).max(1024),
  })
  .refine(
    (value) =>
      value.kind === "dwg"
        ? value.dwgHeaderVersion != null
        : value.dwgHeaderVersion == null,
    {
      path: ["dwgHeaderVersion"],
      message: "DWG header evidence must match the file kind.",
    },
  );

export type FinalizedProjectUpload = z.infer<
  typeof finalizedProjectUploadSchema
>;
