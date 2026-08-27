import {
  applyDrawingCommand,
  createDrawingDocumentState,
  type AppliedDrawingCommand,
  type DrawingCommand,
  type DrawingCommandEnvironment,
  type DrawingDocumentState,
} from "./drawing-commands.ts";
import { drawingVisibleCanvasObjects } from "./drawing-blocks.ts";
import { validateDrawingStructureState } from "./drawing-structure.ts";
import type {
  DrawingBlock,
  DrawingBlockInstance,
  DrawingCanvas,
  DrawingLayer,
  DrawingObject,
  DrawingObjectSource,
  DrawingPage,
  DrawingPropertySchema,
  DrawingPropertyValue,
  DrawingStyleDefinition,
  DrawingTable,
  DrawingStructureLayer,
} from "./drawing-workspace.types.ts";
import {
  DrawingBlockInstanceSchema,
  DrawingBlockSchema,
  DrawingCanvasSchema,
  DrawingObjectSchema,
  DrawingObjectSourceSchema,
  DrawingPageSchema,
  DrawingPropertySchemaSchema,
  DrawingPropertyValueSchema,
  DrawingStructureLayerSchema,
  DrawingStyleDefinitionSchema,
  DrawingTableSchema,
} from "./drawing-workspace.types.ts";

export type DrawingDocumentSnapshot = DrawingDocumentState & {
  /** UI identity only; the canonical canvas ownership remains in structure. */
  activePageId: string | null;
  activeCanvasId: string | null;
};

export type DrawingDocumentHydration = {
  revisionId: string;
  pages: DrawingPage[];
  canvases: DrawingCanvas[];
  layers: DrawingStructureLayer[];
  objects: DrawingObject[];
  sources?: DrawingObjectSource[];
  styles: DrawingStyleDefinition[];
  blocks: DrawingBlock[];
  blockInstances: DrawingBlockInstance[];
  propertySchemas: DrawingPropertySchema[];
  propertyValues: DrawingPropertyValue[];
  tables: DrawingTable[];
};

export type DrawingDocumentStore = {
  getSnapshot(): DrawingDocumentSnapshot;
  subscribe(listener: () => void): () => void;
  dispatch(command: DrawingCommand): AppliedDrawingCommand;
  replace(state: DrawingDocumentState): void;
  selectCanvas(canvasId: string): void;
};

type DrawingDocumentStoreOptions = Partial<DrawingCommandEnvironment> &
  Pick<Partial<DrawingDocumentSnapshot>, "activePageId" | "activeCanvasId"> & {
    revisionStatus?: string;
  };

export class DrawingDocumentStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrawingDocumentStoreError";
  }
}

function byId<T extends { id: string }>(items: T[]): Record<string, T> {
  const result: Record<string, T> = {};
  for (const item of items) {
    if (result[item.id])
      throw new DrawingDocumentStoreError(
        `Duplicate drawing entity ${item.id}.`,
      );
    result[item.id] = structuredClone(item);
  }
  return result;
}

/** Turns the complete P2 loader payload into its single canonical client state. */
export function hydrateDrawingDocumentState(
  hydration: DrawingDocumentHydration,
): DrawingDocumentState {
  const structure = {
    pages: byId(hydration.pages.map((value) => DrawingPageSchema.parse(value))),
    canvases: byId(
      hydration.canvases.map((value) => DrawingCanvasSchema.parse(value)),
    ),
    layers: byId(
      hydration.layers.map((value) => DrawingStructureLayerSchema.parse(value)),
    ),
    objects: byId(
      hydration.objects.map((value) => DrawingObjectSchema.parse(value)),
    ),
    sources: byId(
      (hydration.sources ?? []).map((value) =>
        DrawingObjectSourceSchema.parse(value),
      ),
    ),
    styles: byId(
      hydration.styles.map((value) =>
        DrawingStyleDefinitionSchema.parse(value),
      ),
    ),
    blocks: byId(
      hydration.blocks.map((value) => DrawingBlockSchema.parse(value)),
    ),
    blockInstances: byId(
      hydration.blockInstances.map((value) =>
        DrawingBlockInstanceSchema.parse(value),
      ),
    ),
    propertySchemas: byId(
      hydration.propertySchemas.map((value) =>
        DrawingPropertySchemaSchema.parse(value),
      ),
    ),
    propertyValues: byId(
      hydration.propertyValues.map((value) =>
        DrawingPropertyValueSchema.parse(value),
      ),
    ),
    tables: byId(
      hydration.tables.map((value) => DrawingTableSchema.parse(value)),
    ),
  };
  validateDrawingStructureState({
    revisionId: hydration.revisionId,
    ...structure,
  });
  return createDrawingDocumentState({
    revisionId: hydration.revisionId,
    structure,
  });
}

