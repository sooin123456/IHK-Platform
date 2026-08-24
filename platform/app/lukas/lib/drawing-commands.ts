import type {
  DrawingGeometry,
  DrawingLayer,
  DrawingObject,
  DrawingOperationInput,
  Point,
} from "./drawing-workspace.types.ts";

export type ObjectPatch = Partial<
  Pick<DrawingObject, "layerId" | "geometry" | "style">
>;

export type ObjectUpdate = {
  objectId: string;
  baseVersion?: number;
  patch: ObjectPatch;
};

export type LayerPatch = Partial<
  Pick<DrawingLayer, "name" | "visible" | "locked">
>;

export type DrawingCommand =
  | { type: "add_objects"; actorId: string; objects: DrawingObject[] }
  | { type: "update_objects"; actorId: string; updates: ObjectUpdate[] }
  | { type: "delete_objects"; actorId: string; objectIds: string[] }
  | { type: "add_layer"; actorId: string; layer: DrawingLayer }
  | {
      type: "update_layer";
      actorId: string;
      layerId: string;
      patch: LayerPatch;
    };

type DrawingCommandPayload =
  | { type: "add_objects"; objects: DrawingObject[] }
  | { type: "update_objects"; updates: ObjectUpdate[] }
  | { type: "delete_objects"; objectIds: string[] }
  | { type: "add_layer"; layer: DrawingLayer }
  | { type: "update_layer"; layerId: string; patch: LayerPatch };

export type DrawingRecordedOperation = DrawingOperationInput & {
  actorId: string;
  /** add_layer has no inverse until the command union gains delete_layer. */
  undoable: boolean;
  /** Expected target versions after this operation; null means an object is absent. */
  resultVersions: Record<string, number | null>;
  originalOperationId?: string;
  historyAction?: "undo" | "redo";
};

export type DrawingDocumentState = {
  revisionId: string;
  objects: Record<string, DrawingObject>;
  layers: Record<string, DrawingLayer>;
  operations: DrawingRecordedOperation[];
  undoStackByActor: Record<string, string[]>;
  redoStackByActor: Record<string, string[]>;
};

export type DrawingCommandEnvironment = {
  createId?: () => string;
  now?: () => string;
};

export type DrawingCommandConflict = {
  kind: "conflict";
  objectIds: string[];
};

export type AppliedDrawingCommand = {
  state: DrawingDocumentState;
  operation: DrawingRecordedOperation;
};

export class DrawingCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrawingCommandError";
  }
}

export class LockedDrawingLayerError extends DrawingCommandError {
  readonly code = "drawing_layer_locked";

  constructor(layerId: string) {
    super(
      `Object mutation is blocked because drawing layer ${layerId} is locked.`,
    );
    this.name = "LockedDrawingLayerError";
  }
}

type Reduction = {
  objects: Record<string, DrawingObject>;
  layers: Record<string, DrawingLayer>;
  baseVersions: Record<string, number>;
  forward: DrawingCommandPayload;
  inverse: DrawingCommandPayload | Record<string, never>;
  resultVersions: Record<string, number | null>;
  undoable: boolean;
};

type CommandHistoryMetadata = {
  originalOperationId?: string;
  historyAction?: "undo" | "redo";
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function mapById<T extends { id: string }>(items: T[]): Record<string, T> {
  const mapped: Record<string, T> = {};
  for (const item of items) {
    if (mapped[item.id])
      throw new DrawingCommandError(`Duplicate ID: ${item.id}.`);
    mapped[item.id] = clone(item);
  }
  return mapped;
}

function cloneStacks(
  stacks: Record<string, string[]>,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(stacks).map(([actorId, operationIds]) => [
      actorId,
      [...operationIds],
    ]),
  );
}

function payloadFor(command: DrawingCommand): DrawingCommandPayload {
  switch (command.type) {
    case "add_objects":
      return { type: command.type, objects: clone(command.objects) };
    case "update_objects":
      return {
        type: command.type,
        updates: command.updates.map(({ objectId, patch }) => ({
          objectId,
          patch: clone(patch),
        })),
      };
    case "delete_objects":
      return { type: command.type, objectIds: [...command.objectIds] };
    case "add_layer":
      return { type: command.type, layer: clone(command.layer) };
    case "update_layer":
      return {
        type: command.type,
        layerId: command.layerId,
        patch: clone(command.patch),
      };
  }
}

