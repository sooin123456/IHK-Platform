import type {
  DrawingBlock,
  DrawingBlockInstance,
  DrawingCanvas,
  DrawingLayer,
  DrawingStructureLayer,
  DrawingObject,
  DrawingObjectSource,
  DrawingPage,
  DrawingPropertySchema,
  DrawingPropertyValue,
  DrawingStructureAction,
  DrawingStyle,
  DrawingStyleDefinition,
  DrawingStyleOverride,
  DrawingTable,
  DrawingGeometry,
  DrawingPrimitiveGeometry,
} from "./drawing-workspace.types.ts";
import {
  DrawingObjectSourceSchema,
  DrawingPrimitiveGeometrySchema,
  DrawingStructureActionSchema,
  DrawingStyleSchema,
} from "./drawing-workspace.types.ts";
import {
  DrawingSemanticGeometryError,
  resolveDrawingOpening,
} from "./drawing-semantic-geometry.ts";

export type DrawingStructureState = {
  revisionId: string;
  pages: Record<string, DrawingPage>;
  canvases: Record<string, DrawingCanvas>;
  layers: Record<string, DrawingLayer>;
  objects: Record<string, DrawingObject>;
  /** Hydrated by P5 source loading; legacy P0-P4 projections omit it until Task 2. */
  sources?: Record<string, DrawingObjectSource>;
  styles: Record<string, DrawingStyleDefinition>;
  blocks: Record<string, DrawingBlock>;
  blockInstances: Record<string, DrawingBlockInstance>;
  propertySchemas: Record<string, DrawingPropertySchema>;
  propertyValues: Record<string, DrawingPropertyValue>;
  tables: Record<string, DrawingTable>;
  tombstones?: Record<
    string,
    {
      collection: StructureCollection;
      entity: StructureEntity;
      version: number;
    }
  >;
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
  | "sources"
  | "pages"
  | "canvases"
  | "layers"
  | "styles"
  | "blocks"
  | "blockInstances"
  | "propertySchemas"
  | "propertyValues"
  | "tables";

type StructureEntity =
  | DrawingObject
  | DrawingObjectSource
  | DrawingPage
  | DrawingCanvas
  | DrawingStructureLayer
  | DrawingStyleDefinition
  | DrawingBlock
  | DrawingBlockInstance
  | DrawingPropertySchema
  | DrawingPropertyValue
  | DrawingTable;

const collectionForKind: Record<
  DrawingStructureAction["kind"],
  StructureCollection
> = {
  put_object: "objects",
  delete_object: "objects",
  put_source: "sources",
  delete_source: "sources",
  put_page: "pages",
  delete_page: "pages",
  put_canvas: "canvases",
  delete_canvas: "canvases",
  put_layer: "layers",
  delete_layer: "layers",
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

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameCanonicalValue(value, right[index]))
    );
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  )
    return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every(
      (key) =>
        Object.hasOwn(rightRecord, key) &&
        sameCanonicalValue(leftRecord[key], rightRecord[key]),
    )
  );
}

// Trigonometric block transforms can round-trip a finite geometry measurement
// by a few ulps. Keep the absolute allowance sub-nanometric in drawing units,
// with a small relative allowance for large finite coordinates.
const GEOMETRY_ABSOLUTE_TOLERANCE = 1e-12;
const GEOMETRY_RELATIVE_TOLERANCE = 64 * Number.EPSILON;

function sameGeometryNumber(left: number, right: number): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return (
    Math.abs(left - right) <=
    GEOMETRY_ABSOLUTE_TOLERANCE +
      GEOMETRY_RELATIVE_TOLERANCE * Math.max(Math.abs(left), Math.abs(right))
  );
}

function samePoint(
  left: { x: number; y: number },
  right: { x: number; y: number },
): boolean {
  return (
    sameGeometryNumber(left.x, right.x) && sameGeometryNumber(left.y, right.y)
  );
}

