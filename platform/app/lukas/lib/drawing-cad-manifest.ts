import { z } from "zod";
import {
  DrawingBlockInstanceSchema,
  DrawingBlockSchema,
  DrawingCanvasSchema,
  DrawingObjectSchema,
  DrawingOutputProfileSchema,
  DrawingPageSchema,
  DrawingPropertySchemaSchema,
  DrawingPropertyValueSchema,
  DrawingStructureLayerSchema,
  DrawingStyleDefinitionSchema,
  DrawingStyleSchema,
  DrawingTableSchema,
  DrawingObjectNameSchema,
  PointSchema,
} from "./drawing-workspace.types.ts";
import { validateDrawingStructureState } from "./drawing-structure.ts";
import { nativeAssetCanonicalJson } from "./drawing-native-symbols.ts";
import type { Point } from "./drawing-workspace.types.ts";

const uuid = z.string().uuid();
const number = z.number().finite();
const positive = number.positive();
const id = z.string().min(1).max(1024);
const version = z.number().int().positive().max(2147483647);

/** Bound raw JSON before schema traversal, hashing, or geometry expansion. */
export function assertDrawingCadJsonBudget(
  value: unknown,
  countPoints = true,
): void {
  const stack: { value: unknown; depth: number; exit?: boolean }[] = [
    { value, depth: 0 },
  ];
  const seen = new Set<object>();
  let bytes = 0;
  let points = 0;
  let nodes = 0;
  const text = (value: string) => {
    if (value.length > 20 * 1024 * 1024)
      throw new Error("CAD input contains oversized Unicode text.");
    let wellFormed = true;
    for (let index = 0; index < value.length; index++) {
      const unit = value.charCodeAt(index);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(++index);
        if (!(next >= 0xdc00 && next <= 0xdfff)) {
          wellFormed = false;
          break;
        }
      } else if (unit >= 0xdc00 && unit <= 0xdfff) {
        wellFormed = false;
        break;
      }
    }
    if (!wellFormed || value.includes("\0"))
      throw new Error("CAD input contains invalid or oversized Unicode text.");
    bytes += new TextEncoder().encode(JSON.stringify(value)).length;
  };
  while (stack.length) {
    const entry = stack.pop()!;
    const item = entry.value;
    if (entry.exit) {
      seen.delete(item as object);
      continue;
    }
    if (++nodes > 1_000_000 || entry.depth > 64)
      throw new Error("CAD JSON budget exceeded.");
    if (typeof item === "string") text(item);
    else if (typeof item === "number") {
      if (!Number.isFinite(item))
        throw new Error("CAD JSON numbers must be finite.");
      bytes += String(item).length;
    } else if (item === null || typeof item === "boolean")
      bytes += item === false ? 5 : 4;
    else if (typeof item === "object") {
      if (seen.has(item)) throw new Error("CAD input must not contain cycles.");
      seen.add(item);
      stack.push({ value: item, depth: entry.depth, exit: true });
      const prototype = Object.getPrototypeOf(item);
      if (
        !Array.isArray(item) &&
        prototype !== Object.prototype &&
        prototype !== null
      )
        throw new Error("CAD input must contain plain JSON objects.");
      const keys = Reflect.ownKeys(item).filter(
        (key) => !(Array.isArray(item) && key === "length"),
      );
      if (keys.length > 100_000 || stack.length + keys.length > 1_000_000)
        throw new Error("CAD collection budget exceeded.");
      if (
        Array.isArray(item) &&
        (keys.length !== item.length ||
          keys.some((key, index) => key !== String(index)))
      )
        throw new Error("CAD arrays must be dense.");
      if (
        countPoints &&
        Object.hasOwn(item, "x") &&
        Object.hasOwn(item, "y") &&
        ++points > 100_000
      )
        throw new Error("CAD aggregate point budget exceeded.");
      bytes +=
        2 +
        Math.max(0, keys.length - 1) +
        (Array.isArray(item) ? 0 : keys.length);
      for (const key of keys) {
        if (typeof key !== "string")
          throw new Error("CAD JSON symbol keys are unsupported.");
        const property = Object.getOwnPropertyDescriptor(item, key)!;
        if (!property.enumerable || !("value" in property))
          throw new Error("CAD JSON accessors are unsupported.");
        if (!Array.isArray(item)) text(key);
        stack.push({ value: property.value, depth: entry.depth + 1 });
      }
    } else throw new Error("CAD input must be finite JSON.");
    if (bytes > 20 * 1024 * 1024)
      throw new Error("CAD canonical input exceeds 20 MiB.");
  }
}

