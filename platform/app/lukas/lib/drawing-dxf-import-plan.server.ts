import { createHash } from "node:crypto";

import { z } from "zod";

import {
  buildDrawingDxfImport,
  type DrawingDxfImportIssue,
  type DrawingDxfImportResult,
  type DrawingDxfUnitSelection,
} from "./drawing-dxf-import.server.ts";
import {
  DRAWING_CAD_IMPORT_PLAN_LIMITS,
  buildDrawingCadImportPlanPhases,
} from "./drawing-cad-import-plan.server.ts";
import {
  DrawingObjectSourceSchema,
  type DrawingObjectSource,
  type DrawingOperationInput,
  type DrawingStructureLayer,
} from "./drawing-workspace.types.ts";

export const DRAWING_DXF_IMPORT_PLAN_LIMITS = DRAWING_CAD_IMPORT_PLAN_LIMITS;

export type DrawingDxfEntitySource = Extract<
  DrawingObjectSource,
  { sourceKind: "dxf_entity" }
>;

export type DrawingDxfImportPlan = Omit<
  DrawingDxfImportResult,
  "operations"
> & {
  requestId: string | null;
  sources: DrawingDxfEntitySource[];
  operations: DrawingOperationInput[];
};

type PlanLimits = typeof DRAWING_DXF_IMPORT_PLAN_LIMITS;
type AdapterInput = Parameters<typeof buildDrawingDxfImport>[0];

const PlanInputSchema = z.object({ sourceFileId: z.string().uuid() }).strict();

const encoder = new TextEncoder();

function deterministicUuid(seed: string) {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function resolvedPlanLimits(overrides: Partial<PlanLimits> | undefined) {
  const limits = { ...DRAWING_DXF_IMPORT_PLAN_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value < 1)
      throw new TypeError(`Invalid DXF import plan limit: ${name}.`);
  return limits;
}

function blockingIssue(code: string, detail: string): DrawingDxfImportIssue {
  return { code, detail };
}

function failedPlan(
  imported: DrawingDxfImportResult,
  issue?: DrawingDxfImportIssue,
): DrawingDxfImportPlan {
  return {
    requestId: null,
    sourceSha256: imported.sourceSha256,
    units: imported.units,
    layers: [],
    objects: [],
    entityLineage: [],
    sources: [],
    operations: [],
    report: {
      imported: 0,
      converted: imported.report.converted,
      skipped: imported.report.skipped,
      blocking: [...imported.report.blocking, ...(issue ? [issue] : [])],
    },
  };
}

export async function buildDrawingDxfImportPlan(input: {
  bytes: Uint8Array;
  revisionId: string;
  canvasId: string;
  sourceFileId: string;
  createdAt: string;
  unitOverride?: DrawingDxfUnitSelection;
  limits?: AdapterInput["limits"];
  now?: AdapterInput["now"];
  planLimits?: Partial<PlanLimits>;
}): Promise<DrawingDxfImportPlan> {
  const { sourceFileId } = PlanInputSchema.parse({
    sourceFileId: input.sourceFileId,
  });
  const planLimits = resolvedPlanLimits(input.planLimits);
  const imported = await buildDrawingDxfImport({
    bytes: input.bytes,
    revisionId: input.revisionId,
    canvasId: input.canvasId,
    createdAt: input.createdAt,
    unitOverride: input.unitOverride,
    limits: input.limits,
    now: input.now,
  });
  if (imported.report.blocking.length > 0) return failedPlan(imported);
  const { sourceSha256, units } = imported;
  if (!sourceSha256 || !units)
    return failedPlan(
      imported,
      blockingIssue(
        "SOURCE_LINEAGE_INCOMPLETE",
        "DXF source SHA 또는 단위를 확정할 수 없습니다.",
      ),
    );

  const unitSeed = `${units.code}:${units.source}`;
  const requestId = deterministicUuid(
    `dxf-import:v1:${input.revisionId}:${input.canvasId}:${sourceFileId}:${sourceSha256}:${unitSeed}`,
  );
  let sources: DrawingDxfEntitySource[];
  try {
    sources = imported.entityLineage.map((lineage) =>
      DrawingObjectSourceSchema.parse({
        id: deterministicUuid(
          `${requestId}:source:${lineage.objectId}:${lineage.entityKey}`,
        ),
        objectId: lineage.objectId,
        revisionId: input.revisionId,
        sourceFileId,
        sourceSha256,
        sourceKind: "dxf_entity",
        entityKey: lineage.entityKey,
        entityType: lineage.entityType,
        sourceLayer: lineage.sourceLayer,
        handle: lineage.rawHandle,
        unitCode: units.code,
        unitSource: units.source,
        importerVersion: 1,
        version: 1,
      }),
    ) as DrawingDxfEntitySource[];
  } catch {
    return failedPlan(
      imported,
      blockingIssue(
        "SOURCE_LINEAGE_INVALID",
        "DXF entity source 계보를 canonical 형식으로 검증할 수 없습니다.",
      ),
    );
  }
  if (
    sources.length !== imported.objects.length ||
    sources.some(
      (source, index) => source.objectId !== imported.objects[index]?.id,
    )
  )
    return failedPlan(
      imported,
      blockingIssue(
        "SOURCE_LINEAGE_MISMATCH",
        "DXF 객체와 source 계보 순서가 일치하지 않습니다.",
      ),
    );

  let operations: DrawingOperationInput[];
  let finalLayers: DrawingStructureLayer[];
  try {
    const phased = buildDrawingCadImportPlanPhases({
      requestId,
      revisionId: input.revisionId,
      historyKind: "dxf_import",
      layers: imported.layers,
      records: imported.objects.map((object, index) => ({
        object,
        source: sources[index],
      })),
    });
    finalLayers = phased.layers;
    operations = phased.operations;
  } catch {
    return failedPlan(
      imported,
      blockingIssue(
        "PLAN_OPERATION_ITEM_LIMIT",
        "DXF 객체와 source 원자 단위가 협업 operation 한도를 초과했습니다.",
      ),
    );
  }
  if (
    operations.length > planLimits.maxOperations ||
    operations.length > DRAWING_DXF_IMPORT_PLAN_LIMITS.maxOperations
  )
    return failedPlan(
      imported,
      blockingIssue(
        "PLAN_OPERATION_LIMIT",
        "DXF import plan operation 수가 초기 안전 한도를 초과했습니다.",
      ),
    );
  const plan: DrawingDxfImportPlan = {
    requestId,
    sourceSha256,
    units,
    layers: finalLayers,
    objects: imported.objects,
    entityLineage: imported.entityLineage,
    sources,
    operations,
    report: imported.report,
  };
  if (
    encoder.encode(JSON.stringify(plan)).byteLength >
    planLimits.maxSerializedBytes
  )
    return failedPlan(
      imported,
      blockingIssue(
        "PLAN_BYTE_LIMIT",
        "DXF import plan 응답 크기가 초기 안전 한도를 초과했습니다.",
      ),
    );
  return plan;
}
