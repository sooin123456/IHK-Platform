import type {
  DrawingGeometry,
  DrawingCanvas,
  DrawingLayer,
  DrawingLayerInput,
  DrawingObject,
  DrawingPage,
  DrawingOperationInput,
  DrawingStyle,
  DrawingStructureAction,
  Point,
} from "./drawing-workspace.types.ts";
import {
  applyDrawingStructureActions,
  resolveDrawingStyle,
  type DrawingStructureState,
} from "./drawing-structure.ts";
import {
  DrawingFillColorSchema,
  DrawingGeometrySchema,
  DrawingLayerInputSchema,
  DrawingLayerNameSchema,
  DrawingLayerSchema,
  DrawingObjectNameSchema,
  DrawingObjectSchema,
  DrawingStyleSchema,
  DrawingStrokeColorSchema,
  DrawingStrokeWidthSchema,
  DrawingCanvasSchema,
  DrawingPageSchema,
  DrawingStructureLayerSchema,
} from "./drawing-workspace.types.ts";

export type ObjectPatch = Partial<
  Pick<DrawingObject, "name" | "layerId" | "geometry">
> & {
  styleId?: string | null;
  style?: Partial<DrawingObject["style"]>;
};

export type ObjectUpdate = {
  objectId: string;
  baseVersion?: number;
  patch: ObjectPatch;
};

export type LayerPatch = Partial<
  Pick<DrawingLayer, "name" | "visible" | "locked" | "canvasId" | "sortOrder">
>;

type StructureCommandState = Pick<
  DrawingDocumentState,
  "revisionId" | "layers" | "structure"
> & {
  structure: NonNullable<DrawingDocumentState["structure"]>;
};

function requireStructureState(
  state: Pick<DrawingDocumentState, "revisionId" | "layers" | "structure">,
): StructureCommandState {
  if (!state.structure) {
    throw new DrawingCommandError(
      "Drawing structure state is required for canvas actions.",
    );
  }
  return state as StructureCommandState;
}

