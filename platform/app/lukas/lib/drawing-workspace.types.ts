import { z } from "zod";

import { isSimpleDrawingBoundary } from "./drawing-semantic-geometry.ts";

export type Point = { x: number; y: number };
export type Bounds = { x: number; y: number; width: number; height: number };
export type Viewport = { x: number; y: number; zoom: number };

const SHARED_NUMERIC_ABSOLUTE_MAX = 999_999_999_999;
const P4_NUMERIC_ABSOLUTE_MAX = 9_000_000_000;
const SHARED_INTEGER_MAX = 2_147_483_647;
const Finite = z
  .number()
  .min(-SHARED_NUMERIC_ABSOLUTE_MAX)
  .max(SHARED_NUMERIC_ABSOLUTE_MAX)
  .refine(Number.isFinite, "유한한 숫자여야 합니다.");
const PositiveFinite = Finite.refine(
  (value) => value > 0,
  "0보다 커야 합니다.",
);
const PositiveFiniteMax = (maximum: number) =>
  z
    .number()
    .max(maximum)
    .refine(Number.isFinite, "유한한 숫자여야 합니다.")
    .refine((value) => value > 0, "0보다 커야 합니다.");
const Uuid = z.string().uuid();
const PositiveInteger = z.number().int().positive().max(SHARED_INTEGER_MAX);
const NonNegativeInteger = z
  .number()
  .int()
  .nonnegative()
  .max(SHARED_INTEGER_MAX);
const ExactTrimmedName = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => value === value.trim(), "앞뒤 공백을 제거해야 합니다.");

export const DrawingObjectNameSchema = ExactTrimmedName;
export const DrawingLayerNameSchema = ExactTrimmedName;
export const DrawingStrokeColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);
export const DrawingStrokeWidthSchema = PositiveFiniteMax(1000);
export const DrawingFillColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i)
  .nullable();

export const PointSchema = z.object({ x: Finite, y: Finite }).strict();
export const BoundsSchema = z
  .object({
    x: Finite,
    y: Finite,
    width: Finite.refine((value) => value >= 0, "0 이상이어야 합니다."),
    height: Finite.refine((value) => value >= 0, "0 이상이어야 합니다."),
  })
  .strict();
export const ViewportSchema = z
  .object({
    x: Finite,
    y: Finite,
    zoom: PositiveFinite,
  })
  .strict();

const DrawingPrimitiveGeometryBaseSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("line"), start: PointSchema, end: PointSchema })
    .strict(),
  z
    .object({
      type: z.literal("polyline"),
      points: z.array(PointSchema).min(2),
      closed: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("rectangle"),
      origin: PointSchema,
      width: PositiveFinite,
      height: PositiveFinite,
      rotation: Finite,
    })
    .strict(),
  z
    .object({
      type: z.literal("circle"),
      center: PointSchema,
      radius: PositiveFinite,
    })
    .strict(),
  z
    .object({
      type: z.literal("text"),
      origin: PointSchema,
      width: PositiveFinite,
      text: z.string().max(10000),
    })
    .strict(),
  z
    .object({
      type: z.literal("dimension"),
      start: PointSchema,
      end: PointSchema,
      offset: Finite,
      calibrationId: Uuid.nullable(),
    })
    .strict(),
]);

export const DrawingPrimitiveGeometrySchema =
  DrawingPrimitiveGeometryBaseSchema.superRefine((geometry, context) => {
    if (
      (geometry.type === "line" || geometry.type === "dimension") &&
      geometry.start.x === geometry.end.x &&
      geometry.start.y === geometry.end.y
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "시작점과 끝점이 달라야 합니다.",
      });
    }

    if (
      geometry.type === "polyline" &&
      geometry.points.every(
        (point) =>
          point.x === geometry.points[0].x && point.y === geometry.points[0].y,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "폴리라인에는 서로 다른 점이 필요합니다.",
      });
    }

    if (geometry.type === "text" && geometry.text.includes("\0")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "텍스트에 NUL 문자를 포함할 수 없습니다.",
      });
    }
  });

const P4Finite = z
  .number()
  .min(-P4_NUMERIC_ABSOLUTE_MAX)
  .max(P4_NUMERIC_ABSOLUTE_MAX)
  .refine(Number.isFinite, "유한한 숫자여야 합니다.")
  .refine(
    (value) => Number.isSafeInteger(value * 1_000_000),
    "소수점 이하 여섯 자리 이하여야 합니다.",
  );