function isAccessibleCanvas(
  state: DrawingDocumentState,
  canvasId: string,
): boolean {
  return Object.values(state.layers).some(
    (layer) =>
      layer.canvasId === canvasId &&
      (layer.systemKind === "work" || layer.systemKind === "custom") &&
      layer.visible &&
      !layer.locked,
  );
}

function resolveActiveIdentity(
  state: DrawingDocumentState,
  requested: Partial<
    Pick<DrawingDocumentSnapshot, "activePageId" | "activeCanvasId">
  >,
): Pick<DrawingDocumentSnapshot, "activePageId" | "activeCanvasId"> {
  if (!state.structure) return { activePageId: null, activeCanvasId: null };
  const { pages, canvases } = state.structure;
  const requestedCanvas = requested.activeCanvasId
    ? canvases[requested.activeCanvasId]
    : undefined;
  if (
    requested.activePageId &&
    requestedCanvas &&
    requestedCanvas.pageId === requested.activePageId &&
    pages[requested.activePageId] &&
    isAccessibleCanvas(state, requestedCanvas.id)
  ) {
    return {
      activePageId: requested.activePageId ?? null,
      activeCanvasId: requested.activeCanvasId ?? null,
    };
  }
  const fallback = Object.values(canvases)
    .filter(
      (canvas) =>
        canvas.spaceKind === "paper" &&
        pages[canvas.pageId] &&
        isAccessibleCanvas(state, canvas.id),
    )
    .sort((left, right) => {
      const pageOrder =
        pages[left.pageId].sortOrder - pages[right.pageId].sortOrder;
      return (
        pageOrder ||
        left.sortOrder - right.sortOrder ||
        left.id.localeCompare(right.id)
      );
    })[0];
  if (!fallback)
    throw new DrawingDocumentStoreError(
      "Drawing state has no accessible default paper canvas.",
    );
  return { activePageId: fallback.pageId, activeCanvasId: fallback.id };
}

function snapshotFor(
  state: DrawingDocumentState,
  requested: Partial<
    Pick<DrawingDocumentSnapshot, "activePageId" | "activeCanvasId">
  >,
): DrawingDocumentSnapshot {
  if (state.structure) {
    if (
      state.objects !== state.structure.objects ||
      state.layers !== state.structure.layers
    )
      throw new DrawingDocumentStoreError(
        "Drawing objects and layers must share the canonical structure maps.",
      );
    validateDrawingStructureState({
      revisionId: state.revisionId,
      ...state.structure,
    });
  }
  return { ...state, ...resolveActiveIdentity(state, requested) };
}

export type DrawingTransientState = {
  state: DrawingDocumentSnapshot;
  activeLayerId: string | null;
  activeTool: string;
  selectedIds: string[];
};

type ActiveCanvasSlice = {
  layers: Record<string, DrawingLayer>;
  objects: Record<string, DrawingObject>;
  blockInstances: Record<string, DrawingBlockInstance>;
};

const EMPTY_BLOCK_INSTANCES: Record<string, DrawingBlockInstance> = {};

export type DrawingActiveCanvasSliceCache = {
  select(
    layers: Record<string, DrawingLayer>,
    objects: Record<string, DrawingObject>,
    canvasId: string,
    blockInstances?: Record<string, DrawingBlockInstance>,
  ): ActiveCanvasSlice;
  readonly buildCount: number;
};

