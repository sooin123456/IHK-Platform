import {
  DRAWING_SEMANTIC_RENDER_METRICS,
  drawingSemanticLabelLayout,
  geometryBounds,
} from "./drawing-geometry.ts";
import {
  drawingDimensionBoundsPoints,
  drawingLayoutCorners,
  drawingTextLayout,
} from "./drawing-layout.ts";
import { resolveDrawingStyle } from "./drawing-structure.ts";
import { drawingTargetReferenceCleanupActions } from "./drawing-properties.ts";
import type {
  DrawingCommand,
  DrawingDocumentState,
} from "./drawing-commands.ts";
import {
  DrawingBlockInstanceSchema,
  DrawingBlockSchema,
  DrawingPrimitiveGeometrySchema,
  type Bounds,
  type DrawingBlock,
  type DrawingBlockInstance,
  type DrawingBlockPrimitive,
  type DrawingPrimitiveGeometry,
  type DrawingObject,
  type DrawingStyle,
  type DrawingStyleDefinition,
  type Point,
} from "./drawing-workspace.types.ts";

type StructureCommand = Extract<DrawingCommand, { type: "mutate_structure" }>;

export class DrawingBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrawingBlockError";
  }
}

type CanonicalBlockState = DrawingDocumentState & {
  structure: NonNullable<DrawingDocumentState["structure"]>;
};

function canonicalState(state: DrawingDocumentState): CanonicalBlockState {
  if (!state.structure)
    throw new DrawingBlockError("Canonical drawing structure is required.");
  return state as CanonicalBlockState;
}

function structureCommand(
  actorId: string,
  actions: StructureCommand["actions"],
): StructureCommand {
  return { type: "mutate_structure", actorId, actions };
}

function finiteTransform(
  instance: Pick<
    DrawingBlockInstance,
    "origin" | "rotation" | "scaleX" | "scaleY"
  >,
) {
  if (
    !Number.isFinite(instance.origin.x) ||
    !Number.isFinite(instance.origin.y) ||
    !Number.isFinite(instance.rotation)
  )
    throw new DrawingBlockError("Block transform values must be finite.");
  if (!Number.isFinite(instance.scaleX) || !Number.isFinite(instance.scaleY))
    throw new DrawingBlockError("Block scale values must be finite.");
  if (instance.scaleX === 0 || instance.scaleY === 0)
    throw new DrawingBlockError("Block scale values must be nonzero.");
}

