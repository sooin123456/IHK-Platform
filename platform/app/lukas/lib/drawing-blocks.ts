import { geometryBounds } from "./drawing-geometry.ts";
import { resolveDrawingStyle } from "./drawing-structure.ts";
import type {
  DrawingCommand,
  DrawingDocumentState,
} from "./drawing-commands.ts";
import {
  DrawingBlockInstanceSchema,
  DrawingBlockSchema,
  type Bounds,
  type DrawingBlock,
  type DrawingBlockInstance,
  type DrawingBlockPrimitive,
  type DrawingGeometry,
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
  geometry: DrawingGeometry,
  origin: Point,
): DrawingGeometry {
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
      geometry: translateGeometry(structuredClone(object.geometry), origin),
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

function dimensionPoints(
  geometry: Extract<DrawingGeometry, { type: "dimension" }>,
): Point[] {
  const length = Math.hypot(
    geometry.end.x - geometry.start.x,
    geometry.end.y - geometry.start.y,
  );
  const x = (-(geometry.end.y - geometry.start.y) / length) * geometry.offset;
  const y = ((geometry.end.x - geometry.start.x) / length) * geometry.offset;
  return [
    geometry.start,
    geometry.end,
    { x: geometry.start.x + x, y: geometry.start.y + y },
    { x: geometry.end.x + x, y: geometry.end.y + y },
  ];
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
      points = rectanglePoints(
        geometry.origin,
        geometry.width,
        style.fontSize ?? 14,
        0,
      );
      break;
    case "dimension":
      points = dimensionPoints(geometry);
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
    | readonly DrawingStyleDefinition[]
    | Record<string, DrawingStyleDefinition>,
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
    | readonly DrawingStyleDefinition[]
    | Record<string, DrawingStyleDefinition>,
): Bounds {
  const model = blockInstanceRenderModel(block, instance, styles);
  const bounds = model.primitives.map((primitive) =>
    primitiveWorldBounds(primitive, model.instance, primitive.style),
  );
  const x = Math.min(...bounds.map((value) => value.x));
  const y = Math.min(...bounds.map((value) => value.y));
  const right = Math.max(...bounds.map((value) => value.x + value.width));
  const bottom = Math.max(...bounds.map((value) => value.y + value.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** Produces one aggregate hit target per visible unlocked instance. */
export function drawingBlockSelectionCandidates(
  instances: readonly DrawingBlockInstance[],
  blocks: Record<string, DrawingBlock>,
  layers: Record<string, { visible: boolean; locked: boolean }>,
  styles:
    | readonly DrawingStyleDefinition[]
    | Record<string, DrawingStyleDefinition>,
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
  const entity = DrawingBlockInstanceSchema.parse({
    id: (options.createId ?? (() => crypto.randomUUID()))(),
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
  const entity = DrawingBlockInstanceSchema.parse({
    ...structuredClone(current),
    id: (options.createId ?? (() => crypto.randomUUID()))(),
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
    {
      kind: "delete_block_instance",
      id: instanceId,
      baseVersion: current.version,
    },
  ]);
}