function requireObject(
  objects: Record<string, DrawingObject>,
  objectId: string,
): DrawingObject {
  const object = objects[objectId];
  if (!object)
    throw new DrawingCommandError(`Drawing object ${objectId} does not exist.`);
  return object;
}

function requireLayer(
  layers: Record<string, DrawingLayer>,
  layerId: string,
): DrawingLayer {
  const layer = layers[layerId];
  if (!layer)
    throw new DrawingCommandError(`Drawing layer ${layerId} does not exist.`);
  return layer;
}

function requireUnlockedLayer(
  layers: Record<string, DrawingLayer>,
  layerId: string,
): void {
  if (requireLayer(layers, layerId).locked)
    throw new LockedDrawingLayerError(layerId);
}

function objectPatchBefore(
  object: DrawingObject,
  patch: ObjectPatch,
): ObjectPatch {
  const inverse: ObjectPatch = {};
  if (patch.layerId !== undefined) inverse.layerId = object.layerId;
  if (patch.geometry !== undefined) inverse.geometry = clone(object.geometry);
  if (patch.style !== undefined) inverse.style = clone(object.style);
  return inverse;
}

function layerPatchBefore(layer: DrawingLayer, patch: LayerPatch): LayerPatch {
  const inverse: LayerPatch = {};
  if (patch.name !== undefined) inverse.name = layer.name;
  if (patch.visible !== undefined) inverse.visible = layer.visible;
  if (patch.locked !== undefined) inverse.locked = layer.locked;
  return inverse;
}

function reduceCommand(
  state: DrawingDocumentState,
  command: DrawingCommand,
): Reduction {
  const objects = { ...state.objects };
  const layers = { ...state.layers };
  const baseVersions: Record<string, number> = {};
  const resultVersions: Record<string, number | null> = {};
  const forward = payloadFor(command);

  switch (command.type) {
    case "add_objects": {
      const objectIds = new Set<string>();
      for (const object of command.objects) {
        if (objectIds.has(object.id) || objects[object.id]) {
          throw new DrawingCommandError(
            `Drawing object ${object.id} already exists.`,
          );
        }
        objectIds.add(object.id);
        requireUnlockedLayer(layers, object.layerId);
        const added = clone(object);
        objects[added.id] = added;
        resultVersions[added.id] = added.version;
      }
      return {
        objects,
        layers,
        baseVersions,
        forward,
        inverse: { type: "delete_objects", objectIds: [...objectIds] },
        resultVersions,
        undoable: true,
      };
    }
    case "update_objects": {
      const inverseUpdates: ObjectUpdate[] = [];
      const objectIds = new Set<string>();
      for (const update of command.updates) {
        if (objectIds.has(update.objectId)) {
          throw new DrawingCommandError(
            `Drawing object ${update.objectId} is updated more than once.`,
          );
        }
        objectIds.add(update.objectId);
        const object = requireObject(objects, update.objectId);
        requireUnlockedLayer(layers, object.layerId);
        if (
          update.baseVersion !== undefined &&
          update.baseVersion !== object.version
        ) {
          throw new DrawingCommandError(
            `Drawing object ${object.id} changed from version ${update.baseVersion} to ${object.version}.`,
          );
        }
        if (update.patch.layerId !== undefined) {
          requireUnlockedLayer(layers, update.patch.layerId);
        }
        baseVersions[object.id] = object.version;
        inverseUpdates.push({
          objectId: object.id,
          patch: objectPatchBefore(object, update.patch),
        });
        const updated = {
          ...object,
          ...clone(update.patch),
          version: object.version + 1,
        };
        objects[object.id] = updated;
        resultVersions[object.id] = updated.version;
      }
      return {
        objects,
        layers,
        baseVersions,
        forward,
        inverse: { type: "update_objects", updates: inverseUpdates },
        resultVersions,
        undoable: true,
      };
    }
    case "delete_objects": {
      const deleted: DrawingObject[] = [];
      const objectIds = new Set<string>();
      for (const objectId of command.objectIds) {
        if (objectIds.has(objectId)) {
          throw new DrawingCommandError(
            `Drawing object ${objectId} is deleted more than once.`,
          );
        }
        objectIds.add(objectId);
        const object = requireObject(objects, objectId);
        requireUnlockedLayer(layers, object.layerId);
        baseVersions[object.id] = object.version;
        resultVersions[object.id] = null;
        deleted.push(clone(object));
        delete objects[object.id];
      }
      return {
        objects,
        layers,
        baseVersions,
        forward,
        inverse: { type: "add_objects", objects: deleted },
        resultVersions,
        undoable: true,
      };
    }
    case "add_layer": {
      if (layers[command.layer.id]) {
        throw new DrawingCommandError(
          `Drawing layer ${command.layer.id} already exists.`,
        );
      }
      const added = clone(command.layer);
      layers[added.id] = added;
      baseVersions[added.id] = added.version;
      resultVersions[added.id] = added.version;
      return {
        objects,
        layers,
        baseVersions,
        forward,
        inverse: {},
        resultVersions,
        undoable: false,
      };
    }
    case "update_layer": {
      const layer = requireLayer(layers, command.layerId);
      baseVersions[layer.id] = layer.version;
      const inverse = layerPatchBefore(layer, command.patch);
      const updated = {
        ...layer,
        ...clone(command.patch),
        version: layer.version + 1,
      };
      layers[layer.id] = updated;
      resultVersions[layer.id] = updated.version;
      return {
        objects,
        layers,
        baseVersions,
        forward,
        inverse: { type: "update_layer", layerId: layer.id, patch: inverse },
        resultVersions,
        undoable: true,
      };
    }
  }
}