/** Applies scale, then rotation, then translation without a matrix dependency. */
export function transformBlockPoint(
  point: Point,
  instance: Pick<
    DrawingBlockInstance,
    "origin" | "rotation" | "scaleX" | "scaleY"
  >,
): Point {
  finiteTransform(instance);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
    throw new DrawingBlockError("Block geometry values must be finite.");
  const angle = (instance.rotation * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const x = point.x * instance.scaleX;
  const y = point.y * instance.scaleY;
  return {
    x: x * cosine - y * sine + instance.origin.x,
    y: x * sine + y * cosine + instance.origin.y,
  };
}

function translatePoint(point: Point, origin: Point): Point {
  return { x: point.x - origin.x, y: point.y - origin.y };
}

function translateGeometry(
  geometry: DrawingPrimitiveGeometry,
  origin: Point,
): DrawingPrimitiveGeometry {
  switch (geometry.type) {
    case "line":
      return {
        ...geometry,
        start: translatePoint(geometry.start, origin),
        end: translatePoint(geometry.end, origin),
      };
    case "polyline":
      return {
        ...geometry,
        points: geometry.points.map((point) => translatePoint(point, origin)),
      };
    case "rectangle":
      return { ...geometry, origin: translatePoint(geometry.origin, origin) };
    case "circle":
      return { ...geometry, center: translatePoint(geometry.center, origin) };
    case "text":
      return { ...geometry, origin: translatePoint(geometry.origin, origin) };
    case "dimension":
      return {
        ...geometry,
        start: translatePoint(geometry.start, origin),
        end: translatePoint(geometry.end, origin),
      };
  }
}

/** Canonically sorts selected objects and makes local geometry around their top-left union. */
export function worldObjectsToBlockPrimitives(
  objects: readonly DrawingObject[],
  createLocalId: (object: DrawingObject, index: number) => string,
): { origin: Point; primitives: DrawingBlockPrimitive[] } {
  if (objects.length === 0)
    throw new DrawingBlockError(
      "A block requires at least one selected object.",
    );
  const ordered = [...objects].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const seen = new Set<string>();
  for (const object of ordered) {
    if (seen.has(object.id))
      throw new DrawingBlockError(
        "A block selection cannot contain duplicate objects.",
      );
    seen.add(object.id);
    if (!DrawingPrimitiveGeometrySchema.safeParse(object.geometry).success) {
      throw new DrawingBlockError(
        "Semantic drawing objects cannot become block primitives.",
      );
    }
  }
  const bounds = ordered.map((object) => geometryBounds(object.geometry));
  const origin = {
    x: Math.min(...bounds.map((value) => value.x)),
    y: Math.min(...bounds.map((value) => value.y)),
  };
  const localIds = new Set<string>();
  const primitives = ordered.map((object, index) => {
    const localId = createLocalId(object, index);
    if (!localId || localIds.has(localId))
      throw new DrawingBlockError(
        "Block primitive local IDs must be nonempty and unique.",
      );
    localIds.add(localId);
    return {
      localId,
      name: object.name,
      geometry: translateGeometry(
        DrawingPrimitiveGeometrySchema.parse(structuredClone(object.geometry)),
        origin,
      ),
      styleId: object.styleId ?? null,
      style: structuredClone(object.style),
    };
  });
  return { origin, primitives };
}

function rectanglePoints(
  origin: Point,
  width: number,
  height: number,
  rotation: number,
): Point[] {
  const angle = (rotation * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ].map((point) => ({
    x: origin.x + point.x * cosine - point.y * sine,
    y: origin.y + point.x * sine + point.y * cosine,
  }));
}

function pointsBounds(points: Point[]): Bounds {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function primitiveWorldBounds(
  primitive: DrawingBlockPrimitive,
  instance: DrawingBlockInstance,
  style: DrawingStyle,
): Bounds {
  const geometry = primitive.geometry;
  if (geometry.type === "circle") {
    const center = transformBlockPoint(geometry.center, instance);
    const angle = (instance.rotation * Math.PI) / 180;
    const extentX =
      geometry.radius *
      Math.hypot(
        instance.scaleX * Math.cos(angle),
        instance.scaleY * Math.sin(angle),
      );
    const extentY =
      geometry.radius *
      Math.hypot(
        instance.scaleX * Math.sin(angle),
        instance.scaleY * Math.cos(angle),
      );
    return {
      x: center.x - extentX,
      y: center.y - extentY,
      width: extentX * 2,
      height: extentY * 2,
    };
  }
  let points: Point[];
  switch (geometry.type) {
    case "line":
      points = [geometry.start, geometry.end];
      break;
    case "polyline":
      points = geometry.points;
      break;
    case "rectangle":
      points = rectanglePoints(
        geometry.origin,
        geometry.width,
        geometry.height,
        geometry.rotation,
      );
      break;
    case "text":
      points = drawingLayoutCorners(
        geometry.origin,
        geometry.width,
        drawingTextLayout(geometry, style.fontSize ?? 14).height,
      );
      break;
    case "dimension":
      points = drawingDimensionBoundsPoints(geometry);
      break;
  }
  return pointsBounds(
    points.map((point) => transformBlockPoint(point, instance)),
  );
}

export type DrawingBlockRenderModel = {
  blockId: string;
  blockVersion: number;
  instance: DrawingBlockInstance;
  primitives: Array<DrawingBlockPrimitive & { style: DrawingStyle }>;
};

/** Resolves definitions on every model build so block/style edits propagate without instance writes. */
export function blockInstanceRenderModel(
  block: DrawingBlock,
  instance: DrawingBlockInstance,
  styles:
    readonly DrawingStyleDefinition[] | Record<string, DrawingStyleDefinition>,
): DrawingBlockRenderModel {
  let definition: DrawingBlock;
  let placed: DrawingBlockInstance;
  try {
    definition = DrawingBlockSchema.parse(structuredClone(block));
    placed = DrawingBlockInstanceSchema.parse(structuredClone(instance));
  } catch (error) {
    throw new DrawingBlockError(
      error instanceof Error
        ? `Block geometry and transform values must be finite with nonzero scale: ${error.message}`
        : "Block geometry and transform values must be finite with nonzero scale.",
    );
  }
  if (placed.blockId !== definition.id)
    throw new DrawingBlockError(
      "Block instance references a different definition.",
    );
  finiteTransform(placed);
  return {
    blockId: definition.id,
    blockVersion: definition.version,
    instance: placed,
    primitives: definition.primitives.map((primitive) => ({
      ...primitive,
      style: resolveDrawingStyle(primitive, styles),
    })),
  };
}

/** Exact axis-aligned world bounds for supported primitives after instance transform. */
export function blockInstanceBounds(
  block: DrawingBlock,
  instance: DrawingBlockInstance,
  styles:
    readonly DrawingStyleDefinition[] | Record<string, DrawingStyleDefinition>,
): Bounds {
  const model = blockInstanceRenderModel(block, instance, styles);
  return blockRenderModelBounds(model);
}

/** Derives bounds from an already-resolved live model without resolving styles twice. */
export function blockRenderModelBounds(model: DrawingBlockRenderModel): Bounds {
  const bounds = model.primitives.map((primitive) =>
    primitiveWorldBounds(primitive, model.instance, primitive.style),
  );
  const x = Math.min(...bounds.map((value) => value.x));
  const y = Math.min(...bounds.map((value) => value.y));
  const right = Math.max(...bounds.map((value) => value.x + value.width));
  const bottom = Math.max(...bounds.map((value) => value.y + value.height));
  return { x, y, width: right - x, height: bottom - y };
}

export type DrawingCanvasRenderItem =
  | {
      bounds: Bounds;
      id: string;
      kind: "object";
      layerId: string;
      object: DrawingObject & { style: DrawingStyle };
    }
  | {
      bounds: Bounds;
      id: string;
      kind: "block";
      layerId: string;
      model: DrawingBlockRenderModel & { bounds: Bounds };
    };

const DRAWING_SCREEN_RENDER_PADDING_PIXELS = 8;

function expandBounds(bounds: Bounds, padding: number): Bounds {
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };
}

function unionBounds(...bounds: Bounds[]): Bounds {
  const x = Math.min(...bounds.map((value) => value.x));
  const y = Math.min(...bounds.map((value) => value.y));
  const right = Math.max(...bounds.map((value) => value.x + value.width));
  const bottom = Math.max(...bounds.map((value) => value.y + value.height));
  return { x, y, width: right - x, height: bottom - y };
}

function drawingObjectRenderBounds(
  object: DrawingObject & { style: DrawingStyle },
  objects: Readonly<Record<string, DrawingObject>>,
): Bounds {
  const { geometry, style } = object;
  let bounds = geometryBounds(geometry, objects);
  if (geometry.type === "text") {
    const layout = drawingTextLayout(geometry, style.fontSize ?? 14);
    bounds = pointsBounds(
      drawingLayoutCorners(geometry.origin, layout.width, layout.height),
    );
  } else if (geometry.type === "dimension") {
    bounds = pointsBounds(drawingDimensionBoundsPoints(geometry));
  } else if (
    geometry.type === "space" ||
    geometry.type === "area" ||
    geometry.type === "grid"
  ) {
    const label = drawingSemanticLabelLayout(geometry, object.name);
    bounds = unionBounds(
      bounds,
      pointsBounds(
        rectanglePoints(
          { x: label.x, y: label.y },
          label.width,
          label.height,
          label.rotation,
        ),
      ),
    );
    if (geometry.type === "grid") {
      const radius =
        DRAWING_SEMANTIC_RENDER_METRICS.gridBubbleRadius +
        DRAWING_SEMANTIC_RENDER_METRICS.gridBubbleStrokeWidth / 2;
      bounds = unionBounds(bounds, {
        x: geometry.end.x - radius,
        y: geometry.end.y - radius,
        width: radius * 2,
        height: radius * 2,
      });
    }
  } else if (geometry.type === "opening") {
    const host = objects[geometry.hostWallId];
    if (host?.geometry.type === "wall")
      bounds = expandBounds(
        bounds,
        (host.geometry.thicknessMillimeters +
          DRAWING_SEMANTIC_RENDER_METRICS.openingCutExtra) /
          2,
      );
  }
  return expandBounds(bounds, style.strokeWidth / 2);
}

function drawingBlockRenderBounds(
  model: DrawingBlockRenderModel & { bounds: Bounds },
) {
  const scale = Math.max(
    Math.abs(model.instance.scaleX),
    Math.abs(model.instance.scaleY),
  );
  const strokePadding =
    (Math.max(...model.primitives.map(({ style }) => style.strokeWidth), 0) *
      scale) /
    2;
  return expandBounds(model.bounds, strokePadding);
}

/**
 * Derives the canonical authored-order object set visible to every live
 * canvas consumer. Hosted openings inherit their host wall's layer
 * visibility, while unresolved hosts remain present so strict geometry
 * resolution can fail closed instead of silently hiding corrupt data.
 */
export function drawingVisibleCanvasObjects<T extends DrawingObject>(
  objects: readonly T[],
  layers: Readonly<Record<string, { visible: boolean }>>,
): T[] {
  const objectsById = Object.fromEntries(
    objects.map((object) => [object.id, object]),
  );
  return objects.filter((object) => {
    if (layers[object.layerId]?.visible !== true) return false;
    if (object.geometry.type !== "opening") return true;
    const host = objectsById[object.geometry.hostWallId];
    return host === undefined || layers[host.layerId]?.visible === true;
  });
}

type DrawingCanvasRenderInput = {
  blockInstances: Array<DrawingBlockRenderModel & { bounds: Bounds }>;
  layers: Record<
    string,
    { visible: boolean; locked: boolean; sortOrder?: number }
  >;
  objects: Array<DrawingObject & { style: DrawingStyle }>;
};

export function drawingCanvasRenderItems(input: DrawingCanvasRenderInput) {
  const objectMap = Object.fromEntries(
    input.objects.map((object) => [object.id, object]),
  );
  const sortedItems: DrawingCanvasRenderItem[] = [
    ...drawingVisibleCanvasObjects(input.objects, input.layers).map(
      (object) => ({
        bounds: drawingObjectRenderBounds(object, objectMap),
        id: object.id,
        kind: "object" as const,
        layerId: object.layerId,
        object,
      }),
    ),
    ...input.blockInstances.flatMap((model) =>
      input.layers[model.instance.layerId]?.visible
        ? [
            {
              bounds: drawingBlockRenderBounds(model),
              id: model.instance.id,
              kind: "block" as const,
              layerId: model.instance.layerId,
              model,
            },
          ]
        : [],
    ),
  ].sort(
    (left, right) =>
      (input.layers[left.layerId]?.sortOrder ?? 0) -
        (input.layers[right.layerId]?.sortOrder ?? 0) ||
      left.id.localeCompare(right.id),
  );
  const itemById = new Map(sortedItems.map((item) => [item.id, item]));
  const waitingByHost = new Map<string, DrawingCanvasRenderItem[]>();
  const emittedIds = new Set<string>();
  const items: DrawingCanvasRenderItem[] = [];
  const emit = (item: DrawingCanvasRenderItem) => {
    if (emittedIds.has(item.id)) return;
    emittedIds.add(item.id);
    items.push(item);
    for (const dependent of waitingByHost.get(item.id) ?? []) emit(dependent);
    waitingByHost.delete(item.id);
  };
  for (const item of sortedItems) {
    const hostId =
      item.kind === "object" && item.object.geometry.type === "opening"
        ? item.object.geometry.hostWallId
        : null;
    if (hostId && itemById.has(hostId) && !emittedIds.has(hostId)) {
      const waiting = waitingByHost.get(hostId);
      if (waiting) waiting.push(item);
      else waitingByHost.set(hostId, [item]);
    } else emit(item);
  }
  for (const item of sortedItems) emit(item);
  return items;
}

export function drawingCanvasViewportProjection(input: {
  items: readonly DrawingCanvasRenderItem[];
  layers: DrawingCanvasRenderInput["layers"];
  viewportBounds?: Bounds | null;
  zoom: number;
}) {
  if (!Number.isFinite(input.zoom) || input.zoom <= 0)
    throw new DrawingBlockError("Drawing canvas zoom must be positive.");
  const projectedItems =
    input.viewportBounds === null
      ? []
      : input.viewportBounds
        ? input.items.filter((item) => {
            const bounds = expandBounds(
              item.bounds,
              DRAWING_SCREEN_RENDER_PADDING_PIXELS / input.zoom,
            );
            const viewport = input.viewportBounds!;
            return (
              bounds.x <= viewport.x + viewport.width &&
              bounds.x + bounds.width >= viewport.x &&
              bounds.y <= viewport.y + viewport.height &&
              bounds.y + bounds.height >= viewport.y
            );
          })
        : [...input.items];
  const tolerance = 6 / input.zoom;
  const hitItems = projectedItems.flatMap((item) => {
    const layer = input.layers[item.layerId];
    if (!layer?.visible || layer.locked) return [];
    return [
      {
        ...item,
        hitBounds: {
          x: item.bounds.x - tolerance,
          y: item.bounds.y - tolerance,
          width: item.bounds.width + tolerance * 2,
          height: item.bounds.height + tolerance * 2,
        },
      },
    ];
  });
  return {
    hitItems,
    projectedItems,
    topmostAt(point: Point) {
      return [...hitItems].reverse().find((item) => {
        const bounds = item.hitBounds;
        return (
          point.x >= bounds.x &&
          point.x <= bounds.x + bounds.width &&
          point.y >= bounds.y &&
          point.y <= bounds.y + bounds.height
        );
      });
    },
  };
}

export function drawingCanvasRenderAdapter(
  input: DrawingCanvasRenderInput & { viewportBounds?: Bounds; zoom: number },
) {
  const items = drawingCanvasRenderItems(input);
  return {
    items,
    ...drawingCanvasViewportProjection({
      items,
      layers: input.layers,
      viewportBounds: input.viewportBounds,
      zoom: input.zoom,
    }),
  };
}

export type DrawingBlockRenderCache = {
  readonly resolveCount: number;
  select(input: {
    activeCanvasId: string;
    blocks: Record<string, DrawingBlock>;
    instances: Record<string, DrawingBlockInstance>;
    layers: Record<
      string,
      {
        canvasId?: string | null;
        locked: boolean;
        sortOrder?: number;
        visible: boolean;
      }
    >;
    styles: Record<string, DrawingStyleDefinition>;
  }): {
    error: string | null;
    instances: Array<DrawingBlockRenderModel & { bounds: Bounds }>;
  };
};

/** Memoizes live block resolution only by stable canonical entity-map identity. */
export function createDrawingBlockRenderCache(): DrawingBlockRenderCache {
  let previous:
    | {
        activeCanvasId: string;
        blocks: Record<string, DrawingBlock>;
        instances: Record<string, DrawingBlockInstance>;
        layers: Record<
          string,
          {
            canvasId?: string | null;
            locked: boolean;
            sortOrder?: number;
            visible: boolean;
          }
        >;
        styles: Record<string, DrawingStyleDefinition>;
      }
    | undefined;
  let result: {
    error: string | null;
    instances: Array<DrawingBlockRenderModel & { bounds: Bounds }>;
  } = { error: null, instances: [] };
  let resolveCount = 0;
  return {
    select(input) {
      if (
        previous?.activeCanvasId === input.activeCanvasId &&
        previous.blocks === input.blocks &&
        previous.instances === input.instances &&
        previous.layers === input.layers &&
        previous.styles === input.styles
      )
        return result;
      previous = input;
      const resolved: Array<DrawingBlockRenderModel & { bounds: Bounds }> = [];
      let error: string | null = null;
      const ordered = Object.values(input.instances).sort((left, right) => {
        const layerOrder =
          (input.layers[left.layerId]?.sortOrder ?? 0) -
          (input.layers[right.layerId]?.sortOrder ?? 0);
        return layerOrder || left.id.localeCompare(right.id);
      });
      for (const instance of ordered) {
        const layer = input.layers[instance.layerId];
        if (
          !layer?.visible ||
          (layer.canvasId != null && layer.canvasId !== input.activeCanvasId)
        )
          continue;
        const block = input.blocks[instance.blockId];
        if (!block) {
          error = `Block instance ${instance.id} references a missing block.`;
          continue;
        }
        try {
          const model = blockInstanceRenderModel(block, instance, input.styles);
          resolveCount += 1;
          resolved.push({ ...model, bounds: blockRenderModelBounds(model) });
        } catch (caught) {
          error =
            caught instanceof Error
              ? caught.message
              : "Drawing block cannot be resolved.";
        }
      }
      result = { error, instances: resolved };
      return result;
    },
    get resolveCount() {
      return resolveCount;
    },
  };
}

/** Produces one aggregate hit target per visible unlocked instance. */
export function drawingBlockSelectionCandidates(
  instances: readonly DrawingBlockInstance[],
  blocks: Record<string, DrawingBlock>,
  layers: Record<string, { visible: boolean; locked: boolean }>,
  styles:
    readonly DrawingStyleDefinition[] | Record<string, DrawingStyleDefinition>,
  zoom: number,
  tolerancePixels = 6,
): Array<{ id: string; bounds: Bounds }> {
  if (!Number.isFinite(zoom) || zoom <= 0)
    throw new DrawingBlockError(
      "Block hit-test zoom must be finite and positive.",
    );
  const tolerance = tolerancePixels / zoom;
  return instances.flatMap((instance) => {
    const layer = layers[instance.layerId];
    if (!layer?.visible || layer.locked) return [];
    const block = blocks[instance.blockId];
    if (!block)
      throw new DrawingBlockError(
        `Block instance ${instance.id} references a missing block.`,
      );
    const bounds = blockInstanceBounds(block, instance, styles);
    return [
      {
        id: instance.id,
        bounds: {
          x: bounds.x - tolerance,
          y: bounds.y - tolerance,
          width: bounds.width + tolerance * 2,
          height: bounds.height + tolerance * 2,
        },
      },
    ];
  });
}

type BlockCreateOptions = {
  activeLayerId: string;
  createId?: () => string;
};

/** Builds the server-compatible definition + instance + object deletion atomic batch. */
export function createBlockFromSelection(
  inputState: DrawingDocumentState,
  selectedIds: readonly string[],
  actorId: string,
  name: string,
  options: BlockCreateOptions,
): StructureCommand {
  const state = canonicalState(inputState);
  const uniqueIds = [...new Set(selectedIds)];
  if (uniqueIds.length === 0 || uniqueIds.length !== selectedIds.length)
    throw new DrawingBlockError(
      "Block selection must contain unique existing objects.",
    );
  const objects = uniqueIds.map((id) => state.objects[id]);
  if (objects.some((object) => !object))
    throw new DrawingBlockError("Block selection is partial or stale.");
  const layer = state.layers[options.activeLayerId];
  if (!layer || !layer.visible || layer.locked || layer.systemKind === "source")
    throw new DrawingBlockError(
      "The active block layer must be visible and unlocked.",
    );
  if (objects.some((object) => object.layerId !== layer.id))
    throw new DrawingBlockError(
      "All block objects must be on the active layer.",
    );
  const createId = options.createId ?? (() => crypto.randomUUID());
  const blockId = createId();
  const instanceId = createId();
  const converted = worldObjectsToBlockPrimitives(objects, () => createId());
  const block = DrawingBlockSchema.parse({
    id: blockId,
    revisionId: state.revisionId,
    name,
    primitives: converted.primitives,
    version: 1,
  });
  const instance = DrawingBlockInstanceSchema.parse({
    id: instanceId,
    lineageId: instanceId,
    blockId: block.id,
    layerId: layer.id,
    name: block.name,
    origin: converted.origin,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    version: 1,
  });
  const ordered = [...objects].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  return structureCommand(actorId, [
    { kind: "put_block", entity: block, baseVersion: null },
    { kind: "put_block_instance", entity: instance, baseVersion: null },
    ...drawingTargetReferenceCleanupActions(
      state,
      ordered.map((object) => object.id),
    ),
    ...ordered.map((object) => ({
      kind: "delete_object" as const,
      id: object.id,
      baseVersion: object.version,
    })),
  ]);
}

export function updateDrawingBlockCommand(
  inputState: DrawingDocumentState,
  actorId: string,
  blockId: string,
  patch: Partial<Pick<DrawingBlock, "name" | "primitives">>,
): StructureCommand {
  const state = canonicalState(inputState);
  const current = state.structure.blocks[blockId];
  if (!current) throw new DrawingBlockError("Drawing block does not exist.");
  const entity = DrawingBlockSchema.parse({
    ...current,
    ...structuredClone(patch),
  });
  return structureCommand(actorId, [
    { kind: "put_block", entity, baseVersion: current.version },
  ]);
}

export function deleteDrawingBlockCommand(
  inputState: DrawingDocumentState,
  actorId: string,
  blockId: string,
): StructureCommand {
  const state = canonicalState(inputState);
  const current = state.structure.blocks[blockId];
  if (!current) throw new DrawingBlockError("Drawing block does not exist.");
  if (
    Object.values(state.structure.blockInstances).some(
      (instance) => instance.blockId === blockId,
    )
  )
    throw new DrawingBlockError("Referenced drawing block cannot be deleted.");
  return structureCommand(actorId, [
    { kind: "delete_block", id: blockId, baseVersion: current.version },
  ]);
}

type InsertInstanceOptions = {
  activeLayerId: string;
  createId?: () => string;
  name?: string;
};

export function insertDrawingBlockInstanceCommand(
  inputState: DrawingDocumentState,
  actorId: string,
  blockId: string,
  origin: Point,
  options: InsertInstanceOptions,
): StructureCommand {
  const state = canonicalState(inputState);
  const block = state.structure.blocks[blockId];
  if (!block) throw new DrawingBlockError("Drawing block does not exist.");
  const layer = state.layers[options.activeLayerId];
  if (!layer || !layer.visible || layer.locked || layer.systemKind === "source")
    throw new DrawingBlockError(
      "The active block layer must be visible and unlocked.",
    );
  const instanceId = (options.createId ?? (() => crypto.randomUUID()))();
  const entity = DrawingBlockInstanceSchema.parse({
    id: instanceId,
    lineageId: instanceId,
    blockId,
    layerId: layer.id,
    name: options.name ?? block.name,
    origin,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    version: 1,
  });
  return structureCommand(actorId, [
    { kind: "put_block_instance", entity, baseVersion: null },
  ]);
}

export function updateDrawingBlockInstanceCommand(
  inputState: DrawingDocumentState,
  actorId: string,
  instanceId: string,
  patch: Partial<
    Pick<
      DrawingBlockInstance,
      "name" | "layerId" | "origin" | "rotation" | "scaleX" | "scaleY"
    >
  >,
): StructureCommand {
  const state = canonicalState(inputState);
  const current = state.structure.blockInstances[instanceId];
  if (!current)
    throw new DrawingBlockError("Drawing block instance does not exist.");
  const layerId = patch.layerId ?? current.layerId;
  const layer = state.layers[layerId];
  if (!layer || !layer.visible || layer.locked || layer.systemKind === "source")
    throw new DrawingBlockError(
      "Block instances require a visible unlocked layer.",
    );
  let entity: DrawingBlockInstance;
  try {
    entity = DrawingBlockInstanceSchema.parse({
      ...current,
      ...structuredClone(patch),
    });
  } catch (error) {
    throw new DrawingBlockError(
      error instanceof Error
        ? `Invalid block scale or transform: ${error.message}`
        : "Invalid block scale or transform.",
    );
  }
  return structureCommand(actorId, [
    { kind: "put_block_instance", entity, baseVersion: current.version },
  ]);
}

export function copyDrawingBlockInstanceCommand(
  inputState: DrawingDocumentState,
  actorId: string,
  instanceId: string,
  options: { createId?: () => string; offset?: Point } = {},
): StructureCommand {
  const state = canonicalState(inputState);
  const current = state.structure.blockInstances[instanceId];
  if (!current)
    throw new DrawingBlockError("Drawing block instance does not exist.");
  const layer = state.layers[current.layerId];
  if (!layer?.visible || layer.locked || layer.systemKind === "source")
    throw new DrawingBlockError(
      "Block instance copy requires a visible unlocked layer.",
    );
  const offset = options.offset ?? { x: 10, y: 10 };
  const copiedId = (options.createId ?? (() => crypto.randomUUID()))();
  const entity = DrawingBlockInstanceSchema.parse({
    ...structuredClone(current),
    id: copiedId,
    lineageId: copiedId,
    name: `${current.name} copy`.slice(0, 255),
    origin: { x: current.origin.x + offset.x, y: current.origin.y + offset.y },
    version: 1,
  });
  return structureCommand(actorId, [
    { kind: "put_block_instance", entity, baseVersion: null },
  ]);
}

export function deleteDrawingBlockInstanceCommand(
  inputState: DrawingDocumentState,
  actorId: string,
  instanceId: string,
): StructureCommand {
  const state = canonicalState(inputState);
  const current = state.structure.blockInstances[instanceId];
  if (!current)
    throw new DrawingBlockError("Drawing block instance does not exist.");
  const layer = state.layers[current.layerId];
  if (!layer?.visible || layer.locked || layer.systemKind === "source")
    throw new DrawingBlockError(
      "Block instance deletion requires a visible unlocked layer.",
    );
  return structureCommand(actorId, [
    ...drawingTargetReferenceCleanupActions(state, [instanceId]),
    {
      kind: "delete_block_instance",
      id: instanceId,
      baseVersion: current.version,
    },
  ]);
}

export type DrawingSelectionEntityKind =
  "none" | "object" | "block_instance" | "mixed" | "invalid";

export function drawingSelectionEntityKind(
  inputState: DrawingDocumentState,
  selectedIds: readonly string[],
): DrawingSelectionEntityKind {
  const state = canonicalState(inputState);
  if (selectedIds.length === 0) return "none";
  let kind: "object" | "block_instance" | null = null;
  for (const id of selectedIds) {
    const current = state.objects[id]
      ? "object"
      : state.structure.blockInstances[id]
        ? "block_instance"
        : null;
    if (!current) return "invalid";
    if (kind && current !== kind) return "mixed";
    kind = current;
  }
  return kind ?? "none";
}

export function drawingKindExclusiveSelection(
  currentIds: readonly string[],
  candidateId: string,
  shiftKey: boolean,
  objectIds: ReadonlySet<string>,
  blockInstanceIds: ReadonlySet<string>,
): string[] {
  const candidateKind = objectIds.has(candidateId)
    ? "object"
    : blockInstanceIds.has(candidateId)
      ? "block_instance"
      : null;
  if (!candidateKind) return shiftKey ? [...currentIds] : [];
  if (!shiftKey) return [candidateId];
  const sameKind = currentIds.every((id) =>
    candidateKind === "object" ? objectIds.has(id) : blockInstanceIds.has(id),
  );
  if (!sameKind) return [candidateId];
  return currentIds.includes(candidateId)
    ? currentIds.filter((id) => id !== candidateId)
    : [...currentIds, candidateId];
}

function selectedBlockInstances(
  inputState: DrawingDocumentState,
  selectedIds: readonly string[],
) {
  const state = canonicalState(inputState);
  if (
    selectedIds.length === 0 ||
    new Set(selectedIds).size !== selectedIds.length ||
    drawingSelectionEntityKind(state, selectedIds) !== "block_instance"
  )
    throw new DrawingBlockError(
      "A block shortcut requires one selection kind containing only block instances.",
    );
  const instances = selectedIds.map((id) => state.structure.blockInstances[id]);
  for (const instance of instances) {
    const layer = state.layers[instance.layerId];
    if (
      !layer?.visible ||
      layer.locked ||
      (layer.systemKind !== "work" && layer.systemKind !== "custom")
    )
      throw new DrawingBlockError(
        "Block instance shortcuts require visible unlocked editable layers.",
      );
  }
  return { instances, state };
}

export function deleteDrawingBlockInstancesCommand(
  inputState: DrawingDocumentState,
  actorId: string,
  selectedIds: readonly string[],
): StructureCommand {
  const { instances } = selectedBlockInstances(inputState, selectedIds);
  return structureCommand(actorId, [
    ...drawingTargetReferenceCleanupActions(
      inputState,
      instances.map((instance) => instance.id),
    ),
    ...instances.map((instance) => ({
      kind: "delete_block_instance" as const,
      id: instance.id,
      baseVersion: instance.version,
    })),
  ]);
}

export function moveDrawingBlockInstancesCommand(
  inputState: DrawingDocumentState,
  actorId: string,
  selectedIds: readonly string[],
  delta: Point,
): StructureCommand {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y))
    throw new DrawingBlockError("Block move delta must be finite.");
  const { instances } = selectedBlockInstances(inputState, selectedIds);
  return structureCommand(
    actorId,
    instances.map((instance) => ({
      kind: "put_block_instance" as const,
      entity: DrawingBlockInstanceSchema.parse({
        ...structuredClone(instance),
        origin: {
          x: instance.origin.x + delta.x,
          y: instance.origin.y + delta.y,
        },
      }),
      baseVersion: instance.version,
    })),
  );
}