function sameGeometry(
  left: DrawingPrimitiveGeometry,
  right: DrawingPrimitiveGeometry,
): boolean {
  if (left.type !== right.type) return false;
  switch (left.type) {
    case "line":
      return (
        right.type === "line" &&
        samePoint(left.start, right.start) &&
        samePoint(left.end, right.end)
      );
    case "polyline":
      return (
        right.type === "polyline" &&
        left.closed === right.closed &&
        left.points.length === right.points.length &&
        left.points.every((point, index) =>
          samePoint(point, right.points[index]),
        )
      );
    case "rectangle":
      return (
        right.type === "rectangle" &&
        samePoint(left.origin, right.origin) &&
        sameGeometryNumber(left.width, right.width) &&
        sameGeometryNumber(left.height, right.height) &&
        sameGeometryNumber(left.rotation, right.rotation)
      );
    case "circle":
      return (
        right.type === "circle" &&
        samePoint(left.center, right.center) &&
        sameGeometryNumber(left.radius, right.radius)
      );
    case "text":
      return (
        right.type === "text" &&
        left.text === right.text &&
        samePoint(left.origin, right.origin) &&
        sameGeometryNumber(left.width, right.width)
      );
    case "dimension":
      return (
        right.type === "dimension" &&
        left.calibrationId === right.calibrationId &&
        samePoint(left.start, right.start) &&
        samePoint(left.end, right.end) &&
        sameGeometryNumber(left.offset, right.offset)
      );
  }
}

function sameBlockObject(
  left: ReturnType<typeof drawingObjectFromBlockPrimitive>,
  right: ReturnType<typeof drawingObjectFromBlockPrimitive>,
): boolean {
  return (
    left.name === right.name &&
    left.layerId === right.layerId &&
    left.styleId === right.styleId &&
    sameJson(left.style, right.style) &&
    sameGeometry(left.geometry, right.geometry)
  );
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
  geometry: DrawingPrimitiveGeometry,
  instance: DrawingBlockInstance,
  inverse: boolean,
): DrawingPrimitiveGeometry {
  const point = (value: { x: number; y: number }) =>
    transformPoint(value, instance, inverse);
  const scaleX = Math.abs(instance.scaleX);
  const scaleY = Math.abs(instance.scaleY);
  const uniform = scaleX === scaleY;
  const scale = scaleX;
  const rotation = inverse
    ? geometry.type === "rectangle"
      ? geometry.rotation - instance.rotation
      : 0
    : geometry.type === "rectangle"
      ? geometry.rotation + instance.rotation
      : 0;
  switch (geometry.type) {
    case "line":
      return {
        ...geometry,
        start: point(geometry.start),
        end: point(geometry.end),
      };
    case "polyline":
      return { ...geometry, points: geometry.points.map(point) };
    case "rectangle":
      return {
        ...geometry,
        origin: point(geometry.origin),
        width: inverse ? geometry.width / scaleX : geometry.width * scaleX,
        height: inverse ? geometry.height / scaleY : geometry.height * scaleY,
        rotation,
      };
    case "circle":
      if (!uniform)
        throw new DrawingStructureError(
          "A non-uniform block instance cannot exactly convert a circle.",
        );
      return {
        ...geometry,
        center: point(geometry.center),
        radius: inverse ? geometry.radius / scale : geometry.radius * scale,
      };
    case "text":
      return {
        ...geometry,
        origin: point(geometry.origin),
        width: inverse ? geometry.width / scaleX : geometry.width * scaleX,
      };
    case "dimension":
      if (!uniform)
        throw new DrawingStructureError(
          "A non-uniform block instance cannot exactly convert a dimension.",
        );
      return {
        ...geometry,
        start: point(geometry.start),
        end: point(geometry.end),
        offset: inverse ? geometry.offset / scale : geometry.offset * scale,
      };
  }
}