const P4Positive = P4Finite.refine((value) => value > 0, "0보다 커야 합니다.");
const P4NonNegative = P4Finite.refine(
  (value) => value >= 0,
  "0 이상이어야 합니다.",
);
const P4PointSchema = z.object({ x: P4Finite, y: P4Finite }).strict();
const DrawingWallGeometryBaseSchema = z
  .object({
    type: z.literal("wall"),
    semanticVersion: z.literal(1),
    start: P4PointSchema,
    end: P4PointSchema,
    thicknessMillimeters: P4Positive,
    heightMillimeters: P4Positive,
  })
  .strict();
export const DrawingWallGeometrySchema =
  DrawingWallGeometryBaseSchema.superRefine((geometry, context) => {
    if (
      geometry.start.x === geometry.end.x &&
      geometry.start.y === geometry.end.y
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "시작점과 끝점이 달라야 합니다.",
      });
  });
export const DrawingOpeningGeometrySchema = z
  .object({
    type: z.literal("opening"),
    semanticVersion: z.literal(1),
    hostWallId: Uuid,
    offsetMillimeters: P4NonNegative,
    widthMillimeters: P4Positive,
    heightMillimeters: P4Positive,
    sillHeightMillimeters: P4NonNegative,
    openingKind: z.enum(["door", "window", "void"]),
  })
  .strict()
  .superRefine((geometry, context) => {
    if (geometry.openingKind === "door" && geometry.sillHeightMillimeters !== 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sillHeightMillimeters"],
        message: "문의 하부 높이는 0이어야 합니다.",
      });
  });
const P4BoundarySchema = z
  .array(P4PointSchema)
  .min(3)
  .max(4096)
  .refine(isSimpleDrawingBoundary, "단순한 비퇴화 경계여야 합니다.");
export const DrawingSpaceGeometrySchema = z
  .object({
    type: z.literal("space"),
    semanticVersion: z.literal(1),
    boundary: P4BoundarySchema,
    number: z.string().max(255),
    finishes: z
      .object({
        floor: z.string().max(255).nullable(),
        wall: z.string().max(255).nullable(),
        ceiling: z.string().max(255).nullable(),
      })
      .strict(),
  })
  .strict();
export const DrawingAreaGeometrySchema = z
  .object({
    type: z.literal("area"),
    semanticVersion: z.literal(1),
    boundary: P4BoundarySchema,
  })
  .strict();
const DrawingGridGeometryBaseSchema = z
  .object({
    type: z.literal("grid"),
    semanticVersion: z.literal(1),
    start: P4PointSchema,
    end: P4PointSchema,
  })
  .strict();
export const DrawingGridGeometrySchema =
  DrawingGridGeometryBaseSchema.superRefine((geometry, context) => {
    if (
      geometry.start.x === geometry.end.x &&
      geometry.start.y === geometry.end.y
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "시작점과 끝점이 달라야 합니다.",
      });
  });
export const DrawingArcGeometrySchema = z
  .object({
    type: z.literal("arc"),
    semanticVersion: z.literal(1),
    center: P4PointSchema,
    radius: P4Positive,
    startAngleDegrees: P4Finite,
    sweepAngleDegrees: P4Finite.refine(
      (value) => value !== 0 && Math.abs(value) <= 360,
      "호 각도는 0이 아니고 절댓값이 360 이하여야 합니다.",
    ),
  })
  .strict();

export const DrawingGeometrySchema = z.union([
  DrawingPrimitiveGeometrySchema,
  DrawingWallGeometrySchema,
  DrawingOpeningGeometrySchema,
  DrawingSpaceGeometrySchema,
  DrawingAreaGeometrySchema,
  DrawingGridGeometrySchema,
  DrawingArcGeometrySchema,
]);

export type DrawingSemanticVersion = 1;
export type DrawingPrimitiveGeometry = z.infer<
  typeof DrawingPrimitiveGeometrySchema
>;
export type DrawingWallGeometry = z.infer<typeof DrawingWallGeometrySchema>;
export type DrawingOpeningGeometry = z.infer<
  typeof DrawingOpeningGeometrySchema