function appendOperation(
  state: DrawingDocumentState,
  command: DrawingCommand,
  environment: DrawingCommandEnvironment,
  metadata: CommandHistoryMetadata = {},
): AppliedDrawingCommand {
  const reduced = reduceCommand(state, command);
  const operation: DrawingRecordedOperation = {
    clientOperationId: environment.createId?.() ?? crypto.randomUUID(),
    revisionId: state.revisionId,
    type: command.type,
    actorId: command.actorId,
    baseVersions: reduced.baseVersions,
    forward: reduced.forward,
    inverse: reduced.inverse,
    createdAt: environment.now?.() ?? new Date().toISOString(),
    resultVersions: reduced.resultVersions,
    undoable: reduced.undoable,
    ...metadata,
  };
  return {
    state: {
      ...state,
      objects: reduced.objects,
      layers: reduced.layers,
      operations: [...state.operations, operation],
    },
    operation,
  };
}

function payloadToCommand(
  actorId: string,
  payload: DrawingCommandPayload,
): DrawingCommand {
  return { ...clone(payload), actorId } as DrawingCommand;
}

function operationFor(
  state: DrawingDocumentState,
  operationId: string,
): DrawingRecordedOperation | undefined {
  return state.operations.find(
    (operation) => operation.clientOperationId === operationId,
  );
}

function conflictFor(
  state: DrawingDocumentState,
  operation: DrawingRecordedOperation,
): DrawingCommandConflict | undefined {
  const objectIds = Object.entries(operation.resultVersions)
    .filter(([objectId, expectedVersion]) => {
      const current =
        operation.type === "update_layer"
          ? state.layers[objectId]
          : state.objects[objectId];
      return expectedVersion === null
        ? current !== undefined
        : current?.version !== expectedVersion;
    })
    .map(([objectId]) => objectId);
  return objectIds.length > 0 ? { kind: "conflict", objectIds } : undefined;
}

function latestAppliedOperationFor(
  state: DrawingDocumentState,
  originalOperationId: string,
): DrawingRecordedOperation | undefined {
  return [...state.operations]
    .reverse()
    .find(
      (operation) =>
        operation.clientOperationId === originalOperationId ||
        (operation.originalOperationId === originalOperationId &&
          operation.historyAction === "redo"),
    );
}

function latestUndoOperationFor(
  state: DrawingDocumentState,
  originalOperationId: string,
): DrawingRecordedOperation | undefined {
  return [...state.operations]
    .reverse()
    .find(
      (operation) =>
        operation.originalOperationId === originalOperationId &&
        operation.historyAction === "undo",
    );
}