/** Converts world geometry to a block primitive relative to one instance transform. */
export function drawingBlockPrimitiveFromObject(
  object: DrawingObject,
  instance: DrawingBlockInstance,
  localId: string,
) {
  const geometry = DrawingPrimitiveGeometrySchema.parse(object.geometry);
  return {
    localId,
    name: object.name,
    geometry: transformGeometry(geometry, instance, true),
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
    sources: clone(state.sources ?? {}),
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
  if (collection === "sources")
    return (state.sources ?? {}) as Record<string, StructureEntity>;
  return state[collection] as Record<string, StructureEntity>;
}

function entityFor(action: DrawingStructureAction): StructureEntity {
  if (!("entity" in action)) {
    throw new DrawingStructureError(
      `${action.kind} does not include an entity.`,
    );
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
  const entity = recordFor(state, collectionForKind[action.kind])[
    idFor(action)
  ];
  if (!entity) {
    throw new DrawingStructureError(
      `${action.kind} target ${idFor(action)} does not exist.`,
    );
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
      throw new DrawingStructureError(
        `${action.kind} targets ${idFor(action)} more than once.`,
      );
    }
    targets.add(target);
    const collection = collectionForKind[action.kind];
    const existing = recordFor(state, collection)[idFor(action)];
    const occupiedElsewhere = (
      [
        "objects",
        "sources",
        "pages",
        "canvases",
        "layers",
        "styles",
        "blocks",
        "blockInstances",
        "propertySchemas",
        "propertyValues",
        "tables",
      ] as StructureCollection[]
    ).some(
      (candidate) =>
        candidate !== collection &&
        Boolean(recordFor(state, candidate)[idFor(action)]),
    );
    if (occupiedElsewhere) {
      throw new DrawingStructureError(
        `${action.kind} reuses a UUID from another structure collection.`,
      );
    }
    const tombstone = state.tombstones?.[idFor(action)];
    if (tombstone && tombstone.collection !== collection) {
      throw new DrawingStructureError(
        `${action.kind} reuses a UUID from another structure collection.`,
      );
    }
    if ("entity" in action) {
      if (action.baseVersion === null) {
        if (existing) {
          throw new DrawingStructureError(
            `${action.kind} cannot create existing entity ${action.entity.id}.`,
          );
        }
        if (
          tombstone &&
          JSON.stringify(tombstone.entity) !== JSON.stringify(action.entity)
        ) {
          throw new DrawingStructureError(
            `${action.kind} must restore the exact tombstoned entity.`,
          );
        }
        if (!tombstone && action.entity.version !== 1) {
          throw new DrawingStructureError(
            `${action.kind} must create a fresh entity at version 1.`,
          );
        }
      } else if (!existing || existing.version !== action.baseVersion) {
        throw new DrawingStructureError(
          `${action.kind} base version does not match operation-start state.`,
        );
      }
    } else if (!existing || existing.version !== action.baseVersion) {
      throw new DrawingStructureError(
        `${action.kind} base version does not match operation-start state.`,
      );
    }
  }
}

function validateStyleReference(
  styleId: string | null | undefined,
  state: DrawingStructureState,
  label: string,
): void {
  if (styleId !== null && styleId !== undefined && !state.styles[styleId]) {
    throw new DrawingStructureError(
      `${label} references missing style ${styleId}.`,
    );
  }
}

function validatePropertyValue(
  value: DrawingPropertyValue,
  state: DrawingStructureState,
): void {
  const schema = state.propertySchemas[value.schemaId];
  if (!schema) {
    throw new DrawingStructureError(
      `Property value ${value.id} references a missing schema.`,
    );
  }
  const object = value.objectId ? state.objects[value.objectId] : undefined;
  const instance = value.blockInstanceId
    ? state.blockInstances[value.blockInstanceId]
    : undefined;
  if (value.objectId && !object) {
    throw new DrawingStructureError(
      `Property value ${value.id} references a missing object.`,
    );
  }
  if (value.blockInstanceId && !instance) {
    throw new DrawingStructureError(
      `Property value ${value.id} references a missing block instance.`,
    );
  }
  const appliesTo =
    object?.geometry.type ?? (instance ? "block_instance" : null);
  if (
    !appliesTo ||
    !(schema.appliesTo as readonly string[]).includes(appliesTo)
  ) {
    throw new DrawingStructureError(
      `Property value ${value.id} is not applicable to its target.`,
    );
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
    (schema.valueType === "number" &&
      typeof value.value === "number" &&
      Number.isFinite(value.value)) ||
    (schema.valueType === "boolean" && typeof value.value === "boolean") ||
    (schema.valueType === "date" &&
      typeof value.value === "string" &&
      validCalendarDate(value.value)) ||
    (schema.valueType === "enum" &&
      typeof value.value === "string" &&
      schema.enumOptions.includes(value.value));
  if (!valid) {
    throw new DrawingStructureError(
      `Property value ${value.id} does not match schema ${schema.id}.`,
    );
  }
}

function validateReferences(state: DrawingStructureState): void {
  for (const page of Object.values(state.pages)) {
    if (page.revisionId !== state.revisionId) {
      throw new DrawingStructureError(
        `Page ${page.id} belongs to another revision.`,
      );
    }
  }
  for (const canvas of Object.values(state.canvases)) {
    if (!state.pages[canvas.pageId]) {
      throw new DrawingStructureError(
        `Canvas ${canvas.id} references a missing page.`,
      );
    }
  }
  for (const layer of Object.values(state.layers)) {
    if (!layer.canvasId || !state.canvases[layer.canvasId]) {
      throw new DrawingStructureError(
        `Layer ${layer.id} references a missing canvas.`,
      );
    }
  }
  for (const object of Object.values(state.objects)) {
    if (!state.layers[object.layerId]) {
      throw new DrawingStructureError(
        `Object ${object.id} references a missing layer.`,
      );
    }
    validateStyleReference(object.styleId, state, `Object ${object.id}`);
  }
  const activeSourceKeys = new Set<string>();
  for (const source of Object.values(state.sources ?? {})) {
    const parsed = DrawingObjectSourceSchema.safeParse(source);
    if (!parsed.success || !sameCanonicalValue(parsed.data, source))
      throw new DrawingStructureError(
        `Source ${source.id} is not canonical evidence.`,
      );
    if (!state.objects[source.objectId])
      throw new DrawingStructureError(
        `Source ${source.id} references a missing object.`,
      );
    if (source.revisionId !== state.revisionId)
      throw new DrawingStructureError(
        `Source ${source.id} belongs to another revision.`,
      );
    const activeKey = `${source.objectId}\u0000${source.sourceFileId}\u0000${source.sourceKind}`;
    if (activeSourceKeys.has(activeKey))
      throw new DrawingStructureError(
        `Source ${source.id} duplicates an active object/file/kind link.`,
      );
    activeSourceKeys.add(activeKey);
  }
  const styleNames = new Set<string>();
  for (const style of Object.values(state.styles)) {
    if (style.revisionId !== state.revisionId) {
      throw new DrawingStructureError(
        `Style ${style.id} belongs to another revision.`,
      );
    }
    if (styleNames.has(style.name)) {
      throw new DrawingStructureError(
        `Drawing style name ${style.name} must be unique.`,
      );
    }
    styleNames.add(style.name);
  }
  for (const block of Object.values(state.blocks)) {
    if (block.revisionId !== state.revisionId) {
      throw new DrawingStructureError(
        `Block ${block.id} belongs to another revision.`,
      );
    }
    for (const primitive of block.primitives) {
      validateStyleReference(primitive.styleId, state, `Block ${block.id}`);
    }
  }
  for (const instance of Object.values(state.blockInstances)) {
    if (!state.blocks[instance.blockId] || !state.layers[instance.layerId]) {
      throw new DrawingStructureError(
        `Block instance ${instance.id} has a missing reference.`,
      );
    }
  }
  for (const schema of Object.values(state.propertySchemas)) {
    if (schema.revisionId !== state.revisionId) {
      throw new DrawingStructureError(
        `Property schema ${schema.id} belongs to another revision.`,
      );
    }
  }
  for (const value of Object.values(state.propertyValues)) {
    validatePropertyValue(value, state);
  }
  for (const table of Object.values(state.tables)) {
    if (table.revisionId !== state.revisionId) {
      throw new DrawingStructureError(
        `Table ${table.id} belongs to another revision.`,
      );
    }
    const columns = new Map(table.columns.map((column) => [column.id, column]));
    for (const column of table.columns) {
      if (
        column.propertySchemaId &&
        !state.propertySchemas[column.propertySchemaId]
      ) {
        throw new DrawingStructureError(
          `Table ${table.id} references a missing property schema.`,
        );
      }
    }
    for (const row of table.rows) {
      if (row.objectId && !state.objects[row.objectId]) {
        throw new DrawingStructureError(
          `Table row ${row.id} references a missing object.`,
        );
      }
      if (row.blockInstanceId && !state.blockInstances[row.blockInstanceId]) {
        throw new DrawingStructureError(
          `Table row ${row.id} references a missing block instance.`,
        );
      }
      if (row.objectId && row.blockInstanceId) {
        throw new DrawingStructureError(
          `Table row ${row.id} may not reference two targets.`,
        );
      }
      const targetKind = row.objectId
        ? state.objects[row.objectId]?.geometry.type
        : row.blockInstanceId
          ? "block_instance"
          : undefined;
      if (
        targetKind &&
        table.columns.some((column) => {
          const schema = column.propertySchemaId
            ? state.propertySchemas[column.propertySchemaId]
            : undefined;
          return schema
            ? !(schema.appliesTo as readonly string[]).includes(targetKind)
            : false;
        })
      ) {
        throw new DrawingStructureError(
          `Table row ${row.id} property schema does not apply to its target.`,
        );
      }
      for (const [columnId, cell] of Object.entries(row.cells)) {
        const column = columns.get(columnId);
        if (!column) {
          throw new DrawingStructureError(
            `Table row ${row.id} has an unknown column.`,
          );
        }
        if (
          cell !== null &&
          column.kind !== "text" &&
          column.kind !== "number"
        ) {
          throw new DrawingStructureError(
            `Table row ${row.id} stores a computed cell.`,
          );
        }
        if (
          column.kind === "text" &&
          cell !== null &&
          typeof cell !== "string"
        ) {
          throw new DrawingStructureError(
            `Table row ${row.id} text cell must be text.`,
          );
        }
        if (
          column.kind === "number" &&
          cell !== null &&
          typeof cell !== "number"
        ) {
          throw new DrawingStructureError(
            `Table row ${row.id} number cell must be numeric.`,
          );
        }
      }
    }
  }
}

/** Validates hosted semantic references against one completed candidate graph. */
export function validateDrawingSemanticReferences(
  state: Pick<DrawingStructureState, "objects" | "layers">,
): void {
  for (const opening of Object.values(state.objects)) {
    if (opening.geometry.type !== "opening") continue;
    const host = state.objects[opening.geometry.hostWallId];
    const openingLayer = state.layers[opening.layerId];
    const hostLayer = host ? state.layers[host.layerId] : undefined;
    if (!openingLayer || !hostLayer) {
      throw new DrawingStructureError(
        `Opening ${opening.id} requires active opening and host layers.`,
      );
    }
    if (
      !openingLayer.canvasId ||
      !hostLayer.canvasId ||
      openingLayer.canvasId !== hostLayer.canvasId
    ) {
      throw new DrawingStructureError(
        `Opening ${opening.id} and its host wall must share a canvas.`,
      );
    }
    try {
      resolveDrawingOpening(opening.geometry, state.objects);
    } catch (error) {
      if (error instanceof DrawingSemanticGeometryError) {
        throw new DrawingStructureError(
          `Opening ${opening.id} is invalid: ${error.message}`,
        );
      }
      throw error;
    }
  }
}

function validateFinalCanvasInvariant(state: DrawingStructureState): void {
  if (Object.keys(state.pages).length === 0) {
    throw new DrawingStructureError(
      "A drawing document requires at least one page.",
    );
  }
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
      throw new DrawingStructureError(
        `Page ${page.id} must have exactly one default paper canvas.`,
      );
    }
  }
  for (const canvas of Object.values(state.canvases)) {
    const hasEditableLayer = Object.values(state.layers).some(
      (layer) =>
        layer.canvasId === canvas.id &&
        (layer.systemKind === "work" || layer.systemKind === "custom") &&
        layer.visible &&
        !layer.locked,
    );
    if (!hasEditableLayer) {
      throw new DrawingStructureError(
        `Canvas ${canvas.id} must retain an editable layer.`,
      );
    }
  }
}