>;
export type DrawingSpaceGeometry = z.infer<typeof DrawingSpaceGeometrySchema>;
export type DrawingAreaGeometry = z.infer<typeof DrawingAreaGeometrySchema>;
export type DrawingGridGeometry = z.infer<typeof DrawingGridGeometrySchema>;
export type DrawingArcGeometry = z.infer<typeof DrawingArcGeometrySchema>;
export type DrawingSemanticGeometry =
  | DrawingWallGeometry
  | DrawingOpeningGeometry
  | DrawingSpaceGeometry
  | DrawingAreaGeometry
  | DrawingGridGeometry
  | DrawingArcGeometry;

const drawingObjectDefaultNames: Record<
  z.infer<typeof DrawingGeometrySchema>["type"],
  string
> = {
  line: "Line",
  polyline: "Polyline",
  rectangle: "Rectangle",
  circle: "Circle",
  text: "Text",
  dimension: "Dimension",
  wall: "Wall",
  opening: "Opening",
  space: "Space",
  area: "Area",
  grid: "Grid",
  arc: "Arc",
};

/** Deterministic language-neutral names for newly authored geometry. */
export function defaultDrawingObjectName(
  type: z.infer<typeof DrawingGeometrySchema>["type"],
) {
  return drawingObjectDefaultNames[type];
}

export const DrawingStyleSchema = z
  .object({
    stroke: DrawingStrokeColorSchema,
    strokeWidth: DrawingStrokeWidthSchema,
    fill: DrawingFillColorSchema,
    fontSize: PositiveFiniteMax(10000).optional(),
  })
  .strict();

export type DrawingStyle = z.infer<typeof DrawingStyleSchema>;
export const DrawingStyleOverrideSchema = DrawingStyleSchema.partial();
export type DrawingGeometry = z.infer<typeof DrawingGeometrySchema>;
export type DrawingObject = {
  id: string;
  name: string;
  layerId: string;
  geometry: DrawingGeometry;
  styleId?: string | null;
  style: DrawingStyleOverride;
  version: number;
};

export const PdfCalibrationSchema = z
  .object({
    normalizedStart: PointSchema,
    normalizedEnd: PointSchema,
    realLengthMillimeters: PositiveFinite,
    millimetersPerNormalizedUnit: PositiveFinite,
  })
  .strict();

const DrawingObjectValidatedSchema = z
  .object({
    id: Uuid,
    name: DrawingObjectNameSchema,
    layerId: Uuid,
    geometry: DrawingGeometrySchema,
    /** Omitted is legacy inline-style data and is treated as null by resolvers. */
    styleId: Uuid.nullable().optional(),
    style: z.union([DrawingStyleSchema, DrawingStyleOverrideSchema]),
    version: PositiveInteger,
  })
  .strict()
  .superRefine((object, context) => {
    if (
      object.styleId == null &&
      !DrawingStyleSchema.safeParse(object.style).success
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["style"],
        message: "인라인 도면 스타일은 완전해야 합니다.",
      });
    }
  });

/** `.strict()` remains available for P0/P1 callers; the inner object is strict. */
export const DrawingObjectSchema = Object.assign(DrawingObjectValidatedSchema, {
  strict: () => DrawingObjectValidatedSchema,
}) as z.ZodType<DrawingObject> & {
  strict: () => z.ZodType<DrawingObject>;
};

export const DrawingLayerInputSchema = z
  .object({
    id: Uuid,
    name: DrawingLayerNameSchema,
    visible: z.boolean(),
    locked: z.boolean(),
    /** Legacy P0/P1 layers predate canvas ownership. */
    canvasId: Uuid.optional(),
    sortOrder: NonNegativeInteger.optional(),
    version: PositiveInteger,
  })
  .strict();

export const DrawingLayerSchema = DrawingLayerInputSchema.extend({
  systemKind: z.enum(["source", "work", "custom"]),
})
  .strict()
  .superRefine((layer, context) => {
    if (layer.systemKind === "source" && (!layer.visible || !layer.locked)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "원본 레이어는 표시되고 잠겨 있어야 합니다.",
      });
    }
  });