/** Finite derived geometry, not the canonical fixed-six input domain. */
export function isSimpleCadBoundary(points: readonly Point[]): boolean {
  if (points.length < 3 || points.length > 4096) return false;
  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const on = (a: Point, b: Point, p: Point) =>
    cross(a, b, p) === 0 &&
    p.x >= Math.min(a.x, b.x) &&
    p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) &&
    p.y <= Math.max(a.y, b.y);
  const intersects = (a: Point, b: Point, c: Point, d: Point) => {
    const x = cross(a, b, c),
      y = cross(a, b, d),
      u = cross(c, d, a),
      v = cross(c, d, b);
    return (
      (Math.sign(x) !== Math.sign(y) && Math.sign(u) !== Math.sign(v)) ||
      on(a, b, c) ||
      on(a, b, d) ||
      on(c, d, a) ||
      on(c, d, b)
    );
  };
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (a.x === b.x && a.y === b.y) return false;
    area += cross(points[0], a, b);
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (intersects(a, b, points[j], points[(j + 1) % points.length]))
        return false;
    }
  }
  return Number.isFinite(area) && area !== 0;
}

export const DrawingCadSourceStructureSchema = z
  .object({
    revisionId: uuid,
    pages: z.record(uuid, DrawingPageSchema),
    canvases: z.record(uuid, DrawingCanvasSchema),
    layers: z.record(uuid, DrawingStructureLayerSchema),
    objects: z.record(uuid, DrawingObjectSchema),
    sources: z.object({}).strict().optional(),
    styles: z.record(uuid, DrawingStyleDefinitionSchema),
    blocks: z.record(uuid, DrawingBlockSchema),
    blockInstances: z.record(uuid, DrawingBlockInstanceSchema),
    propertySchemas: z.record(uuid, DrawingPropertySchemaSchema),
    propertyValues: z.record(uuid, DrawingPropertyValueSchema),
    tables: z.record(uuid, DrawingTableSchema),
    tombstones: z.object({}).strict().optional(),
  })
  .strict()
  .superRefine((state, context) => {
    try {
      assertDrawingCadJsonBudget(state);
      if (
        Object.keys(state.objects).length +
          Object.keys(state.blockInstances).length >
          10_000 ||
        Object.keys(state.blocks).length > 1_000
      )
        throw new Error("CAD object or block budget exceeded.");
      if (
        Object.keys(state.canvases).length !== 1 ||
        Object.keys(state.pages).length !== 1
      )
        throw new Error(
          "CAD projection supports exactly one native canvas and page.",
        );
      validateDrawingStructureState(state);
      if (
        Object.values(state.canvases).some(
          (canvas) => canvas.background !== null,
        )
      )
        throw new Error("CAD projection does not support source backgrounds.");
      const ids = new Set(
        Object.values(state).flatMap((value) =>
          typeof value === "object" ? Object.keys(value) : [],
        ),
      );
      for (const table of Object.values(state.tables))
        for (const entry of [...table.columns, ...table.rows]) {
          if (ids.has(entry.id))
            throw new Error("CAD graph reuses a nested table UUID.");
          ids.add(entry.id);
        }
      const usedBlocks = new Set(
        Object.values(state.blockInstances).map((instance) => instance.blockId),
      );
      if (Object.keys(state.blocks).some((blockId) => !usedBlocks.has(blockId)))
        throw new Error("CAD graph contains an unassigned block definition.");
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid CAD graph.",
      });
    }
  });

