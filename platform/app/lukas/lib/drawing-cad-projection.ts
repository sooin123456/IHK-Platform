import { z } from "zod";
import {
  assertDrawingCadJsonBudget,
  isSimpleCadBoundary,
  DrawingCadManifestSchema,
  DrawingCadSourceStructureSchema,
  type DrawingCadEntity,
  type DrawingCadManifest,
} from "./drawing-cad-manifest.ts";
import { resolveDrawingStyle } from "./drawing-structure.ts";
import { orderDrawingCanvasItems } from "./drawing-blocks.ts";
import {
  DrawingCanvasSchema,
  DrawingOutputProfileSchema,
  type DrawingGeometry,
  type DrawingObject,
  type DrawingStyle,
  type Point,
} from "./drawing-workspace.types.ts";
import {
  drawingDimensionContextForCanvas,
  drawingDimensionLayout,
  drawingTextLayout,
} from "./drawing-layout.ts";
import {
  drawingOpeningMarkerSegments,
  drawingSemanticLabelLayout,
  DRAWING_SEMANTIC_RENDER_METRICS,
} from "./drawing-geometry.ts";
import {
  resolveDrawingOpening,
  drawingSemanticScaledInteger,
} from "./drawing-semantic-geometry.ts";
import {
  nativeAssetCanonicalJson,
  nativeAssetSha256,
} from "./drawing-native-symbols.ts";

const inputSchema = z
  .object({
    projectId: z.string().uuid(),
    documentId: z.string().uuid(),
    operationSequence: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    canvasId: z.string().uuid(),
    structure: z.unknown(),
    outputProfile: DrawingOutputProfileSchema,
  })
  .strict();
const cadPoint = ({ x, y }: Point): Point => ({ x, y: y === 0 ? 0 : -y });
const sorted = <T extends { id: string }>(record: Record<string, T>): T[] =>
  Object.values(record).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