export const DrawingStructureLayerSchema = z
  .object({
    id: Uuid,
    name: DrawingLayerNameSchema,
    visible: z.boolean(),
    locked: z.boolean(),
    systemKind: z.enum(["source", "work", "custom"]),
    canvasId: Uuid,
    sortOrder: NonNegativeInteger,
    version: PositiveInteger,
  })
  .strict()
  .superRefine((layer, context) => {
    if (layer.systemKind === "source" && (!layer.visible || !layer.locked)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "원본 레이어는 표시되고 잠겨 있어야 합니다.",
      });
    }
  });

export const DrawingPageSchema = z
  .object({
    id: Uuid,
    revisionId: Uuid,
    name: ExactTrimmedName,
    sortOrder: NonNegativeInteger,
    version: PositiveInteger,
  })
  .strict();

export const DrawingCanvasSchema = z
  .object({
    id: Uuid,
    pageId: Uuid,
    name: ExactTrimmedName,
    spaceKind: z.enum(["paper", "model"]),
    widthMillimeters: PositiveFinite,
    heightMillimeters: PositiveFinite,
    background: z
      .object({
        sourceFileId: Uuid,
        sourceSha256: z.string().regex(/^[0-9a-f]{64}$/i),
        pdfPageNumber: PositiveInteger.nullable(),
        calibration: PdfCalibrationSchema.nullable(),
      })
      .strict()
      .nullable(),
    sortOrder: NonNegativeInteger,
    version: PositiveInteger,
  })
  .strict();

export const DrawingStyleDefinitionSchema = z
  .object({
    id: Uuid,
    revisionId: Uuid,
    name: ExactTrimmedName,
    value: DrawingStyleSchema,
    version: PositiveInteger,
  })
  .strict();

const DrawingStyledPrimitiveSchema = z
  .object({
    localId: z.string().min(1).max(255),
    name: DrawingObjectNameSchema,
    geometry: DrawingPrimitiveGeometrySchema,
    styleId: Uuid.nullable(),
    style: z.union([DrawingStyleSchema, DrawingStyleOverrideSchema]),
  })
  .strict()
  .superRefine((primitive, context) => {
    if (
      primitive.styleId === null &&
      !DrawingStyleSchema.safeParse(primitive.style).success
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["style"],
        message: "인라인 블록 스타일은 완전해야 합니다.",
      });
    }
  });

export const DrawingBlockPrimitiveSchema = DrawingStyledPrimitiveSchema;

export const DrawingBlockSchema = z
  .object({
    id: Uuid,
    revisionId: Uuid,
    name: ExactTrimmedName,
    primitives: z.array(DrawingBlockPrimitiveSchema).min(1),
    version: PositiveInteger,
  })
  .strict()
  .superRefine((block, context) => {
    const localIds = new Set<string>();
    for (const primitive of block.primitives) {
      if (localIds.has(primitive.localId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["primitives"],
          message: "블록 primitive localId는 고유해야 합니다.",
        });
      }
      localIds.add(primitive.localId);
    }
  });

export const DrawingBlockInstanceSchema = z
  .object({
    id: Uuid,
    lineageId: Uuid,
    blockId: Uuid,
    layerId: Uuid,
    name: ExactTrimmedName,
    origin: PointSchema,
    rotation: Finite,
    scaleX: Finite.refine((value) => value !== 0, "0일 수 없습니다."),
    scaleY: Finite.refine((value) => value !== 0, "0일 수 없습니다."),
    version: PositiveInteger,
  })
  .strict();

const DrawingPropertyValueTypeSchema = z.enum([
  "text",
  "number",
  "boolean",
  "date",
  "enum",
]);
const DrawingPropertyAppliesToSchema = z.enum([
  "line",
  "polyline",
  "rectangle",
  "circle",
  "text",
  "dimension",
  "wall",
  "opening",
  "space",
  "area",
  "grid",
  "arc",
  "block_instance",
]);

export const DrawingPropertySchemaSchema = z
  .object({
    id: Uuid,
    revisionId: Uuid,
    name: ExactTrimmedName,
    valueType: DrawingPropertyValueTypeSchema,
    enumOptions: z.array(ExactTrimmedName).max(255),
    appliesTo: z.array(DrawingPropertyAppliesToSchema).min(1),
    required: z.boolean(),
    version: PositiveInteger,
  })
  .strict()
  .superRefine((schema, context) => {
    if (schema.valueType === "enum" && schema.enumOptions.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["enumOptions"],
        message: "enum 속성에는 하나 이상의 옵션이 필요합니다.",
      });
    }
    if (schema.valueType !== "enum" && schema.enumOptions.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["enumOptions"],
        message: "enum 이외 속성에는 옵션을 둘 수 없습니다.",
      });
    }
  });

