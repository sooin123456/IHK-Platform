import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";

import {
  ArrowLeft,
  Check,
  Circle as CircleIcon,
  Cloud,
  Hand,
  Minus,
  MousePointer2,
  Redo2,
  Repeat2,
  RotateCcw,
  Ruler,
  Square,
  Type,
  Undo2,
  Waypoints,
  X,
} from "lucide-react";
import { Form, Link, useBlocker, useNavigation } from "react-router";

import { Button } from "~/core/components/ui/button";
import {
  applyDrawingCommand,
  copyDrawingSelection,
  createDrawingDocumentState,
  deleteDrawingSelection,
  duplicateDrawingSelection,
  moveDrawingSelection,
  pasteDrawingClipboard,
  redoDrawingCommand,
  undoDrawingCommand,
  type AppliedDrawingCommand,
  type DrawingCommand,
  type DrawingClipboard,
  type DrawingDocumentState,
} from "~/lukas/lib/drawing-commands";
import {
  createDrawingDocumentStore,
  deriveDrawingTransientState,
  drawingTransientAuthorizationKey,
  hydrateDrawingDocumentState,
  sanitizeDrawingTransientInput,
  type DrawingDocumentStore,
} from "~/lukas/lib/drawing-document-store.client";
import {
  canPersistDrawingMutation,
  claimLegacyDrawingOperations,
  createDrawingOutbox,
  createDrawingPersistenceQueue,
  drawingSaveStatus,
  prepareDrawingReview,
  restoreDrawingWorkspaceState,
  sendDrawingOperation,
  type DrawingOutbox,
  type DrawingPersistenceSnapshot,
} from "~/lukas/lib/drawing-outbox.client";
import type {
  DrawingWorkspace,
  DrawingWorkspaceCapability,
} from "~/lukas/lib/drawing-workspace.server";
import {
  DrawingLayerSchema,
  DrawingObjectSchema,
  PdfCalibrationSchema,
} from "~/lukas/lib/drawing-workspace.types";
import {
  drawingRevisionDecisionFields,
  drawingIssueLinkReady,
  drawingWorkspaceReviewControls,
  drawingWorkspaceSurface,
  loadDrawingClientModule,
  type DrawingClientModuleState,
} from "~/lukas/lib/drawing-workspace-view";
import {
  DrawingCommandMenu,
  type DrawingCommandId,
} from "./drawing-command-menu";
import { DrawingInspector } from "./drawing-inspector";
import { DrawingLayersPanel } from "./drawing-layers-panel";
import { DrawingPagesPanel } from "./drawing-pages-panel";
import type {
  DrawingCanvasBackground,
  DrawingCanvasHandle,
  DrawingTool,
  DimensionCalibrationEvidence,
} from "./drawing-canvas.client";

type CanvasModule = typeof import("./drawing-canvas.client");
type CanvasComponent = CanvasModule["DrawingCanvas"];
type IfcModule = typeof import("./ifc-property-browser.client");
type IfcComponent = IfcModule["default"];

type WorkspaceLayer = NonNullable<
  DrawingWorkspace["document"]
>["revision"]["layers"][number];

export type DrawingWorkspaceShortcut =
  | { type: "copy" | "paste" | "duplicate" | "delete" | "undo" | "redo" }
  | { type: "move"; delta: { x: number; y: number } };

type DrawingShortcutEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
> & { target: EventTarget | null };

function drawingShortcutTargetIsEditable(target: EventTarget | null) {
  if (!target || typeof target !== "object") return false;
  const candidate = target as {
    closest?: (selector: string) => unknown;
    isContentEditable?: boolean;
    tagName?: string;
  };
  const tagName = candidate.tagName?.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    candidate.isContentEditable === true ||
    Boolean(
      candidate.closest?.("input, textarea, select, [contenteditable='true']"),
    ) ||
    Boolean(candidate.closest?.("dialog")) ||
    Boolean(candidate.closest?.("[role='dialog']")) ||
    Boolean(candidate.closest?.("[data-drawing-shortcuts='ignore']"))
  );
}

/** Resolves only shortcuts owned by the drawing workspace. */
export function resolveDrawingWorkspaceShortcut(
  event: DrawingShortcutEvent,
): DrawingWorkspaceShortcut | null {
  if (event.altKey || drawingShortcutTargetIsEditable(event.target))
    return null;
  const modifier = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  if (modifier) {
    if (key === "z") return { type: event.shiftKey ? "redo" : "undo" };
    if (event.shiftKey) return null;
    if (key === "c") return { type: "copy" };
    if (key === "v") return { type: "paste" };
    if (key === "d") return { type: "duplicate" };
    return null;
  }
  if (key === "delete" || key === "backspace") return { type: "delete" };
  const amount = event.shiftKey ? 10 : 1;
  if (key === "arrowleft") return { type: "move", delta: { x: -amount, y: 0 } };
  if (key === "arrowright") return { type: "move", delta: { x: amount, y: 0 } };
  if (key === "arrowup") return { type: "move", delta: { x: 0, y: -amount } };
  if (key === "arrowdown") return { type: "move", delta: { x: 0, y: amount } };
  return null;
}

/** Creates an in-document duplicate; referenced styles stay attached to this document. */
export function duplicateDrawingWorkspaceSelection(
  state: DrawingDocumentState,
  selectedIds: string[],
  actorId: string,
  createId?: () => string,
) {
  return duplicateDrawingSelection(state, selectedIds, actorId, createId);
}