/** Caches slice work against canonical map identity, never transient UI snapshots. */
export function createDrawingActiveCanvasSliceCache(): DrawingActiveCanvasSliceCache {
  const byLayers = new WeakMap<
    Record<string, DrawingLayer>,
    WeakMap<
      Record<string, DrawingObject>,
      WeakMap<
        Record<string, DrawingBlockInstance>,
        Map<string, ActiveCanvasSlice>
      >
    >
  >();
  let buildCount = 0;
  return {
    select(layers, objects, canvasId, blockInstances = EMPTY_BLOCK_INSTANCES) {
      let byObjects = byLayers.get(layers);
      if (!byObjects) {
        byObjects = new WeakMap();
        byLayers.set(layers, byObjects);
      }
      let byInstances = byObjects.get(objects);
      if (!byInstances) {
        byInstances = new WeakMap();
        byObjects.set(objects, byInstances);
      }
      let byCanvas = byInstances.get(blockInstances);
      if (!byCanvas) {
        byCanvas = new Map();
        byInstances.set(blockInstances, byCanvas);
      }
      const cached = byCanvas.get(canvasId);
      if (cached) return cached;
      const scopedLayers = Object.fromEntries(
        Object.entries(layers).filter(
          ([, layer]) => !canvasId || layer.canvasId === canvasId,
        ),
      ) as Record<string, DrawingLayer>;
      const layerIds = new Set(Object.keys(scopedLayers));
      const scopedObjects = Object.fromEntries(
        Object.entries(objects).filter(([, object]) =>
          layerIds.has(object.layerId),
        ),
      ) as Record<string, DrawingObject>;
      const scopedBlockInstances = Object.fromEntries(
        Object.entries(blockInstances).filter(([, instance]) =>
          layerIds.has(instance.layerId),
        ),
      ) as Record<string, DrawingBlockInstance>;
      const slice = {
        layers: scopedLayers,
        objects: scopedObjects,
        blockInstances: scopedBlockInstances,
      };
      byCanvas.set(canvasId, slice);
      buildCount += 1;
      return slice;
    },
    get buildCount() {
      return buildCount;
    },
  };
}

const activeCanvasSlices = createDrawingActiveCanvasSliceCache();

/** Memoizes canonical canvas indexes by stable entity-map identity and canvas ID. */
export function drawingActiveCanvasSlice(
  snapshot: DrawingDocumentSnapshot,
): ActiveCanvasSlice {
  return activeCanvasSlices.select(
    snapshot.layers,
    snapshot.objects,
    snapshot.activeCanvasId ?? "",
    snapshot.structure?.blockInstances ?? EMPTY_BLOCK_INSTANCES,
  );
}

/**
 * Names the boundary at which transient canvas interaction must be discarded.
 * It intentionally includes permission as well as the active document slice.
 */
export function drawingTransientAuthorizationKey(
  snapshot: Pick<DrawingDocumentSnapshot, "activePageId" | "activeCanvasId">,
  input: {
    draft: boolean;
    canEdit: boolean;
    activeLayer?: Pick<
      DrawingLayer,
      "id" | "visible" | "locked" | "version"
    > | null;
  },
) {
  const layer = input.activeLayer;
  return [
    snapshot.activePageId ?? "",
    snapshot.activeCanvasId ?? "",
    input.draft ? "draft" : "immutable",
    input.canEdit ? "edit" : "read",
    layer?.id ?? "",
    layer?.visible ? "visible" : "hidden",
    layer?.locked ? "locked" : "unlocked",
    layer?.version ?? "",
  ].join(":");
}

/** Clears raw interaction input synchronously while its authorization key is stale. */
export function sanitizeDrawingTransientInput<
  T extends {
    activeLayerId: string | null;
    activeTool: string;
    selectedIds: string[];
  },
>(
  input: T,
  invalidated: boolean,
):
  | {
      activeLayerId: string | null;
      activeTool: "select";
      selectedIds: string[];
    }
  | T {
  return invalidated
    ? {
        activeLayerId: input.activeLayerId,
        activeTool: "select",
        selectedIds: [],
      }
    : input;
}