function updateHistory(
  state: DrawingDocumentState,
  actorId: string,
  undoStack: string[],
  redoStack: string[],
): DrawingDocumentState {
  return {
    ...state,
    undoStackByActor: {
      ...cloneStacks(state.undoStackByActor),
      [actorId]: undoStack,
    },
    redoStackByActor: {
      ...cloneStacks(state.redoStackByActor),
      [actorId]: redoStack,
    },
  };
}

/** Creates an empty append-only document state from canonical drawing records. */
export function createDrawingDocumentState({
  revisionId,
  objects = [],
  layers = [],
}: {
  revisionId: string;
  objects?: DrawingObject[];
  layers?: DrawingLayer[];
}): DrawingDocumentState {
  return {
    revisionId,
    objects: mapById(objects),
    layers: mapById(layers),
    operations: [],
    undoStackByActor: {},
    redoStackByActor: {},
  };
}

/** Applies a new command and appends its recorded operation without mutating state. */
export function applyDrawingCommand(
  state: DrawingDocumentState,
  command: DrawingCommand,
  environment: DrawingCommandEnvironment = {},
): AppliedDrawingCommand {
  const applied = appendOperation(state, command, environment);
  const undoStack = [...(state.undoStackByActor[command.actorId] ?? [])];
  if (applied.operation.undoable)
    undoStack.push(applied.operation.clientOperationId);
  return {
    ...applied,
    state: updateHistory(applied.state, command.actorId, undoStack, []),
  };
}

/**
 * Appends an inverse of the requesting actor's latest undoable operation.
 * add_layer remains non-undoable until the command union supports delete_layer.
 */
export function undoDrawingCommand(
  state: DrawingDocumentState,
  actorId: string,
  environment: DrawingCommandEnvironment = {},
): AppliedDrawingCommand | DrawingCommandConflict | null {
  const undoStack = state.undoStackByActor[actorId] ?? [];
  const originalOperationId = undoStack.at(-1);
  if (!originalOperationId) return null;
  const original = operationFor(state, originalOperationId);
  if (!original)
    throw new DrawingCommandError(
      `Drawing operation ${originalOperationId} does not exist.`,
    );
  const latestApplied = latestAppliedOperationFor(state, originalOperationId);
  if (!latestApplied)
    throw new DrawingCommandError(
      `Applied operation for ${originalOperationId} does not exist.`,
    );
  const conflict = conflictFor(state, latestApplied);
  if (conflict) return conflict;
  const payload = original.inverse as DrawingCommandPayload;
  const applied = appendOperation(
    state,
    payloadToCommand(actorId, payload),
    environment,
    { originalOperationId, historyAction: "undo" },
  );
  return {
    ...applied,
    state: updateHistory(applied.state, actorId, undoStack.slice(0, -1), [
      ...(state.redoStackByActor[actorId] ?? []),
      originalOperationId,
    ]),
  };
}

/** Reapplies the requesting actor's latest undone object operation as a new entry. */
export function redoDrawingCommand(
  state: DrawingDocumentState,
  actorId: string,
  environment: DrawingCommandEnvironment = {},
): AppliedDrawingCommand | DrawingCommandConflict | null {
  const redoStack = state.redoStackByActor[actorId] ?? [];
  const originalOperationId = redoStack.at(-1);
  if (!originalOperationId) return null;
  const original = operationFor(state, originalOperationId);
  if (!original)
    throw new DrawingCommandError(
      `Drawing operation ${originalOperationId} does not exist.`,
    );
  const inverse = latestUndoOperationFor(state, originalOperationId);
  if (!inverse)
    throw new DrawingCommandError(
      `Undo operation for ${originalOperationId} does not exist.`,
    );
  const conflict = conflictFor(state, inverse);
  if (conflict) return conflict;
  const payload = original.forward as DrawingCommandPayload;
  const applied = appendOperation(
    state,
    payloadToCommand(actorId, payload),
    environment,
    { originalOperationId, historyAction: "redo" },
  );
  return {
    ...applied,
    state: updateHistory(
      applied.state,
      actorId,
      [...(state.undoStackByActor[actorId] ?? []), originalOperationId],
      redoStack.slice(0, -1),
    ),
  };
}

