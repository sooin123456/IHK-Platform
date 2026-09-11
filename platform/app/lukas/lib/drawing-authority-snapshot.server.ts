import { z } from "zod";

import {
  hydrateDrawingDocumentState,
  type DrawingDocumentHydration,
} from "./drawing-document-store.ts";
import { parseDrawingWorkspaceCollaborationBootstrap } from "./drawing-workspace.server.ts";

const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const SafePositiveInteger = z.number().int().positive().safe();
const SafeNonNegativeInteger = z.number().int().nonnegative().safe();
const FrozenRevisionStatus = z.enum([
  "review_requested",
  "reviewed",
  "approved",
  "superseded",
]);

const DrawingAuthoritySnapshotSchema = z
  .object({
    projectId: Uuid,
    documentId: Uuid,
    revision: z
      .object({
        id: Uuid,
        sequence: SafePositiveInteger,
        version: SafePositiveInteger,
        status: FrozenRevisionStatus,
      })
      .strict(),
    snapshot: z
      .object({
        sha256: Sha256,
        schemaVersion: z.literal(2),
        operationSequence: SafeNonNegativeInteger,
        canonicalJson: z.unknown(),
      })
      .strict(),
  })
  .strict();

const CanonicalLayerLineageSchema = z
  .object({ id: Uuid, pageId: Uuid })
  .passthrough();
const CanonicalObjectLineageSchema = z
  .object({
    id: Uuid,
    lineageId: Uuid,
    pageId: Uuid,
    type: z.string().min(1),
  })
  .passthrough();
const CanonicalIssueSchema = z.object({ id: Uuid, objectId: Uuid }).strict();

function withoutFields(values: unknown[], fields: readonly string[]) {
  return values.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return value;
    const projected = { ...(value as Record<string, unknown>) };
    for (const field of fields) delete projected[field];
    return projected;
  });
}

function invalidDrawingAuthoritySnapshot(): Error {
  return new Error("Drawing authority snapshot is invalid.");
}

export function hydrateDrawingAuthoritySnapshot(input: unknown) {
  try {
    const authority = DrawingAuthoritySnapshotSchema.parse(input);
    const bootstrap = parseDrawingWorkspaceCollaborationBootstrap({
      canonicalJson: authority.snapshot.canonicalJson,
      operationSequence: authority.snapshot.operationSequence,
      schemaVersion: authority.snapshot.schemaVersion,
      sha256: authority.snapshot.sha256,
      revisionStatus: authority.revision.status,
      capability: "viewer",
      canWrite: false,
      recentOutcomes: [],
    });
    const canonicalJson = bootstrap.canonicalJson;
    if (
      canonicalJson.revision.id !== authority.revision.id ||
      canonicalJson.revision.documentId !== authority.documentId ||
      canonicalJson.revision.projectId !== authority.projectId ||
      canonicalJson.revision.sequence !== authority.revision.sequence ||
      canonicalJson.revision.version !== authority.revision.version ||
      bootstrap.operationSequence !== authority.snapshot.operationSequence
    )
      throw invalidDrawingAuthoritySnapshot();
    const state = hydrateDrawingDocumentState({
      revisionId: canonicalJson.revision.id,
      pages: canonicalJson.pages as DrawingDocumentHydration["pages"],
      canvases: canonicalJson.canvases as DrawingDocumentHydration["canvases"],
      layers: withoutFields(canonicalJson.layers, [
        "pageId",
      ]) as DrawingDocumentHydration["layers"],
      objects: withoutFields(canonicalJson.objects, [
        "lineageId",
        "pageId",
        "type",
      ]) as DrawingDocumentHydration["objects"],
      sources: canonicalJson.sources as DrawingDocumentHydration["sources"],
      styles: canonicalJson.styles as DrawingDocumentHydration["styles"],
      blocks: canonicalJson.blocks as DrawingDocumentHydration["blocks"],
      blockInstances:
        canonicalJson.blockInstances as DrawingDocumentHydration["blockInstances"],
      propertySchemas:
        canonicalJson.propertySchemas as DrawingDocumentHydration["propertySchemas"],
      propertyValues:
        canonicalJson.propertyValues as DrawingDocumentHydration["propertyValues"],
      tables: canonicalJson.tables as DrawingDocumentHydration["tables"],
    });
    const structure = state.structure;
    if (!structure) throw invalidDrawingAuthoritySnapshot();
    for (const value of canonicalJson.layers) {
      const canonical = CanonicalLayerLineageSchema.parse(value);
      const layer = structure.layers[canonical.id];
      const canvas = layer?.canvasId ? structure.canvases[layer.canvasId] : null;
      if (!canvas || canonical.pageId !== canvas.pageId)
        throw invalidDrawingAuthoritySnapshot();
    }
    for (const value of canonicalJson.objects) {
      const canonical = CanonicalObjectLineageSchema.parse(value);
      const object = structure.objects[canonical.id];
      const layer = object ? structure.layers[object.layerId] : null;
      const canvas = layer?.canvasId ? structure.canvases[layer.canvasId] : null;
      if (
        !object ||
        !canvas ||
        canonical.pageId !== canvas.pageId ||
        canonical.type !== object.geometry.type
      )
        throw invalidDrawingAuthoritySnapshot();
    }
    const issuePairs = canonicalJson.issues.map((value) => {
      const issue = CanonicalIssueSchema.parse(value);
      if (!structure.objects[issue.objectId])
        throw invalidDrawingAuthoritySnapshot();
      return `${issue.id}:${issue.objectId}`;
    });
    if (new Set(issuePairs).size !== issuePairs.length)
      throw invalidDrawingAuthoritySnapshot();
    return { state, canonicalJson };
  } catch {
    throw invalidDrawingAuthoritySnapshot();
  }
}