/**
 * Produces the render-time canvas slice. This is deliberately synchronous so
 * an identity/capability change cannot leak stale selections for one render.
 */
export function deriveDrawingTransientState(
  snapshot: DrawingDocumentSnapshot,
  input: {
    canEdit: boolean;
    canSelect?: boolean;
    activeLayerId: string | null;
    activeTool: string;
    selectedIds: string[];
    semanticBlockInstanceIds?: readonly string[];
  },
): DrawingTransientState {
  const { layers, objects, blockInstances } =
    drawingActiveCanvasSlice(snapshot);
  const eligible = (layer: DrawingLayer | undefined) =>
    Boolean(
      layer &&
      (layer.systemKind === "work" || layer.systemKind === "custom") &&
      layer.visible &&
      !layer.locked,
    );
  const activeLayer =
    input.canEdit && eligible(layers[input.activeLayerId ?? ""])
      ? input.activeLayerId
      : input.canEdit
        ? (Object.values(layers).find(
            (layer) => layer.systemKind === "work" && eligible(layer),
          )?.id ??
          Object.values(layers).find(eligible)?.id ??
          null)
        : null;
  const semanticBlockInstanceIds = new Set(
    input.semanticBlockInstanceIds ?? [],
  );
  const visibleObjectIds = new Set(
    drawingVisibleCanvasObjects(Object.values(objects), layers).map(
      (object) => object.id,
    ),
  );
  const selectedIds =
    (input.canSelect ?? input.canEdit)
      ? input.selectedIds.filter((id) => {
          const object = objects[id];
          const instance = blockInstances[id];
          return Boolean(
            (object &&
              visibleObjectIds.has(object.id) &&
              eligible(layers[object.layerId])) ||
            (instance &&
              (eligible(layers[instance.layerId]) ||
                (semanticBlockInstanceIds.has(instance.id) &&
                  ["work", "custom"].includes(
                    layers[instance.layerId]?.systemKind ?? "",
                  )))),
          );
        })
      : [];
  const state = {
    ...snapshot,
    layers,
    objects,
    structure: snapshot.structure
      ? { ...snapshot.structure, layers, objects, blockInstances }
      : undefined,
  } as DrawingDocumentSnapshot;
  return {
    state,
    activeLayerId: activeLayer,
    activeTool:
      activeLayer || input.activeTool === "pan" ? input.activeTool : "select",
    selectedIds,
  };
}

/**
 * A deliberately small external store. State replacement and dispatch publish
 * once, while active identity is derived from the canonical P2 structure.
 */
export function createDrawingDocumentStore(
  initial: DrawingDocumentState,
  options: DrawingDocumentStoreOptions = {},
): DrawingDocumentStore {
  const revisionStatus = options.revisionStatus ?? "draft";
  let snapshot = snapshotFor(initial, options);
  const listeners = new Set<() => void>();
  const publish = () => {
    for (const listener of listeners) listener();
  };
  const set = (next: DrawingDocumentSnapshot) => {
    if (next === snapshot) return;
    snapshot = next;
    publish();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(command) {
      if (revisionStatus !== "draft")
        throw new DrawingDocumentStoreError(
          "Only draft drawing revisions may be mutated.",
        );
      const applied = applyDrawingCommand(snapshot, command, options);
      set(snapshotFor(applied.state, snapshot));
      return applied;
    },
    replace(state) {
      if (state === snapshot) return;
      set(snapshotFor(state, snapshot));
    },
    selectCanvas(canvasId) {
      const canvas = snapshot.structure?.canvases[canvasId];
      if (!canvas || !isAccessibleCanvas(snapshot, canvasId)) {
        const fallback = resolveActiveIdentity(snapshot, {});
        if (
          fallback.activePageId === snapshot.activePageId &&
          fallback.activeCanvasId === snapshot.activeCanvasId
        )
          return;
        set({ ...snapshot, ...fallback });
        return;
      }
      if (
        canvas.pageId === snapshot.activePageId &&
        canvas.id === snapshot.activeCanvasId
      )
        return;
      set({
        ...snapshot,
        activePageId: canvas.pageId,
        activeCanvasId: canvas.id,
      });
    },
  };
}