function ordered<T extends { id: string; sortOrder?: number }>(
  items: readonly T[],
): T[] {
  return [...items].sort(
    (left, right) =>
      (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
      left.id.localeCompare(right.id),
  );
}

function nextSortOrder(items: ReadonlyArray<{ sortOrder?: number }>): number {
  return (
    items.reduce(
      (largest, item) => Math.max(largest, item.sortOrder ?? 0),
      -1,
    ) + 1
  );
}

function entityName(value: string): string {
  const parsed = DrawingPageSchema.safeParse({
    id: "00000000-0000-4000-8000-000000000000",
    revisionId: "00000000-0000-4000-8000-000000000000",
    name: value.trim(),
    sortOrder: 0,
    version: 1,
  });
  if (!parsed.success)
    throw new DrawingCommandError(
      "Drawing page and canvas names must not be empty.",
    );
  return parsed.data.name;
}

function requireUniqueName(
  name: string,
  siblings: ReadonlyArray<{ id: string; name: string }>,
  id?: string,
): string {
  const normalized = entityName(name);
  if (siblings.some((sibling) => sibling.id !== id && sibling.name === normalized)) {
    throw new DrawingCommandError(`Drawing name ${normalized} already exists.`);
  }
  return normalized;
}

function nextUniqueSiblingName(
  base: string,
  siblings: ReadonlyArray<{ name: string }>,
): string {
  const normalized = entityName(base);
  const names = new Set(siblings.map((sibling) => sibling.name));
  if (!names.has(normalized)) return normalized;
  let suffix = 2;
  while (names.has(`${normalized} ${suffix}`)) suffix += 1;
  return `${normalized} ${suffix}`;
}

function structureCommand(
  actorId: string,
  actions: DrawingStructureAction[],
): Extract<DrawingCommand, { type: "mutate_structure" }> {
  return { type: "mutate_structure", actorId, actions };
}

/** Creates one page, its required default paper canvas, and editable work layer atomically. */
export function createDrawingPageCommand(
  state: Pick<DrawingDocumentState, "revisionId" | "layers" | "structure">,
  actorId: string,
  name: string,
  createId: () => string = () => crypto.randomUUID(),
): Extract<DrawingCommand, { type: "mutate_structure" }> {
  const canonical = requireStructureState(state);
  const page: DrawingPage = DrawingPageSchema.parse({
    id: createId(),
    revisionId: canonical.revisionId,
    name: entityName(name),
    sortOrder: nextSortOrder(Object.values(canonical.structure.pages)),
    version: 1,
  });
  const canvas: DrawingCanvas = DrawingCanvasSchema.parse({
    id: createId(),
    pageId: page.id,
    name: "Paper",
    spaceKind: "paper",
    widthMillimeters: 210,
    heightMillimeters: 297,
    background: null,
    sortOrder: 0,
    version: 1,
  });
  const layer = DrawingStructureLayerSchema.parse({
    id: createId(),
    name: "Work",
    visible: true,
    locked: false,
    systemKind: "work",
    canvasId: canvas.id,
    sortOrder: 0,
    version: 1,
  });
  return structureCommand(actorId, [
    { kind: "put_page", entity: page, baseVersion: null },
    { kind: "put_canvas", entity: canvas, baseVersion: null },
    { kind: "put_layer", entity: layer, baseVersion: null },
  ]);
}

/** Creates a non-default canvas and its editable layer in one strict action batch. */
export function createDrawingCanvasCommand(
  state: Pick<DrawingDocumentState, "revisionId" | "layers" | "structure">,
  actorId: string,
  pageId: string,
  spaceKind: DrawingCanvas["spaceKind"],
  name: string,
  createId: () => string = () => crypto.randomUUID(),
): Extract<DrawingCommand, { type: "mutate_structure" }> {
  const canonical = requireStructureState(state);
  if (!canonical.structure.pages[pageId])
    throw new DrawingCommandError("Drawing page does not exist.");
  const siblings = Object.values(canonical.structure.canvases).filter(
    (canvas) => canvas.pageId === pageId,
  );
  const canvas: DrawingCanvas = DrawingCanvasSchema.parse({
    id: createId(),
    pageId,
    name: nextUniqueSiblingName(name, siblings),
    spaceKind,
    widthMillimeters: 210,
    heightMillimeters: 297,
    background: null,
    sortOrder: nextSortOrder(siblings),
    version: 1,
  });
  const layer = DrawingStructureLayerSchema.parse({
    id: createId(),
    name: spaceKind === "model" ? "Model work" : "Paper work",
    visible: true,
    locked: false,
    systemKind: "custom",
    canvasId: canvas.id,
    sortOrder: 0,
    version: 1,
  });
  return structureCommand(actorId, [
    { kind: "put_canvas", entity: canvas, baseVersion: null },
    { kind: "put_layer", entity: layer, baseVersion: null },
  ]);
}

export function renameDrawingPageCommand(
  state: Pick<DrawingDocumentState, "revisionId" | "layers" | "structure">,
  actorId: string,
  pageId: string,
  name: string,
): Extract<DrawingCommand, { type: "mutate_structure" }> {
  const page = requireStructureState(state).structure.pages[pageId];
  if (!page) throw new DrawingCommandError("Drawing page does not exist.");
  return structureCommand(actorId, [
    {
      kind: "put_page",
      entity: { ...page, name: entityName(name) },
      baseVersion: page.version,
    },
  ]);
}

export function renameDrawingCanvasCommand(
  state: Pick<DrawingDocumentState, "revisionId" | "layers" | "structure">,
  actorId: string,
  canvasId: string,
  name: string,
): Extract<DrawingCommand, { type: "mutate_structure" }> {
  const canonical = requireStructureState(state);
  const canvas = canonical.structure.canvases[canvasId];
  if (!canvas) throw new DrawingCommandError("Drawing canvas does not exist.");
  return structureCommand(actorId, [
    {
      kind: "put_canvas",
      entity: {
        ...canvas,
        name: requireUniqueName(
          name,
          Object.values(canonical.structure.canvases).filter(
            (sibling) => sibling.pageId === canvas.pageId,
          ),
          canvas.id,
        ),
      },
      baseVersion: canvas.version,
    },
  ]);
}

function reorderStructureEntity<
  T extends { id: string; sortOrder?: number; version: number },
>(
  actorId: string,
  entity: T,
  siblings: T[],
  direction: "up" | "down",
  kind: "put_page" | "put_canvas" | "put_layer",
  startSortOrder = 0,
): Extract<DrawingCommand, { type: "mutate_structure" }> {
  const items = ordered(siblings);
  const index = items.findIndex((candidate) => candidate.id === entity.id);
  const target = items[index + (direction === "up" ? -1 : 1)];
  if (!target)
    throw new DrawingCommandError(
      "Drawing item cannot move farther in that direction.",
    );
  const reordered = [...items];
  [reordered[index], reordered[index + (direction === "up" ? -1 : 1)]] = [
    reordered[index + (direction === "up" ? -1 : 1)],
    reordered[index],
  ];
  return structureCommand(
    actorId,
    reordered
      .map((item, index) => ({ item, sortOrder: startSortOrder + index }))
      .filter(({ item, sortOrder }) => (item.sortOrder ?? 0) !== sortOrder)
      .map(({ item, sortOrder }) => ({
        kind,
        entity: { ...item, sortOrder },
        baseVersion: item.version,
      })) as unknown as DrawingStructureAction[],
  );
}

export function reorderDrawingPageCommand(
  state: Pick<DrawingDocumentState, "revisionId" | "layers" | "structure">,
  actorId: string,
  pageId: string,
  direction: "up" | "down",
) {
  const canonical = requireStructureState(state);
  const page = canonical.structure.pages[pageId];
  if (!page) throw new DrawingCommandError("Drawing page does not exist.");
  return reorderStructureEntity(
    actorId,
    page,
    Object.values(canonical.structure.pages),
    direction,
    "put_page",
  );
}

export function reorderDrawingCanvasCommand(
  state: Pick<DrawingDocumentState, "revisionId" | "layers" | "structure">,
  actorId: string,
  canvasId: string,
  direction: "up" | "down",
) {
  const canonical = requireStructureState(state);
  const canvas = canonical.structure.canvases[canvasId];
  if (!canvas) throw new DrawingCommandError("Drawing canvas does not exist.");
  if (canvas.spaceKind === "paper" && canvas.sortOrder === 0) {
    throw new DrawingCommandError("The default paper canvas is pinned at the top of its page.");
  }
  return reorderStructureEntity(
    actorId,
    canvas,
    Object.values(canonical.structure.canvases).filter(
      (item) => item.pageId === canvas.pageId,
    ),
    direction,
    "put_canvas",
  );
}

export function reorderDrawingLayerCommand(
  state: Pick<DrawingDocumentState, "revisionId" | "layers" | "structure">,
  actorId: string,
  layerId: string,
  direction: "up" | "down",
) {
  const canonical = requireStructureState(state);
  const layer = canonical.structure.layers[layerId];
  if (!layer) throw new DrawingCommandError("Drawing layer does not exist.");
  if (layer.systemKind === "source")
    throw new DrawingCommandError("Source drawing layer is immutable.");
  const siblings = Object.values(canonical.structure.layers).filter(
    (item) => item.canvasId === layer.canvasId && item.systemKind !== "source",
  );
  const sourceMaximum = Math.max(
    -1,
    ...Object.values(canonical.structure.layers)
      .filter((item) => item.canvasId === layer.canvasId && item.systemKind === "source")
      .map((item) => item.sortOrder ?? 0),
  );
  return reorderStructureEntity(
    actorId,
    layer,
    siblings,
    direction,
    "put_layer",
    sourceMaximum + 1,
  );
}

export function moveDrawingLayerToCanvasCommand(
  state: Pick<DrawingDocumentState, "revisionId" | "layers" | "structure">,
  actorId: string,
  layerId: string,
  canvasId: string,
) {
  const canonical = requireStructureState(state);
  const layer = canonical.structure.layers[layerId];
  const target = canonical.structure.canvases[canvasId];
  if (!layer || !target)
    throw new DrawingCommandError("Drawing layer or canvas does not exist.");
  if (layer.systemKind === "source")
    throw new DrawingCommandError("Source drawing layer is immutable.");
  const origin = canonical.structure.canvases[layer.canvasId ?? ""];
  if (!origin || origin.pageId !== target.pageId)
    throw new DrawingCommandError(
      "Layers may move only between canvases on the same page.",
    );
  return structureCommand(actorId, [
    {
      kind: "put_layer",
      entity: {
        ...layer,
        canvasId,
        sortOrder: nextSortOrder(
          Object.values(canonical.structure.layers).filter(
            (item) => item.canvasId === canvasId,
          ),
        ),
      },
      baseVersion: layer.version,
    },
  ]);
}

function canvasContentReason(
  structure: NonNullable<DrawingDocumentState["structure"]>,
  canvasId: string,
): string | null {
  const layerIds = new Set(
    Object.values(structure.layers)
      .filter((layer) => layer.canvasId === canvasId)
      .map((layer) => layer.id),
  );
  return Object.values(structure.objects).some((object) =>
    layerIds.has(object.layerId),
  ) ||
    Object.values(structure.blockInstances).some((instance) =>
      layerIds.has(instance.layerId),
    )
    ? "Canvas with objects or blocks cannot be deleted."
    : null;
}

export function drawingCanvasDeletionReason(
  state: Pick<DrawingDocumentState, "revisionId" | "layers" | "structure">,
  canvasId: string,
): string | null {
  const canonical = requireStructureState(state);
  const canvas = canonical.structure.canvases[canvasId];
  if (!canvas) return "Drawing canvas does not exist.";
  if (canvas.spaceKind === "paper" && canvas.sortOrder === 0)
    return "The default paper canvas can only be deleted with its page.";
  if (
    Object.values(canonical.structure.canvases).filter(
      (item) => item.pageId === canvas.pageId,
    ).length <= 1
  )
    return "A page requires at least one canvas.";
  return canvasContentReason(canonical.structure, canvasId);
}

export function deleteDrawingCanvasCommand(
  state: Pick<DrawingDocumentState, "revisionId" | "layers" | "structure">,
  actorId: string,
  canvasId: string,
) {
  const canonical = requireStructureState(state);
  const reason = drawingCanvasDeletionReason(canonical, canvasId);
  if (reason) throw new DrawingCommandError(reason);
  const canvas = canonical.structure.canvases[canvasId];
  const layers = Object.values(canonical.structure.layers).filter(
    (layer) => layer.canvasId === canvasId,
  );
  return structureCommand(actorId, [
    ...layers.map((layer) => ({
      kind: "delete_layer" as const,
      id: layer.id,
      baseVersion: layer.version,
    })),
    { kind: "delete_canvas", id: canvas.id, baseVersion: canvas.version },
  ]);
}

export function drawingPageDeletionReason(
  state: Pick<DrawingDocumentState, "revisionId" | "layers" | "structure">,
  pageId: string,
): string | null {
  const canonical = requireStructureState(state);
  const page = canonical.structure.pages[pageId];
  if (!page) return "Drawing page does not exist.";
  return (
    Object.keys(canonical.structure.pages).length <= 1
      ? "A drawing document requires at least one page."
      :
    Object.values(canonical.structure.canvases)
      .filter((canvas) => canvas.pageId === pageId)
      .map((canvas) => canvasContentReason(canonical.structure, canvas.id))
      .find((reason): reason is string => Boolean(reason)) ?? null
  );
}

export function deleteDrawingPageCommand(
  state: Pick<DrawingDocumentState, "revisionId" | "layers" | "structure">,
  actorId: string,
  pageId: string,
) {
  const canonical = requireStructureState(state);
  const reason = drawingPageDeletionReason(canonical, pageId);
  if (reason) throw new DrawingCommandError(reason);
  const page = canonical.structure.pages[pageId];
  const canvases = Object.values(canonical.structure.canvases).filter(
    (canvas) => canvas.pageId === pageId,
  );
  const layerActions = canvases.flatMap((canvas) =>
    Object.values(canonical.structure.layers)
      .filter((layer) => layer.canvasId === canvas.id)
      .map((layer) => ({
        kind: "delete_layer" as const,
        id: layer.id,
        baseVersion: layer.version,
      })),
  );
  return structureCommand(actorId, [
    ...layerActions,
    ...canvases.map((canvas) => ({
      kind: "delete_canvas" as const,
      id: canvas.id,
      baseVersion: canvas.version,
    })),
    { kind: "delete_page", id: page.id, baseVersion: page.version },
  ]);
}

export type DrawingCommand =
  | { type: "add_objects"; actorId: string; objects: DrawingObject[] }
  | { type: "update_objects"; actorId: string; updates: ObjectUpdate[] }
  | { type: "delete_objects"; actorId: string; objectIds: string[] }
  | { type: "add_layer"; actorId: string; layer: DrawingLayerInput }
  | {
      type: "update_layer";
      actorId: string;
      layerId: string;
      patch: LayerPatch;
    }
  | {
      type: "mutate_structure";
      actorId: string;
      actions: DrawingStructureAction[];
    };

type DrawingCommandPayload =
  | { type: "add_objects"; objects: DrawingObject[] }
  | { type: "update_objects"; updates: ObjectUpdate[] }
  | { type: "delete_objects"; objectIds: string[] }
  | { type: "add_layer"; layer: DrawingLayerInput }
  | { type: "update_layer"; layerId: string; patch: LayerPatch }
  | { type: "mutate_structure"; actions: DrawingStructureAction[] };

export type DrawingRecordedOperation = Omit<
  DrawingOperationInput,
  "type" | "forward" | "inverse"
> & {
  type: DrawingCommand["type"];
  forward: DrawingCommandPayload;
  inverse: DrawingCommandPayload | Record<string, never>;
  actorId: string;
  /** add_layer has no inverse until the command union gains delete_layer. */
  undoable: boolean;
  /** Expected target versions after this operation; null means an object is absent. */
  resultVersions: Record<string, number | null>;
  /** Real database versions, including tombstones omitted from local object state. */
  realizedVersions: Record<string, number>;
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
  /** P2 canonical entities are absent until a document is upgraded/loaded. */
  structure?: Omit<DrawingStructureState, "revisionId">;
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
  realizedVersions: Record<string, number>;
  undoable: boolean;
  structure?: Omit<DrawingStructureState, "revisionId">;
};

type CommandHistoryMetadata = {
  originalOperationId?: string;
  historyAction?: "undo" | "redo";
};

type ReductionOptions = {
  restoreBaseVersions?: Record<string, number>;
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
    case "mutate_structure":
      return { type: command.type, actions: clone(command.actions) };
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
  if (patch.name !== undefined) inverse.name = object.name;
  if (patch.layerId !== undefined) inverse.layerId = object.layerId;
  if (patch.geometry !== undefined) inverse.geometry = clone(object.geometry);
  if (patch.styleId !== undefined) inverse.styleId = object.styleId ?? null;
  if (patch.style !== undefined) inverse.style = clone(object.style);
  return inverse;
}

function layerPatchBefore(layer: DrawingLayer, patch: LayerPatch): LayerPatch {
  const inverse: LayerPatch = {};
  if (patch.name !== undefined) inverse.name = layer.name;
  if (patch.visible !== undefined) inverse.visible = layer.visible;
  if (patch.locked !== undefined) inverse.locked = layer.locked;
  if (patch.canvasId !== undefined) inverse.canvasId = layer.canvasId;
  if (patch.sortOrder !== undefined) inverse.sortOrder = layer.sortOrder;
  return inverse;
}

function reduceCommand(
  state: DrawingDocumentState,
  command: DrawingCommand,
  options: ReductionOptions = {},
): Reduction {
  const objects = { ...state.objects };
  const layers = { ...state.layers };
  const baseVersions: Record<string, number> = {};
  const resultVersions: Record<string, number | null> = {};
  const realizedVersions: Record<string, number> = {};
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
        const added = DrawingObjectSchema.parse(clone(object));
        const restoreBaseVersion = options.restoreBaseVersions?.[added.id];
        if (restoreBaseVersion === undefined) {
          if (added.version !== 1) {
            throw new DrawingCommandError(
              `New drawing object ${added.id} must start at version 1.`,
            );
          }
        } else {
          if (added.version !== restoreBaseVersion + 1) {
            throw new DrawingCommandError(
              `Drawing object ${added.id} restore version must follow tombstone ${restoreBaseVersion}.`,
            );
          }
          baseVersions[added.id] = restoreBaseVersion;
        }
        objects[added.id] = added;
        resultVersions[added.id] = added.version;
        realizedVersions[added.id] = added.version;
      }
      return {
        objects,
        layers,
        baseVersions,
        forward,
        inverse: { type: "delete_objects", objectIds: [...objectIds] },
        resultVersions,
        realizedVersions,
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
        if (update.patch.name !== undefined) {
          DrawingObjectNameSchema.parse(update.patch.name);
        }
        baseVersions[object.id] = object.version;
        inverseUpdates.push({
          objectId: object.id,
          patch: objectPatchBefore(object, update.patch),
        });
        const updated = DrawingObjectSchema.parse({
          ...object,
          ...clone(update.patch),
          ...(update.patch.style !== undefined
            ? { style: clone(update.patch.style) }
            : {}),
          version: object.version + 1,
        });
        if (updated.styleId) {
          if (!state.structure) {
            throw new DrawingCommandError(
              "Referenced drawing styles require canonical structure state.",
            );
          }
          resolveDrawingStyle(updated, state.structure.styles);
        }
        objects[object.id] = updated;
        resultVersions[object.id] = updated.version;
        realizedVersions[object.id] = updated.version;
      }
      return {
        objects,
        layers,
        baseVersions,
        forward,
        inverse: { type: "update_objects", updates: inverseUpdates },
        resultVersions,
        realizedVersions,
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
        realizedVersions[object.id] = object.version + 1;
        deleted.push({ ...clone(object), version: object.version + 2 });
        delete objects[object.id];
      }
      return {
        objects,
        layers,
        baseVersions,
        forward,
        inverse: { type: "add_objects", objects: deleted },
        resultVersions,
        realizedVersions,
        undoable: true,
      };
    }
    case "add_layer": {
      if (layers[command.layer.id]) {
        throw new DrawingCommandError(
          `Drawing layer ${command.layer.id} already exists.`,
        );
      }
      const input = DrawingLayerInputSchema.parse(clone(command.layer));
      if (Object.values(layers).some((layer) => layer.name === input.name)) {
        throw new DrawingCommandError(
          `Drawing layer name ${input.name} already exists.`,
        );
      }
      const added = DrawingLayerSchema.parse({
        ...input,
        systemKind: "custom",
      });
      layers[added.id] = added;
      baseVersions[added.id] = added.version;
      resultVersions[added.id] = added.version;
      realizedVersions[added.id] = added.version;
      return {
        objects,
        layers,
        baseVersions,
        forward,
        inverse: {},
        resultVersions,
        realizedVersions,
        undoable: false,
      };
    }
    case "update_layer": {
      const layer = requireLayer(layers, command.layerId);
      if (layer.systemKind === "source") {
        throw new DrawingCommandError("Source drawing layer is immutable.");
      }
      if (command.patch.name !== undefined) {
        DrawingLayerNameSchema.parse(command.patch.name);
        if (
          Object.values(layers).some(
            (candidate) =>
              candidate.id !== layer.id &&
              candidate.name === command.patch.name,
          )
        ) {
          throw new DrawingCommandError(
            `Drawing layer name ${command.patch.name} already exists.`,
          );
        }
      }
      if (command.patch.canvasId !== undefined && state.structure) {
        const target = state.structure.canvases[command.patch.canvasId];
        const origin = state.structure.canvases[layer.canvasId ?? ""];
        if (!target || !origin || target.pageId !== origin.pageId) {
          throw new DrawingCommandError(
            "Layers may move only between canvases on the same page.",
          );
        }
      }
      baseVersions[layer.id] = layer.version;
      const inverse = layerPatchBefore(layer, command.patch);
      const updated = DrawingLayerSchema.parse({
        ...layer,
        ...clone(command.patch),
        version: layer.version + 1,
      });
      const candidateLayers = { ...layers, [layer.id]: updated };
      const losesEditableLayer = state.structure
        ? Object.values(state.structure.canvases).some(
            (canvas) =>
              !Object.values(candidateLayers).some(
                (candidate) =>
                  candidate.canvasId === canvas.id &&
                  isEditableDrawingLayer(candidate),
              ),
          )
        : !Object.values(candidateLayers).some(isEditableDrawingLayer);
      if (losesEditableLayer) {
        throw new DrawingCommandError(
          "Every canvas requires a visible unlocked user drawing layer.",
        );
      }
      layers[layer.id] = updated;
      resultVersions[layer.id] = updated.version;
      realizedVersions[layer.id] = updated.version;
      return {
        objects,
        layers,
        baseVersions,
        forward,
        inverse: { type: "update_layer", layerId: layer.id, patch: inverse },
        resultVersions,
        realizedVersions,
        undoable: true,
      };
    }
    case "mutate_structure": {
      if (!state.structure) {
        throw new DrawingCommandError(
          "Drawing structure state is required for mutate_structure.",
        );
      }
      const applied = applyDrawingStructureActions(
        { revisionId: state.revisionId, ...state.structure },
        command.actions,
      );
      const { revisionId: _revisionId, ...structure } = applied.state;
      return {
        objects: applied.state.objects,
        layers: applied.state.layers,
        baseVersions: applied.baseVersions,
        forward,
        inverse: { type: "mutate_structure", actions: applied.inverse },
        resultVersions: applied.resultVersions,
        realizedVersions: applied.realizedVersions,
        undoable: true,
        structure,
      };
    }
  }
}

