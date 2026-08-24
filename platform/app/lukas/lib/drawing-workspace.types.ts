import { z } from "zod";

export type Point = { x: number; y: number };
export type Bounds = { x: number; y: number; width: number; height: number };
export type Viewport = { x: number; y: number; zoom: number };

const Finite = z.number().refine(Number.isFinite, "유한한 숫자여야 합니다.");
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

const DrawingGeometryBaseSchema = z.discriminatedUnion("type", [
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

export const DrawingGeometrySchema = DrawingGeometryBaseSchema.superRefine(
  (geometry, context) => {
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
  },
);

const drawingObjectDefaultNames: Record<
  z.infer<typeof DrawingGeometryBaseSchema>["type"],
  string
> = {
  line: "Line",
  polyline: "Polyline",
  rectangle: "Rectangle",
  circle: "Circle",
  text: "Text",
  dimension: "Dimension",
};

/** Deterministic language-neutral names for newly authored geometry. */
export function defaultDrawingObjectName(
  type: z.infer<typeof DrawingGeometryBaseSchema>["type"],
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

export const PdfCalibrationSchema = z.object({
  normalizedStart: PointSchema,
  normalizedEnd: PointSchema,
  realLengthMillimeters: PositiveFinite,
  millimetersPerNormalizedUnit: PositiveFinite,
});

export const DrawingObjectSchema = z
  .object({
    id: Uuid,
    name: DrawingObjectNameSchema,
    layerId: Uuid,
    geometry: DrawingGeometrySchema,
    style: DrawingStyleSchema,
    version: z.number().int().positive(),
  })
  .strict();

export const DrawingLayerInputSchema = z
  .object({
    id: Uuid,
    name: DrawingLayerNameSchema,
    visible: z.boolean(),
    locked: z.boolean(),
    version: z.number().int().positive(),
  })
  .strict();

export const DrawingLayerSchema = DrawingLayerInputSchema.extend({
  systemKind: z.enum(["source", "work", "custom"]),
}).strict();

export const DrawingOperationInputSchema = z.object({
  clientOperationId: Uuid,
  revisionId: Uuid,
  type: z.enum([
    "add_objects",
    "update_objects",
    "delete_objects",
    "add_layer",
    "update_layer",
  ]),
  baseVersions: z.record(Uuid, z.number().int().positive()),
  forward: z.record(z.string(), z.unknown()),
  inverse: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export type PdfCalibration = z.infer<typeof PdfCalibrationSchema>;
export type DrawingStyle = z.infer<typeof DrawingStyleSchema>;
export type DrawingGeometry = z.infer<typeof DrawingGeometrySchema>;
export type DrawingObject = z.infer<typeof DrawingObjectSchema>;
export type DrawingLayerInput = z.infer<typeof DrawingLayerInputSchema>;
export type DrawingLayer = z.infer<typeof DrawingLayerSchema>;
export type DrawingOperationInput = z.infer<typeof DrawingOperationInputSchema>;