export async function buildDrawingCadManifest(
  input: unknown,
): Promise<DrawingCadManifest> {
  assertDrawingCadJsonBudget(input);
  const parsed = inputSchema.parse(input);
  const raw = parsed.structure as Record<string, unknown> | null;
  const count = (key: string) =>
    raw && typeof raw[key] === "object" && raw[key] !== null
      ? Object.keys(raw[key]).length
      : 0;
  if (
    count("objects") + count("blockInstances") > 10_000 ||
    count("blocks") > 1_000
  )
    throw new Error("CAD object or block budget exceeded.");
  const state = DrawingCadSourceStructureSchema.parse(
    JSON.parse(nativeAssetCanonicalJson(parsed.structure)),
  );
  type DrawingOpeningObject = DrawingObject & {
    geometry: Extract<DrawingGeometry, { type: "opening" }>;
  };
  const openingsByWall = new Map<string, DrawingOpeningObject[]>();
  for (const object of sorted(state.objects)) {
    if (object.geometry.type !== "opening") continue;
    const opening = object as DrawingOpeningObject;
    const openings = openingsByWall.get(opening.geometry.hostWallId);
    if (openings) openings.push(opening);
    else openingsByWall.set(opening.geometry.hostWallId, [opening]);
  }
  const canvas = state.canvases[parsed.canvasId];
  if (!canvas) throw new Error("Selected CAD canvas does not exist.");
  if (
    canvas.outputProfile &&
    nativeAssetCanonicalJson(canvas.outputProfile) !==
      nativeAssetCanonicalJson(parsed.outputProfile)
  )
    throw new Error("Authored and persisted output profiles disagree.");
  DrawingCanvasSchema.parse({ ...canvas, outputProfile: parsed.outputProfile });
  const dimensionContext = drawingDimensionContextForCanvas(canvas);
  const scale = parsed.outputProfile.scaleDenominator;
  const entities: DrawingCadEntity[] = [];
  const lineage: DrawingCadManifest["lineage"] = [];
  let entityCount = 0;
  const styleFor = (style: DrawingStyle): DrawingCadEntity["style"] => ({
    ...style,
    kind: "resolved",
    requestedPaperLineweightMillimeters: style.strokeWidth / scale,
  });
  const emit = (
    target: DrawingCadEntity[],
    prefix: string,
    layerId: string | null,
    style: DrawingStyle,
    geometry: DrawingCadEntity["geometry"],
  ) => {
    if (++entityCount > 100_000)
      throw new Error("CAD emitted entity budget exceeded.");
    const id = `${prefix}/${target.length}`;
    target.push({ id, layerId, style: styleFor(style), geometry });
    return id;
  };
  const project = (
    geometry: DrawingGeometry,
    name: string,
    style: DrawingStyle,
    prefix: string,
    layerId: string | null,
    target: DrawingCadEntity[],
  ) => {
    const add = (geometry: DrawingCadEntity["geometry"], override = style) =>
      emit(target, prefix, layerId, override, geometry);
    const polygon = (points: Point[], color: string | null = style.fill) => {
      const boundary = points.map(cadPoint);
      if (color)
        add({
          type: "hatch",
          boundary,
          color: color.slice(0, 7),
          opacity: color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1,
        });
      add({
        type: "polyline",
        points: boundary.map((point) => ({ ...point })),
        closed: true,
      });
    };
    switch (geometry.type) {
      case "line":
        add({
          type: "line",
          start: cadPoint(geometry.start),
          end: cadPoint(geometry.end),
        });
        break;
      case "polyline": {
        if (geometry.closed && style.fill) {
          const points = geometry.points;
          const boundary =
            points.length > 1 &&
            points[0].x === points.at(-1)!.x &&
            points[0].y === points.at(-1)!.y
              ? points.slice(0, -1)
              : points;
          if (!isSimpleCadBoundary(boundary))
            throw new Error(
              "Filled CAD polyline requires a simple boundary of at most 4096 points.",
            );
          polygon(boundary);
        } else
          add({
            type: "polyline",
            points: geometry.points.map(cadPoint),
            closed: geometry.closed,
          });
        break;
      }
      case "rectangle": {
        const angle = (geometry.rotation * Math.PI) / 180,
          c = Math.cos(angle),
          s = Math.sin(angle);
        polygon(
          [
            { x: 0, y: 0 },
            { x: geometry.width, y: 0 },
            { x: geometry.width, y: geometry.height },
            { x: 0, y: geometry.height },
          ].map((p) => ({
            x: geometry.origin.x + p.x * c - p.y * s,
            y: geometry.origin.y + p.x * s + p.y * c,
          })),
        );
        break;
      }
      case "circle": {
        if (style.fill)
          add({
            type: "hatch",
            boundary: {
              type: "circle",
              center: cadPoint(geometry.center),
              radius: geometry.radius,
            },
            color: style.fill.slice(0, 7),
            opacity:
              style.fill.length === 9
                ? parseInt(style.fill.slice(7), 16) / 255
                : 1,
          });
        add({
          type: "circle",
          center: cadPoint(geometry.center),
          radius: geometry.radius,
        });
        break;
      }
      case "arc": {
        const startMicrodegrees =
          drawingSemanticScaledInteger(geometry.startAngleDegrees)! %
          360_000_000n;
        const start = Number(startMicrodegrees) / 1_000_000;
        const end =
          Number(
            startMicrodegrees +
              drawingSemanticScaledInteger(geometry.sweepAngleDegrees)!,
          ) / 1_000_000;
        const reflected = (angle: number) => (angle === 0 ? 0 : -angle);
        add({
          type: "arc",
          center: cadPoint(geometry.center),
          radius: geometry.radius,
          startAngleDegrees: reflected(
            geometry.sweepAngleDegrees > 0 ? end : start,
          ),
          endAngleDegrees: reflected(
            geometry.sweepAngleDegrees > 0 ? start : end,
          ),
        });
        break;
      }
      case "text": {
        const layout = drawingTextLayout(geometry, style.fontSize ?? 14);
        add({
          type: "text",
          origin: cadPoint(geometry.origin),
          text: geometry.text,
          width: layout.width,
          fontSize: layout.fontSize,
          lineHeight: layout.lineHeight,
          attachment: "top-left",
          wrapping: "authored-newlines-only",
          rotationDegrees: 0,
        });
        break;
      }
      case "dimension": {
        const layout = drawingDimensionLayout(
          geometry,
          dimensionContext,
          style.fontSize ?? 12,
        );
        if (layout.warning)
          throw new Error("CAD dimension calibration is unconfirmed.");
        add({
          type: "dimension",
          start: cadPoint(geometry.start),
          end: cadPoint(geometry.end),
          dimensionLinePoint: cadPoint(layout.displayEnd),
          textPosition: cadPoint(layout.label),
          fontSize: layout.fontSize,
          precision: 1,
          suffix: " mm",
          measurementMillimeters: Math.hypot(
            geometry.end.x - geometry.start.x,
            geometry.end.y - geometry.start.y,
          ),
        });
        break;
      }
      case "wall": {
        const dx = geometry.end.x - geometry.start.x,
          dy = geometry.end.y - geometry.start.y;
        const length = Math.hypot(dx, dy),
          ux = dx / length,
          uy = dy / length,
          half = geometry.thicknessMillimeters / 2;
        const wallId = prefix.slice("object/".length);
        const intervals = (openingsByWall.get(wallId) ?? [])
          .map((object) => {
            const opening = resolveDrawingOpening(
              object.geometry,
              state.objects,
            );
            const along = (p: Point) =>
              (p.x - geometry.start.x) * ux + (p.y - geometry.start.y) * uy;
            return [
              Math.max(0, along(opening.start)),
              Math.min(length, along(opening.end)),
            ];
          })
          .sort((a, b) => a[0] - b[0]);
        const merged: number[][] = [];
        for (const interval of intervals) {
          const last = merged.at(-1);
          if (last && interval[0] <= last[1])
            last[1] = Math.max(last[1], interval[1]);
          else merged.push([...interval]);
        }
        let cursor = 0;
        const strip = (start: number, end: number) => {
          if (end <= start) return;
          const a = start === 0 ? -half : start,
            b = end === length ? length + half : end;
          polygon(
            [
              { x: a, y: half },
              { x: b, y: half },
              { x: b, y: -half },
              { x: a, y: -half },
            ].map((p) => ({
              x: geometry.start.x + ux * p.x - uy * p.y,
              y: geometry.start.y + uy * p.x + ux * p.y,
            })),
            style.fill ?? style.stroke,
          );
        };
        for (const [start, end] of merged) {
          strip(cursor, start);
          cursor = end;
        }
        strip(cursor, length);
        break;
      }
      case "opening": {
        const resolved = resolveDrawingOpening(geometry, state.objects);
        drawingOpeningMarkerSegments(geometry, resolved).forEach(
          ([start, end], index) => {
            const metrics = DRAWING_SEMANTIC_RENDER_METRICS;
            const strokeWidth =
              index === 0
                ? geometry.openingKind === "void"
                  ? metrics.voidWidth
                  : metrics.openingWidth
                : geometry.openingKind === "door"
                  ? metrics.doorMarkerWidth
                  : metrics.windowMarkerWidth;
            add(
              { type: "line", start: cadPoint(start), end: cadPoint(end) },
              { ...style, strokeWidth, fill: null },
            );
          },
        );
        break;
      }
      case "space":
      case "area": {
        polygon(
          geometry.boundary,
          style.fill ??
            (geometry.type === "space"
              ? DRAWING_SEMANTIC_RENDER_METRICS.spaceFill
              : DRAWING_SEMANTIC_RENDER_METRICS.areaFill),
        );
        const layout = drawingSemanticLabelLayout(
          geometry,
          name,
          style.fontSize ?? 14,
        );
        add({
          type: "text",
          origin: cadPoint({ x: layout.x, y: layout.y }),
          text: layout.text,
          width: layout.width,
          fontSize: layout.fontSize,
          lineHeight: layout.lineHeight,
          attachment: "top-left",
          wrapping: "authored-newlines-only",
          rotationDegrees: -layout.rotation,
        });
        break;
      }
      case "grid":
        throw new Error("CAD grid linetype and bubble mapping is unsupported.");
      default: {
        const unsupported: never = geometry;
        throw new Error(`Unsupported CAD geometry: ${unsupported}.`);
      }
    }
  };
  const blocks: DrawingCadManifest["blocks"] = sorted(state.blocks).map(
    (block) => {
      const entities: DrawingCadEntity[] = [];
      const primitives = block.primitives.map((primitive) => {
        const start = entities.length;
        project(
          primitive.geometry,
          primitive.name,
          resolveDrawingStyle(primitive, state.styles),
          `block/${block.id}/${encodeURIComponent(primitive.localId)}`,
          null,
          entities,
        );
        return {
          localId: primitive.localId,
          name: primitive.name,
          entityIds: entities.slice(start).map((entity) => entity.id),
        };
      });
      return {
        id: block.id,
        name: block.name,
        version: block.version,
        cadName: `B_${block.id.replaceAll("-", "").toLowerCase()}`,
        primitives,
        entities,
      };
    },
  );
  const items = orderDrawingCanvasItems(
    [
      ...Object.values(state.objects).map((object) => ({
        id: object.id,
        layerId: object.layerId,
        kind: "object" as const,
        object,
      })),
      ...Object.values(state.blockInstances).map((instance) => ({
        id: instance.id,
        layerId: instance.layerId,
        kind: "instance" as const,
        instance,
      })),
    ],
    state.layers,
    (item) =>
      item.kind === "object" && item.object.geometry.type === "opening"
        ? item.object.geometry.hostWallId
        : null,
  );
  for (const item of items) {
    if (item.kind === "object") {
      const object = item.object;
      const start = entities.length;
      project(
        object.geometry,
        object.name,
        resolveDrawingStyle(object, state.styles),
        `object/${object.id}`,
        object.layerId,
        entities,
      );
      const entityIds = entities.slice(start).map((entity) => entity.id);
      lineage.push({
        id: object.id,
        kind: "object",
        name: object.name,
        version: object.version,
        entityIds,
        ...(entityIds.length === 0 && object.geometry.type === "wall"
          ? { representation: "fully-opened-wall" as const }
          : {}),
      });
    } else {
      const instance = item.instance;
      if (++entityCount > 100_000)
        throw new Error("CAD emitted entity budget exceeded.");
      const id = `instance/${instance.id}`;
      entities.push({
        id,
        layerId: instance.layerId,
        style: { kind: "block-defined" },
        geometry: {
          type: "insert",
          blockId: instance.blockId,
          origin: cadPoint(instance.origin),
          rotationDegrees: -instance.rotation,
          scaleX: instance.scaleX,
          scaleY: instance.scaleY,
        },
      });
      lineage.push({
        id: instance.id,
        kind: "block_instance",
        name: instance.name,
        version: instance.version,
        entityIds: [id],
      });
    }
  }
  return DrawingCadManifestSchema.parse({
    schemaVersion: "1hk-native-cad/1",
    qualification: "experimental-unqualified",
    units: "mm",
    coordinateSystem: "WCS_X_RIGHT_Y_UP",
    targetVersion: "AC1024",
    scope: {
      projectId: parsed.projectId,
      documentId: parsed.documentId,
      revisionId: state.revisionId,
      operationSequence: parsed.operationSequence,
      structureSha256: await nativeAssetSha256(state),
    },
    canvas: {
      id: canvas.id,
      pageId: canvas.pageId,
      name: canvas.name,
      modelWidthMillimeters: canvas.widthMillimeters,
      modelHeightMillimeters: canvas.heightMillimeters,
      outputProfile: parsed.outputProfile,
      viewport: {
        paperCenter: {
          x: parsed.outputProfile.widthMillimeters / 2,
          y: parsed.outputProfile.heightMillimeters / 2,
        },
        viewCenter: {
          x: canvas.widthMillimeters / 2,
          y: -canvas.heightMillimeters / 2,
        },
        viewHeight: canvas.heightMillimeters,
        scale: 1 / scale,
      },
    },
    layers: sorted(state.layers).map((layer) => ({
      ...layer,
      cadName: `L_${layer.id.replaceAll("-", "").toLowerCase()}`,
    })),
    blocks,
    entities,
    lineage,
    metadata: { structure: state, schedulePlacement: "not-authored" },
    policies: {
      fontFile: "NotoSansKR-Regular.ttf",
      fontStatus: "not-verified",
      fontRedistributed: false,
      text: "literal-authored-newlines-only",
      plot: "direct-rgb-lineweights",
      plotStyleFile: null,
      lineweight: "requested-paper-mm-not-quantized",
      dimensionGraphics: "verify-generated-child-font-style",
    },
  });
}