export type DrawingClipboard = {
  items: Array<Pick<DrawingObject, "layerId" | "geometry" | "style">>;
};

export type PastedDrawingObject = DrawingObject & { lineageId: string };

function mutableDrawingObject(
  state: Pick<DrawingDocumentState, "layers" | "objects">,
  objectId: string,
): DrawingObject | null {
  const object = state.objects[objectId];
  const layer = object ? state.layers[object.layerId] : undefined;
  return object && layer?.visible && !layer.locked ? object : null;
}

/** Translates authored world geometry without storing a renderer transform. */
export function translateDrawingGeometry(
  geometry: DrawingGeometry,
  delta: Point,
): DrawingGeometry {
  const point = ({ x, y }: Point) => ({ x: x + delta.x, y: y + delta.y });
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
      return { ...geometry, origin: point(geometry.origin) };
    case "circle":
      return { ...geometry, center: point(geometry.center) };
    case "text":
      return { ...geometry, origin: point(geometry.origin) };
    case "dimension":
      return {
        ...geometry,
        start: point(geometry.start),
        end: point(geometry.end),
      };
  }
}

/** Creates one version-aware update command for a local selection move. */
export function moveDrawingSelection(
  state: Pick<DrawingDocumentState, "layers" | "objects">,
  selectedIds: string[],
  actorId: string,
  delta: Point,
): Extract<DrawingCommand, { type: "update_objects" }> | null {
  const updates = [...new Set(selectedIds)].flatMap((objectId) => {
    const object = mutableDrawingObject(state, objectId);
    return object
      ? [
          {
            objectId,
            baseVersion: object.version,
            patch: {
              geometry: translateDrawingGeometry(object.geometry, delta),
            },
          },
        ]
      : [];
  });
  return updates.length > 0
    ? { type: "update_objects", actorId, updates }
    : null;
}

/** Creates a delete command only for visible, unlocked selected objects. */
export function deleteDrawingSelection(
  state: Pick<DrawingDocumentState, "layers" | "objects">,
  selectedIds: string[],
  actorId: string,
): Extract<DrawingCommand, { type: "delete_objects" }> | null {
  const objectIds = [...new Set(selectedIds)].filter((objectId) =>
    Boolean(mutableDrawingObject(state, objectId)),
  );
  return objectIds.length > 0
    ? { type: "delete_objects", actorId, objectIds }
    : null;
}

/** Copies only portable authored fields, excluding identity and provenance. */
export function copyDrawingSelection(
  state: Pick<DrawingDocumentState, "layers" | "objects">,
  selectedIds: string[],
): DrawingClipboard {
  return {
    items: [...new Set(selectedIds)].flatMap((objectId) => {
      const object = mutableDrawingObject(state, objectId);
      return object
        ? [
            clone({
              layerId: object.layerId,
              geometry: object.geometry,
              style: object.style,
            }),
          ]
        : [];
    }),
  };
}

/** Pastes clipboard geometry with fresh identities and a deterministic 20 mm offset. */
export function pasteDrawingClipboard(
  clipboard: DrawingClipboard,
  actorId: string,
  createId: () => string = () => crypto.randomUUID(),
): Extract<DrawingCommand, { type: "add_objects" }> | null {
  if (clipboard.items.length === 0) return null;
  const objects: PastedDrawingObject[] = clipboard.items.map((item) => ({
    id: createId(),
    lineageId: createId(),
    layerId: item.layerId,
    geometry: translateDrawingGeometry(item.geometry, { x: 20, y: 20 }),
    style: clone(item.style),
    version: 1,
  }));
  return { type: "add_objects", actorId, objects };
}

export function duplicateDrawingSelection(
  state: Pick<DrawingDocumentState, "layers" | "objects">,
  selectedIds: string[],
  actorId: string,
  createId?: () => string,
): Extract<DrawingCommand, { type: "add_objects" }> | null {
  return pasteDrawingClipboard(
    copyDrawingSelection(state, selectedIds),
    actorId,
    createId,
  );
}
