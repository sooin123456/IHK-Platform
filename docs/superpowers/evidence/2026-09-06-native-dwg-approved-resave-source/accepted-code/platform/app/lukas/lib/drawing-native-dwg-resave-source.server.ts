import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import { hydrateDrawingAuthoritySnapshot } from "./drawing-authority-snapshot.server.ts";
import { NativeDrawingDwgScopeSchema } from "./drawing-native-dwg-jobs.server.ts";
import {
  NativeDrawingDwgImportScopeSchema,
  NativeDrawingDwgImportResultSchema,
} from "./drawing-native-dwg-import-jobs.server.ts";
import { buildNativeDrawingDwgImportPlan } from "./drawing-native-dwg-import-plan.server.ts";
import { projectNativeDrawingDwgImport } from "./drawing-native-dwg-import.server.ts";
import { buildNativeDrawingDwgSelectedEdits } from "./drawing-native-dwg-selected-edits.server.ts";

const Uuid = z.string().uuid();
const PayloadSchema = z
  .object({
    approved: z
      .object({
        projectId: Uuid,
        documentId: Uuid,
        canvasId: Uuid,
        revision: z
          .object({
            id: Uuid,
            sequence: z.number().int().positive().safe(),
            version: z.number().int().positive().safe(),
            status: z.enum(["approved", "superseded"]),
          })
          .strict(),
        snapshot: z
          .object({
            sha256: z.string().regex(/^[0-9a-f]{64}$/),
            schemaVersion: z.literal(2),
            operationSequence: z.number().int().nonnegative().safe(),
            canonicalJsonText: z.string(),
          })
          .strict(),
        approvalDecision: z.literal("approved"),
      })
      .strict(),
    analysis: z
      .object({
        scope: NativeDrawingDwgImportScopeSchema,
        result: NativeDrawingDwgImportResultSchema,
      })
      .strict(),
  })
  .strict();
const units = {
  1: { code: 1, label: "in" },
  2: { code: 2, label: "ft" },
  4: { code: 4, label: "mm" },
  5: { code: 5, label: "cm" },
  6: { code: 6, label: "m" },
} as const;

export class DrawingNativeDwgResaveSourceError extends Error {
  readonly code = "NATIVE_DWG_RESAVE_SOURCE_UNAVAILABLE";
  constructor() {
    super("Approved DWG resave source is unavailable.");
    this.name = "DrawingNativeDwgResaveSourceError";
  }
}

