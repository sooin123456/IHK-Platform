import { z } from "zod";

import {
  DRAWING_CAD_IMPORT_PLAN_LIMITS,
  buildDrawingCadImportPlanPhases,
} from "./drawing-cad-import-plan.server.ts";
import {
  NativeDrawingDwgImportReportSchema,
  projectNativeDrawingDwgImport,
  type NativeDrawingDwgImportReport,
  type NativeDrawingDwgImportResult,
  type NativeDrawingDwgImportWarning,
  type NativeDrawingDwgUnitSelection,
} from "./drawing-native-dwg-import.server.ts";
import {
  DrawingObjectSourceSchema,
  type DrawingObject,
  type DrawingObjectSource,
  type DrawingOperationInput,
  type DrawingStructureLayer,
} from "./drawing-workspace.types.ts";

const InputIdentitySchema = z
  .object({
    analysisJobId: z.string().uuid(),
    reportSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
const encoder = new TextEncoder();

export type DrawingNativeDwgEntitySource = Extract<
  DrawingObjectSource,
  { sourceKind: "dwg_entity" }
>;

export type NativeDrawingDwgImportPlanInput = {
  report: unknown;
  expectedSource: unknown;
  revisionId: string;
  canvasId: string;
  sourceFileId: string;
  unitOverride?: NativeDrawingDwgUnitSelection;
  analysisJobId: string;
  reportSha256: string;
};

export type NativeDrawingDwgImportPlan = {
  requestId: string;
  sourceSha256: string;
  units: NativeDrawingDwgImportResult["units"];
  layers: DrawingStructureLayer[];
  objects: DrawingObject[];
  sources: DrawingNativeDwgEntitySource[];
  operations: DrawingOperationInput[];
  coverage: NativeDrawingDwgImportReport["coverage"];
  warnings: NativeDrawingDwgImportWarning[];
  qualification: "experimental-unqualified";
  persistenceAuthority: "not-issued";
};

export class DrawingNativeDwgImportPlanError extends Error {
  readonly code: "invalid" | "empty" | "oversized";

  constructor(code: DrawingNativeDwgImportPlanError["code"]) {
    super(`Native DWG canonical import plan is ${code}.`);
    this.name = "DrawingNativeDwgImportPlanError";
    this.code = code;
  }
}

export function buildNativeDrawingDwgImportPlan(
  input: NativeDrawingDwgImportPlanInput,
): NativeDrawingDwgImportPlan {
  let report: NativeDrawingDwgImportReport;
  let projected: NativeDrawingDwgImportResult;
  let identity: z.infer<typeof InputIdentitySchema>;
  try {
    identity = InputIdentitySchema.parse({
      analysisJobId: input.analysisJobId,
      reportSha256: input.reportSha256,
    });
    report = NativeDrawingDwgImportReportSchema.parse(input.report);
    projected = projectNativeDrawingDwgImport(input);
  } catch {
    throw new DrawingNativeDwgImportPlanError("invalid");
  }
  if (projected.objects.length === 0)
    throw new DrawingNativeDwgImportPlanError("empty");

  const layerNames = new Map(
    report.layers.map((layer) => [layer.handle, layer.name]),
  );
  let sources: DrawingNativeDwgEntitySource[];
  try {
    sources = projected.bindings.map((binding, index) => {
      const entity = report.entities[index];
      const object = projected.objects[index];
      if (
        !entity ||
        !object ||
        binding.objectId !== object.id ||
        binding.handle !== entity.handle ||
        binding.ownerHandle !== entity.ownerHandle ||
        binding.entityType !== entity.type
      )
        throw new Error("Native DWG projector lineage is inconsistent.");
      return DrawingObjectSourceSchema.parse({
        id: binding.id,
        objectId: binding.objectId,
        revisionId: input.revisionId,
        sourceFileId: input.sourceFileId,
        sourceSha256: projected.source.sha256,
        sourceKind: "dwg_entity",
        analysisJobId: identity.analysisJobId,
        reportSha256: identity.reportSha256,
        handle: entity.handle,
        ownerHandle: entity.ownerHandle,
        layerHandle: entity.layerHandle,
        entityType: entity.type,
        sourceLayer: layerNames.get(entity.layerHandle),
        unitCode: projected.units.code,
        unitSource: projected.units.source,
        importerVersion: 1,
        version: 1,
      }) as DrawingNativeDwgEntitySource;
    });
  } catch {
    throw new DrawingNativeDwgImportPlanError("invalid");
  }
  if (sources.length !== projected.objects.length)
    throw new DrawingNativeDwgImportPlanError("invalid");

  let phases: ReturnType<typeof buildDrawingCadImportPlanPhases>;
  try {
    phases = buildDrawingCadImportPlanPhases({
      requestId: projected.requestId,
      revisionId: input.revisionId,
      historyKind: "dwg_import",
      layers: projected.layers,
      records: projected.objects.map((object, index) => ({
        object,
        source: sources[index],
      })),
    });
  } catch {
    throw new DrawingNativeDwgImportPlanError("oversized");
  }
  if (phases.operations.length > DRAWING_CAD_IMPORT_PLAN_LIMITS.maxOperations)
    throw new DrawingNativeDwgImportPlanError("oversized");

  const plan: NativeDrawingDwgImportPlan = {
    requestId: projected.requestId,
    sourceSha256: projected.source.sha256,
    units: projected.units,
    layers: phases.layers,
    objects: projected.objects,
    sources,
    operations: phases.operations,
    coverage: projected.coverage,
    warnings: projected.warnings,
    qualification: "experimental-unqualified",
    persistenceAuthority: "not-issued",
  };
  if (
    encoder.encode(JSON.stringify(plan)).byteLength >
    DRAWING_CAD_IMPORT_PLAN_LIMITS.maxSerializedBytes
  )
    throw new DrawingNativeDwgImportPlanError("oversized");
  return plan;
}