export function duplicateDrawingBlockInstancesCommand(
  inputState: DrawingDocumentState,
  actorId: string,
  selectedIds: readonly string[],
  options: { createId?: () => string; offset?: Point } = {},
): StructureCommand {
  const { instances } = selectedBlockInstances(inputState, selectedIds);
  const createId = options.createId ?? (() => crypto.randomUUID());
  const offset = options.offset ?? { x: 10, y: 10 };
  if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y))
    throw new DrawingBlockError("Block copy offset must be finite.");
  return structureCommand(
    actorId,
    instances.map((instance) => {
      const id = createId();
      return {
        kind: "put_block_instance" as const,
        entity: DrawingBlockInstanceSchema.parse({
          ...structuredClone(instance),
          id,
          lineageId: id,
          origin: {
            x: instance.origin.x + offset.x,
            y: instance.origin.y + offset.y,
          },
          version: 1,
        }),
        baseVersion: null,
      };
    }),
  );
}

export type DrawingBlockInstancesClipboard = {
  instances: DrawingBlockInstance[];
};

export function copyDrawingBlockInstancesClipboard(
  inputState: DrawingDocumentState,
  selectedIds: readonly string[],
): DrawingBlockInstancesClipboard {
  const { instances } = selectedBlockInstances(inputState, selectedIds);
  return {
    instances: instances.map((instance) =>
      DrawingBlockInstanceSchema.parse(structuredClone(instance)),
    ),
  };
}