export const DrawingPropertyValueSchema = z
  .object({
    id: Uuid,
    schemaId: Uuid,
    objectId: Uuid.nullable(),
    blockInstanceId: Uuid.nullable(),
    value: z.union([z.string(), Finite, z.boolean(), z.null()]),
    version: PositiveInteger,
  })
  .strict()
  .refine(
    (value) =>
      Number(value.objectId !== null) +
        Number(value.blockInstanceId !== null) ===
      1,
    "속성 값은 객체 또는 블록 instance 중 하나에만 귀속해야 합니다.",
  );

const DrawingTableColumnSchema = z
  .object({
    id: Uuid,
    name: ExactTrimmedName,
    kind: z.enum(["text", "number", "object_name", "object_type", "property"]),
    propertySchemaId: Uuid.nullable(),
  })
  .strict()
  .superRefine((column, context) => {
    if ((column.kind === "property") !== (column.propertySchemaId !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["propertySchemaId"],
        message: "property 열만 property schema를 참조해야 합니다.",
      });
    }
  });

const DrawingTableRowSchema = z
  .object({
    id: Uuid,
    objectId: Uuid.nullable(),
    blockInstanceId: Uuid.nullable(),
    cells: z.record(Uuid, z.union([z.string(), Finite, z.null()])),
  })
  .strict()
  .refine(
    (row) =>
      Number(row.objectId !== null) + Number(row.blockInstanceId !== null) ===
      1,
    "표 행은 객체 또는 블록 instance 중 하나에만 귀속해야 합니다.",
  );

export const DrawingTableSchema = z
  .object({
    id: Uuid,
    revisionId: Uuid,
    name: ExactTrimmedName,
    columns: z.array(DrawingTableColumnSchema).min(1),
    rows: z.array(DrawingTableRowSchema),
    version: PositiveInteger,
  })
  .strict()
  .superRefine((table, context) => {
    const columnIds = new Set<string>();
    const columnNames = new Set<string>();
    for (const [index, column] of table.columns.entries()) {
      if (columnIds.has(column.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["columns", index, "id"],
          message: "표 열 ID는 고유해야 합니다.",
        });
      }
      if (columnNames.has(column.name)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["columns", index, "name"],
          message: "표 열 이름은 고유해야 합니다.",
        });
      }
      columnIds.add(column.id);
      columnNames.add(column.name);
    }
    const rowIds = new Set<string>();
    for (const [index, row] of table.rows.entries()) {
      if (rowIds.has(row.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", index, "id"],
          message: "표 행 ID는 고유해야 합니다.",
        });
      }
      rowIds.add(row.id);
    }
  });

const DrawingStructurePutActionSchema = <T extends z.ZodTypeAny>(
  kind: string,
  entity: T,
) =>
  z
    .object({
      kind: z.literal(kind),
      entity,
      baseVersion: PositiveInteger.nullable(),
    })
    .strict();
const DrawingStructureDeleteActionSchema = (kind: string) =>
  z
    .object({ kind: z.literal(kind), id: Uuid, baseVersion: PositiveInteger })
    .strict();

export const DrawingStructureActionSchema = z.discriminatedUnion("kind", [
  DrawingStructurePutActionSchema("put_object", DrawingObjectSchema),
  DrawingStructureDeleteActionSchema("delete_object"),
  DrawingStructurePutActionSchema("put_page", DrawingPageSchema),
  DrawingStructureDeleteActionSchema("delete_page"),
  DrawingStructurePutActionSchema("put_canvas", DrawingCanvasSchema),
  DrawingStructureDeleteActionSchema("delete_canvas"),
  DrawingStructurePutActionSchema("put_layer", DrawingStructureLayerSchema),
  DrawingStructureDeleteActionSchema("delete_layer"),
  DrawingStructurePutActionSchema("put_style", DrawingStyleDefinitionSchema),
  DrawingStructureDeleteActionSchema("delete_style"),
  DrawingStructurePutActionSchema("put_block", DrawingBlockSchema),
  DrawingStructureDeleteActionSchema("delete_block"),
  DrawingStructurePutActionSchema(
    "put_block_instance",
    DrawingBlockInstanceSchema,
  ),
  DrawingStructureDeleteActionSchema("delete_block_instance"),
  DrawingStructurePutActionSchema(
    "put_property_schema",
    DrawingPropertySchemaSchema,
  ),
  DrawingStructureDeleteActionSchema("delete_property_schema"),
  DrawingStructurePutActionSchema(
    "put_property_value",
    DrawingPropertyValueSchema,
  ),
  DrawingStructureDeleteActionSchema("delete_property_value"),
  DrawingStructurePutActionSchema("put_table", DrawingTableSchema),
  DrawingStructureDeleteActionSchema("delete_table"),
]);

