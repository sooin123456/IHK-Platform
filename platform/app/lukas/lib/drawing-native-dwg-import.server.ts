import { createHash } from "node:crypto";

import { z } from "zod";

import { geometryBounds } from "./drawing-geometry.ts";
import {
  DrawingLayerNameSchema,
  DrawingObjectSchema,
  DrawingStructureLayerSchema,
  type DrawingGeometry,
  type DrawingObject,
  type DrawingStructureLayer,
} from "./drawing-workspace.types.ts";

const MAX_NATIVE_COORDINATE = 999_999_999_999;
const MAX_PROJECTED_COORDINATE_MILLIMETERS = 9_000_000_000;
const MAX_TOTAL_ENTITIES = 10_000;
const MAX_LAYERS = 1_000;
const MAX_VERTICES = 100_000;

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const HeaderVersionSchema = z.string().regex(/^AC[0-9]{4}$/);
const UuidSchema = z.string().uuid();
const CanonicalHandleSchema = z.string().regex(/^[1-9A-F][0-9A-F]{0,15}$/);
const NativeNumberSchema = z
  .number()
  .min(-MAX_NATIVE_COORDINATE)
  .max(MAX_NATIVE_COORDINATE)
  .refine(Number.isFinite, "Native coordinates must be finite.");
const NativePointSchema = z.tuple([
  NativeNumberSchema,
  NativeNumberSchema,
  NativeNumberSchema,
]);
const PositiveNativeNumberSchema = NativeNumberSchema.refine(
  (value) => value > 0,
  "Native sizes must be positive.",
);
const SafeCountSchema = z.number().int().nonnegative().safe();

export const NativeDrawingDwgSourceSchema = z
  .object({
    sha256: Sha256Schema,
    byteSize: z
      .number()
      .int()
      .positive()
      .safe()
      .max(200 * 1024 * 1024),
    headerVersion: HeaderVersionSchema,
  })
  .strict();

const NativeLineEntitySchema = z
  .object({
    handle: CanonicalHandleSchema,
    ownerHandle: CanonicalHandleSchema,
    layerHandle: CanonicalHandleSchema,
    type: z.literal("LINE"),
    geometry: z
      .object({ start: NativePointSchema, end: NativePointSchema })
      .strict()
      .refine(
        ({ start, end }) => start.some((value, index) => value !== end[index]),
        "Native LINE must not have zero length.",
      ),
  })
  .strict();

const NativePolylineEntitySchema = z
  .object({
    handle: CanonicalHandleSchema,
    ownerHandle: CanonicalHandleSchema,
    layerHandle: CanonicalHandleSchema,
    type: z.literal("LWPOLYLINE"),
    geometry: z
      .object({
        points: z.array(NativePointSchema).min(2).max(MAX_VERTICES),
        closed: z.boolean(),
      })
      .strict()
      .refine(
        ({ points }) =>
          points.some((point) =>
            point.some((value, index) => value !== points[0][index]),
          ),
        "Native LWPOLYLINE must contain distinct points.",
      ),
  })
  .strict();

const NativeCircleEntitySchema = z
  .object({
    handle: CanonicalHandleSchema,
    ownerHandle: CanonicalHandleSchema,
    layerHandle: CanonicalHandleSchema,
    type: z.literal("CIRCLE"),
    geometry: z
      .object({
        center: NativePointSchema,
        radius: PositiveNativeNumberSchema,
      })
      .strict(),
  })
  .strict();

const NativeArcEntitySchema = z
  .object({
    handle: CanonicalHandleSchema,
    ownerHandle: CanonicalHandleSchema,
    layerHandle: CanonicalHandleSchema,
    type: z.literal("ARC"),
    geometry: z
      .object({
        center: NativePointSchema,
        radius: PositiveNativeNumberSchema,
        startAngleRadians: NativeNumberSchema,
        endAngleRadians: NativeNumberSchema,
      })
      .strict()
      .refine(({ startAngleRadians, endAngleRadians }) => {
        const sweep = endAngleRadians - startAngleRadians;
        return sweep !== 0 && Math.abs(sweep) <= Math.PI * 2;
      }, "Native ARC must have a nonzero sweep no larger than one full turn."),
  })
  .strict();