export function drawingEditingContext(
  capability: DrawingWorkspaceCapability,
  layers: Array<
    | WorkspaceLayer
    | (DrawingDocumentState["layers"][string] & { system_kind?: never })
  >,
  requestedLayerId: string | null = null,
) {
  if (capability !== "admin" && capability !== "editor")
    return { canEdit: false, layerId: null };
  const eligible = (candidate: (typeof layers)[number]) => {
    const kind =
      "systemKind" in candidate ? candidate.systemKind : candidate.system_kind;
    return (
      (kind === "work" || kind === "custom") &&
      candidate.visible &&
      !candidate.locked
    );
  };
  const layer =
    layers.find(
      (candidate) => candidate.id === requestedLayerId && eligible(candidate),
    ) ??
    layers.find((candidate) => {
      const kind =
        "systemKind" in candidate
          ? candidate.systemKind
          : candidate.system_kind;
      return kind === "work" && eligible(candidate);
    }) ??
    layers.find(eligible);
  return layer
    ? { canEdit: true, layerId: layer.id }
    : { canEdit: false, layerId: null };
}

function drawingStateFromRevision(
  revision: NonNullable<DrawingWorkspace["document"]>["revision"],
): DrawingDocumentState {
  const p2Pages = revision.pages.filter(
    (page): page is Extract<typeof page, { revisionId: string }> =>
      "revisionId" in page,
  );
  const p2Layers = revision.layers.filter(
    (layer): layer is Extract<typeof layer, { systemKind: string }> =>
      "systemKind" in layer,
  );
  const p2Objects = revision.objects.filter(
    (object): object is Extract<typeof object, { layerId: string }> =>
      "layerId" in object,
  );
  if (
    revision.canvases &&
    revision.styles &&
    revision.blocks &&
    revision.blockInstances &&
    revision.propertySchemas &&
    revision.propertyValues &&
    revision.tables &&
    p2Pages.length === revision.pages.length &&
    p2Layers.length === revision.layers.length &&
    p2Objects.length === revision.objects.length
  ) {
    return hydrateDrawingDocumentState({
      revisionId: revision.id,
      pages: p2Pages,
      canvases: revision.canvases,
      layers: p2Layers.map((layer) => ({
        ...layer,
        canvasId: layer.canvasId!,
        sortOrder: layer.sortOrder!,
      })),
      objects: p2Objects,
      styles: revision.styles,
      blocks: revision.blocks,
      blockInstances: revision.blockInstances,
      propertySchemas: revision.propertySchemas,
      propertyValues: revision.propertyValues,
      tables: revision.tables,
    });
  }
  const activeCanvasId = revision.activeCanvasId;
  const layers = revision.layers.filter(
    (layer) =>
      !activeCanvasId ||
      !("canvasId" in layer) ||
      layer.canvasId === activeCanvasId,
  );
  const layerIds = new Set(layers.map((layer) => layer.id));
  return createDrawingDocumentState({
    revisionId: revision.id,
    layers: layers.map((layer) =>
      DrawingLayerSchema.parse({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        systemKind:
          "systemKind" in layer ? layer.systemKind : layer.system_kind,
        version: layer.version,
      }),
    ),
    objects: revision.objects
      .filter((object) =>
        layerIds.has("layerId" in object ? object.layerId : object.layer_id),
      )
      .map((object) =>
        DrawingObjectSchema.parse({
          id: object.id,
          name: object.name,
          layerId: "layerId" in object ? object.layerId : object.layer_id,
          geometry: object.geometry,
          style: object.style,
          ...("styleId" in object ? { styleId: object.styleId } : {}),
          version: object.version,
        }),
      ),
  });
}

type Props = {
  actionError?: string | null;
  capability: DrawingWorkspaceCapability;
  currentUserId: string;
  roomUrl: string;
  sourceUrl: string | null;
  workspace: DrawingWorkspace & {
    document: NonNullable<DrawingWorkspace["document"]>;
  };
};