const DrawingOperationObjectPatchSchema = z
  .object({
    name: DrawingObjectNameSchema.optional(),
    layerId: Uuid.optional(),
    geometry: DrawingGeometrySchema.optional(),
    styleId: Uuid.nullable().optional(),
    style: DrawingStyleOverrideSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0);
const DrawingOperationLayerPatchSchema = z
  .object({
    name: DrawingLayerNameSchema.optional(),
    visible: z.boolean().optional(),
    locked: z.boolean().optional(),
    canvasId: Uuid.optional(),
    sortOrder: NonNegativeInteger.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0);
const DrawingOperationPayloadSchemas = {
  add_objects: z
    .object({
      type: z.literal("add_objects"),
      objects: z.array(DrawingObjectSchema).min(1),
    })
    .strict(),
  update_objects: z
    .object({
      type: z.literal("update_objects"),
      updates: z
        .array(
          z
            .object({
              objectId: Uuid,
              patch: DrawingOperationObjectPatchSchema,
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
  delete_objects: z
    .object({
      type: z.literal("delete_objects"),
      objectIds: z.array(Uuid).min(1),
    })
    .strict(),
  add_layer: z
    .object({ type: z.literal("add_layer"), layer: DrawingLayerInputSchema })
    .strict(),
  update_layer: z
    .object({
      type: z.literal("update_layer"),
      layerId: Uuid,
      patch: DrawingOperationLayerPatchSchema,
    })
    .strict(),
  mutate_structure: z
    .object({
      type: z.literal("mutate_structure"),
      actions: z.array(DrawingStructureActionSchema).min(1),
    })
    .strict(),
  mutate_objects_with_references: z
    .object({
      type: z.literal("mutate_objects_with_references"),
      objectAction: z.enum(["delete", "restore"]),
      objects: z.array(DrawingObjectSchema).min(1),
      actions: z.array(DrawingStructureActionSchema),
    })
    .strict(),
  restore_checkpoint: z
    .object({
      type: z.literal("restore_checkpoint"),
      checkpointId: Uuid,
      actions: z.array(DrawingStructureActionSchema).min(1).max(5000),
    })
    .strict(),
} as const;

export const DrawingOperationInputSchema = z
  .object({
    clientOperationId: Uuid,
    revisionId: Uuid,
    type: z.enum([
      "add_objects",
      "update_objects",
      "delete_objects",
      "add_layer",
      "update_layer",
      "mutate_structure",
      "mutate_objects_with_references",
      "restore_checkpoint",
    ]),
    baseVersions: z.record(Uuid, PositiveInteger),
    forward: z.record(z.string(), z.unknown()),
    inverse: z.record(z.string(), z.unknown()),
    createdAt: z.string().datetime(),
    originalOperationId: Uuid.optional(),
    historyAction: z.enum(["undo", "redo"]).optional(),
  })
  .superRefine((operation, context) => {
    if (
      Boolean(operation.originalOperationId) !==
      Boolean(operation.historyAction)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "도면 실행 취소 이력은 원본 작업과 동작을 함께 지정해야 합니다.",
      });
    const forward = DrawingOperationPayloadSchemas[operation.type].safeParse(
      operation.forward,
    );
    const inverseSchema =
      operation.type === "add_objects"
        ? DrawingOperationPayloadSchemas.delete_objects
        : operation.type === "delete_objects"
          ? DrawingOperationPayloadSchemas.add_objects
          : operation.type === "add_layer"
            ? z.object({}).strict()
            : operation.type === "mutate_structure"
              ? DrawingOperationPayloadSchemas.mutate_structure
              : operation.type === "mutate_objects_with_references"
                ? DrawingOperationPayloadSchemas.mutate_objects_with_references
                : operation.type === "restore_checkpoint"
                  ? DrawingOperationPayloadSchemas.restore_checkpoint
                  : DrawingOperationPayloadSchemas[operation.type];
    const inverse = inverseSchema.safeParse(operation.inverse);
    if (!forward.success)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["forward"],
        message: "도면 작업 payload가 올바르지 않습니다.",
      });
    if (!inverse.success)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inverse"],
        message: "도면 작업 inverse가 올바르지 않습니다.",
      });
  });

export type PdfCalibration = z.infer<typeof PdfCalibrationSchema>;
export type DrawingStyleOverride = z.infer<typeof DrawingStyleOverrideSchema>;
export type DrawingLayerInput = z.infer<typeof DrawingLayerInputSchema>;
export type DrawingLayer = z.infer<typeof DrawingLayerSchema>;
export type DrawingStructureLayer = z.infer<typeof DrawingStructureLayerSchema>;
export type DrawingPage = z.infer<typeof DrawingPageSchema>;
export type DrawingCanvas = z.infer<typeof DrawingCanvasSchema>;
export type DrawingStyleDefinition = z.infer<
  typeof DrawingStyleDefinitionSchema
>;
export type DrawingBlockPrimitive = z.infer<typeof DrawingBlockPrimitiveSchema>;
export type DrawingBlock = z.infer<typeof DrawingBlockSchema>;
export type DrawingBlockInstance = z.infer<typeof DrawingBlockInstanceSchema>;
export type DrawingPropertySchema = z.infer<typeof DrawingPropertySchemaSchema>;
export type DrawingPropertyValue = z.infer<typeof DrawingPropertyValueSchema>;
export type DrawingTable = z.infer<typeof DrawingTableSchema>;
type DrawingStructureObject = Omit<DrawingObject, "style"> & {
  style: DrawingStyleOverride;
};
type PutStructureAction<T> = {
  kind:
    | "put_object"
    | "put_page"
    | "put_canvas"
    | "put_layer"
    | "put_style"
    | "put_block"
    | "put_block_instance"
    | "put_property_schema"
    | "put_property_value"
    | "put_table";
  entity: T;
  baseVersion: number | null;
};
type DeleteStructureAction = {
  kind:
    | "delete_object"
    | "delete_page"
    | "delete_canvas"
    | "delete_layer"
    | "delete_style"
    | "delete_block"
    | "delete_block_instance"
    | "delete_property_schema"
    | "delete_property_value"
    | "delete_table";
  id: string;
  baseVersion: number;
};
export type DrawingStructureAction =
  | (PutStructureAction<DrawingStructureObject> & { kind: "put_object" })
  | (PutStructureAction<DrawingPage> & { kind: "put_page" })
  | (PutStructureAction<DrawingCanvas> & { kind: "put_canvas" })
  | (PutStructureAction<DrawingStructureLayer> & { kind: "put_layer" })
  | (PutStructureAction<DrawingStyleDefinition> & { kind: "put_style" })
  | (PutStructureAction<DrawingBlock> & { kind: "put_block" })
  | (PutStructureAction<DrawingBlockInstance> & { kind: "put_block_instance" })
  | (PutStructureAction<DrawingPropertySchema> & {
      kind: "put_property_schema";
    })
  | (PutStructureAction<DrawingPropertyValue> & { kind: "put_property_value" })
  | (PutStructureAction<DrawingTable> & { kind: "put_table" })
  | (DeleteStructureAction & { kind: "delete_object" })
  | (DeleteStructureAction & { kind: "delete_page" })
  | (DeleteStructureAction & { kind: "delete_canvas" })
  | (DeleteStructureAction & { kind: "delete_layer" })
  | (DeleteStructureAction & { kind: "delete_style" })
  | (DeleteStructureAction & { kind: "delete_block" })
  | (DeleteStructureAction & { kind: "delete_block_instance" })
  | (DeleteStructureAction & { kind: "delete_property_schema" })
  | (DeleteStructureAction & { kind: "delete_property_value" })
  | (DeleteStructureAction & { kind: "delete_table" });
export type DrawingOperationInput = z.infer<typeof DrawingOperationInputSchema>;
