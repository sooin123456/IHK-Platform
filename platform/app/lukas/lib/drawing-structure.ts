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
};

export type AppliedDrawingStructureActions = {
  state: DrawingStructureState;
  inverse: DrawingStructureAction[];
  baseVersions: Record<string, number>;
  resultVersions: Record<string, number | null>;
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
    const target = `${collectionForKind[action.kind]}:${idFor(action)}`;
    if (targets.has(target)) {
      throw new DrawingStructureError(`${action.kind} targets ${idFor(action)} more than once.`);
    }
    targets.add(target);
    const existing = recordFor(state, collectionForKind[action.kind])[idFor(action)];
    if ("entity" in action) {
      if (action.baseVersion === null) {
        if (existing) {
          throw new DrawingStructureError(`${action.kind} cannot create existing entity ${action.entity.id}.`);
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
  const valid =
    (schema.valueType === "text" && typeof value.value === "string") ||
    (schema.valueType === "number" && typeof value.value === "number" && Number.isFinite(value.value)) ||
    (schema.valueType === "boolean" && typeof value.value === "boolean") ||
    (schema.valueType === "date" && typeof value.value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.value)) ||
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
    const newBlockIds = new Set(
      actions
        .filter((action) => action.kind === "put_block")
        .map((action) => entityFor(action).id),
    );
    const createsMatchingInstance = actions.some(
      (action) =>
        action.kind === "put_block_instance" &&
        newBlockIds.has((entityFor(action) as DrawingBlockInstance).blockId),
    );
    if (!createsMatchingInstance) {
      throw new DrawingStructureError(
        "Block conversion must create an instance of its new definition.",
      );
    }
  }
  if (isReverseConversion) {
    const deletedBlockIds = new Set(
      actions
        .filter((action) => action.kind === "delete_block")
        .map(idFor),
    );
    const deletesMatchingInstance = actions.some(
      (action) =>
        action.kind === "delete_block_instance" &&
        deletedBlockIds.has(state.blockInstances[idFor(action)]?.blockId),
    );
    if (!deletesMatchingInstance) {
      throw new DrawingStructureError(
        "Block conversion inverse must remove the matching instance and definition.",
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

  const next = cloneState(state);
  const inverse: DrawingStructureAction[] = [];
  const baseVersions: Record<string, number> = {};
  const resultVersions: Record<string, number | null> = {};

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
      } else {
        const entity = clone(action.entity) as StructureEntity;
        record[entity.id] = entity;
        inverse.unshift({
          kind: action.kind.replace("put_", "delete_") as DrawingStructureAction["kind"],
          id: entity.id,
          baseVersion: entity.version,
        } as DrawingStructureAction);
        resultVersions[entity.id] = entity.version;
      }
    } else {
      const previous = requireEntity(next, action);
      delete record[action.id];
      inverse.unshift({
        kind: action.kind.replace("delete_", "put_") as DrawingStructureAction["kind"],
        entity: clone(previous),
        baseVersion: null,
      } as DrawingStructureAction);
      baseVersions[action.id] = action.baseVersion;
      resultVersions[action.id] = null;
    }
    validateReferences(next);
  }
  validateFinalCanvasInvariant(next);
  return { state: next, inverse, baseVersions, resultVersions };
}