function appendOperation(
  state: DrawingDocumentState,
  command: DrawingCommand,
  environment: DrawingCommandEnvironment,
  metadata: CommandHistoryMetadata = {},
  options: ReductionOptions = {},
): AppliedDrawingCommand {
  const reduced = reduceCommand(state, command, options);
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
    realizedVersions: reduced.realizedVersions,
    undoable: reduced.undoable,
    ...metadata,
  };
  return {
    state: {
      ...state,
      objects: reduced.objects,
      layers: reduced.layers,
      structure:
        reduced.structure ??
        (state.structure
          ? {
              ...state.structure,
              objects: reduced.objects,
              layers: reduced.layers,
            }
          : undefined),
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
        operation.type === "mutate_structure"
          ? structureTarget(
              state.structure,
              (
                operation.forward as Extract<
                  DrawingCommandPayload,
                  { type: "mutate_structure" }
                >
              ).actions,
              objectId,
            )
          : operation.type === "update_layer"
            ? state.layers[objectId]
            : state.objects[objectId];
      return expectedVersion === null
        ? current !== undefined
        : current?.version !== expectedVersion;
    })
    .map(([objectId]) => objectId);
  return objectIds.length > 0 ? { kind: "conflict", objectIds } : undefined;
}

function structureCollectionFor(
  kind: DrawingStructureAction["kind"],
): keyof Omit<DrawingStructureState, "revisionId" | "tombstones"> {
  if (kind.includes("object")) return "objects";
  if (kind.includes("page")) return "pages";
  if (kind.includes("canvas")) return "canvases";
  if (kind.includes("layer")) return "layers";
  if (kind.includes("style")) return "styles";
  if (kind.includes("block_instance")) return "blockInstances";
  if (kind.includes("block")) return "blocks";
  if (kind.includes("property_schema")) return "propertySchemas";
  if (kind.includes("property_value")) return "propertyValues";
  return "tables";
}