export async function projectApprovedNativeDrawingDwgResaveSource(
  rawRequest: unknown,
  rawPayload: unknown,
) {
  try {
    const scope = NativeDrawingDwgScopeSchema.parse(rawRequest);
    const { approved, analysis } = PayloadSchema.parse(rawPayload);
    const receipt = analysis.result.receipt;
    if (
      approved.projectId !== scope.projectId ||
      approved.documentId !== scope.documentId ||
      approved.canvasId !== scope.canvasId ||
      approved.revision.id !== scope.revisionId ||
      approved.revision.version !== scope.revisionVersion ||
      approved.snapshot.sha256 !== scope.snapshotSha256 ||
      analysis.scope.projectId !== scope.projectId ||
      analysis.scope.sourceFileId !== receipt.source.fileId ||
      analysis.scope.sourceSha256 !== receipt.source.sha256 ||
      Buffer.byteLength(approved.snapshot.canonicalJsonText, "utf8") >
        20 * 1024 * 1024 ||
      createHash("sha256")
        .update(approved.snapshot.canonicalJsonText, "utf8")
        .digest("hex") !== scope.snapshotSha256
    )
      throw new DrawingNativeDwgResaveSourceError();
    const isClone = analysis.scope.revisionId !== scope.revisionId;
    if (
      !isClone &&
      (analysis.scope.documentId !== scope.documentId ||
        analysis.scope.canvasId !== scope.canvasId)
    )
      throw new DrawingNativeDwgResaveSourceError();
    const { state } = hydrateDrawingAuthoritySnapshot({
      projectId: scope.projectId,
      documentId: scope.documentId,
      revision: approved.revision,
      snapshot: {
        sha256: scope.snapshotSha256,
        schemaVersion: 2,
        operationSequence: approved.snapshot.operationSequence,
        canonicalJson: JSON.parse(approved.snapshot.canonicalJsonText),
      },
    });
    const structure = state.structure!;
    const pages = Object.values(structure.pages),
      canvases = Object.values(structure.canvases);
    if (
      pages.length !== 1 ||
      canvases.length !== 1 ||
      canvases[0].id !== scope.canvasId ||
      canvases[0].background !== null ||
      Object.keys(structure.blocks).length ||
      Object.keys(structure.blockInstances).length
    )
      throw new DrawingNativeDwgResaveSourceError();
    const importInput = {
      report: JSON.parse(analysis.result.reportText),
      expectedSource: {
        sha256: receipt.source.sha256,
        byteSize: receipt.source.byteSize,
        headerVersion: receipt.source.headerVersion,
      },
      revisionId: scope.revisionId,
      canvasId: scope.canvasId,
      sourceFileId: receipt.source.fileId,
      ...(analysis.scope.unitOverride === null
        ? {}
        : { unitOverride: units[analysis.scope.unitOverride] }),
      analysisJobId: receipt.jobId,
      reportSha256: receipt.reportSha256,
    };
    const plan = buildNativeDrawingDwgImportPlan(importInput);
    const baseline = projectNativeDrawingDwgImport(importInput);
    const objects = Object.values(structure.objects),
      sources = Object.values(structure.sources ?? {}),
      layers = Object.values(structure.layers);
    if (
      objects.length !== plan.objects.length ||
      sources.length !== objects.length
    )
      throw new DrawingNativeDwgResaveSourceError();
    // Layer IDs change on clone. Bind all imported layers by their full native
    // semantics, including empty native layers, before adapting object IDs.
    const layerIds = new Map<string, string>();
    for (const nativeLayer of plan.layers) {
      const matches = layers.filter(
        (layer) =>
          layer.name === nativeLayer.name && layer.systemKind === "custom",
      );
      if (matches.length !== 1) throw new DrawingNativeDwgResaveSourceError();
      const current = matches[0];
      if (
        !isDeepStrictEqual(
          {
            ...current,
            id: isClone ? nativeLayer.id : current.id,
            version: nativeLayer.version,
          },
          nativeLayer,
        ) ||
        current.version < nativeLayer.version
      )
        throw new DrawingNativeDwgResaveSourceError();
      layerIds.set(current.id, nativeLayer.id);
    }
    if (
      layers.some(
        (layer) =>
          !layerIds.has(layer.id) &&
          (layer.systemKind === "custom" ||
            objects.some((object) => object.layerId === layer.id)),
      )
    )
      throw new DrawingNativeDwgResaveSourceError();
    const byHandle = new Map(
      plan.sources.map((source) => [source.handle, source]),
    );
    const seenHandles = new Set<string>(),
      seenObjects = new Set<string>();
    const bindings: Array<{ objectId: string; handle: string }> = [];
    const boundCanonicalObjects = sources.map((source) => {
      if (source.sourceKind !== "dwg_entity")
        throw new DrawingNativeDwgResaveSourceError();
      const expected = byHandle.get(source.handle);
      const object = structure.objects[source.objectId];
      if (
        !expected ||
        !object ||
        seenHandles.has(source.handle) ||
        seenObjects.has(source.objectId) ||
        source.version < expected.version ||
        !isDeepStrictEqual(
          {
            ...source,
            id: isClone ? expected.id : source.id,
            objectId: isClone ? expected.objectId : source.objectId,
            version: expected.version,
          },
          expected,
        )
      )
        throw new DrawingNativeDwgResaveSourceError();
      seenHandles.add(source.handle);
      seenObjects.add(source.objectId);
      bindings.push({ objectId: object.id, handle: source.handle });
      const projected = baseline.objects.find(
        (candidate) => candidate.id === expected.objectId,
      )!;
      if (layerIds.get(object.layerId) !== projected.layerId)
        throw new DrawingNativeDwgResaveSourceError();
      return isClone
        ? { ...object, id: expected.objectId, layerId: projected.layerId }
        : object;
    });
    bindings.sort((a, b) =>
      BigInt(`0x${a.handle}`) < BigInt(`0x${b.handle}`) ? -1 : 1,
    );
    const selectedEdits = buildNativeDrawingDwgSelectedEdits({
      importInput,
      objects: boundCanonicalObjects,
    });
    return {
      scope,
      approved: {
        revisionId: scope.revisionId,
        revisionVersion: scope.revisionVersion,
        snapshotSha256: scope.snapshotSha256,
        operationSequence: approved.snapshot.operationSequence,
      },
      analysisReceipt: receipt,
      bindings,
      selectedEdits,
    };
  } catch {
    throw new DrawingNativeDwgResaveSourceError();
  }
}

export async function loadApprovedNativeDrawingDwgResaveSource(
  client: { rpc: unknown },
  rawRequest: unknown,
) {
  try {
    const scope = NativeDrawingDwgScopeSchema.parse(rawRequest);
    if (typeof client?.rpc !== "function")
      throw new DrawingNativeDwgResaveSourceError();
    const response = await Reflect.apply(client.rpc, client, [
      "lukas_qto_drawing_native_dwg_resave_source",
      { p_scope: scope },
    ]);
    if (!response || response.error)
      throw new DrawingNativeDwgResaveSourceError();
    return await projectApprovedNativeDrawingDwgResaveSource(
      scope,
      response.data,
    );
  } catch {
    throw new DrawingNativeDwgResaveSourceError();
  }
}