const style = z.union([
  DrawingStyleSchema.extend({
    kind: z.literal("resolved"),
    requestedPaperLineweightMillimeters: positive,
  }).strict(),
  z.object({ kind: z.literal("block-defined") }).strict(),
]);
const geometry = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("line"), start: PointSchema, end: PointSchema })
    .strict(),
  z
    .object({
      type: z.literal("polyline"),
      points: z.array(PointSchema).min(2).max(100_000),
      closed: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("circle"),
      center: PointSchema,
      radius: positive,
    })
    .strict(),
  z
    .object({
      type: z.literal("arc"),
      center: PointSchema,
      radius: positive,
      startAngleDegrees: number,
      endAngleDegrees: number,
    })
    .strict(),
  z
    .object({
      type: z.literal("text"),
      origin: PointSchema,
      text: z.string().max(10000),
      width: positive,
      fontSize: positive,
      lineHeight: positive,
      attachment: z.literal("top-left"),
      wrapping: z.literal("authored-newlines-only"),
      rotationDegrees: number,
    })
    .strict(),
  z
    .object({
      type: z.literal("dimension"),
      start: PointSchema,
      end: PointSchema,
      dimensionLinePoint: PointSchema,
      textPosition: PointSchema,
      fontSize: positive,
      precision: z.literal(1),
      suffix: z.literal(" mm"),
      measurementMillimeters: positive,
    })
    .strict(),
  z
    .object({
      type: z.literal("hatch"),
      boundary: z.union([
        z.array(PointSchema).min(3).max(4096),
        z
          .object({
            type: z.literal("circle"),
            center: PointSchema,
            radius: positive,
          })
          .strict(),
      ]),
      color: z.string().regex(/^#[0-9a-f]{6}$/i),
      opacity: number.min(0).max(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("insert"),
      blockId: uuid,
      origin: PointSchema,
      rotationDegrees: number,
      scaleX: number.refine((value) => value !== 0),
      scaleY: number.refine((value) => value !== 0),
    })
    .strict(),
]);
const entity = z
  .object({ id, layerId: uuid.nullable(), style, geometry })
  .strict()
  .superRefine((entity, context) => {
    if (
      (entity.geometry.type === "insert") !==
      (entity.style.kind === "block-defined")
    )
      context.addIssue({
        code: "custom",
        message: "Only INSERT uses block-defined style.",
      });
    const g = entity.geometry;
    if (
      (g.type === "line" || g.type === "dimension") &&
      g.start.x === g.end.x &&
      g.start.y === g.end.y
    )
      context.addIssue({
        code: "custom",
        message: "CAD line/dimension is degenerate.",
      });
    if (
      g.type === "hatch" &&
      Array.isArray(g.boundary) &&
      !isSimpleCadBoundary(g.boundary)
    )
      context.addIssue({
        code: "custom",
        message: "CAD HATCH requires a simple boundary of at most 4096 points.",
      });
    if (
      g.type === "arc" &&
      !(
        g.endAngleDegrees > g.startAngleDegrees &&
        g.endAngleDegrees - g.startAngleDegrees <= 360
      )
    )
      context.addIssue({
        code: "custom",
        message:
          "CAD arc must have a positive counterclockwise sweep of at most 360 degrees.",
      });
  });