function structureTarget(
  structure: DrawingDocumentState["structure"],
  actions: DrawingStructureAction[],
  id: string,
): { version: number } | undefined {
  if (!structure) return undefined;
  const action = actions.find(
    (candidate) =>
      ("entity" in candidate ? candidate.entity.id : candidate.id) === id,
  );
  if (!action) return undefined;
  const collection = structureCollectionFor(action.kind);
  return (structure[collection] as Record<string, { version: number }>)[id];
}

function realizeStructurePayload(
  payload: Extract<DrawingCommandPayload, { type: "mutate_structure" }>,
  structure: DrawingDocumentState["structure"],
): Extract<DrawingCommandPayload, { type: "mutate_structure" }> {
  if (!structure)
    throw new DrawingCommandError(
      "Drawing structure state is required for structure history.",
    );
  return {
    type: "mutate_structure",
    actions: payload.actions.map((action) => {
      const id = "entity" in action ? action.entity.id : action.id;
      const current = (
        structure[structureCollectionFor(action.kind)] as Record<
          string,
          { version: number }
        >
      )[id];
      if ("entity" in action) {
        return {
          ...clone(action),
          baseVersion: current?.version ?? null,
        } as DrawingStructureAction;
      }
      if (!current)
        throw new DrawingCommandError(
          `Structure history target ${id} no longer exists.`,
        );
      return {
        ...clone(action),
        baseVersion: current.version,
      } as DrawingStructureAction;
    }),
  };
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

function realizeAddPayload(
  payload: Extract<DrawingCommandPayload, { type: "add_objects" }>,
  tombstoneVersions: Record<string, number>,
): Extract<DrawingCommandPayload, { type: "add_objects" }> {
  return {
    type: "add_objects",
    objects: payload.objects.map((object) => {
      const tombstoneVersion = tombstoneVersions[object.id];
      if (tombstoneVersion === undefined) {
        throw new DrawingCommandError(
          `Drawing object ${object.id} tombstone realization is missing.`,
        );
      }
      return { ...clone(object), version: tombstoneVersion + 1 };
    }),
  };
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
  objects,
  layers,
  structure,
}: {
  revisionId: string;
  objects?: DrawingObject[];
  layers?: DrawingLayer[];
  structure?: Omit<DrawingStructureState, "revisionId">;
}): DrawingDocumentState {
  const canonicalObjects = structure
    ? mapById(Object.values(structure.objects))
    : mapById(
        (objects ?? []).map((object) => DrawingObjectSchema.parse(object)),
      );
  const canonicalLayers = structure
    ? mapById(Object.values(structure.layers))
    : mapById((layers ?? []).map((layer) => DrawingLayerSchema.parse(layer)));
  const suppliedObjects = objects
    ? mapById(objects.map((object) => DrawingObjectSchema.parse(object)))
    : undefined;
  const suppliedLayers = layers
    ? mapById(layers.map((layer) => DrawingLayerSchema.parse(layer)))
    : undefined;
  if (
    structure &&
    ((suppliedObjects &&
      JSON.stringify(suppliedObjects) !== JSON.stringify(canonicalObjects)) ||
      (suppliedLayers &&
        JSON.stringify(suppliedLayers) !== JSON.stringify(canonicalLayers)))
  ) {
    throw new DrawingCommandError(
      "Drawing structure objects and layers must match the canonical document state.",
    );
  }
  return {
    revisionId,
    objects: canonicalObjects,
    layers: canonicalLayers,
    operations: [],
    undoStackByActor: {},
    redoStackByActor: {},
    structure: structure
      ? {
          ...clone(structure),
          objects: canonicalObjects,
          layers: canonicalLayers,
        }
      : undefined,
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
  const originalPayload = original.inverse as DrawingCommandPayload;
  const payload =
    originalPayload.type === "add_objects"
      ? realizeAddPayload(originalPayload, latestApplied.realizedVersions)
      : originalPayload.type === "mutate_structure"
        ? realizeStructurePayload(originalPayload, state.structure)
        : originalPayload;
  const applied = appendOperation(
    state,
    payloadToCommand(actorId, payload),
    environment,
    { originalOperationId, historyAction: "undo" },
    payload.type === "add_objects"
      ? { restoreBaseVersions: latestApplied.realizedVersions }
      : {},
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
  const originalPayload = original.forward as DrawingCommandPayload;
  const payload: DrawingCommandPayload =
    originalPayload.type === "add_objects"
      ? realizeAddPayload(originalPayload, inverse.realizedVersions)
      : originalPayload.type === "mutate_structure"
        ? realizeStructurePayload(originalPayload, state.structure)
        : originalPayload;
  const applied = appendOperation(
    state,
    payloadToCommand(actorId, payload),
    environment,
    { originalOperationId, historyAction: "redo" },
    payload.type === "add_objects"
      ? { restoreBaseVersions: inverse.realizedVersions }
      : {},
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
  items: Array<
    Pick<DrawingObject, "name" | "layerId" | "geometry"> & {
      style: DrawingStyle;
    }
  >;
};

export type DrawingMoveSnapshot = Pick<
  DrawingObject,
  "id" | "layerId" | "geometry" | "version"
>;

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
  const snapshots = [...new Set(selectedIds)].flatMap((objectId) => {
    const object = mutableDrawingObject(state, objectId);
    return object
      ? [
          {
            id: object.id,
            layerId: object.layerId,
            geometry: clone(object.geometry),
            version: object.version,
          },
        ]
      : [];
  });
  return moveDrawingSnapshots(snapshots, actorId, delta);
}

/** Creates a move from immutable pointer-down object snapshots. */
export function moveDrawingSnapshots(
  snapshots: DrawingMoveSnapshot[],
  actorId: string,
  delta: Point,
): Extract<DrawingCommand, { type: "update_objects" }> | null {
  const updates = snapshots.map((snapshot) => ({
    objectId: snapshot.id,
    baseVersion: snapshot.version,
    patch: {
      geometry: translateDrawingGeometry(snapshot.geometry, delta),
    },
  }));
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
  resolveStyle:
    | ((object: DrawingObject) => DrawingStyle)
    | undefined = undefined,
): DrawingClipboard {
  return {
    items: [...new Set(selectedIds)].flatMap((objectId) => {
      const object = mutableDrawingObject(state, objectId);
      if (object?.styleId && !resolveStyle) {
        throw new DrawingCommandError(
          "Copying a referenced style requires an explicit style resolver.",
        );
      }
      return object
        ? [
            clone({
              name: object.name,
              layerId: object.layerId,
              geometry: object.geometry,
              style: object.styleId
                ? DrawingStyleSchema.parse(resolveStyle!(object))
                : DrawingStyleSchema.parse(object.style),
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
  const objects: DrawingObject[] = clipboard.items.map((item) => ({
    id: createId(),
    name: item.name,
    layerId: item.layerId,
    geometry: translateDrawingGeometry(item.geometry, { x: 20, y: 20 }),
    style: clone(item.style),
    version: 1,
  }));
  return { type: "add_objects", actorId, objects };
}

/** Returns true only for visible, unlocked user-authored layers. */
export function isEditableDrawingLayer(layer: DrawingLayer | undefined) {
  return Boolean(
    layer &&
      (layer.systemKind === "work" || layer.systemKind === "custom") &&
      layer.visible &&
      !layer.locked,
  );
}

/** Keeps the requested layer when eligible, otherwise selects a stable fallback. */
export function resolveActiveDrawingLayerId(
  layers: Record<string, DrawingLayer>,
  requestedLayerId: string | null,
): string | null {
  if (requestedLayerId && isEditableDrawingLayer(layers[requestedLayerId])) {
    return requestedLayerId;
  }
  const candidates = Object.values(layers).filter(isEditableDrawingLayer);
  return (
    candidates.find((layer) => layer.systemKind === "work")?.id ??
    candidates[0]?.id ??
    null
  );
}

/** Creates a normalized local add-layer command without browser-supplied authority. */
export function createDrawingLayerCommand(
  state: Pick<DrawingDocumentState, "revisionId" | "layers" | "structure">,
  actorId: string,
  name: string,
  createId: () => string = () => crypto.randomUUID(),
  canvasId?: string,
): Extract<DrawingCommand, { type: "add_layer" }> {
  const normalizedName = DrawingLayerNameSchema.parse(name.trim());
  if (
    Object.values(state.layers).some((layer) => layer.name === normalizedName)
  ) {
    throw new DrawingCommandError(
      `Drawing layer name ${normalizedName} already exists.`,
    );
  }
  if (state.structure) {
    if (!canvasId || !state.structure.canvases[canvasId]) {
      throw new DrawingCommandError(
        "Drawing canvas is required to create a layer.",
      );
    }
    return {
      type: "add_layer",
      actorId,
      layer: DrawingLayerInputSchema.parse({
        id: createId(),
        name: normalizedName,
        visible: true,
        locked: false,
        canvasId,
        sortOrder: nextSortOrder(
          Object.values(state.structure.layers).filter(
            (layer) => layer.canvasId === canvasId,
          ),
        ),
        version: 1,
      }),
    };
  }
  return {
    type: "add_layer",
    actorId,
    layer: DrawingLayerInputSchema.parse({
      id: createId(),
      name: normalizedName,
      visible: true,
      locked: false,
      version: 1,
    }),
  };
}

/** Creates a normalized layer update and enforces immutable/eligible layer rules. */
export function updateDrawingLayerCommand(
  state: Pick<DrawingDocumentState, "revisionId" | "layers" | "structure">,
  actorId: string,
  layerId: string,
  patch: LayerPatch,
): Extract<DrawingCommand, { type: "update_layer" }> {
  const layer = requireLayer(state.layers, layerId);
  if (layer.systemKind === "source") {
    throw new DrawingCommandError("Source drawing layer is immutable.");
  }
  const normalizedPatch: LayerPatch = { ...patch };
  if (patch.name !== undefined) {
    normalizedPatch.name = DrawingLayerNameSchema.parse(patch.name.trim());
  }
  const command = {
    type: "update_layer" as const,
    actorId,
    layerId,
    patch: normalizedPatch,
  };
  reduceCommand(
    {
      revisionId: state.revisionId,
      objects: {},
      layers: state.layers,
      operations: [],
      undoStackByActor: {},
      redoStackByActor: {},
      structure: state.structure,
    },
    command,
  );
  return command;
}

export type DrawingInspectorPatch = {
  name?: string;
  layerId?: string;
  stroke?: string;
  strokeWidth?: number;
  fill?: string | null;
  text?: string;
};

/** Builds one atomic, version-aware property command for an exact selection. */
export function updateDrawingSelectionProperties(
  state: Pick<DrawingDocumentState, "layers" | "objects">,
  selectedIds: string[],
  actorId: string,
  patch: DrawingInspectorPatch,
): Extract<DrawingCommand, { type: "update_objects" }> | null {
  const keys = Object.keys(patch);
  if (keys.length === 0) return null;
  const allowedKeys = new Set([
    "name",
    "layerId",
    "stroke",
    "strokeWidth",
    "fill",
    "text",
  ]);
  if (keys.some((key) => !allowedKeys.has(key))) {
    throw new DrawingCommandError("Unknown drawing inspector property.");
  }
  const parsed = {
    ...patch,
    ...(patch.name !== undefined
      ? { name: DrawingObjectNameSchema.parse(patch.name.trim()) }
      : {}),
    ...(patch.stroke !== undefined
      ? { stroke: DrawingStrokeColorSchema.parse(patch.stroke) }
      : {}),
    ...(patch.strokeWidth !== undefined
      ? { strokeWidth: DrawingStrokeWidthSchema.parse(patch.strokeWidth) }
      : {}),
    ...(patch.fill !== undefined
      ? { fill: DrawingFillColorSchema.parse(patch.fill) }
      : {}),
  };
  if (parsed.layerId !== undefined) {
    const targetLayer = requireLayer(state.layers, parsed.layerId);
    if (!isEditableDrawingLayer(targetLayer)) {
      throw new LockedDrawingLayerError(parsed.layerId);
    }
  }
  const objectIds = [...new Set(selectedIds)];
  if (objectIds.length === 0) return null;
  const targets = objectIds.map((objectId) => {
    const object = requireObject(state.objects, objectId);
    if (!mutableDrawingObject(state, objectId)) {
      throw new LockedDrawingLayerError(object.layerId);
    }
    return object;
  });
  if (
    parsed.text !== undefined &&
    targets.some((object) => object.geometry.type !== "text")
  ) {
    throw new DrawingCommandError("Text can only update text objects.");
  }
  const changesStyle =
    parsed.stroke !== undefined ||
    parsed.strokeWidth !== undefined ||
    parsed.fill !== undefined;
  const updates = targets.map((object) => {
    const objectPatch: ObjectPatch = {};
    if (parsed.name !== undefined) objectPatch.name = parsed.name;
    if (parsed.layerId !== undefined) objectPatch.layerId = parsed.layerId;
    if (changesStyle) {
      objectPatch.style = {
        ...object.style,
        ...(parsed.stroke !== undefined ? { stroke: parsed.stroke } : {}),
        ...(parsed.strokeWidth !== undefined
          ? { strokeWidth: parsed.strokeWidth }
          : {}),
        ...(parsed.fill !== undefined ? { fill: parsed.fill } : {}),
      };
    }
    if (parsed.text !== undefined && object.geometry.type === "text") {
      objectPatch.geometry = DrawingGeometrySchema.parse({
        ...object.geometry,
        text: parsed.text,
      });
    }
    return {
      objectId: object.id,
      baseVersion: object.version,
      patch: objectPatch,
    };
  });
  return { type: "update_objects", actorId, updates };
}

export function duplicateDrawingSelection(
  state: Pick<DrawingDocumentState, "layers" | "objects">,
  selectedIds: string[],
  actorId: string,
  createId?: () => string,
): Extract<DrawingCommand, { type: "add_objects" }> | null {
  const nextId = createId ?? (() => crypto.randomUUID());
  const objects = [...new Set(selectedIds)].flatMap((objectId) => {
    const object = mutableDrawingObject(state, objectId);
    return object
      ? [
          {
            ...clone(object),
            id: nextId(),
            geometry: translateDrawingGeometry(object.geometry, {
              x: 20,
              y: 20,
            }),
            version: 1,
          },
        ]
      : [];
  });
  return objects.length > 0 ? { type: "add_objects", actorId, objects } : null;
}