function validPlainText(value: string) {
  if (
    value.length === 0 ||
    value.length > 10_000 ||
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value) ||
    value.includes("%%") ||
    value.includes("%<")
  )
    return false;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

const NativeTextEntitySchema = z
  .object({
    handle: CanonicalHandleSchema,
    ownerHandle: CanonicalHandleSchema,
    layerHandle: CanonicalHandleSchema,
    type: z.literal("TEXT"),
    geometry: z
      .object({
        insert: NativePointSchema,
        height: PositiveNativeNumberSchema,
        text: z.string().refine(validPlainText),
      })
      .strict(),
  })
  .strict();

const NativeEntitySchema = z.discriminatedUnion("type", [
  NativeLineEntitySchema,
  NativePolylineEntitySchema,
  NativeCircleEntitySchema,
  NativeArcEntitySchema,
  NativeTextEntitySchema,
]);

const NativeUnsupportedSchema = z
  .object({
    type: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
    reason: z.enum([
      "unsupported_type",
      "unsupported_geometry",
      "unsupported_text",
    ]),
    count: z.number().int().positive().safe(),
    sampleHandles: z.array(CanonicalHandleSchema).max(10),
  })
  .strict();

const NativeDrawingDwgImportReportBaseSchema = z
  .object({
    schemaVersion: z.literal("1hk-dwg-import/1"),
    qualification: z.literal("experimental-unqualified"),
    source: NativeDrawingDwgSourceSchema,
    engine: z
      .object({
        name: z.literal("ACadSharp"),
        version: z.literal("3.7.1"),
      })
      .strict(),
    coordinateSystem: z.literal("WCS_NATIVE_UNITS"),
    unitCode: z.number().int().nonnegative().safe(),
    modelSpaceHandle: CanonicalHandleSchema,
    layers: z
      .array(
        z
          .object({
            handle: CanonicalHandleSchema,
            name: DrawingLayerNameSchema,
            visible: z.boolean(),
            locked: z.boolean(),
          })
          .strict(),
      )
      .max(MAX_LAYERS),
    entities: z.array(NativeEntitySchema).max(MAX_TOTAL_ENTITIES),
    coverage: z
      .object({
        modelSpaceEntities: SafeCountSchema,
        importedEntities: SafeCountSchema,
        unsupportedEntities: SafeCountSchema,
        nonModelSpaceEntities: SafeCountSchema,
      })
      .strict(),
    unsupported: z.array(NativeUnsupportedSchema).max(100),
    readerNotificationCount: SafeCountSchema,
  })
  .strict();