const manifest = z
  .object({
    schemaVersion: z.literal("1hk-native-cad/1"),
    qualification: z.literal("experimental-unqualified"),
    units: z.literal("mm"),
    coordinateSystem: z.literal("WCS_X_RIGHT_Y_UP"),
    targetVersion: z.literal("AC1024"),
    scope: z
      .object({
        projectId: uuid,
        documentId: uuid,
        revisionId: uuid,
        operationSequence: z
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER),
        structureSha256: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict(),
    canvas: z
      .object({
        id: uuid,
        pageId: uuid,
        name: DrawingObjectNameSchema,
        modelWidthMillimeters: positive,
        modelHeightMillimeters: positive,
        outputProfile: DrawingOutputProfileSchema,
        viewport: z
          .object({
            paperCenter: PointSchema,
            viewCenter: PointSchema,
            viewHeight: positive,
            scale: positive,
          })
          .strict(),
      })
      .strict(),
    layers: z.array(
      DrawingStructureLayerSchema.innerType()
        .extend({ cadName: z.string().regex(/^L_[0-9a-f]{32}$/) })
        .strict(),
    ),
    blocks: z
      .array(
        z
          .object({
            id: uuid,
            name: DrawingObjectNameSchema,
            version,
            cadName: z.string().regex(/^B_[0-9a-f]{32}$/),
            primitives: z.array(
              z
                .object({
                  localId: id,
                  name: DrawingObjectNameSchema,
                  entityIds: z.array(id).min(1),
                })
                .strict(),
            ),
            entities: z.array(entity),
          })
          .strict(),
      )
      .max(1000),
    entities: z.array(entity).max(100_000),
    lineage: z
      .array(
        z
          .object({
            id: uuid,
            kind: z.enum(["object", "block_instance"]),
            name: DrawingObjectNameSchema,
            version,
            entityIds: z.array(id),
            representation: z.literal("fully-opened-wall").optional(),
          })
          .strict(),
      )
      .max(10_000),
    metadata: z
      .object({
        structure: DrawingCadSourceStructureSchema,
        schedulePlacement: z.literal("not-authored"),
      })
      .strict(),
    policies: z
      .object({
        fontFile: z.literal("NotoSansKR-Regular.ttf"),
        fontStatus: z.literal("not-verified"),
        fontRedistributed: z.literal(false),
        text: z.literal("literal-authored-newlines-only"),
        plot: z.literal("direct-rgb-lineweights"),
        plotStyleFile: z.null(),
        lineweight: z.literal("requested-paper-mm-not-quantized"),
        dimensionGraphics: z.literal("verify-generated-child-font-style"),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const issue = (message: string) =>
      context.addIssue({ code: "custom", message });
    const source = value.metadata.structure;
    const canvas = source.canvases[value.canvas.id];
    if (
      !canvas ||
      source.revisionId !== value.scope.revisionId ||
      canvas.pageId !== value.canvas.pageId ||
      canvas.name !== value.canvas.name ||
      canvas.widthMillimeters !== value.canvas.modelWidthMillimeters ||
      canvas.heightMillimeters !== value.canvas.modelHeightMillimeters
    )
      issue("CAD canvas/scope do not match source graph.");
    if (
      canvas &&
      !DrawingCanvasSchema.safeParse({
        ...canvas,
        outputProfile: value.canvas.outputProfile,
      }).success
    )
      issue("CAD output profile does not match canvas.");
    if (
      canvas?.outputProfile &&
      nativeAssetCanonicalJson(canvas.outputProfile) !==
        nativeAssetCanonicalJson(value.canvas.outputProfile)
    )
      issue("CAD profile differs from persisted profile.");
    const profile = value.canvas.outputProfile,
      viewport = value.canvas.viewport;
    if (
      viewport.paperCenter.x !== profile.widthMillimeters / 2 ||
      viewport.paperCenter.y !== profile.heightMillimeters / 2 ||
      viewport.viewCenter.x !== value.canvas.modelWidthMillimeters / 2 ||
      viewport.viewCenter.y !== -value.canvas.modelHeightMillimeters / 2 ||
      viewport.viewHeight !== value.canvas.modelHeightMillimeters ||
      viewport.scale !== 1 / profile.scaleDenominator
    )
      issue("CAD viewport does not match profile.");
    const ids = new Set<string>(),
      layerIds = new Set(value.layers.map((layer) => layer.id)),
      blockIds = new Set(value.blocks.map((block) => block.id));
    const unique = (id: string) => {
      if (ids.has(id)) issue(`Duplicate CAD identity ${id}.`);
      ids.add(id);
    };
    value.layers.forEach((layer) => {
      unique(layer.id);
      const { cadName, ...canonical } = layer;
      if (
        nativeAssetCanonicalJson(canonical) !==
          nativeAssetCanonicalJson(source.layers[layer.id] ?? null) ||
        cadName !== `L_${layer.id.replaceAll("-", "").toLowerCase()}`
      )
        issue("CAD layer differs from canonical source.");
    });
    for (const block of value.blocks) {
      unique(block.id);
      if (!source.blocks[block.id]) issue("Unknown CAD block.");
      const authoredBlock = source.blocks[block.id];
      if (
        authoredBlock &&
        (authoredBlock.name !== block.name ||
          authoredBlock.version !== block.version ||
          block.cadName !== `B_${block.id.replaceAll("-", "").toLowerCase()}` ||
          nativeAssetCanonicalJson(
            block.primitives.map((p) => ({ localId: p.localId, name: p.name })),
          ) !==
            nativeAssetCanonicalJson(
              authoredBlock.primitives.map((p) => ({
                localId: p.localId,
                name: p.name,
              })),
            ))
      )
        issue("CAD block primitive identity differs from source.");
      const localIds = new Set(block.entities.map((entity) => entity.id)),
        mapped = new Set<string>();
      for (const primitive of block.primitives)
        for (const entityId of primitive.entityIds) {
          if (!localIds.has(entityId) || mapped.has(entityId))
            issue("Invalid block primitive lineage.");
          mapped.add(entityId);
        }
      if (mapped.size !== localIds.size) issue("Unmapped block entities.");
      for (const entity of block.entities) {
        unique(entity.id);
        if (entity.layerId !== null || entity.geometry.type === "insert")
          issue("Block primitives must be local, non-nested entities.");
      }
    }
    const modelIds = new Set(value.entities.map((entity) => entity.id)),
      mapped = new Set<string>();
    for (const entity of value.entities) {
      unique(entity.id);
      if (!entity.layerId || !layerIds.has(entity.layerId))
        issue("Unknown model layer.");
      if (
        entity.geometry.type === "insert" &&
        !blockIds.has(entity.geometry.blockId)
      )
        issue("Unknown INSERT block.");
    }
    for (const line of value.lineage) {
      unique(line.id);
      const authored =
        line.kind === "object"
          ? source.objects[line.id]
          : source.blockInstances[line.id];
      if (
        !authored ||
        authored.name !== line.name ||
        authored.version !== line.version
      )
        issue("Lineage does not match authored source.");
      if (
        !line.entityIds.length &&
        !(
          line.representation === "fully-opened-wall" &&
          authored &&
          "geometry" in authored &&
          authored.geometry.type === "wall"
        )
      )
        issue("Unexpected empty CAD lineage.");
      if (line.entityIds.length && line.representation)
        issue("Represented wall cannot have an empty representation marker.");
      for (const entityId of line.entityIds) {
        if (!modelIds.has(entityId) || mapped.has(entityId))
          issue("Invalid model entity lineage.");
        mapped.add(entityId);
      }
    }
    if (
      mapped.size !== modelIds.size ||
      value.lineage.length !==
        Object.keys(source.objects).length +
          Object.keys(source.blockInstances).length
    )
      issue("Incomplete CAD lineage.");
    if (
      value.layers.length !== Object.keys(source.layers).length ||
      value.blocks.length !== Object.keys(source.blocks).length
    )
      issue("Incomplete CAD definitions.");
    for (const entity of [
      ...value.entities,
      ...value.blocks.flatMap((block) => block.entities),
    ])
      if (
        entity.style.kind === "resolved" &&
        entity.style.requestedPaperLineweightMillimeters !==
          entity.style.strokeWidth / value.canvas.outputProfile.scaleDenominator
      )
        issue(
          "CAD requested paper lineweight does not match world stroke width.",
        );
  });

export const DrawingCadManifestSchema = z
  .unknown()
  .superRefine((value, context) => {
    try {
      assertDrawingCadJsonBudget(value, false);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid CAD JSON.",
      });
    }
  })
  .pipe(manifest);
export type DrawingCadManifest = z.infer<typeof DrawingCadManifestSchema>;
export type DrawingCadEntity = DrawingCadManifest["entities"][number];
