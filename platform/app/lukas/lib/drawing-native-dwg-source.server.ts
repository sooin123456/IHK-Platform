import { createHash } from "node:crypto";

import { z } from "zod";

import { hydrateDrawingAuthoritySnapshot } from "./drawing-authority-snapshot.server.ts";
import { buildDrawingCadManifest } from "./drawing-cad-projection.ts";

const MAX_CANONICAL_JSON_BYTES = 20 * 1024 * 1024;
const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const SafePositiveInteger = z.number().int().positive().safe();
const SafeNonNegativeInteger = z.number().int().nonnegative().safe();

const ApprovedNativeDrawingCadSourceRequestSchema = z
  .object({
    projectId: Uuid,
    documentId: Uuid,
    revisionId: Uuid,
    revisionVersion: SafePositiveInteger,
    canvasId: Uuid,
    snapshotSha256: Sha256,
  })
  .strict();

const ApprovedNativeDrawingCadSourcePayloadSchema = z
  .object({
    projectId: Uuid,
    documentId: Uuid,
    canvasId: Uuid,
    revision: z
      .object({
        id: Uuid,
        sequence: SafePositiveInteger,
        version: SafePositiveInteger,
        status: z.enum(["approved", "superseded"]),
      })
      .strict(),
    snapshot: z
      .object({
        sha256: Sha256,
        schemaVersion: z.literal(2),
        operationSequence: SafeNonNegativeInteger,
        canonicalJsonText: z.string(),
      })
      .strict(),
    approvalDecision: z.literal("approved"),
  })
  .strict();

export class DrawingNativeDwgSourceError extends Error {
  readonly code = "NATIVE_DWG_SOURCE_UNAVAILABLE";

  constructor() {
    super("Approved native DWG source is unavailable.");
    this.name = "DrawingNativeDwgSourceError";
  }
}

function unavailable(): DrawingNativeDwgSourceError {
  return new DrawingNativeDwgSourceError();
}

function compareId(a: { id: string }, b: { id: string }) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export async function projectApprovedNativeDrawingCadSource(
  rawRequest: unknown,
  rawPayload: unknown,
) {
  try {
    const request = ApprovedNativeDrawingCadSourceRequestSchema.parse(rawRequest);
    const payload = ApprovedNativeDrawingCadSourcePayloadSchema.parse(rawPayload);
    if (
      payload.projectId !== request.projectId ||
      payload.documentId !== request.documentId ||
      payload.canvasId !== request.canvasId ||
      payload.revision.id !== request.revisionId ||
      payload.revision.version !== request.revisionVersion ||
      payload.snapshot.sha256 !== request.snapshotSha256
    )
      throw unavailable();

    const canonicalJsonBytes = Buffer.byteLength(
      payload.snapshot.canonicalJsonText,
      "utf8",
    );
    if (canonicalJsonBytes > MAX_CANONICAL_JSON_BYTES) throw unavailable();
    const recomputedSnapshotSha256 = createHash("sha256")
      .update(payload.snapshot.canonicalJsonText, "utf8")
      .digest("hex");
    if (recomputedSnapshotSha256 !== payload.snapshot.sha256)
      throw unavailable();

    const canonicalJson = JSON.parse(payload.snapshot.canonicalJsonText);
    const { state, canonicalJson: validatedCanonicalJson } =
      hydrateDrawingAuthoritySnapshot({
        projectId: payload.projectId,
        documentId: payload.documentId,
        revision: payload.revision,
        snapshot: {
          sha256: payload.snapshot.sha256,
          schemaVersion: payload.snapshot.schemaVersion,
          operationSequence: payload.snapshot.operationSequence,
          canonicalJson,
        },
      });
    const canvas = state.structure?.canvases[request.canvasId];
    if (!canvas?.outputProfile) throw unavailable();
    const structure = { revisionId: state.revisionId, ...state.structure };
    const manifest = await buildDrawingCadManifest({
      projectId: request.projectId,
      documentId: request.documentId,
      operationSequence: payload.snapshot.operationSequence,
      canvasId: request.canvasId,
      structure,
      outputProfile: canvas.outputProfile,
    });
    const layers = validatedCanonicalJson.layers as Array<{
      id: string;
      pageId: string;
    }>;
    const objects = validatedCanonicalJson.objects as Array<{
      id: string;
      lineageId: string;
      pageId: string;
      type: string;
    }>;
    const issues = validatedCanonicalJson.issues as Array<{
      id: string;
      objectId: string;
    }>;

    return {
      manifest,
      authority: {
        projectId: request.projectId,
        documentId: request.documentId,
        revisionId: request.revisionId,
        revisionSequence: payload.revision.sequence,
        revisionVersion: request.revisionVersion,
        operationSequence: payload.snapshot.operationSequence,
        canvasId: request.canvasId,
        snapshotSha256: request.snapshotSha256,
        schemaVersion: 2 as const,
        approvalDecision: "approved" as const,
        revisionStatus: payload.revision.status,
        lineage: {
          layers: layers
            .map(({ id, pageId }) => ({ id, pageId }))
            .sort(compareId),
          objects: objects
            .map(({ id, lineageId, pageId, type }) => ({
              id,
              lineageId,
              pageId,
              type,
            }))
            .sort(compareId),
          issues: issues
            .map(({ id, objectId }) => ({ id, objectId }))
            .sort((a, b) => compareId(a, b) || (a.objectId < b.objectId ? -1 : a.objectId > b.objectId ? 1 : 0)),
        },
      },
    };
  } catch {
    throw unavailable();
  }
}

export async function loadApprovedNativeDrawingCadSource(
  client: { rpc: unknown },
  rawRequest: unknown,
) {
  try {
    const request = ApprovedNativeDrawingCadSourceRequestSchema.parse(rawRequest);
    if (typeof client?.rpc !== "function") throw unavailable();
    const { data, error } = await client.rpc(
      "lukas_qto_drawing_native_dwg_source",
      {
        p_project_id: request.projectId,
        p_document_id: request.documentId,
        p_revision_id: request.revisionId,
        p_revision_version: request.revisionVersion,
        p_canvas_id: request.canvasId,
        p_snapshot_sha256: request.snapshotSha256,
      },
    );
    if (error) throw unavailable();
    return await projectApprovedNativeDrawingCadSource(request, data);
  } catch {
    throw unavailable();
  }
}