export const NativeDrawingDwgImportReportSchema =
  NativeDrawingDwgImportReportBaseSchema.superRefine((report, context) => {
    const handles = new Set<string>();
    const addHandle = (handle: string, path: Array<string | number>) => {
      if (handles.has(handle))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: "Duplicate native handle identity.",
        });
      handles.add(handle);
    };
    addHandle(report.modelSpaceHandle, ["modelSpaceHandle"]);
    const layerHandles = new Set<string>();
    const layerNames = new Set<string>();
    report.layers.forEach((layer, index) => {
      addHandle(layer.handle, ["layers", index, "handle"]);
      layerHandles.add(layer.handle);
      const canonicalName = layer.name.toLocaleUpperCase("en-US");
      if (layerNames.has(canonicalName))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["layers", index, "name"],
          message: "Duplicate native layer identity.",
        });
      layerNames.add(canonicalName);
    });
    let vertices = 0;
    report.entities.forEach((entity, index) => {
      addHandle(entity.handle, ["entities", index, "handle"]);
      if (entity.ownerHandle !== report.modelSpaceHandle)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entities", index, "ownerHandle"],
          message: "Native entity owner identity is inconsistent.",
        });
      if (!layerHandles.has(entity.layerHandle))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entities", index, "layerHandle"],
          message: "Native entity layer identity is missing.",
        });
      const points =
        entity.type === "LINE"
          ? 2
          : entity.type === "LWPOLYLINE"
            ? entity.geometry.points.length
            : 1;
      vertices += points;
      const zCoordinates =
        entity.type === "LINE"
          ? [entity.geometry.start[2], entity.geometry.end[2]]
          : entity.type === "LWPOLYLINE"
            ? entity.geometry.points.map((point) => point[2])
            : entity.type === "TEXT"
              ? [entity.geometry.insert[2]]
              : [entity.geometry.center[2]];
      if (zCoordinates.some((zCoordinate) => zCoordinate !== 0))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entities", index, "geometry"],
          message: "Native supported geometry must be planar Z=0.",
        });
    });
    if (vertices > MAX_VERTICES)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entities"],
        message: "Native vertex count exceeds the supported limit.",
      });
    let unsupportedCount = 0;
    report.unsupported.forEach((unsupported, groupIndex) => {
      unsupportedCount += unsupported.count;
      if (unsupported.sampleHandles.length > unsupported.count)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["unsupported", groupIndex, "sampleHandles"],
          message: "Unsupported handle samples exceed the exact group count.",
        });
      const samples = new Set<string>();
      unsupported.sampleHandles.forEach((handle, sampleIndex) => {
        if (samples.has(handle) || handles.has(handle))
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["unsupported", groupIndex, "sampleHandles", sampleIndex],
            message: "Duplicate native handle identity.",
          });
        samples.add(handle);
        handles.add(handle);
      });
    });
    if (
      report.coverage.importedEntities !== report.entities.length ||
      report.coverage.unsupportedEntities !== unsupportedCount ||
      report.coverage.modelSpaceEntities !==
        report.coverage.importedEntities + report.coverage.unsupportedEntities
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coverage"],
        message: "Native coverage counts are inconsistent.",
      });
    if (
      report.coverage.modelSpaceEntities +
        report.coverage.nonModelSpaceEntities >
      MAX_TOTAL_ENTITIES
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coverage"],
        message: "Native total entity count exceeds the supported limit.",
      });
  });

export type NativeDrawingDwgImportReport = z.infer<
  typeof NativeDrawingDwgImportReportSchema
>;
export type NativeDrawingDwgSource = z.infer<
  typeof NativeDrawingDwgSourceSchema
>;

const UnitSelectionSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal(1), label: z.literal("in") }).strict(),
  z.object({ code: z.literal(2), label: z.literal("ft") }).strict(),
  z.object({ code: z.literal(4), label: z.literal("mm") }).strict(),
  z.object({ code: z.literal(5), label: z.literal("cm") }).strict(),
  z.object({ code: z.literal(6), label: z.literal("m") }).strict(),
]);

export type NativeDrawingDwgUnitSelection = z.infer<typeof UnitSelectionSchema>;

const unitDefinitions = new Map([
  [1, { label: "in" as const, millimetersPerUnit: 25.4 }],
  [2, { label: "ft" as const, millimetersPerUnit: 304.8 }],
  [4, { label: "mm" as const, millimetersPerUnit: 1 }],
  [5, { label: "cm" as const, millimetersPerUnit: 10 }],
  [6, { label: "m" as const, millimetersPerUnit: 1_000 }],
]);

export type NativeDrawingDwgImportWarning = {
  code: string;
  detail: string;
};

export type NativeDrawingDwgBinding = {
  id: string;
  objectId: string;
  sourceFileId: string;
  sourceSha256: string;
  handle: string;
  ownerHandle: string;
  entityType: NativeDrawingDwgImportReport["entities"][number]["type"];
  nativeGeometry: NativeDrawingDwgImportReport["entities"][number]["geometry"];
};

export type NativeDrawingDwgImportResult = {
  requestId: string;
  source: NativeDrawingDwgSource;
  units: {
    code: 1 | 2 | 4 | 5 | 6;
    label: "in" | "ft" | "mm" | "cm" | "m";
    millimetersPerUnit: number;
    source: "declared" | "user_selected";
  };
  layers: DrawingStructureLayer[];
  objects: DrawingObject[];
  bindings: NativeDrawingDwgBinding[];
  coverage: NativeDrawingDwgImportReport["coverage"];
  warnings: NativeDrawingDwgImportWarning[];
  qualification: "experimental-unqualified";
  persistenceAuthority: "not-issued";
};