/** Validates a complete P2 graph before it becomes canonical client state. */
export function validateDrawingStructureState(
  state: DrawingStructureState,
): void {
  const collections: [string, Record<string, { id: string }>][] = [
    ["objects", state.objects],
    ["sources", state.sources ?? {}],
    ["pages", state.pages],
    ["canvases", state.canvases],
    ["layers", state.layers as Record<string, StructureEntity>],
    ["styles", state.styles],
    ["blocks", state.blocks],
    ["blockInstances", state.blockInstances],
    ["propertySchemas", state.propertySchemas],
    ["propertyValues", state.propertyValues],
    ["tables", state.tables],
  ];
  const ids = new Set<string>();
  for (const [collection, records] of collections) {
    for (const [id, entity] of Object.entries(records)) {
      if (id !== entity.id)
        throw new DrawingStructureError(
          `${collection} key ${id} does not match its entity ID.`,
        );
      if (ids.has(id))
        throw new DrawingStructureError(
          `Structure collections reuse UUID ${id}.`,
        );
      ids.add(id);
    }
  }
  for (const [id, tombstone] of Object.entries(state.tombstones ?? {})) {
    if (id !== tombstone.entity.id || ids.has(id))
      throw new DrawingStructureError(`Structure tombstone ${id} is invalid.`);
    ids.add(id);
  }
  validateReferences(state);
  validateDrawingSemanticReferences(state);
  validateFinalCanvasInvariant(state);
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
          action.kind !== "put_block_instance" &&
          action.kind !== "delete_source" &&
          action.kind !== "delete_property_value" &&
          action.kind !== "put_table",
      )
    ) {
      throw new DrawingStructureError(
        "Block conversion must create exactly one new definition and matching new instance.",
      );
    }
    const block = entityFor(blocks[0]) as DrawingBlock;
    const instance = entityFor(instances[0]) as DrawingBlockInstance;
    const targetIds = new Set(objectActions.map(idFor));
    const expectedCleanup: DrawingStructureAction[] = [
      ...Object.values(state.sources ?? {})
        .filter((source) => targetIds.has(source.objectId))
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((source) => ({
          kind: "delete_source" as const,
          id: source.id,
          baseVersion: source.version,
        })),
      ...Object.values(state.propertyValues)
        .filter(
          (value) =>
            (value.objectId !== null && targetIds.has(value.objectId)) ||
            (value.blockInstanceId !== null &&
              targetIds.has(value.blockInstanceId)),
        )
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((value) => ({
          kind: "delete_property_value" as const,
          id: value.id,
          baseVersion: value.version,
        })),
      ...Object.values(state.tables)
        .sort((left, right) => left.id.localeCompare(right.id))
        .flatMap((table) => {
          const rows = table.rows.filter(
            (row) =>
              !(row.objectId && targetIds.has(row.objectId)) &&
              !(row.blockInstanceId && targetIds.has(row.blockInstanceId)),
          );
          return rows.length === table.rows.length
            ? []
            : [
                {
                  kind: "put_table" as const,
                  entity: { ...table, rows },
                  baseVersion: table.version,
                },
              ];
        }),
    ];
    const cleanup = actions.filter(
      (action) =>
        action.kind === "delete_source" ||
        action.kind === "delete_property_value" ||
        action.kind === "put_table",
    );
    if (!sameJson(cleanup, expectedCleanup)) {
      throw new DrawingStructureError(
        "Block conversion must exactly clean every selected object reference.",
      );
    }
    if (
      instance.rotation !== 0 ||
      instance.scaleX !== 1 ||
      instance.scaleY !== 1
    ) {
      throw new DrawingStructureError(
        "Block conversion creation is translation-only: rotation must be zero and scale must be one.",
      );
    }
    for (const action of objectActions) {
      const object = state.objects[idFor(action)];
      const layer = object ? state.layers[object.layerId] : undefined;
      if (
        !object ||
        !layer ||
        object.layerId !== instance.layerId ||
        !layer.visible ||
        layer.locked ||
        layer.systemKind === "source"
      ) {
        throw new DrawingStructureError(
          "Block conversion may delete only selected editable drawing objects.",
        );
      }
    }
    const expected = objectActions.map((action, index) =>
      drawingBlockPrimitiveFromObject(
        state.objects[idFor(action)],
        instance,
        block.primitives[index]?.localId ?? "",
      ),
    );
    if (
      block.primitives.length !== expected.length ||
      expected.some(
        (primitive, index) => !sameJson(block.primitives[index], primitive),
      )
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
          action.kind !== "delete_block_instance" &&
          action.kind !== "put_source" &&
          action.kind !== "put_property_value" &&
          action.kind !== "put_table",
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
    const restored = objectActions.map(
      (action) => entityFor(action) as DrawingObject,
    );
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
        geometry: DrawingPrimitiveGeometrySchema.parse(object.geometry),
        styleId: object.styleId ?? null,
        style: object.style,
      };
      const index = remaining.findIndex((expectedObject) =>
        sameBlockObject(expectedObject, candidate),
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

/** Validates the one mixed semantic update/delete shape shared by command replay. */
export function validateDrawingReferenceAwareObjectMutation(
  deletedOrRestoredObjects: readonly DrawingObject[],
  actions: readonly DrawingStructureAction[],
): boolean {
  const objectActions = actions.filter(
    (action) => action.kind === "put_object" || action.kind === "delete_object",
  );
  if (objectActions.length === 0) return false;
  const outerIds = new Set(deletedOrRestoredObjects.map((object) => object.id));
  const updatedWallIds = new Set(
    objectActions.flatMap((action) =>
      action.kind === "put_object" && action.entity.geometry.type === "wall"
        ? [action.entity.id]
        : [],
    ),
  );
  if (
    objectActions.some(
      (action) =>
        action.kind !== "put_object" ||
        (action.entity.geometry.type !== "wall" &&
          action.entity.geometry.type !== "opening") ||
        outerIds.has(action.entity.id),
    ) ||
    updatedWallIds.size === 0 ||
    deletedOrRestoredObjects.some(
      (object) =>
        object.geometry.type !== "opening" ||
        !updatedWallIds.has(object.geometry.hostWallId),
    )
  )
    throw new DrawingStructureError(
      "A mixed reference-aware mutation must update semantic hosts and delete only their openings.",
    );
  return true;
}

/** Resolves a style definition and inline override into one validated render style. */
export function resolveDrawingStyle(
  styled:
    | Pick<DrawingObject, "styleId" | "style">
    | {
        styleId: string | null;
        style: DrawingStyleOverride;
      },
  styles:
    readonly DrawingStyleDefinition[] | Record<string, DrawingStyleDefinition>,
): DrawingStyle {
  const definitions = Array.isArray(styles) ? styles : Object.values(styles);
  const styleId = styled.styleId ?? null;
  if (styleId === null) {
    const parsed = DrawingStyleSchema.safeParse(styled.style);
    if (!parsed.success) {
      throw new DrawingStructureError(
        "Inline drawing style must be complete and valid.",
      );
    }
    return parsed.data;
  }
  const definition = definitions.find((style) => style.id === styleId);
  if (!definition) {
    throw new DrawingStructureError(`Drawing style ${styleId} does not exist.`);
  }
  const parsed = DrawingStyleSchema.safeParse({
    ...definition.value,
    ...styled.style,
  });
  if (!parsed.success) {
    throw new DrawingStructureError(
      "Resolved drawing style must be complete and valid.",
    );
  }
  return parsed.data;
}

/** Applies strict P2 structure actions atomically without mutating the input state. */
export function applyDrawingStructureActions(
  state: DrawingStructureState,
  inputActions: DrawingStructureAction[],
  options: {
    allowCheckpointRestore?: boolean;
    allowReferenceAwareObjectMutation?: boolean;
    deferSemanticReferenceValidation?: boolean;
  } = {},
): AppliedDrawingStructureActions {
  const actions = inputActions.map(
    (action) =>
      DrawingStructureActionSchema.parse(
        clone(action),
      ) as DrawingStructureAction,
  );
  if (actions.length === 0) {
    throw new DrawingStructureError(
      "A structure operation requires at least one action.",
    );
  }
  if (
    !options.allowCheckpointRestore &&
    !options.allowReferenceAwareObjectMutation
  )
    validateObjectCompound(state, actions);
  validateActionBases(state, actions);
  const protectedDefaultCanvasIds = new Set(
    Object.values(state.canvases)
      .filter(
        (canvas) => canvas.spaceKind === "paper" && canvas.sortOrder === 0,
      )
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
        const entity = {
          ...clone(action.entity),
          version: previous.version + 1,
        } as StructureEntity;
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
          kind: action.kind.replace(
            "put_",
            "delete_",
          ) as DrawingStructureAction["kind"],
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
        kind: action.kind.replace(
          "delete_",
          "put_",
        ) as DrawingStructureAction["kind"],
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
    actions.filter((action) => action.kind === "delete_page").map(idFor),
  );
  if (
    actions.some((action) => {
      if (
        action.kind !== "delete_canvas" ||
        !protectedDefaultCanvasIds.has(action.id)
      )
        return false;
      return !deletedPageIds.has(state.canvases[action.id]?.pageId);
    })
  ) {
    throw new DrawingStructureError(
      "The operation-start default paper canvas cannot be deleted.",
    );
  }
  validateFinalCanvasInvariant(next);
  if (!options.deferSemanticReferenceValidation)
    validateDrawingSemanticReferences(next);
  return {
    state: next,
    inverse,
    baseVersions,
    resultVersions,
    realizedVersions,
  };
}
