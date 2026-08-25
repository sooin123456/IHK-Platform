import type {
  DrawingBlock,
  DrawingBlockInstance,
  DrawingCanvas,
  DrawingLayer,
  DrawingObject,
  DrawingPage,
  DrawingPropertySchema,
  DrawingPropertyValue,
  DrawingStructureAction,
  DrawingStyle,
  DrawingStyleDefinition,
  DrawingStyleOverride,
  DrawingTable,
  DrawingGeometry,
} from "./drawing-workspace.types.ts";
import {
  DrawingStructureActionSchema,
  DrawingStyleSchema,
} from "./drawing-workspace.types.ts";

export type DrawingStructureState = {
  revisionId: string;
  pages: Record<string, DrawingPage>;
  canvases: Record<string, DrawingCanvas>;
  layers: Record<string, DrawingLayer>;
  objects: Record<string, DrawingObject>;
  styles: Record<string, DrawingStyleDefinition>;
  blocks: Record<string, DrawingBlock>;
  blockInstances: Record<string, DrawingBlockInstance>;
  propertySchemas: Record<string, DrawingPropertySchema>;
  propertyValues: Record<string, DrawingPropertyValue>;
  tables: Record<string, DrawingTable>;
  tombstones?: Record<string, { collection: StructureCollection; entity: StructureEntity; version: number }>;
};

export type AppliedDrawingStructureActions = {
  state: DrawingStructureState;
  inverse: DrawingStructureAction[];
  baseVersions: Record<string, number>;
  resultVersions: Record<string, number | null>;
  realizedVersions: Record<string, number>;
};

export class DrawingStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrawingStructureError";
  }
}

type StructureCollection =
  | "objects"
  | "pages"
  | "canvases"
  | "styles"
  | "blocks"
  | "blockInstances"
  | "propertySchemas"
  | "propertyValues"
  | "tables";

type StructureEntity =
  | DrawingObject
  | DrawingPage
  | DrawingCanvas
  | DrawingStyleDefinition
  | DrawingBlock
  | DrawingBlockInstance
  | DrawingPropertySchema
  | DrawingPropertyValue
  | DrawingTable;