function deterministicUuid(domain: string, values: readonly string[]) {
  const digest = createHash("sha256");
  digest.update("1hk-native-dwg-import/1\0", "utf8");
  digest.update(domain, "utf8");
  for (const value of values) {
    digest.update("\0", "utf8");
    digest.update(value, "utf8");
  }
  const bytes = digest.digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeNumber(value: number) {
  if (!Number.isFinite(value))
    throw new Error("Native DWG coordinate is invalid.");
  const normalized = Number(value.toFixed(6));
  const result = Object.is(normalized, -0) ? 0 : normalized;
  if (Math.abs(result) > MAX_PROJECTED_COORDINATE_MILLIMETERS)
    throw new Error("Native DWG coordinate exceeds the projected extent.");
  return result;
}

function scalarCount(value: string) {
  let count = 0;
  for (const _scalar of value) count += 1;
  return count;
}

function projectGeometry(
  entity: NativeDrawingDwgImportReport["entities"][number],
  millimetersPerUnit: number,
): { geometry: DrawingGeometry; fontSize?: number } {
  const point = (value: readonly [number, number, number]) => ({
    x: normalizeNumber(value[0] * millimetersPerUnit),
    y: normalizeNumber(value[1] * millimetersPerUnit),
  });
  switch (entity.type) {
    case "LINE":
      return {
        geometry: {
          type: "line",
          start: point(entity.geometry.start),
          end: point(entity.geometry.end),
        },
      };
    case "LWPOLYLINE":
      return {
        geometry: {
          type: "polyline",
          points: entity.geometry.points.map(point),
          closed: entity.geometry.closed,
        },
      };
    case "CIRCLE":
      return {
        geometry: {
          type: "circle",
          center: point(entity.geometry.center),
          radius: normalizeNumber(entity.geometry.radius * millimetersPerUnit),
        },
      };
    case "ARC": {
      const radians =
        entity.geometry.endAngleRadians - entity.geometry.startAngleRadians;
      let sweepRadians =
        ((radians % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (sweepRadians === 0) sweepRadians = Math.PI * 2;
      return {
        geometry: {
          type: "arc",
          semanticVersion: 1,
          center: point(entity.geometry.center),
          radius: normalizeNumber(entity.geometry.radius * millimetersPerUnit),
          startAngleDegrees: normalizeNumber(
            ((((entity.geometry.startAngleRadians * 180) / Math.PI) % 360) +
              360) %
              360,
          ),
          sweepAngleDegrees: normalizeNumber((sweepRadians * 180) / Math.PI),
        },
      };
    }
    case "TEXT": {
      const fontSize = normalizeNumber(
        entity.geometry.height * millimetersPerUnit,
      );
      return {
        geometry: {
          type: "text",
          origin: point(entity.geometry.insert),
          width: normalizeNumber(
            Math.max(
              fontSize,
              scalarCount(entity.geometry.text) * fontSize * 0.6,
            ),
          ),
          text: entity.geometry.text,
        },
        fontSize,
      };
    }
  }
}

function assertProjectedBounds(geometry: DrawingGeometry) {
  const bounds = geometryBounds(geometry);
  const extrema = [
    bounds.x,
    bounds.y,
    bounds.x + bounds.width,
    bounds.y + bounds.height,
  ];
  if (
    extrema.some(
      (value) =>
        !Number.isFinite(value) ||
        Math.abs(value) > MAX_PROJECTED_COORDINATE_MILLIMETERS,
    )
  )
    throw new Error(
      "Native DWG projected extent exceeds the coordinate limit.",
    );
}

export function projectNativeDrawingDwgImport(input: {
  report: unknown;
  expectedSource: unknown;
  revisionId: string;
  canvasId: string;
  sourceFileId: string;
  unitOverride?: NativeDrawingDwgUnitSelection;
}): NativeDrawingDwgImportResult {
  const report = NativeDrawingDwgImportReportSchema.parse(input.report);
  const expectedSource = NativeDrawingDwgSourceSchema.parse(
    input.expectedSource,
  );
  const revisionId = UuidSchema.parse(input.revisionId);
  const canvasId = UuidSchema.parse(input.canvasId);
  const sourceFileId = UuidSchema.parse(input.sourceFileId);
  const unitOverride = input.unitOverride
    ? UnitSelectionSchema.parse(input.unitOverride)
    : undefined;
  if (
    report.source.sha256 !== expectedSource.sha256 ||
    report.source.byteSize !== expectedSource.byteSize ||
    report.source.headerVersion !== expectedSource.headerVersion
  )
    throw new Error(
      "Native DWG source identity does not match expected source.",
    );

  const declared = unitDefinitions.get(report.unitCode);
  if (declared && unitOverride && unitOverride.code !== report.unitCode)
    throw new Error("Native DWG declared unit cannot be overridden.");
  if (!declared && !unitOverride)
    throw new Error("Native DWG unit requires an explicit supported override.");
  const selection = declared
    ? {
        code: report.unitCode as 1 | 2 | 4 | 5 | 6,
        ...declared,
        source: "declared" as const,
      }
    : {
        ...unitOverride!,
        millimetersPerUnit: unitDefinitions.get(unitOverride!.code)!
          .millimetersPerUnit,
        source: "user_selected" as const,
      };
  const identity = [
    expectedSource.sha256,
    String(expectedSource.byteSize),
    expectedSource.headerVersion,
    revisionId,
    canvasId,
    sourceFileId,
    String(selection.code),
    selection.label,
  ];
  const requestId = deterministicUuid("request", identity);
  const layerIds = new Map<string, string>();
  const layers = report.layers.map((nativeLayer, index) => {
    const id = deterministicUuid("layer", [...identity, nativeLayer.handle]);
    layerIds.set(nativeLayer.handle, id);
    return DrawingStructureLayerSchema.parse({
      id,
      name: nativeLayer.name,
      visible: nativeLayer.visible,
      locked: nativeLayer.locked,
      systemKind: "custom",
      canvasId,
      sortOrder: index + 1,
      version: 1,
    });
  });
  const objects: DrawingObject[] = [];
  const bindings: NativeDrawingDwgBinding[] = [];
  for (const entity of report.entities) {
    const projected = projectGeometry(entity, selection.millimetersPerUnit);
    assertProjectedBounds(projected.geometry);
    const objectId = deterministicUuid("object", [...identity, entity.handle]);
    const object = DrawingObjectSchema.parse({
      id: objectId,
      name: `DWG ${entity.type} ${entity.handle}`,
      layerId: layerIds.get(entity.layerHandle),
      geometry: projected.geometry,
      styleId: null,
      style: {
        stroke: "#111827",
        strokeWidth: 1,
        fill: null,
        ...(projected.fontSize === undefined
          ? {}
          : { fontSize: projected.fontSize }),
      },
      version: 1,
    });
    objects.push(object);
    bindings.push({
      id: deterministicUuid("binding", [...identity, entity.handle]),
      objectId,
      sourceFileId,
      sourceSha256: expectedSource.sha256,
      handle: entity.handle,
      ownerHandle: entity.ownerHandle,
      entityType: entity.type,
      nativeGeometry: entity.geometry,
    });
  }
  const warnings: NativeDrawingDwgImportWarning[] = [
    {
      code: "DWG_APPEARANCE_APPROXIMATED",
      detail:
        "Native line styles, fonts, and plot appearance are not reproduced by the editable display projection.",
    },
  ];
  const textCount = report.entities.filter(
    ({ type }) => type === "TEXT",
  ).length;
  if (textCount > 0)
    warnings.push({
      code: "TEXT_WIDTH_ESTIMATED",
      detail: `${textCount} TEXT display width estimate(s) use Unicode scalar count × height × 0.6 with a one-height minimum.`,
    });
  if (report.coverage.unsupportedEntities > 0)
    warnings.push({
      code: "UNSUPPORTED_MODEL_SPACE_ENTITIES_OMITTED",
      detail: `${report.coverage.unsupportedEntities} unsupported model-space entity/entities were not projected.`,
    });
  if (report.coverage.nonModelSpaceEntities > 0)
    warnings.push({
      code: "NON_MODEL_SPACE_ENTITIES_OMITTED",
      detail: `${report.coverage.nonModelSpaceEntities} non-model-space entity/entities were not projected.`,
    });
  return {
    requestId,
    source: expectedSource,
    units: selection,
    layers,
    objects,
    bindings,
    coverage: report.coverage,
    warnings,
    qualification: "experimental-unqualified",
    persistenceAuthority: "not-issued",
  };
}