export default function DrawingWorkspaceClient({
  actionError,
  capability,
  currentUserId,
  roomUrl,
  sourceUrl,
  workspace,
}: Props) {
  const canvasRef = useRef<DrawingCanvasHandle>(null);
  const [canvasModule, setCanvasModule] = useState<
    DrawingClientModuleState<CanvasComponent>
  >({ status: "loading" });
  const [ifcModule, setIfcModule] = useState<
    DrawingClientModuleState<IfcComponent>
  >({ status: "loading" });
  const [activeTool, setActiveTool] = useState<DrawingTool>("select");
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [repeatMode, setRepeatMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const transientAuthorizationRef = useRef<string | null>(null);
  const transientInputInvalidatedRef = useRef(true);
  const setAuthorizedTool = useCallback((tool: DrawingTool) => {
    transientInputInvalidatedRef.current = false;
    setActiveTool(tool);
  }, []);
  const setAuthorizedSelection = useCallback((ids: string[]) => {
    transientInputInvalidatedRef.current = false;
    setSelectedIds(ids);
  }, []);
  const setAuthorizedActiveLayer = useCallback((layerId: string | null) => {
    transientInputInvalidatedRef.current = false;
    setActiveLayerId(layerId);
  }, []);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewPreparing, setReviewPreparing] = useState(false);
  const [reviewPreparationError, setReviewPreparationError] = useState<
    string | null
  >(null);
  const [outboxReady, setOutboxReady] = useState(false);
  const [saveState, setSaveState] = useState({
    pending: 0,
    conflicted: false,
    flushing: false,
    online: true,
    storageError: false,
  });
  const [persistenceState, setPersistenceState] =
    useState<DrawingPersistenceSnapshot>({ failed: false, volatileCount: 0 });
  const [legacyOperationCount, setLegacyOperationCount] = useState(0);
  const clipboardRef = useRef<DrawingClipboard>({ items: [] });
  const legacyOutboxRef = useRef<DrawingOutbox | null>(null);
  const flushOutboxRef = useRef<(() => Promise<void>) | null>(null);
  const reviewFrozenRef = useRef(false);
  const reviewSubmitBypassRef = useRef(false);
  const reviewSubmissionSeenRef = useRef(false);
  const reviewSubmittedRef = useRef(false);
  const persistenceRef = useRef<ReturnType<
    typeof createDrawingPersistenceQueue
  > | null>(null);
  const retryStorageRef = useRef<() => void>(() => {});
  const { file, document: drawingDocument } = workspace;
  const navigation = useNavigation();
  const { revision } = drawingDocument;
  const documentStoreRef = useRef<DrawingDocumentStore | null>(null);
  if (!documentStoreRef.current) {
    documentStoreRef.current = createDrawingDocumentStore(
      drawingStateFromRevision(revision),
      {
        activePageId: revision.activePageId,
        activeCanvasId: revision.activeCanvasId,
        revisionStatus: revision.status,
      },
    );
  }
  const documentStore = documentStoreRef.current;
  const drawingState = useSyncExternalStore(
    documentStore.subscribe,
    documentStore.getSnapshot,
    documentStore.getSnapshot,
  );
  const drawingStateRef = useRef<DrawingDocumentState>(drawingState);
  const activeIdentityRef = useRef(
    `${drawingState.activePageId ?? ""}:${drawingState.activeCanvasId ?? ""}`,
  );
  useEffect(() => {
    drawingStateRef.current = drawingState;
    const nextIdentity = `${drawingState.activePageId ?? ""}:${drawingState.activeCanvasId ?? ""}`;
    if (activeIdentityRef.current === nextIdentity) return;
    activeIdentityRef.current = nextIdentity;
    // A different/deleted canvas cannot retain a gesture or selection safely.
    setActiveTool("select");
    setActiveLayerId(null);
    setSelectedIds([]);
  }, [drawingState]);
  const capabilityCanPersist = canPersistDrawingMutation(
    capability,
    persistenceState,
  );
  const baseCanEdit =
    outboxReady &&
    !reviewPreparing &&
    capabilityCanPersist &&
    revision.status === "draft";
  const authorizationProbe = useMemo(
    () =>
      deriveDrawingTransientState(drawingState, {
        canEdit: baseCanEdit,
        activeLayerId,
        activeTool: "select",
        selectedIds: [],
      }),
    [activeLayerId, baseCanEdit, drawingState],
  );
  const authorizationLayer = authorizationProbe.activeLayerId
    ? authorizationProbe.state.layers[authorizationProbe.activeLayerId]
    : null;
  const authorizationKey = drawingTransientAuthorizationKey(drawingState, {
    draft: revision.status === "draft",
    canEdit: baseCanEdit,
    activeLayer: authorizationLayer,
  });
  if (transientAuthorizationRef.current !== authorizationKey) {
    transientAuthorizationRef.current = authorizationKey;
    transientInputInvalidatedRef.current = true;
  }
  const transientInput = sanitizeDrawingTransientInput(
    { activeLayerId, activeTool, selectedIds },
    transientInputInvalidatedRef.current,
  );
  const selectedIdsKey = transientInput.selectedIds.join("\u0000");
  const transient = useMemo(
    () =>
      deriveDrawingTransientState(drawingState, {
        canEdit: baseCanEdit,
        activeLayerId: transientInput.activeLayerId,
        activeTool: transientInput.activeTool,
        selectedIds: selectedIdsKey ? selectedIdsKey.split("\u0000") : [],
      }),
    [
      baseCanEdit,
      drawingState,
      transientInput.activeLayerId,
      transientInput.activeTool,
      selectedIdsKey,
    ],
  );
  const activeDrawingState = transient.state;
  const visibleObjects = useMemo(
    () =>
      Object.values(activeDrawingState.objects)
        .filter((object) => activeDrawingState.layers[object.layerId]?.visible)
        .sort((left, right) => {
          const layerOrder =
            (activeDrawingState.layers[left.layerId]?.sortOrder ?? 0) -
            (activeDrawingState.layers[right.layerId]?.sortOrder ?? 0);
          return layerOrder || left.id.localeCompare(right.id);
        }),
    [activeDrawingState.layers, activeDrawingState.objects],
  );
  const resolvedActiveLayerId = transient.activeLayerId;
  const activeCanvas = drawingState.activeCanvasId
    ? (drawingState.structure?.canvases[drawingState.activeCanvasId] ?? null)
    : null;
  const page = activeCanvas
    ? {
        id: activeCanvas.pageId,
        width_mm: activeCanvas.widthMillimeters,
        height_mm: activeCanvas.heightMillimeters,
        background_pdf_page: activeCanvas.background?.pdfPageNumber ?? null,
        calibration: activeCanvas.background?.calibration ?? null,
      }
    : revision.pages.find((candidate) => "width_mm" in candidate);
  const editingContext = drawingEditingContext(
    capability,
    Object.values(activeDrawingState.layers),
    resolvedActiveLayerId,
  );
  const editing = {
    ...editingContext,
    canEdit:
      baseCanEdit && editingContext.canEdit && revision.status === "draft",
  };
  const navigationBlocker = useBlocker(persistenceState.volatileCount > 0);

  useEffect(() => {
    if (!reviewSubmittedRef.current) return;
    if (navigation.state !== "idle") {
      reviewSubmissionSeenRef.current = true;
      return;
    }
    if (!reviewSubmissionSeenRef.current) return;
    reviewSubmittedRef.current = false;
    reviewSubmissionSeenRef.current = false;
    reviewFrozenRef.current = false;
    setReviewPreparing(false);
  }, [navigation.state]);

  useEffect(() => {
    if (navigationBlocker.state !== "blocked") return;
    if (
      window.confirm(
        "아직 브라우저 저장소에 저장되지 않은 도면 작업이 있습니다.",
      )
    )
      navigationBlocker.proceed();
    else navigationBlocker.reset();
  }, [navigationBlocker]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!persistenceRef.current?.snapshot().volatileCount) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const calibration = useMemo<DimensionCalibrationEvidence | null>(() => {
    const parsed = PdfCalibrationSchema.safeParse(page?.calibration);
    return page && parsed.success
      ? {
          id: page.id,
          millimetersPerNormalizedUnit:
            parsed.data.millimetersPerNormalizedUnit,
          pageHeight: page.height_mm,
          pageWidth: page.width_mm,
        }
      : null;
  }, [page]);
  const calibrationId = calibration?.id ?? null;
  const reviewControls = drawingWorkspaceReviewControls({
    capability,
    createdBy: revision.created_by,
    currentUserId,
    reviewEvidence: revision.reviewEvidence,
    revisionId: revision.id,
    revisionVersion: revision.version,
    status: revision.status,
  });
  const surface = drawingWorkspaceSurface({
    file: {
      id: file.id,
      kind: file.kind,
      immutable: file.immutable,
      originalFilename: file.original_filename,
      byteSize: file.byte_size,
    },
    page: page
      ? {
          width: page.width_mm,
          height: page.height_mm,
          backgroundPdfPage: page.background_pdf_page,
        }
      : null,
    sourceUrl,
  });
  const Canvas = canvasModule.status === "ready" ? canvasModule.value : null;
  const canvasLoadError =
    canvasModule.status === "error" ? canvasModule.message : null;
  const IfcViewer = ifcModule.status === "ready" ? ifcModule.value : null;
  const ifcLoadError = ifcModule.status === "error" ? ifcModule.message : null;

  useEffect(() => {
    return loadDrawingClientModule({
      load: () =>
        import("./drawing-canvas.client").then(
          (module) => module.DrawingCanvas,
        ),
      errorMessage: "도면 캔버스를 불러오지 못했습니다.",
      onState: setCanvasModule,
    });
  }, []);

  useEffect(() => {
    if (surface.layout !== "ifc_split") return;
    return loadDrawingClientModule({
      load: () =>
        import("./ifc-property-browser.client").then(
          (module) => module.default,
        ),
      errorMessage: "IFC 원본 화면을 불러오지 못했습니다.",
      onState: setIfcModule,
    });
  }, [surface.layout]);

  useEffect(() => {
    let active = true;
    let outbox: DrawingOutbox;
    const actionUrl = window.location.href;
    const refresh = async () => {
      const [entries, legacy] = await Promise.all([
        outbox.entries(),
        outbox.legacyEntries(),
      ]);
      if (!active) return;
      setLegacyOperationCount(legacy.length);
      setSaveState((current) => ({
        ...current,
        pending: entries.length,
        conflicted: entries.some((entry) => entry.status !== "pending"),
        online: navigator.onLine,
      }));
    };
    outbox = createDrawingOutbox(undefined, {
      ownerId: currentUserId,
      revisionId: revision.id,
      onChange: () => void refresh(),
    });
    legacyOutboxRef.current = outbox;

    const flush = async () => {
      if (!active || !navigator.onLine) {
        await refresh();
        return;
      }
      setSaveState((current) => ({ ...current, flushing: true }));
      try {
        await outbox.flush((operation, context) =>
          sendDrawingOperation(operation, actionUrl, fetch, context?.signal),
        );
      } catch {
        // The outbox retains the operation and schedules the bounded retry.
      } finally {
        if (active)
          setSaveState((current) => ({ ...current, flushing: false }));
        await refresh();
      }
    };
    flushOutboxRef.current = flush;
    const persistence = createDrawingPersistenceQueue({
      flush,
      outbox,
      onChange: (snapshot) => {
        if (!active) return;
        setPersistenceState(snapshot);
        setSaveState((current) => ({
          ...current,
          storageError: snapshot.failed,
        }));
      },
    });
    persistenceRef.current = persistence;

    const initialize = async () => {
      const base = drawingStateFromRevision(revision);
      try {
        const recovered = await restoreDrawingWorkspaceState({
          online: navigator.onLine,
          outbox,
          send: (operation, context) =>
            sendDrawingOperation(operation, actionUrl, fetch, context?.signal),
          serverState: base,
        });
        for (const operationId of recovered.conflictedOperationIds)
          await outbox.markConflicted(
            operationId,
            "conflicted",
            "서버 상태와 로컬 작업의 기준 버전이 다릅니다.",
          );
        if (!active) return;
        documentStore.replace(recovered.state);
        drawingStateRef.current = documentStore.getSnapshot();
        setOutboxReady(true);
        setSaveState((current) => ({ ...current, storageError: false }));
        await refresh();
      } catch {
        if (active)
          setSaveState((current) => ({
            ...current,
            storageError: true,
            flushing: false,
          }));
      }
    };
    retryStorageRef.current = () => void initialize();
    const online = () => {
      setSaveState((current) => ({ ...current, online: true }));
      void flush();
    };
    const offline = () =>
      setSaveState((current) => ({ ...current, online: false }));
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    setOutboxReady(false);
    setLegacyOperationCount(0);
    setPersistenceState({ failed: false, volatileCount: 0 });
    setActiveTool("select");
    setActiveLayerId(null);
    setSelectedIds([]);
    clipboardRef.current = { items: [] };
    void initialize();
    return () => {
      active = false;
      persistence.dispose();
      outbox.dispose();
      if (persistenceRef.current === persistence) persistenceRef.current = null;
      if (legacyOutboxRef.current === outbox) legacyOutboxRef.current = null;
      if (flushOutboxRef.current === flush) flushOutboxRef.current = null;
      retryStorageRef.current = () => {};
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [currentUserId, documentStore, revision]);

  useEffect(() => {
    setSelectedIds((current) => {
      const eligible = current.filter((objectId) =>
        transient.selectedIds.includes(objectId),
      );
      return eligible.length === current.length ? current : eligible;
    });
  }, [transient.selectedIds]);

  const commitApplied = useCallback(
    (applied: AppliedDrawingCommand) => {
      const persistence = persistenceRef.current;
      if (
        reviewFrozenRef.current ||
        !persistence ||
        !canPersistDrawingMutation(
          capability,
          persistence.snapshot(),
          revision.status,
        )
      )
        return;
      void persistence.capture(applied.operation);
      documentStore.replace(applied.state);
      drawingStateRef.current = documentStore.getSnapshot();
    },
    [capability, documentStore, revision.status],
  );

  const applyCommand = useCallback(
    (command: DrawingCommand) => {
      if (
        reviewFrozenRef.current ||
        !outboxReady ||
        !canPersistDrawingMutation(
          capability,
          persistenceState,
          revision.status,
        )
      )
        return;
      commitApplied(applyDrawingCommand(drawingStateRef.current, command));
    },
    [capability, commitApplied, outboxReady, persistenceState, revision.status],
  );

  const undo = useCallback(() => {
    if (
      !outboxReady ||
      !canPersistDrawingMutation(capability, persistenceState, revision.status)
    )
      return;
    const result = undoDrawingCommand(drawingStateRef.current, currentUserId);
    if (!result || "kind" in result) return;
    commitApplied(result);
  }, [
    capability,
    commitApplied,
    currentUserId,
    outboxReady,
    persistenceState,
    revision.status,
  ]);

  const redo = useCallback(() => {
    if (
      !outboxReady ||
      !canPersistDrawingMutation(capability, persistenceState, revision.status)
    )
      return;
    const result = redoDrawingCommand(drawingStateRef.current, currentUserId);
    if (!result || "kind" in result) return;
    commitApplied(result);
  }, [
    capability,
    commitApplied,
    currentUserId,
    outboxReady,
    persistenceState,
    revision.status,
  ]);

  const copySelection = useCallback(() => {
    const clipboard = copyDrawingSelection(drawingState, transient.selectedIds);
    if (clipboard.items.length === 0) return false;
    clipboardRef.current = clipboard;
    return true;
  }, [drawingState, transient.selectedIds]);

  const pasteSelection = useCallback(() => {
    if (!editing.canEdit) return false;
    if (
      clipboardRef.current.items.some((item) => {
        const targetLayer = activeDrawingState.layers[item.layerId];
        return !targetLayer?.visible || targetLayer.locked;
      })
    )
      return false;
    const command = pasteDrawingClipboard(clipboardRef.current, currentUserId);
    if (!command) return false;
    applyCommand(command);
    setAuthorizedSelection(command.objects.map((object) => object.id));
    return true;
  }, [
    activeDrawingState.layers,
    applyCommand,
    currentUserId,
    editing.canEdit,
    setAuthorizedSelection,
  ]);

  const duplicateSelection = useCallback(() => {
    if (!editing.canEdit) return false;
    const command = duplicateDrawingWorkspaceSelection(
      drawingState,
      transient.selectedIds,
      currentUserId,
    );
    if (!command) return false;
    applyCommand(command);
    setAuthorizedSelection(command.objects.map((object) => object.id));
    return true;
  }, [
    applyCommand,
    currentUserId,
    drawingState,
    editing.canEdit,
    setAuthorizedSelection,
    transient.selectedIds,
  ]);

  const deleteSelection = useCallback(() => {
    if (!editing.canEdit) return false;
    const command = deleteDrawingSelection(
      drawingState,
      transient.selectedIds,
      currentUserId,
    );
    if (!command) return false;
    applyCommand(command);
    setSelectedIds([]);
    return true;
  }, [
    applyCommand,
    currentUserId,
    drawingState,
    editing.canEdit,
    transient.selectedIds,
  ]);

  const moveSelection = useCallback(
    (delta: { x: number; y: number }) => {
      if (!editing.canEdit) return false;
      const command = moveDrawingSelection(
        drawingState,
        transient.selectedIds,
        currentUserId,
        delta,
      );
      if (!command) return false;
      applyCommand(command);
      return true;
    },
    [
      applyCommand,
      currentUserId,
      drawingState,
      editing.canEdit,
      transient.selectedIds,
    ],
  );

  useEffect(() => {
    function openCommandMenu(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return false;
      if (event.key.toLowerCase() !== "k") return false;
      if (drawingShortcutTargetIsEditable(event.target)) return false;
      event.preventDefault();
      setCommandMenuOpen(true);
      return true;
    }
    function handleWorkspaceShortcut(event: KeyboardEvent) {
      if (openCommandMenu(event)) return;
      const shortcut = resolveDrawingWorkspaceShortcut(event);
      if (!shortcut) return;
      let handled = false;
      if (shortcut.type === "copy") handled = copySelection();
      else if (shortcut.type === "paste") handled = pasteSelection();
      else if (shortcut.type === "duplicate") handled = duplicateSelection();
      else if (shortcut.type === "delete") handled = deleteSelection();
      else if (shortcut.type === "move")
        handled = moveSelection(shortcut.delta);
      else if (shortcut.type === "undo") {
        handled =
          (drawingState.undoStackByActor[currentUserId]?.length ?? 0) > 0;
        if (handled) undo();
      } else {
        handled =
          (drawingState.redoStackByActor[currentUserId]?.length ?? 0) > 0;
        if (handled) redo();
      }
      if (handled) event.preventDefault();
    }
    window.addEventListener("keydown", handleWorkspaceShortcut);
    return () => window.removeEventListener("keydown", handleWorkspaceShortcut);
  }, [
    copySelection,
    currentUserId,
    deleteSelection,
    drawingState.redoStackByActor,
    drawingState.undoStackByActor,
    duplicateSelection,
    moveSelection,
    pasteSelection,
    redo,
    undo,
  ]);

  const commandEnabled = useCallback(
    (commandId: DrawingCommandId) => {
      if (commandId === "select" || commandId === "pan") return true;
      if (commandId === "zoom_to_fit") return true;
      if (commandId === "undo")
        return (
          editing.canEdit &&
          (drawingState.undoStackByActor[currentUserId]?.length ?? 0) > 0
        );
      if (commandId === "redo")
        return (
          editing.canEdit &&
          (drawingState.redoStackByActor[currentUserId]?.length ?? 0) > 0
        );
      if (commandId === "duplicate" || commandId === "delete")
        return editing.canEdit && transient.selectedIds.length > 0;
      return editing.canEdit;
    },
    [
      currentUserId,
      drawingState,
      editing.canEdit,
      transient.selectedIds.length,
    ],
  );

  const runCommand = useCallback(
    (commandId: DrawingCommandId) => {
      if (!commandEnabled(commandId)) return;
      if (
        commandId === "select" ||
        commandId === "pan" ||
        commandId === "line" ||
        commandId === "polyline" ||
        commandId === "rectangle" ||
        commandId === "circle" ||
        commandId === "text" ||
        commandId === "dimension"
      ) {
        setAuthorizedTool(commandId);
      } else if (commandId === "undo") undo();
      else if (commandId === "redo") redo();
      else if (commandId === "duplicate") duplicateSelection();
      else if (commandId === "delete") deleteSelection();
      else if (commandId === "zoom_to_fit") canvasRef.current?.resetViewport();
    },
    [
      commandEnabled,
      deleteSelection,
      duplicateSelection,
      redo,
      setAuthorizedTool,
      undo,
    ],
  );
  const background: DrawingCanvasBackground = activeCanvas
    ? activeCanvas.background && sourceUrl
      ? {
          kind: "pdf",
          width: activeCanvas.widthMillimeters,
          height: activeCanvas.heightMillimeters,
          pageNumber: activeCanvas.background.pdfPageNumber ?? 1,
          signedUrl: sourceUrl,
        }
      : {
          kind: "blank",
          width: activeCanvas.widthMillimeters,
          height: activeCanvas.heightMillimeters,
        }
    : surface.background;
  const saveStatus = drawingSaveStatus({
    ...saveState,
    volatileCount: persistenceState.volatileCount,
  });
  const decisionFields = reviewControls.decisionEvidence
    ? drawingRevisionDecisionFields({
        revisionId: revision.id,
        evidence: reviewControls.decisionEvidence,
        decision: "approved",
        note: reviewNote,
      })
    : null;
  const prepareReviewSubmission = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      if (reviewSubmitBypassRef.current) {
        reviewSubmitBypassRef.current = false;
        return;
      }
      if (reviewFrozenRef.current) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      const form = event.currentTarget;
      const submitter = (event.nativeEvent as SubmitEvent).submitter;
      const persistence = persistenceRef.current;
      const outbox = legacyOutboxRef.current;
      const flush = flushOutboxRef.current;
      if (!persistence || !outbox || !flush) return;
      setReviewPreparationError(null);
      try {
        await prepareDrawingReview({
          freeze() {
            reviewFrozenRef.current = true;
            setReviewPreparing(true);
          },
          persistence,
          flush,
          outbox,
        });
        reviewSubmittedRef.current = true;
        reviewSubmitBypassRef.current = true;
        form.requestSubmit(
          submitter instanceof HTMLButtonElement ? submitter : undefined,
        );
      } catch (error) {
        reviewFrozenRef.current = false;
        setReviewPreparing(false);
        setReviewPreparationError(
          error instanceof Error
            ? error.message
            : "검토 요청을 준비하지 못했습니다.",
        );
      }
    },
    [],
  );

  return (
    <main className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex min-h-16 flex-wrap items-center gap-3 border-b border-white/10 bg-slate-900 px-3 py-2 sm:px-4">
        <Link
          aria-label="협업 도면실로 돌아가기"
          className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white"
          to={roomUrl}
        >
          <ArrowLeft className="size-4" /> 협업 도면실
        </Link>
        <div className="min-w-0 flex-1 border-l border-white/10 pl-3">
          <p className="text-xs font-semibold text-indigo-300">도면 작업실</p>
          <h1 className="truncate text-sm font-bold">
            {drawingDocument.title}
          </h1>
          <p className="truncate text-xs text-slate-400">
            {file.original_filename}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span
            aria-label={`저장 상태: ${saveStatus}`}
            className={`inline-flex min-h-9 items-center gap-1 px-2 text-xs ${saveStatus === "저장됨" ? "text-emerald-300" : saveStatus === "충돌 검토 필요" ? "text-red-300" : "text-amber-300"}`}
            role="status"
          >
            <Cloud className="size-4" />
            {saveStatus}
          </span>
          {editing.canEdit ? (
            <>
              <Button
                aria-label="실행 취소"
                disabled={!commandEnabled("undo")}
                onClick={undo}
                size="icon"
                title="실행 취소"
                variant="ghost"
              >
                <Undo2 className="size-4" />
              </Button>
              <Button
                aria-label="다시 실행"
                disabled={!commandEnabled("redo")}
                onClick={redo}
                size="icon"
                title="다시 실행"
                variant="ghost"
              >
                <Redo2 className="size-4" />
              </Button>
            </>
          ) : null}
          {reviewControls.requestReview ? (
            <Form method="post" onSubmit={prepareReviewSubmission}>
              <input name="intent" type="hidden" value="request_review" />
              <input name="revision_id" type="hidden" value={revision.id} />
              <Button disabled={!outboxReady} type="submit" variant="secondary">
                <Check className="size-4" /> 검토 요청
              </Button>
            </Form>
          ) : null}
          {decisionFields ? (
            <Form
              aria-label="리비전 검토"
              className="flex flex-wrap items-center gap-1"
              method="post"
            >
              {Object.entries(decisionFields)
                .filter(([name]) => name !== "decision" && name !== "note")
                .map(([name, value]) => (
                  <input key={name} name={name} type="hidden" value={value} />
                ))}
              <label className="sr-only" htmlFor="drawing-review-note">
                검토 의견
              </label>
              <input
                className="min-h-9 w-40 rounded-md border border-white/15 bg-slate-950 px-2 text-sm"
                id="drawing-review-note"
                maxLength={5000}
                name="note"
                onChange={(event) => setReviewNote(event.target.value)}
                placeholder="검토 의견"
                value={reviewNote}
              />
              <Button
                aria-label="도면 승인"
                name="decision"
                type="submit"
                value="approved"
                variant="secondary"
              >
                <Check className="size-4" /> 승인
              </Button>
              <Button
                aria-label="도면 반려"
                name="decision"
                type="submit"
                value="rejected"
                variant="destructive"
              >
                <X className="size-4" /> 반려
              </Button>
            </Form>
          ) : null}
        </div>
      </header>

      {actionError ? (
        <p
          className="border-b border-red-500/30 bg-red-950 px-4 py-2 text-sm text-red-100"
          role="alert"
        >
          {actionError}
        </p>
      ) : null}

      {reviewPreparationError ? (
        <p
          className="border-b border-red-500/30 bg-red-950 px-4 py-2 text-sm text-red-100"
          role="alert"
        >
          {reviewPreparationError}
        </p>
      ) : null}

      {saveState.storageError ? (
        <div
          className="border-b border-red-500/30 bg-red-950 px-4 py-2 text-sm text-red-100"
          role="alert"
        >
          로컬 저장 실패: 이 탭을 닫지 말고 브라우저 저장소 설정을 확인하세요.{" "}
          <Button
            onClick={() => {
              const persistence = persistenceRef.current;
              if (persistence?.snapshot().volatileCount)
                void persistence.retry();
              else retryStorageRef.current();
            }}
            size="sm"
            type="button"
            variant="secondary"
          >
            다시 시도
          </Button>
        </div>
      ) : null}

      {legacyOperationCount > 0 ? (
        <div
          className="border-b border-amber-500/30 bg-amber-950 px-4 py-2 text-sm text-amber-100"
          role="status"
        >
          이전 브라우저 작업 {legacyOperationCount}건이 격리되어 있습니다.
          복구하면 현재 로그인 사용자가 복구 책임자로 기록됩니다.{" "}
          {canPersistDrawingMutation(
            capability,
            persistenceState,
            revision.status,
          ) ? (
            <Button
              onClick={async () => {
                const confirmed = window.confirm(
                  "격리된 이전 작업을 현재 로그인 사용자에게 귀속하고 저장하시겠습니까?",
                );
                const drawingOutbox = legacyOutboxRef.current;
                if (!drawingOutbox) return;
                try {
                  await claimLegacyDrawingOperations({
                    capability,
                    confirmed,
                    outbox: drawingOutbox,
                    revisionStatus: revision.status,
                  });
                  retryStorageRef.current();
                } catch {
                  setSaveState((current) => ({
                    ...current,
                    storageError: true,
                  }));
                }
              }}
              size="sm"
              type="button"
              variant="secondary"
            >
              이전 작업 복구
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[14rem_minmax(0,1fr)_17rem]">
        <aside
          aria-label="레이어 패널"
          className="border-b border-white/10 bg-slate-900 p-4 lg:border-b-0 lg:border-r"
        >
          <DrawingPagesPanel
            activeCanvasId={drawingState.activeCanvasId}
            actorId={currentUserId}
            canEdit={baseCanEdit}
            onCanvasSelect={(canvasId) => documentStore.selectCanvas(canvasId)}
            onCommand={applyCommand}
            state={drawingState}
          />
          <div className="mt-6 border-t border-white/10 pt-6">
            <DrawingLayersPanel
              activeCanvasId={drawingState.activeCanvasId}
              activeLayerId={resolvedActiveLayerId}
              actorId={currentUserId}
              canEdit={editing.canEdit}
              onActiveLayerChange={setAuthorizedActiveLayer}
              onCommand={applyCommand}
              state={drawingState}
            />
          </div>
        </aside>

        <section
          aria-label="도면 캔버스"
          className="relative min-h-[34rem] min-w-0 bg-slate-950"
        >
          <div
            className={
              surface.layout === "ifc_split"
                ? "grid h-full min-h-[34rem] xl:grid-cols-[minmax(0,1fr)_minmax(28rem,0.9fr)]"
                : "h-full min-h-[34rem]"
            }
          >
            <div className="min-h-0 min-w-0">
              {surface.layout === "canvas" && surface.sourceError ? (
                <p
                  className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-md bg-red-950 px-3 py-2 text-sm text-red-100"
                  role="alert"
                >
                  {surface.sourceError}
                </p>
              ) : null}
              {Canvas ? (
                <Canvas
                  key={authorizationKey}
                  activeTool={transient.activeTool as DrawingTool}
                  actorId={currentUserId}
                  background={background}
                  calibration={calibration}
                  calibrationId={calibrationId}
                  canEdit={editing.canEdit}
                  layerId={editing.layerId}
                  layers={Object.values(activeDrawingState.layers)}
                  objects={visibleObjects}
                  onCommand={applyCommand}
                  onSelectionChange={(ids) =>
                    setAuthorizedSelection(
                      ids.filter(
                        (id) =>
                          transient.selectedIds.includes(id) ||
                          Boolean(activeDrawingState.objects[id]),
                      ),
                    )
                  }
                  onToolComplete={(tool) =>
                    setAuthorizedTool(transient.activeLayerId ? tool : "select")
                  }
                  ref={canvasRef}
                  repeatMode={repeatMode}
                  selectedIds={transient.selectedIds}
                />
              ) : canvasLoadError ? (
                <div
                  className="grid h-full min-h-[34rem] place-items-center p-6 text-sm text-red-200"
                  role="alert"
                >
                  {canvasLoadError}
                </div>
              ) : (
                <div
                  className="grid h-full min-h-[34rem] place-items-center text-sm text-slate-400"
                  role="status"
                >
                  캔버스를 준비하는 중입니다.
                </div>
              )}
            </div>
            {surface.layout === "ifc_split" ? (
              <aside
                aria-label="IFC 3D 원본"
                className="max-h-[calc(100vh-4rem)] overflow-auto border-t border-white/10 bg-background p-4 text-foreground xl:border-l xl:border-t-0"
              >
                <h2 className="text-sm font-bold">IFC 원본 보기</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  2D 오버레이는 빈 도면에서 시작합니다. 2D와 3D 화면 동기화는
                  이후 단계에서 제공합니다.
                </p>
                {surface.sourceError || ifcLoadError ? (
                  <p
                    className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
                    role="alert"
                  >
                    {surface.sourceError ?? ifcLoadError}
                  </p>
                ) : IfcViewer && surface.ifcViewer ? (
                  <div className="mt-4">
                    <IfcViewer {...surface.ifcViewer} />
                  </div>
                ) : (
                  <p
                    className="mt-4 text-sm text-muted-foreground"
                    role="status"
                  >
                    IFC 3D 원본을 준비하는 중입니다.
                  </p>
                )}
              </aside>
            ) : null}
          </div>

          <nav
            aria-label="캔버스 도구"
            className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/15 bg-slate-900/95 p-1.5 shadow-xl backdrop-blur"
          >
            <Button
              aria-label="선택 도구"
              aria-pressed={transient.activeTool === "select"}
              onClick={() => setAuthorizedTool("select")}
              size="icon"
              variant={
                transient.activeTool === "select" ? "secondary" : "ghost"
              }
            >
              <MousePointer2 className="size-4" />
            </Button>
            {editing.canEdit ? (
              <>
                <Button
                  aria-label="선 도구"
                  aria-pressed={transient.activeTool === "line"}
                  onClick={() => setAuthorizedTool("line")}
                  size="icon"
                  variant={
                    transient.activeTool === "line" ? "secondary" : "ghost"
                  }
                >
                  <Minus className="size-4" />
                </Button>
                <Button
                  aria-label="폴리라인 도구"
                  aria-pressed={transient.activeTool === "polyline"}
                  onClick={() => setAuthorizedTool("polyline")}
                  size="icon"
                  variant={
                    transient.activeTool === "polyline" ? "secondary" : "ghost"
                  }
                >
                  <Waypoints className="size-4" />
                </Button>
                <Button
                  aria-label="사각형 도구"
                  aria-pressed={transient.activeTool === "rectangle"}
                  onClick={() => setAuthorizedTool("rectangle")}
                  size="icon"
                  variant={
                    transient.activeTool === "rectangle" ? "secondary" : "ghost"
                  }
                >
                  <Square className="size-4" />
                </Button>
                <Button
                  aria-label="원 도구"
                  aria-pressed={transient.activeTool === "circle"}
                  onClick={() => setAuthorizedTool("circle")}
                  size="icon"
                  variant={
                    transient.activeTool === "circle" ? "secondary" : "ghost"
                  }
                >
                  <CircleIcon className="size-4" />
                </Button>
                <Button
                  aria-label="텍스트 도구"
                  aria-pressed={transient.activeTool === "text"}
                  onClick={() => setAuthorizedTool("text")}
                  size="icon"
                  variant={
                    transient.activeTool === "text" ? "secondary" : "ghost"
                  }
                >
                  <Type className="size-4" />
                </Button>
                <Button
                  aria-label="치수 도구"
                  aria-pressed={transient.activeTool === "dimension"}
                  onClick={() => setAuthorizedTool("dimension")}
                  size="icon"
                  variant={
                    transient.activeTool === "dimension" ? "secondary" : "ghost"
                  }
                >
                  <Ruler className="size-4" />
                </Button>
                <Button
                  aria-label="도구 반복"
                  aria-pressed={repeatMode}
                  onClick={() => setRepeatMode((enabled) => !enabled)}
                  size="icon"
                  variant={repeatMode ? "secondary" : "ghost"}
                >
                  <Repeat2 className="size-4" />
                </Button>
              </>
            ) : null}
            <Button
              aria-label="이동 도구"
              aria-pressed={transient.activeTool === "pan"}
              onClick={() => setAuthorizedTool("pan")}
              size="icon"
              variant={transient.activeTool === "pan" ? "secondary" : "ghost"}
            >
              <Hand className="size-4" />
            </Button>
            <Button
              aria-label="화면 맞춤"
              onClick={() => canvasRef.current?.resetViewport()}
              size="icon"
              variant="ghost"
            >
              <RotateCcw className="size-4" />
            </Button>
          </nav>
        </section>

        <aside
          aria-label="속성 검사기"
          className="border-t border-white/10 bg-slate-900 p-4 lg:border-l lg:border-t-0"
        >
          <DrawingInspector
            actorId={currentUserId}
            canEdit={editing.canEdit}
            canLinkIssues={drawingIssueLinkReady({
              capability,
              objectIds: Object.keys(activeDrawingState.objects),
              saveStatus,
              selectedIds: transient.selectedIds,
              status: revision.status,
            })}
            issueLinks={revision.issueLinks}
            issues={revision.issues}
            onCommand={applyCommand}
            selectedIds={transient.selectedIds}
            state={activeDrawingState}
          />
        </aside>
      </div>
      {editing.canEdit ? (
        <DrawingCommandMenu
          enabled={commandEnabled}
          onClose={() => setCommandMenuOpen(false)}
          onRun={runCommand}
          open={commandMenuOpen}
        />
      ) : null}
    </main>
  );
}