export function pasteDrawingBlockInstancesClipboardCommand(
  inputState: DrawingDocumentState,
  actorId: string,
  clipboard: DrawingBlockInstancesClipboard,
  options: {
    activeCanvasId: string;
    activeLayerId: string;
    createId?: () => string;
    offset?: Point;
  },
): StructureCommand {
  const state = canonicalState(inputState);
  const layer = state.layers[options.activeLayerId];
  if (
    !layer ||
    layer.canvasId !== options.activeCanvasId ||
    !layer.visible ||
    layer.locked ||
    (layer.systemKind !== "work" && layer.systemKind !== "custom")
  )
    throw new DrawingBlockError(
      "Block paste requires the current active editable canvas layer.",
    );
  if (!clipboard.instances.length)
    throw new DrawingBlockError("Block clipboard is empty.");
  const snapshots = clipboard.instances.map((instance) =>
    DrawingBlockInstanceSchema.parse(structuredClone(instance)),
  );
  for (const snapshot of snapshots) {
    if (!state.structure.blocks[snapshot.blockId])
      throw new DrawingBlockError(
        `Block definition ${snapshot.blockId} no longer exists.`,
      );
  }
  const createId = options.createId ?? (() => crypto.randomUUID());
  const offset = options.offset ?? { x: 10, y: 10 };
  if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y))
    throw new DrawingBlockError("Block paste offset must be finite.");
  return structureCommand(
    actorId,
    snapshots.map((snapshot) => {
      const id = createId();
      return {
        kind: "put_block_instance" as const,
        entity: DrawingBlockInstanceSchema.parse({
          ...snapshot,
          id,
          lineageId: id,
          layerId: layer.id,
          origin: {
            x: snapshot.origin.x + offset.x,
            y: snapshot.origin.y + offset.y,
          },
          version: 1,
        }),
        baseVersion: null,
      };
    }),
  );
}