const collectionForKind: Record<DrawingStructureAction["kind"], StructureCollection> = {
  put_object: "objects",
  delete_object: "objects",
  put_page: "pages",
  delete_page: "pages",
  put_canvas: "canvases",
  delete_canvas: "canvases",
  put_style: "styles",
  delete_style: "styles",
  put_block: "blocks",
  delete_block: "blocks",
  put_block_instance: "blockInstances",
  delete_block_instance: "blockInstances",
  put_property_schema: "propertySchemas",
  delete_property_schema: "propertySchemas",
  put_property_value: "propertyValues",
  delete_property_value: "propertyValues",
  put_table: "tables",
  delete_table: "tables",
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function transformPoint(
  point: { x: number; y: number },
  instance: DrawingBlockInstance,
  inverse: boolean,
) {
  const angle = (instance.rotation * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  if (inverse) {
    const x = point.x - instance.origin.x;
    const y = point.y - instance.origin.y;
    return {
      x: (x * cosine + y * sine) / instance.scaleX,
      y: (-x * sine + y * cosine) / instance.scaleY,
    };
  }
  const x = point.x * instance.scaleX;
  const y = point.y * instance.scaleY;
  return {
    x: x * cosine - y * sine + instance.origin.x,
    y: x * sine + y * cosine + instance.origin.y,
  };
}

function transformGeometry(
  geometry: DrawingGeometry,
  instance: DrawingBlockInstance,
  inverse: boolean,
): DrawingGeometry {
  const point = (value: { x: number; y: number }) => transformPoint(value, instance, inverse);
  const scaleX = Math.abs(instance.scaleX);
  const scaleY = Math.abs(instance.scaleY);
  const uniform = scaleX === scaleY;
  const scale = scaleX;
  const rotation = inverse
    ? (geometry.type === "rectangle" ? geometry.rotation - instance.rotation : 0)
    : (geometry.type === "rectangle" ? geometry.rotation + instance.rotation : 0);
  switch (geometry.type) {
    case "line": return { ...geometry, start: point(geometry.start), end: point(geometry.end) };
    case "polyline": return { ...geometry, points: geometry.points.map(point) };
    case "rectangle": return { ...geometry, origin: point(geometry.origin), width: inverse ? geometry.width / scaleX : geometry.width * scaleX, height: inverse ? geometry.height / scaleY : geometry.height * scaleY, rotation };
    case "circle":
      if (!uniform) throw new DrawingStructureError("A non-uniform block instance cannot exactly convert a circle.");
      return { ...geometry, center: point(geometry.center), radius: inverse ? geometry.radius / scale : geometry.radius * scale };
    case "text": return { ...geometry, origin: point(geometry.origin), width: inverse ? geometry.width / scaleX : geometry.width * scaleX };
    case "dimension":
      if (!uniform) throw new DrawingStructureError("A non-uniform block instance cannot exactly convert a dimension.");
      return { ...geometry, start: point(geometry.start), end: point(geometry.end), offset: inverse ? geometry.offset / scale : geometry.offset * scale };
  }
}

/** Converts world geometry to a block primitive relative to one instance transform. */
export function drawingBlockPrimitiveFromObject(
  object: DrawingObject,
  instance: DrawingBlockInstance,
  localId: string,
) {
  return {
    localId,
    name: object.name,
    geometry: transformGeometry(object.geometry, instance, true),
    styleId: object.styleId ?? null,
    style: clone(object.style),
  };
}

function drawingObjectFromBlockPrimitive(
  primitive: DrawingBlock["primitives"][number],
  instance: DrawingBlockInstance,
) {
  return {
    name: primitive.name,
    layerId: instance.layerId,
    geometry: transformGeometry(primitive.geometry, instance, false),
    styleId: primitive.styleId,
    style: clone(primitive.style),
  };
}

function cloneState(state: DrawingStructureState): DrawingStructureState {
  return {
    revisionId: state.revisionId,
    pages: clone(state.pages),
    canvases: clone(state.canvases),
    layers: clone(state.layers),
    objects: clone(state.objects),
    styles: clone(state.styles),
    blocks: clone(state.blocks),
    blockInstances: clone(state.blockInstances),
    propertySchemas: clone(state.propertySchemas),
    propertyValues: clone(state.propertyValues),
    tables: clone(state.tables),
    tombstones: clone(state.tombstones ?? {}),
  };
}

function recordFor(
  state: DrawingStructureState,
  collection: StructureCollection,
): Record<string, StructureEntity> {
  return state[collection] as Record<string, StructureEntity>;
}

function entityFor(action: DrawingStructureAction): StructureEntity {
  if (!("entity" in action)) {
    throw new DrawingStructureError(`${action.kind} does not include an entity.`);
  }
  return action.entity as StructureEntity;
}

function idFor(action: DrawingStructureAction): string {
  return "entity" in action ? action.entity.id : action.id;
}

function requireEntity(
  state: DrawingStructureState,
  action: DrawingStructureAction,
): StructureEntity {
  const entity = recordFor(state, collectionForKind[action.kind])[idFor(action)];
  if (!entity) {
    throw new DrawingStructureError(`${action.kind} target ${idFor(action)} does not exist.`);
  }
  return entity;
}

function validateActionBases(
  state: DrawingStructureState,
  actions: DrawingStructureAction[],
): void {
  const targets = new Set<string>();
  for (const action of actions) {
    const target = idFor(action);
    if (targets.has(target)) {
      throw new DrawingStructureError(`${action.kind} targets ${idFor(action)} more than once.`);
    }
    targets.add(target);
    const collection = collectionForKind[action.kind];
    const existing = recordFor(state, collection)[idFor(action)];
    const occupiedElsewhere = (
      [
        "objects",
        "pages",
        "canvases",
        "styles",
        "blocks",
        "blockInstances",
        "propertySchemas",
        "propertyValues",
        "tables",
      ] as StructureCollection[]
    ).some(
      (candidate) =>
        candidate !== collection && Boolean(recordFor(state, candidate)[idFor(action)]),
    );
    if (occupiedElsewhere) {
      throw new DrawingStructureError(`${action.kind} reuses a UUID from another structure collection.`);
    }
    const tombstone = state.tombstones?.[idFor(action)];
    if (tombstone && tombstone.collection !== collection) {
      throw new DrawingStructureError(`${action.kind} reuses a UUID from another structure collection.`);
    }
    if ("entity" in action) {
      if (action.baseVersion === null) {
        if (existing) {
          throw new DrawingStructureError(`${action.kind} cannot create existing entity ${action.entity.id}.`);
        }
        if (tombstone && JSON.stringify(tombstone.entity) !== JSON.stringify(action.entity)) {
          throw new DrawingStructureError(`${action.kind} must restore the exact tombstoned entity.`);
        }
        if (!tombstone && action.entity.version !== 1) {
          throw new DrawingStructureError(
            `${action.kind} must create a fresh entity at version 1.`,
          );
        }
      } else if (!existing || existing.version !== action.baseVersion) {
        throw new DrawingStructureError(`${action.kind} base version does not match operation-start state.`);
      }
    } else if (!existing || existing.version !== action.baseVersion) {
      throw new DrawingStructureError(`${action.kind} base version does not match operation-start state.`);
    }
  }
}

function validateStyleReference(
  styleId: string | null | undefined,
  state: DrawingStructureState,
  label: string,
): void {
  if (styleId !== null && styleId !== undefined && !state.styles[styleId]) {
    throw new DrawingStructureError(`${label} references missing style ${styleId}.`);
  }
}

function validatePropertyValue(
  value: DrawingPropertyValue,
  state: DrawingStructureState,
): void {
  const schema = state.propertySchemas[value.schemaId];
  if (!schema) {
    throw new DrawingStructureError(`Property value ${value.id} references a missing schema.`);
  }
  const object = value.objectId ? state.objects[value.objectId] : undefined;
  const instance = value.blockInstanceId
    ? state.blockInstances[value.blockInstanceId]
    : undefined;
  if (value.objectId && !object) {
    throw new DrawingStructureError(`Property value ${value.id} references a missing object.`);
  }
  if (value.blockInstanceId && !instance) {
    throw new DrawingStructureError(`Property value ${value.id} references a missing block instance.`);
  }
  const appliesTo = object?.geometry.type ?? (instance ? "block_instance" : null);
  if (!appliesTo || !schema.appliesTo.includes(appliesTo)) {
    throw new DrawingStructureError(`Property value ${value.id} is not applicable to its target.`);
  }
  if (value.value === null) return;
  const validCalendarDate = (candidate: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return false;
    const [year, month, day] = candidate.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  };
  const valid =
    (schema.valueType === "text" && typeof value.value === "string") ||
    (schema.valueType === "number" && typeof value.value === "number" && Number.isFinite(value.value)) ||
    (schema.valueType === "boolean" && typeof value.value === "boolean") ||
    (schema.valueType === "date" && typeof value.value === "string" && validCalendarDate(value.value)) ||
    (schema.valueType === "enum" && typeof value.value === "string" && schema.enumOptions.includes(value.value));
  if (!valid) {
    throw new DrawingStructureError(`Property value ${value.id} does not match schema ${schema.id}.`);
  }
}

function validateReferences(state: DrawingStructureState): void {
  for (const page of Object.values(state.pages)) {
    if (page.revisionId !== state.revisionId) {
      throw new DrawingStructureError(`Page ${page.id} belongs to another revision.`);
    }
  }
  for (const canvas of Object.values(state.canvases)) {
    if (!state.pages[canvas.pageId]) {
      throw new DrawingStructureError(`Canvas ${canvas.id} references a missing page.`);
    }
  }
  for (const layer of Object.values(state.layers)) {
    if (layer.canvasId && !state.canvases[layer.canvasId]) {
      throw new DrawingStructureError(`Layer ${layer.id} references a missing canvas.`);
    }
  }
  for (const object of Object.values(state.objects)) {
    if (!state.layers[object.layerId]) {
      throw new DrawingStructureError(`Object ${object.id} references a missing layer.`);
    }
    validateStyleReference(object.styleId, state, `Object ${object.id}`);
  }
  for (const style of Object.values(state.styles)) {
    if (style.revisionId !== state.revisionId) {
      throw new DrawingStructureError(`Style ${style.id} belongs to another revision.`);
    }
  }
  for (const block of Object.values(state.blocks)) {
    if (block.revisionId !== state.revisionId) {
      throw new DrawingStructureError(`Block ${block.id} belongs to another revision.`);
    }
    for (const primitive of block.primitives) {
      validateStyleReference(primitive.styleId, state, `Block ${block.id}`);
    }
  }
  for (const instance of Object.values(state.blockInstances)) {
    if (!state.blocks[instance.blockId] || !state.layers[instance.layerId]) {
      throw new DrawingStructureError(`Block instance ${instance.id} has a missing reference.`);
    }
  }
  for (const schema of Object.values(state.propertySchemas)) {
    if (schema.revisionId !== state.revisionId) {
      throw new DrawingStructureError(`Property schema ${schema.id} belongs to another revision.`);
    }
  }
  for (const value of Object.values(state.propertyValues)) {
    validatePropertyValue(value, state);
  }
  for (const table of Object.values(state.tables)) {
    if (table.revisionId !== state.revisionId) {
      throw new DrawingStructureError(`Table ${table.id} belongs to another revision.`);
    }
    const columns = new Map(table.columns.map((column) => [column.id, column]));
    for (const column of table.columns) {
      if (column.propertySchemaId && !state.propertySchemas[column.propertySchemaId]) {
        throw new DrawingStructureError(`Table ${table.id} references a missing property schema.`);
      }
    }
    for (const row of table.rows) {
      if (row.objectId && !state.objects[row.objectId]) {
        throw new DrawingStructureError(`Table row ${row.id} references a missing object.`);
      }
      if (row.blockInstanceId && !state.blockInstances[row.blockInstanceId]) {
        throw new DrawingStructureError(`Table row ${row.id} references a missing block instance.`);
      }
      if (row.objectId && row.blockInstanceId) {
        throw new DrawingStructureError(`Table row ${row.id} may not reference two targets.`);
      }
      for (const [columnId, cell] of Object.entries(row.cells)) {
        const column = columns.get(columnId);
        if (!column) {
          throw new DrawingStructureError(`Table row ${row.id} has an unknown column.`);
        }
        if (cell !== null && column.kind !== "text" && column.kind !== "number") {
          throw new DrawingStructureError(`Table row ${row.id} stores a computed cell.`);
        }
        if (column.kind === "text" && cell !== null && typeof cell !== "string") {
          throw new DrawingStructureError(`Table row ${row.id} text cell must be text.`);
        }
        if (column.kind === "number" && cell !== null && typeof cell !== "number") {
          throw new DrawingStructureError(`Table row ${row.id} number cell must be numeric.`);
        }
      }
    }
  }
}

function validateFinalCanvasInvariant(state: DrawingStructureState): void {
  for (const page of Object.values(state.pages)) {
    const canvases = Object.values(state.canvases).filter(
      (canvas) => canvas.pageId === page.id,
    );
    if (canvases.length === 0) {
      throw new DrawingStructureError(`Page ${page.id} must retain a canvas.`);
    }
    const defaults = canvases.filter(
      (canvas) => canvas.spaceKind === "paper" && canvas.sortOrder === 0,
    );
    if (defaults.length !== 1) {
      throw new DrawingStructureError(`Page ${page.id} must have exactly one default paper canvas.`);
    }
  }
}

function validateObjectCompound(
  state: DrawingStructureState,
  actions: DrawingStructureAction[],
): void {
  const objectActions = actions.filter(
    (action) => action.kind === "put_object" || action.kind === "delete_object",
  );
  if (objectActions.length === 0) return;
  const kinds = new Set(actions.map((action) => action.kind));
  const isForwardConversion =
    objectActions.every((action) => action.kind === "delete_object") &&
    kinds.has("put_block") &&
    kinds.has("put_block_instance");
  const isReverseConversion =
    objectActions.every((action) => action.kind === "put_object") &&
    kinds.has("delete_block") &&
    kinds.has("delete_block_instance");
  if (!isForwardConversion && !isReverseConversion) {
    throw new DrawingStructureError(
      "Structure object actions are reserved for an atomic block conversion or its inverse.",
    );
  }
  if (isForwardConversion) {
    const blocks = actions.filter((action) => action.kind === "put_block");
    const instances = actions.filter(
      (action) => action.kind === "put_block_instance",
    );
    if (
      blocks.length !== 1 ||
      instances.length !== 1 ||
      blocks[0].baseVersion !== null ||
      instances[0].baseVersion !== null ||
      (entityFor(instances[0]) as DrawingBlockInstance).blockId !==
        entityFor(blocks[0]).id ||
      actions.some(
        (action) =>
          action.kind !== "delete_object" &&
          action.kind !== "put_block" &&
          action.kind !== "put_block_instance",
      )
    ) {
      throw new DrawingStructureError(
        "Block conversion must create exactly one new definition and matching new instance.",
      );
    }
    for (const action of objectActions) {
      const object = state.objects[idFor(action)];
      const layer = object ? state.layers[object.layerId] : undefined;
      if (
        !object ||
        !layer ||
        !layer.visible ||
        layer.locked ||
        layer.systemKind === "source"
      ) {
        throw new DrawingStructureError(
          "Block conversion may delete only selected editable drawing objects.",
        );
      }
    }
    const block = entityFor(blocks[0]) as DrawingBlock;
    const instance = entityFor(instances[0]) as DrawingBlockInstance;
    const expected = objectActions.map((action, index) =>
      drawingBlockPrimitiveFromObject(
        state.objects[idFor(action)],
        instance,
        block.primitives[index]?.localId ?? "",
      ),
    );
    if (
      block.primitives.length !== expected.length ||
      expected.some((primitive, index) => !sameJson(block.primitives[index], primitive))
    ) {
      throw new DrawingStructureError(
        "Block conversion primitives must exactly represent the deleted objects in instance-relative coordinates.",
      );
    }
  }
  if (isReverseConversion) {
    const blocks = actions.filter((action) => action.kind === "delete_block");
    const instances = actions.filter(
      (action) => action.kind === "delete_block_instance",
    );
    if (
      blocks.length !== 1 ||
      instances.length !== 1 ||
      state.blockInstances[idFor(instances[0])]?.blockId !== idFor(blocks[0]) ||
      actions.some(
        (action) =>
          action.kind !== "put_object" &&
          action.kind !== "delete_block" &&
          action.kind !== "delete_block_instance",
      )
    ) {
      throw new DrawingStructureError(
        "Block conversion inverse must remove the matching instance and definition.",
      );
    }
    const block = state.blocks[idFor(blocks[0])];
    const instance = state.blockInstances[idFor(instances[0])];
    const expected = block.primitives.map((primitive) =>
      drawingObjectFromBlockPrimitive(primitive, instance),
    );
    const restored = objectActions.map((action) => entityFor(action) as DrawingObject);
    const remaining = [...expected];
    for (const object of restored) {
      const tombstone = state.tombstones?.[object.id];
      if (
        !tombstone ||
        tombstone.collection !== "objects" ||
        !sameJson(tombstone.entity, object)
      ) {
        throw new DrawingStructureError(
          "Block conversion inverse must restore only the exact captured objects.",
        );
      }
      const candidate = {
        name: object.name,
        layerId: object.layerId,
        geometry: object.geometry,
        styleId: object.styleId ?? null,
        style: object.style,
      };
      const index = remaining.findIndex((expectedObject) =>
        sameJson(expectedObject, candidate),
      );
      if (index < 0) {
        throw new DrawingStructureError(
          "Block conversion inverse must restore the exact block primitive objects.",
        );
      }
      remaining.splice(index, 1);
    }
    if (remaining.length !== 0) {
      throw new DrawingStructureError(
        "Block conversion inverse must restore every block primitive object.",
      );
    }
  }
}

/** Resolves a style definition and inline override into one validated render style. */
export function resolveDrawingStyle(
  styled: Pick<DrawingObject, "styleId" | "style"> | {
    styleId: string | null;
    style: DrawingStyleOverride;
  },
  styles: readonly DrawingStyleDefinition[] | Record<string, DrawingStyleDefinition>,
): DrawingStyle {
  const definitions = Array.isArray(styles) ? styles : Object.values(styles);
  const styleId = styled.styleId ?? null;
  if (styleId === null) {
    const parsed = DrawingStyleSchema.safeParse(styled.style);
    if (!parsed.success) {
      throw new DrawingStructureError("Inline drawing style must be complete and valid.");
    }
    return parsed.data;
  }
  const definition = definitions.find((style) => style.id === styleId);
  if (!definition) {
    throw new DrawingStructureError(`Drawing style ${styleId} does not exist.`);
  }
  const parsed = DrawingStyleSchema.safeParse({ ...definition.value, ...styled.style });
  if (!parsed.success) {
    throw new DrawingStructureError("Resolved drawing style must be complete and valid.");
  }
  return parsed.data;
}

/** Applies strict P2 structure actions atomically without mutating the input state. */
export function applyDrawingStructureActions(
  state: DrawingStructureState,
  inputActions: DrawingStructureAction[],
): AppliedDrawingStructureActions {
  const actions = inputActions.map(
    (action) =>
      DrawingStructureActionSchema.parse(clone(action)) as DrawingStructureAction,
  );
  if (actions.length === 0) {
    throw new DrawingStructureError("A structure operation requires at least one action.");
  }
  validateObjectCompound(state, actions);
  validateActionBases(state, actions);
  const protectedDefaultCanvasIds = new Set(
    Object.values(state.canvases)
      .filter((canvas) => canvas.spaceKind === "paper" && canvas.sortOrder === 0)
      .map((canvas) => canvas.id),
  );

  const next = cloneState(state);
  const inverse: DrawingStructureAction[] = [];
  const baseVersions: Record<string, number> = {};
  const resultVersions: Record<string, number | null> = {};
  const realizedVersions: Record<string, number> = {};

  for (const action of actions) {
    const collection = collectionForKind[action.kind];
    const record = recordFor(next, collection);
    if ("entity" in action) {
      const previous = record[action.entity.id];
      if (previous) {
        const entity = { ...clone(action.entity), version: previous.version + 1 } as StructureEntity;
        record[entity.id] = entity;
        inverse.unshift({
          kind: action.kind,
          entity: clone(previous),
          baseVersion: entity.version,
        } as DrawingStructureAction);
        baseVersions[entity.id] = action.baseVersion ?? previous.version;
        resultVersions[entity.id] = entity.version;
        realizedVersions[entity.id] = entity.version;
      } else {
        const tombstone = next.tombstones?.[action.entity.id];
        const entity = {
          ...clone(action.entity),
          version: tombstone ? tombstone.version + 1 : action.entity.version,
        } as StructureEntity;
        record[entity.id] = entity;
        if (tombstone) delete next.tombstones?.[entity.id];
        inverse.unshift({
          kind: action.kind.replace("put_", "delete_") as DrawingStructureAction["kind"],
          id: entity.id,
          baseVersion: entity.version,
        } as DrawingStructureAction);
        resultVersions[entity.id] = entity.version;
        realizedVersions[entity.id] = entity.version;
      }
    } else {
      const previous = requireEntity(next, action);
      delete record[action.id];
      const tombstoneVersion = previous.version + 1;
      next.tombstones ??= {};
      next.tombstones[action.id] = {
        collection,
        entity: clone(previous),
        version: tombstoneVersion,
      };
      inverse.unshift({
        kind: action.kind.replace("delete_", "put_") as DrawingStructureAction["kind"],
        entity: clone(previous),
        baseVersion: null,
      } as DrawingStructureAction);
      baseVersions[action.id] = action.baseVersion;
      resultVersions[action.id] = null;
      realizedVersions[action.id] = tombstoneVersion;
    }
    validateReferences(next);
  }
  const deletedPageIds = new Set(
    actions
      .filter((action) => action.kind === "delete_page")
      .map(idFor),
  );
  if (actions.some((action) => {
    if (action.kind !== "delete_canvas" || !protectedDefaultCanvasIds.has(action.id)) return false;
    return !deletedPageIds.has(state.canvases[action.id]?.pageId);
  })) {
    throw new DrawingStructureError("The operation-start default paper canvas cannot be deleted.");
  }
  validateFinalCanvasInvariant(next);
  return { state: next, inverse, baseVersions, resultVersions, realizedVersions };
}
