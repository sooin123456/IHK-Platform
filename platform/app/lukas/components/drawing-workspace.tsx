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
  Building2,
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
import * as Y from "yjs";

import { Button } from "~/core/components/ui/button";
import {
  copyDrawingBlockInstancesClipboard,
  createDrawingBlockRenderCache,
  deleteDrawingBlockInstancesCommand,
  drawingSelectionEntityKind,
  drawingVisibleCanvasObjects,
  duplicateDrawingBlockInstancesCommand,
  moveDrawingBlockInstancesCommand,
  pasteDrawingBlockInstancesClipboardCommand,
  type DrawingBlockInstancesClipboard,
} from "~/lukas/lib/drawing-blocks";
import {
  applyDrawingCommand,
  copyDrawingSelection,
  createDrawingCheckpointRestoreCommand,
  createDrawingDocumentState,
  deleteDrawingWallWithOpeningsCommand,
  duplicateDrawingSelection,
  isEditableDrawingLayer,
  moveDrawingSelection,
  pasteDrawingClipboard,
  redoDrawingCommand,
  rebaseDrawingCommandForProjection,
  revertDrawingOperation,
  undoDrawingCommand,
  type AppliedDrawingCommand,
  type DrawingCommand,
  type DrawingClipboard,
  DrawingCommandError,
  type DrawingDocumentState,
} from "~/lukas/lib/drawing-commands";
import {
  createDrawingDocumentStore,
  deriveDrawingTransientState,
  drawingTransientAuthorizationKey,
  hydrateDrawingDocumentState,
  sanitizeDrawingTransientInput,
  type DrawingDocumentHydration,
  type DrawingDocumentStore,
} from "~/lukas/lib/drawing-document-store";
import { createDrawingStyleResolutionCache } from "~/lukas/lib/drawing-style-resolution";
import {
  deleteDrawingObjectsWithReferencesCommand,
  missingRequiredDrawingProperties,
} from "~/lukas/lib/drawing-properties";
import {
  canPersistDrawingMutation,
  claimLegacyDrawingOperations,
  createDrawingOutbox,
  createDrawingPersistenceQueue,
  drawingSaveStatus,
  prepareDrawingReview,
  sendDrawingOperation,
  type DrawingOutbox,
  type DrawingPersistenceSnapshot,
} from "~/lukas/lib/drawing-outbox";
import {
  createDrawingAccessTokenResolver,
  createDrawingCollaborationCommandBridge,
  drawingCollaborationAuthority,
  drawingCollaborationLifecycleKey,
  initializeDrawingCollaborationDocument,
  openDrawingCollaborationLocalAttempt,
  openDrawingCollaborationConnection,
  reconcileDrawingCollaborationDraft,
  type DrawingCollaborationConnection,
} from "~/lukas/lib/drawing-collaboration-client";
import {
  createDrawingDraftAdapter,
  type DrawingDraftAdapter,
} from "~/lukas/lib/drawing-yjs-draft";
import {
  openDrawingYjsPersistence,
  type DrawingYjsPersistence,
} from "~/lukas/lib/drawing-yjs-persistence.client";
import type {
  DrawingWorkspace,
  DrawingWorkspaceCollaborationBootstrap,
  DrawingWorkspaceCapability,
} from "~/lukas/lib/drawing-workspace.server";
import type {
  DrawingMeasurementEvidenceError,
  DrawingMeasurementEvidenceLineage,
  DrawingServerMeasurementEvidence,
} from "~/lukas/lib/drawing-semantic-schedules";
import type { DrawingActivityItem } from "~/lukas/lib/drawing-history.server";
import type {
  DrawingAssignee,
  DrawingAnchorRow,
  DrawingCanvasRegionAnchorRow,
} from "~/lukas/lib/drawing-collaboration.server";
import {
  DrawingLayerSchema,
  DrawingObjectSchema,
  PdfCalibrationSchema,
  normalizeDrawingCanonicalSources,
} from "~/lukas/lib/drawing-workspace.types";
import type {
  DrawingObject,
  DrawingStyle,
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
  useDrawingWorkspaceRealtime,
  type DrawingWorkspaceRealtimeAdapter,
} from "~/lukas/lib/drawing-workspace-realtime";
import {
  createDrawingAwarenessPublication,
  createDrawingAwarenessPeerStore,
  createDrawingSoftLockLease,
  drawingCommandSoftLockConflict,
  drawingRecordedOperationSoftLockConflict,
  drawingSelectionSoftLockConflict,
  drawingSoftLockConflict,
  parseDrawingAwarenessPeers,
  type DrawingAwarenessLocalInput,
} from "~/lukas/lib/drawing-awareness";
import {
  DrawingCommandMenu,
  type DrawingCommandId,
} from "./drawing-command-menu";
import { DrawingExportDialog } from "./drawing-export-dialog";
import { DrawingInspector } from "./drawing-inspector";
import { DrawingBlocksPanel } from "./drawing-blocks-panel";
import { DrawingLayersPanel } from "./drawing-layers-panel";
import { DrawingPagesPanel } from "./drawing-pages-panel";
import { DrawingPropertiesPanel } from "./drawing-properties-panel";
import { DrawingStylesPanel } from "./drawing-styles-panel";
import { DrawingTablesPanel } from "./drawing-tables-panel";
import {
  DrawingCollaborationConnectionStatus,
  DrawingCollaborationLockStatus,
  DrawingCollaborationParticipants,
  useDrawingAwarenessLocks,
} from "./drawing-collaboration-presence";

const drawingBlockRenderCache = createDrawingBlockRenderCache();
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

export type DrawingWorkspacePanel =
  | "structure"
  | "styles"
  | "properties"
  | "schedules"
  | "blocks"
  | "collaboration"
  | "history";

const drawingWorkspacePanels: Array<{
  id: DrawingWorkspacePanel;
  label: string;
}> = [
  { id: "structure", label: "페이지·레이어" },
  { id: "styles", label: "스타일" },
  { id: "properties", label: "속성" },
  { id: "schedules", label: "Schedule" },
  { id: "blocks", label: "블록" },
  { id: "collaboration", label: "댓글·이슈" },
  { id: "history", label: "변경 이력" },
];

/** Resolves the standard keyboard navigation owned by the workspace tablist. */
export function resolveDrawingWorkspacePanelKey(
  activePanel: DrawingWorkspacePanel,
  key: string,
): DrawingWorkspacePanel | null {
  const currentIndex = drawingWorkspacePanels.findIndex(
    (panel) => panel.id === activePanel,
  );
  if (key === "Home") return drawingWorkspacePanels[0].id;
  if (key === "End")
    return drawingWorkspacePanels[drawingWorkspacePanels.length - 1].id;
  const offset =
    key === "ArrowRight" || key === "ArrowDown"
      ? 1
      : key === "ArrowLeft" || key === "ArrowUp"
        ? -1
        : 0;
  if (!offset) return null;
  return drawingWorkspacePanels[
    (currentIndex + offset + drawingWorkspacePanels.length) %
      drawingWorkspacePanels.length
  ].id;
}

export function persistDrawingRecordedOperation(
  bridge: { applyRecorded(applied: AppliedDrawingCommand): Promise<unknown> },
  applied: AppliedDrawingCommand,
) {
  return bridge.applyRecorded(applied);
}

function drawingHistoryPageHref(
  documentId: string,
  cursor: string,
  itemId: string,
) {
  const query = new URLSearchParams({
    document: documentId,
    historyCursor: cursor,
  });
  return `?${query}#history-${itemId}`;
}

export function drawingActivityDescription(item: DrawingActivityItem) {
  const detail =
    item.detail && typeof item.detail === "object"
      ? (item.detail as Record<string, unknown>)
      : {};
  const detailType =
    typeof detail.type === "string" ? detail.type : item.action;
  const count = [detail.actions, detail.updates, detail.objects].find(
    Array.isArray,
  ) as unknown[] | undefined;
  if (item.kind === "issue_event") {
    const to =
      detail.to == null
        ? ""
        : typeof detail.to === "string"
          ? detail.to
          : JSON.stringify(detail.to);
    const note = typeof detail.note === "string" ? detail.note.trim() : "";
    return [item.action, to && `변경값 ${to}`, note && `메모 ${note}`]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 160);
  }
  return `${detailType}${count ? ` · ${count.length}개 항목` : ""}`.slice(
    0,
    160,
  );
}

export function drawingActivityProvenance(item: DrawingActivityItem) {
  if (item.kind === "issue_event") return `이슈 ${item.issueId.slice(0, 8)}`;
  return item.provenance.originalOperationId
    ? `${item.action} · 원본 작업 ${item.provenance.originalOperationId.slice(0, 8)}`
    : `리비전 ${item.revisionId.slice(0, 8)}`;
}

export function drawingReviewSubmissionEnabled(input: {
  outboxReady: boolean;
  reviewPreparing: boolean;
  pending: number;
  conflicted: boolean;
  volatileCount: number;
  persistenceFailed: boolean;
}) {
  return (
    input.outboxReady &&
    !input.reviewPreparing &&
    input.pending === 0 &&
    !input.conflicted &&
    input.volatileCount === 0 &&
    !input.persistenceFailed
  );
}

export function drawingReviewFreezeStorageKey(
  revisionId: string,
  revisionVersion: number,
) {
  return `drawing-review-freeze:${revisionId}:${revisionVersion}`;
}

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

export function replaceDrawingWorkspaceGraphForLifecycle({
  documentStore,
  lifecycleKey,
  previousLifecycleKey,
  recoveredState,
}: {
  documentStore: DrawingDocumentStore;
  lifecycleKey: string;
  previousLifecycleKey: string | null;
  recoveredState: DrawingDocumentState;
}) {
  if (previousLifecycleKey === lifecycleKey) return previousLifecycleKey;
  documentStore.replace(recoveredState);
  return lifecycleKey;
}

export function createDrawingWorkspaceBlockMutationAdapter({
  activeCanvasId,
  actorId,
  canEdit,
  createId,
  onCommand,
  onSelectionChange,
  selectedIds,
  state,
}: {
  activeCanvasId: string | null;
  actorId: string;
  canEdit: boolean;
  createId?: () => string;
  onCommand: (command: DrawingCommand) => void;
  onSelectionChange: (selectedIds: string[]) => void;
  selectedIds: readonly string[];
  state: DrawingDocumentState;
}) {
  const selectionKind = drawingSelectionEntityKind(state, selectedIds);
  const canMutate = Boolean(
    canEdit &&
    activeCanvasId &&
    selectionKind === "block_instance" &&
    selectedIds.length > 0 &&
    selectedIds.every((id) => {
      const instance = state.structure?.blockInstances[id];
      const layer = instance ? state.layers[instance.layerId] : undefined;
      return (
        instance &&
        layer?.canvasId === activeCanvasId &&
        isEditableDrawingLayer(layer)
      );
    }),
  );
  return {
    canMutate,
    selectionKind,
    deleteSelection() {
      if (!canMutate) return false;
      onCommand(
        deleteDrawingBlockInstancesCommand(state, actorId, selectedIds),
      );
      onSelectionChange([]);
      return true;
    },
    duplicateSelection() {
      if (!canMutate) return false;
      const command = duplicateDrawingBlockInstancesCommand(
        state,
        actorId,
        selectedIds,
        { createId },
      );
      onCommand(command);
      onSelectionChange(
        command.actions.flatMap((action) =>
          action.kind === "put_block_instance" ? [action.entity.id] : [],
        ),
      );
      return true;
    },
    moveSelection(delta: { x: number; y: number }) {
      if (!canMutate) return false;
      onCommand(
        moveDrawingBlockInstancesCommand(state, actorId, selectedIds, delta),
      );
      return true;
    },
  };
}

export function drawingWorkspaceCommandEnabled(
  commandId: DrawingCommandId,
  input: {
    blockSelectionCanMutate: boolean;
    canEdit: boolean;
    canRedo: boolean;
    canUndo: boolean;
    selectionHasRemoteLock?: boolean;
    selectionKind: ReturnType<typeof drawingSelectionEntityKind>;
  },
) {
  if (commandId === "select" || commandId === "pan") return true;
  if (commandId === "zoom_to_fit") return true;
  if (commandId === "undo") return input.canEdit && input.canUndo;
  if (commandId === "redo") return input.canEdit && input.canRedo;
  if (
    (commandId === "duplicate" || commandId === "delete") &&
    input.selectionHasRemoteLock
  )
    return false;
  if (commandId === "duplicate" || commandId === "delete")
    return input.selectionKind === "block_instance"
      ? input.blockSelectionCanMutate
      : input.canEdit && input.selectionKind === "object";
  return input.canEdit;
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
      sources: revision.sources ?? [],
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

function drawingStateFromBootstrap(
  bootstrap: DrawingWorkspaceCollaborationBootstrap,
) {
  const graph = bootstrap.canonicalJson;
  return hydrateDrawingDocumentState({
    revisionId: graph.revision.id,
    pages: graph.pages as DrawingDocumentHydration["pages"],
    canvases: graph.canvases as DrawingDocumentHydration["canvases"],
    layers: canonicalCheckpointEntities(graph.layers, [
      "pageId",
    ]) as DrawingDocumentHydration["layers"],
    objects: canonicalCheckpointEntities(graph.objects, [
      "lineageId",
      "pageId",
      "type",
    ]) as DrawingDocumentHydration["objects"],
    sources: graph.sources as DrawingDocumentHydration["sources"],
    styles: graph.styles as DrawingDocumentHydration["styles"],
    blocks: graph.blocks as DrawingDocumentHydration["blocks"],
    blockInstances:
      graph.blockInstances as DrawingDocumentHydration["blockInstances"],
    propertySchemas:
      graph.propertySchemas as DrawingDocumentHydration["propertySchemas"],
    propertyValues:
      graph.propertyValues as DrawingDocumentHydration["propertyValues"],
    tables: graph.tables as DrawingDocumentHydration["tables"],
  });
}

export function canonicalCheckpointEntities(
  values: unknown[],
  omitted: string[],
) {
  return values.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return value;
    const entity = { ...(value as Record<string, unknown>) };
    for (const field of omitted) delete entity[field];
    return entity;
  });
}

function sameDrawingWorkspaceValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

type Props = {
  actionError?: string | null;
  activityPage?: { items: DrawingActivityItem[]; nextCursor: string | null };
  capability: DrawingWorkspaceCapability;
  currentUserId: string;
  assignees?: DrawingAssignee[];
  collaborationRoom?: {
    issues: Array<{ id: string; title: string; status: string }>;
    anchors: DrawingAnchorRow[];
    comments: Array<{
      id: string;
      issue_id: string;
      author_id: string;
      body: string;
      created_at: string;
    }>;
    mentions: Array<{ comment_id: string; user_id: string }>;
    canvasRegionAnchors: DrawingCanvasRegionAnchorRow[];
  };
  projectId: string;
  previewMode?: boolean;
  realtimeAdapter?: DrawingWorkspaceRealtimeAdapter;
  previewHarness?: {
    onInvalidate?: () => void;
    onSoftLockChange?: (entityId: string | null) => void;
    onStateChange?: (snapshot: {
      activeCanvasId: string | null;
      layers: DrawingDocumentState["layers"];
      objects: DrawingDocumentState["objects"];
      operationIds: string[];
      redoIds: string[];
      selectedIds: string[];
      undoIds: string[];
    }) => void;
    verticalTest?: boolean;
  };
  collaborationBootstrap?: DrawingWorkspaceCollaborationBootstrap;
  collaborationConnectionFactory?: typeof openDrawingCollaborationConnection;
  collaborationPersistenceFactory?: typeof openDrawingYjsPersistence;
  measurementEvidence?: DrawingServerMeasurementEvidence | null;
  measurementEvidenceError?: DrawingMeasurementEvidenceError | null;
  roomUrl: string;
  sourceUrl: string | null;
  workspace: DrawingWorkspace & {
    document: NonNullable<DrawingWorkspace["document"]>;
  };
};

export default function DrawingWorkspaceClient({
  actionError,
  activityPage,
  assignees = [],
  capability,
  currentUserId,
  collaborationRoom,
  projectId,
  previewMode = false,
  realtimeAdapter,
  previewHarness,
  collaborationBootstrap,
  collaborationConnectionFactory = openDrawingCollaborationConnection,
  collaborationPersistenceFactory = openDrawingYjsPersistence,
  measurementEvidence,
  measurementEvidenceError,
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
  const [semanticMenuOpen, setSemanticMenuOpen] = useState(false);
  const semanticMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const [repeatMode, setRepeatMode] = useState(false);
  const [activePanel, setActivePanel] =
    useState<DrawingWorkspacePanel>("structure");
  const [historyStatus, setHistoryStatus] = useState<string | null>(null);
  const [selectedIssueId, setSelectedIssueId] = useState(
    collaborationRoom?.issues[0]?.id ?? "",
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const semanticBlockSelectionRef = useRef<Set<string>>(new Set());
  const transientAuthorizationRef = useRef<string | null>(null);
  const transientInputInvalidatedRef = useRef(true);
  const setAuthorizedTool = useCallback((tool: DrawingTool) => {
    transientInputInvalidatedRef.current = false;
    setActiveTool(tool);
  }, []);
  const setAuthorizedSelection = useCallback((ids: string[]) => {
    transientInputInvalidatedRef.current = false;
    semanticBlockSelectionRef.current.clear();
    setSelectedIds(ids);
  }, []);
  const setAuthorizedSemanticBlockSelection = useCallback((ids: string[]) => {
    transientInputInvalidatedRef.current = false;
    semanticBlockSelectionRef.current = new Set(ids);
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
  const [outboxReady, setOutboxReady] = useState(previewMode);
  const [saveState, setSaveState] = useState({
    pending: 0,
    conflicted: false,
    flushing: false,
    online: true,
    storageError: false,
  });
  const [persistenceState, setPersistenceState] =
    useState<DrawingPersistenceSnapshot>({ failed: false, volatileCount: 0 });
  const markStorageFailed = useCallback(() => {
    setPersistenceState((current) => ({ ...current, failed: true }));
    setSaveState((current) => ({ ...current, storageError: true }));
  }, []);
  const [legacyOperationCount, setLegacyOperationCount] = useState(0);
  const clipboardRef = useRef<DrawingClipboard>({ items: [] });
  const blockClipboardRef = useRef<DrawingBlockInstancesClipboard | null>(null);
  const [clipboardError, setClipboardError] = useState<string | null>(null);
  const legacyOutboxRef = useRef<DrawingOutbox | null>(null);
  const flushOutboxRef = useRef<(() => Promise<void>) | null>(null);
  const reviewFrozenRef = useRef(false);
  const reviewRequestInputRef = useRef<HTMLInputElement>(null);
  const reviewSubmitBypassRef = useRef(false);
  const reviewSubmissionSeenRef = useRef(false);
  const reviewSubmittedRef = useRef(false);
  const persistenceRef = useRef<ReturnType<
    typeof createDrawingPersistenceQueue
  > | null>(null);
  const localDraftFlushRef = useRef<() => Promise<void>>(async () => {});
  const retryStorageRef = useRef<() => void>(() => {});
  const { file, document: drawingDocument } = workspace;
  const navigation = useNavigation();
  const { revision } = drawingDocument;
  const authority = drawingCollaborationAuthority({
    bootstrap: collaborationBootstrap,
    fallbackCapability: capability,
    fallbackRevisionStatus: revision.status,
  });
  const effectiveCapability = authority.capability;
  const effectiveRevisionStatus = authority.revisionStatus;
  const authorityCanWrite = authority.canWrite && !measurementEvidenceError;
  const measurementLineage: DrawingMeasurementEvidenceLineage | null =
    collaborationBootstrap
      ? {
          documentId: drawingDocument.id,
          revisionId: revision.id,
          revisionVersion: revision.version,
          snapshotSha256: collaborationBootstrap.sha256,
          operationCheckpoint: collaborationBootstrap.operationSequence,
        }
      : null;
  const collaborationBootstrapRef = useRef(collaborationBootstrap);
  const capabilityRef = useRef(effectiveCapability);
  const revisionStatusRef = useRef(effectiveRevisionStatus);
  collaborationBootstrapRef.current = collaborationBootstrap;
  capabilityRef.current = effectiveCapability;
  revisionStatusRef.current = effectiveRevisionStatus;
  const persistenceLifecycleKey = drawingCollaborationLifecycleKey(
    currentUserId,
    revision.project_id,
    revision.id,
  );
  const realtime = useDrawingWorkspaceRealtime({
    adapter: realtimeAdapter,
    enabled: true,
    projectId: revision.project_id,
    revisionId: revision.id,
    userId: currentUserId,
    onInvalidate: previewHarness?.onInvalidate,
  });
  const documentStoreRef = useRef<DrawingDocumentStore | null>(null);
  if (!documentStoreRef.current) {
    documentStoreRef.current = createDrawingDocumentStore(
      collaborationBootstrap
        ? drawingStateFromBootstrap(collaborationBootstrap)
        : drawingStateFromRevision(revision),
      {
        activePageId: revision.activePageId,
        activeCanvasId: revision.activeCanvasId,
        revisionStatus: effectiveRevisionStatus,
      },
    );
  }
  const documentStore = documentStoreRef.current;
  const collaborationAdapterRef = useRef<DrawingDraftAdapter | null>(null);
  const collaborationCommandRef = useRef<ReturnType<
    typeof createDrawingCollaborationCommandBridge
  > | null>(null);
  const commandQueueRef = useRef<Promise<void>>(Promise.resolve());
  const commandQueueProjectionRef = useRef<DrawingDocumentState | null>(null);
  const commandQueueSizeRef = useRef(0);
  const collaborationConnectionRef =
    useRef<DrawingCollaborationConnection | null>(null);
  const awarenessStoreRef = useRef(createDrawingAwarenessPeerStore());
  const awarenessLockPeers = useDrawingAwarenessLocks(
    awarenessStoreRef.current,
  );
  const awarenessLeaseRef = useRef<ReturnType<
    typeof createDrawingSoftLockLease
  > | null>(null);
  const awarenessRenewalRef = useRef<number | null>(null);
  const awarenessCursorRef =
    useRef<DrawingAwarenessLocalInput["cursorWorld"]>(null);
  const awarenessSelectionRef = useRef<readonly string[]>([]);
  const awarenessVisibleEntityIdsRef = useRef<ReadonlySet<string>>(new Set());
  const awarenessPublicationRef = useRef<ReturnType<
    typeof createDrawingAwarenessPublication
  > | null>(null);
  awarenessPublicationRef.current ??= createDrawingAwarenessPublication({
    getCanonicalSelectedIds: () => awarenessSelectionRef.current,
    getCanonicalVisibleEntityIds: () => awarenessVisibleEntityIdsRef.current,
    initialState: {
      pageId: null,
      canvasId: null,
      cursorWorld: null,
      selectedIds: [],
      activeTool: "select",
      softLocks: [],
    },
    onSoftLocksPruned(entityIds) {
      const lease = awarenessLeaseRef.current;
      if (!lease?.releaseIfEntityHidden(entityIds)) return;
      if (awarenessRenewalRef.current !== null) {
        window.clearInterval(awarenessRenewalRef.current);
        awarenessRenewalRef.current = null;
      }
      awarenessLeaseRef.current = null;
    },
  });
  const [collaborationPhase, setCollaborationPhase] = useState<
    DrawingCollaborationConnection["phase"]
  >(previewMode ? "connected" : "connecting");
  const [collaborationEditNotice, setCollaborationEditNotice] = useState<
    string | null
  >(null);
  const [verticalTestStatus, setVerticalTestStatus] = useState("준비됨");
  const initializedPersistenceLifecycleKeyRef = useRef<string | null>(null);
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
    semanticBlockSelectionRef.current.clear();
    setSelectedIds([]);
  }, [drawingState]);
  useEffect(() => {
    previewHarness?.onStateChange?.({
      activeCanvasId: drawingState.activeCanvasId,
      layers: drawingState.layers,
      objects: drawingState.objects,
      operationIds: drawingState.operations.map(
        (operation) => operation.clientOperationId,
      ),
      redoIds: drawingState.redoStackByActor[currentUserId] ?? [],
      selectedIds,
      undoIds: drawingState.undoStackByActor[currentUserId] ?? [],
    });
  }, [currentUserId, drawingState, previewHarness, selectedIds]);
  const capabilityCanPersist = canPersistDrawingMutation(
    effectiveCapability,
    persistenceState,
  );
  const baseCanEdit =
    outboxReady &&
    !reviewPreparing &&
    capabilityCanPersist &&
    authorityCanWrite;
  const authorizationProbe = useMemo(
    () =>
      deriveDrawingTransientState(drawingState, {
        canEdit: baseCanEdit,
        canSelect: true,
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
    draft: effectiveRevisionStatus === "draft",
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
        canSelect: true,
        activeLayerId: transientInput.activeLayerId,
        activeTool: transientInput.activeTool,
        selectedIds: selectedIdsKey ? selectedIdsKey.split("\u0000") : [],
        semanticBlockInstanceIds: [...semanticBlockSelectionRef.current],
      }),
    [
      baseCanEdit,
      drawingState,
      transientInput.activeLayerId,
      transientInput.activeTool,
      selectedIdsKey,
    ],
  );
  const transientSelectedIdsKey = transient.selectedIds.join("\u0000");
  awarenessSelectionRef.current = transient.selectedIds;
  const activeDrawingState = transient.state;
  const awarenessVisibleEntityIds = useMemo(
    () => [
      ...drawingVisibleCanvasObjects(
        Object.values(activeDrawingState.objects),
        activeDrawingState.layers,
      ).map((object) => object.id),
      ...Object.values(
        activeDrawingState.structure?.blockInstances ?? {},
      ).flatMap((instance) =>
        activeDrawingState.layers[instance.layerId]?.visible
          ? [instance.id]
          : [],
      ),
    ],
    [
      activeDrawingState.layers,
      activeDrawingState.objects,
      activeDrawingState.structure?.blockInstances,
    ],
  );
  awarenessVisibleEntityIdsRef.current = new Set(awarenessVisibleEntityIds);
  const selectionLockConflict = useMemo(
    () =>
      drawingSelectionSoftLockConflict(
        transient.selectedIds,
        awarenessLockPeers,
      ),
    [awarenessLockPeers, transient.selectedIds],
  );
  const reportLockConflict = useCallback(
    (conflict: NonNullable<ReturnType<typeof drawingSoftLockConflict>>) => {
      const entityId = conflict.lock.entityId;
      const name =
        drawingState.objects[entityId]?.name ??
        drawingState.structure?.blockInstances[entityId]?.name ??
        "선택 항목";
      setCollaborationEditNotice(
        `${conflict.user.displayName}님이 ${name} 편집 중이어서 이 작업을 실행하지 않았습니다. advisory 잠금이며 서버 권한은 별도로 확인됩니다.`,
      );
    },
    [drawingState],
  );
  const publishAwareness = useCallback(
    (patch: Partial<DrawingAwarenessLocalInput> = {}) =>
      awarenessPublicationRef.current?.update(patch),
    [],
  );
  const setAwarenessSoftLock = useCallback(
    (entityId: string | null) => {
      previewHarness?.onSoftLockChange?.(entityId);
      if (awarenessRenewalRef.current !== null) {
        window.clearInterval(awarenessRenewalRef.current);
        awarenessRenewalRef.current = null;
      }
      if (!entityId) {
        const lease = awarenessLeaseRef.current;
        awarenessLeaseRef.current = null;
        lease?.release();
        return;
      }
      const lease =
        awarenessLeaseRef.current ??
        createDrawingSoftLockLease({
          onChange: (softLocks) => publishAwareness({ softLocks }),
        });
      awarenessLeaseRef.current = lease;
      lease.acquire(entityId);
      awarenessRenewalRef.current = window.setInterval(
        () => lease.renew(),
        5_000,
      );
    },
    [previewHarness, publishAwareness],
  );
  const selectionMutationAllowed = useCallback(() => {
    if (!selectionLockConflict) return true;
    reportLockConflict(selectionLockConflict);
    setAwarenessSoftLock(null);
    return false;
  }, [reportLockConflict, selectionLockConflict, setAwarenessSoftLock]);
  useEffect(() => {
    if (!selectionLockConflict) setCollaborationEditNotice(null);
  }, [selectionLockConflict]);
  const resolvedObjects = useMemo(() => {
    const resolver = createDrawingStyleResolutionCache(
      activeDrawingState.structure?.styles ?? {},
    );
    const objects: Array<DrawingObject & { style: DrawingStyle }> = [];
    let styleError: string | null = null;
    for (const object of Object.values(activeDrawingState.objects)) {
      try {
        objects.push({ ...object, style: resolver.resolve(object) });
      } catch (caught) {
        styleError =
          caught instanceof Error
            ? caught.message
            : "도면 스타일을 해석할 수 없습니다.";
      }
    }
    return { objects, styleError };
  }, [activeDrawingState.objects, activeDrawingState.structure?.styles]);
  const blockStructure = drawingState.structure;
  const resolvedBlockInstances = useMemo(
    () =>
      blockStructure && drawingState.activeCanvasId
        ? drawingBlockRenderCache.select({
            activeCanvasId: drawingState.activeCanvasId,
            blocks: blockStructure.blocks,
            instances: blockStructure.blockInstances,
            layers: drawingState.layers,
            styles: blockStructure.styles,
          })
        : { instances: [], error: null as string | null },
    [
      blockStructure?.blocks,
      blockStructure?.blockInstances,
      blockStructure?.styles,
      drawingState.activeCanvasId,
      drawingState.layers,
    ],
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
    effectiveCapability,
    Object.values(activeDrawingState.layers),
    resolvedActiveLayerId,
  );
  const editing = {
    ...editingContext,
    canEdit: baseCanEdit && editingContext.canEdit && authorityCanWrite,
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
    capability: effectiveCapability,
    createdBy: revision.created_by,
    currentUserId,
    reviewEvidence: revision.reviewEvidence,
    revisionId: revision.id,
    revisionVersion: revision.version,
    status: effectiveRevisionStatus,
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
    let attempt: {
      document: Y.Doc;
      persistence: DrawingYjsPersistence | null;
      adapter: DrawingDraftAdapter;
      dispose(): Promise<void>;
    } | null = null;
    let connection: DrawingCollaborationConnection | null = null;
    let unsubscribeAwareness: (() => void) | null = null;
    let awarenessExpiryTimer: number | null = null;
    let connecting: Promise<void> | null = null;
    let initializing: Promise<void> | null = null;
    const clearAwareness = () => {
      unsubscribeAwareness?.();
      unsubscribeAwareness = null;
      if (awarenessExpiryTimer !== null)
        window.clearTimeout(awarenessExpiryTimer);
      awarenessExpiryTimer = null;
      if (awarenessRenewalRef.current !== null)
        window.clearInterval(awarenessRenewalRef.current);
      awarenessRenewalRef.current = null;
      const lease = awarenessLeaseRef.current;
      awarenessLeaseRef.current = null;
      lease?.release();
      awarenessPublicationRef.current?.disconnect();
      awarenessStoreRef.current.replace([]);
    };
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

    const runConnect = async () => {
      if (!active || !attempt || connection) return;
      try {
        const opened = await collaborationConnectionFactory({
          document: attempt.document,
          projectId: revision.project_id,
          revisionId: revision.id,
          resolveToken: createDrawingAccessTokenResolver(),
          url: import.meta.env.VITE_DRAWING_COLLABORATION_URL,
          onPhase: (phase) => active && setCollaborationPhase(phase),
        });
        if (!active) opened?.dispose();
        else {
          connection = opened;
          collaborationConnectionRef.current = opened;
          const remote = opened?.awareness;
          if (remote) {
            const refreshPeers = () => {
              if (awarenessExpiryTimer !== null)
                window.clearTimeout(awarenessExpiryTimer);
              const now = Date.now();
              const localState =
                awarenessPublicationRef.current?.getLocalState();
              const peers = parseDrawingAwarenessPeers(remote.getStates(), {
                localClientId: remote.clientId,
                pageId: localState?.pageId ?? null,
                canvasId: localState?.canvasId ?? null,
                now,
              });
              awarenessStoreRef.current.replace(peers);
              const nextExpiry = peers
                .flatMap((peer) => peer.softLocks.map((lock) => lock.expiresAt))
                .sort((left, right) => left - right)[0];
              awarenessExpiryTimer = nextExpiry
                ? window.setTimeout(refreshPeers, Math.max(0, nextExpiry - now))
                : null;
            };
            unsubscribeAwareness = remote.subscribe(refreshPeers);
            awarenessPublicationRef.current?.connect({
              adapter: remote,
              user: { id: currentUserId, displayName: "나" },
            });
            refreshPeers();
          }
        }
      } catch {
        if (active) setCollaborationPhase("degraded");
      }
    };
    const connect = () => {
      if (!connecting)
        connecting = runConnect().finally(() => {
          connecting = null;
        });
      return connecting;
    };
    const runInitialize = async () => {
      const bootstrap = collaborationBootstrapRef.current;
      const base = bootstrap
        ? drawingStateFromBootstrap(bootstrap)
        : drawingStateFromRevision(revision);
      try {
        setOutboxReady(false);
        collaborationAdapterRef.current = null;
        collaborationCommandRef.current = null;
        clearAwareness();
        connection?.dispose();
        connection = null;
        collaborationConnectionRef.current = null;
        await attempt?.dispose();
        let localBaseMeta:
          ReturnType<typeof initializeDrawingCollaborationDocument> | undefined;
        attempt = await openDrawingCollaborationLocalAttempt({
          createDocument() {
            const document = new Y.Doc();
            localBaseMeta = initializeDrawingCollaborationDocument({
              document,
              projectId: revision.project_id,
              revisionId: revision.id,
              baseSnapshotSha256: bootstrap?.sha256 ?? file.sha256,
              baseOperationSequence: bootstrap?.operationSequence ?? 0,
            });
            return document;
          },
          openPersistence: (document) =>
            collaborationPersistenceFactory({
              revisionId: revision.id,
              document,
            }),
          createAdapter: (document) => {
            if (!localBaseMeta)
              throw new Error(
                "Drawing collaboration local base is unavailable.",
              );
            return createDrawingDraftAdapter({
              document,
              localBaseMeta,
              authoritativeState: base,
              actorId: currentUserId,
              authorization: capabilityRef.current,
              frozen: revisionStatusRef.current !== "draft",
              baseOperationSequence: bootstrap?.operationSequence ?? 0,
              replaceProjection: (state) => documentStore.replace(state),
            });
          },
          reconcile: (adapter) =>
            reconcileDrawingCollaborationDraft({
              actorId: currentUserId,
              adapter,
              outbox,
              recentOutcomes: bootstrap?.recentOutcomes ?? [],
            }),
        });
        if (!active) {
          await attempt.dispose();
          attempt = null;
          return;
        }
        localDraftFlushRef.current = async () => {
          await attempt?.persistence?.flush();
        };
        const draft = attempt.adapter;
        collaborationAdapterRef.current = attempt.adapter;
        collaborationCommandRef.current =
          createDrawingCollaborationCommandBridge({
            adapter: draft,
            outbox,
            afterAppend: () => {
              connection?.flush();
              void flushOutboxRef.current?.();
            },
          });
        initializedPersistenceLifecycleKeyRef.current =
          replaceDrawingWorkspaceGraphForLifecycle({
            documentStore,
            lifecycleKey: persistenceLifecycleKey,
            previousLifecycleKey: initializedPersistenceLifecycleKeyRef.current,
            recoveredState: draft.getSnapshot().state,
          });
        drawingStateRef.current = documentStore.getSnapshot();
        setOutboxReady(true);
        setPersistenceState({ failed: false, volatileCount: 0 });
        setSaveState((current) => ({ ...current, storageError: false }));
        await refresh();
        await connect();
      } catch {
        if (active) {
          markStorageFailed();
          setSaveState((current) => ({ ...current, flushing: false }));
        }
      }
    };
    const initialize = () => {
      if (!initializing)
        initializing = runInitialize().finally(() => {
          initializing = null;
        });
      return initializing;
    };
    retryStorageRef.current = () => void initialize();
    const online = () => {
      setSaveState((current) => ({ ...current, online: true }));
      void flush();
      void connect();
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
    blockClipboardRef.current = null;
    void initialize();
    return () => {
      active = false;
      persistence.dispose();
      outbox.dispose();
      clearAwareness();
      connection?.dispose();
      void attempt?.dispose().catch(() => undefined);
      collaborationAdapterRef.current = null;
      collaborationCommandRef.current = null;
      collaborationConnectionRef.current = null;
      if (persistenceRef.current === persistence) persistenceRef.current = null;
      if (legacyOutboxRef.current === outbox) legacyOutboxRef.current = null;
      if (flushOutboxRef.current === flush) flushOutboxRef.current = null;
      localDraftFlushRef.current = async () => {};
      retryStorageRef.current = () => {};
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [documentStore, persistenceLifecycleKey]);

  useEffect(() => {
    awarenessCursorRef.current = null;
    setAwarenessSoftLock(null);
    publishAwareness({
      pageId: drawingState.activePageId,
      canvasId: drawingState.activeCanvasId,
      cursorWorld: null,
      selectedIds: transient.selectedIds,
      activeTool: transient.activeTool,
      softLocks: [],
    });
  }, [
    drawingState.activeCanvasId,
    drawingState.activePageId,
    publishAwareness,
    setAwarenessSoftLock,
  ]);

  useEffect(() => {
    if (
      selectedIds.length === transient.selectedIds.length &&
      selectedIds.every((id, index) => id === transient.selectedIds[index])
    )
      return;
    setAuthorizedSelection(transient.selectedIds);
  }, [selectedIds, setAuthorizedSelection, transientSelectedIdsKey]);

  useEffect(() => {
    publishAwareness({
      cursorWorld: awarenessCursorRef.current,
      selectedIds: transient.selectedIds,
      activeTool: transient.activeTool,
    });
  }, [publishAwareness, transient.activeTool, transientSelectedIdsKey]);

  useEffect(() => {
    publishAwareness({});
  }, [awarenessVisibleEntityIds, publishAwareness]);

  useEffect(() => {
    const adapter = collaborationAdapterRef.current;
    if (!adapter) return;
    adapter.setAuthorization(effectiveCapability);
    adapter.setFrozen(effectiveRevisionStatus !== "draft");
    if (collaborationBootstrap)
      adapter.replaceAuthoritative(
        drawingStateFromBootstrap(collaborationBootstrap),
        { baseOperationSequence: collaborationBootstrap.operationSequence },
      );
    if (!authorityCanWrite) {
      setAwarenessSoftLock(null);
      awarenessPublicationRef.current?.clear();
      setActiveTool("select");
      setActiveLayerId(null);
      setSelectedIds([]);
    } else publishAwareness({});
  }, [
    authorityCanWrite,
    collaborationBootstrap,
    effectiveCapability,
    effectiveRevisionStatus,
    publishAwareness,
    setAwarenessSoftLock,
  ]);

  useEffect(() => {
    const refresh = () =>
      void collaborationConnectionRef.current
        ?.refreshToken()
        .catch(() => setCollaborationPhase("degraded"));
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [persistenceLifecycleKey]);

  useEffect(() => {
    setSelectedIds((current) => {
      const eligible = current.filter((objectId) =>
        transient.selectedIds.includes(objectId),
      );
      return eligible.length === current.length ? current : eligible;
    });
  }, [transient.selectedIds]);

  const commitApplied = useCallback(
    async (applied: AppliedDrawingCommand) => {
      const lockConflict = drawingRecordedOperationSoftLockConflict(
        applied.operation,
        awarenessLockPeers,
      );
      if (lockConflict) {
        reportLockConflict(lockConflict);
        setAwarenessSoftLock(null);
        return false;
      }
      if (
        reviewFrozenRef.current ||
        !authorityCanWrite ||
        !collaborationCommandRef.current ||
        !canPersistDrawingMutation(
          effectiveCapability,
          persistenceState,
          effectiveRevisionStatus,
        )
      )
        return false;
      try {
        await persistDrawingRecordedOperation(
          collaborationCommandRef.current,
          applied,
        );
        return true;
      } catch (error) {
        markStorageFailed();
        throw error;
      }
    },
    [
      authorityCanWrite,
      awarenessLockPeers,
      effectiveCapability,
      effectiveRevisionStatus,
      persistenceState,
      reportLockConflict,
      setAwarenessSoftLock,
    ],
  );

  const enqueueDrawingMutation = useCallback(
    (
      mutation: (
        latest: DrawingDocumentState,
        expected: DrawingDocumentState | null,
      ) => Promise<DrawingDocumentState | null>,
      onError?: (error: unknown) => void,
    ) => {
      commandQueueSizeRef.current += 1;
      const run = async () => {
        const latest =
          collaborationAdapterRef.current?.getSnapshot().state ??
          drawingStateRef.current;
        const next = await mutation(latest, commandQueueProjectionRef.current);
        if (next) commandQueueProjectionRef.current = next;
      };
      const result = commandQueueRef.current.then(run);
      commandQueueRef.current = result.then(
        () => undefined,
        () => undefined,
      );
      const settled = () => {
        commandQueueSizeRef.current -= 1;
        if (commandQueueSizeRef.current === 0)
          commandQueueProjectionRef.current = null;
      };
      void result.then(settled, (error) => {
        settled();
        if (onError) onError(error);
        else markStorageFailed();
      });
    },
    [markStorageFailed],
  );

  const applyCommand = useCallback(
    (command: DrawingCommand) => {
      const lockConflict = drawingCommandSoftLockConflict(
        command,
        awarenessLockPeers,
      );
      if (lockConflict) {
        reportLockConflict(lockConflict);
        setAwarenessSoftLock(null);
        return false;
      }
      if (
        reviewFrozenRef.current ||
        !authorityCanWrite ||
        !outboxReady ||
        !canPersistDrawingMutation(
          effectiveCapability,
          persistenceState,
          effectiveRevisionStatus,
        )
      )
        return false;
      const bridge = collaborationCommandRef.current;
      if (!bridge) return false;
      setCollaborationEditNotice(null);
      const source = drawingStateRef.current;
      enqueueDrawingMutation(
        async (latest, expected) => {
          const locallyOrdered =
            command.type === "update_objects" &&
            expected !== null &&
            command.updates.every((update) =>
              sameDrawingWorkspaceValue(
                expected.objects[update.objectId],
                latest.objects[update.objectId],
              ),
            );
          const nextCommand = locallyOrdered
            ? rebaseDrawingCommandForProjection(command, source, latest)
            : command;
          const prepared = await bridge.applyCommand(nextCommand);
          return prepared.state;
        },
        (error) => {
          if (error instanceof DrawingCommandError) {
            setCollaborationEditNotice(error.message);
            return;
          }
          markStorageFailed();
        },
      );
      return true;
    },
    [
      authorityCanWrite,
      awarenessLockPeers,
      effectiveCapability,
      effectiveRevisionStatus,
      enqueueDrawingMutation,
      outboxReady,
      persistenceState,
      reportLockConflict,
      setAwarenessSoftLock,
    ],
  );
  const runVerticalInvalidShrink = useCallback(async () => {
    const wall =
      selectedIds
        .map((id) => drawingStateRef.current.objects[id])
        .find((object) => object?.geometry.type === "wall") ??
      Object.values(drawingStateRef.current.objects).find(
        (object) => object.geometry.type === "wall",
      );
    const bridge = collaborationCommandRef.current;
    if (!wall || wall.geometry.type !== "wall" || !bridge) {
      setVerticalTestStatus("축소 대상을 찾지 못함");
      return;
    }
    try {
      await bridge.applyCommand({
        type: "update_objects",
        actorId: currentUserId,
        updates: [
          {
            objectId: wall.id,
            baseVersion: wall.version,
            patch: {
              geometry: {
                ...wall.geometry,
                end: {
                  x: wall.geometry.start.x + 10,
                  y: wall.geometry.start.y,
                },
              },
            },
          },
        ],
      });
      setVerticalTestStatus("잘못된 축소가 허용됨");
    } catch (error) {
      setVerticalTestStatus(
        `잘못된 축소 거부됨 · ${error instanceof Error ? error.message : "검증 오류"}`,
      );
    }
  }, [currentUserId, selectedIds]);
  const runVerticalHostedWallDelete = useCallback(() => {
    const wall = selectedIds
      .map((id) => drawingStateRef.current.objects[id])
      .find((object) => object?.geometry.type === "wall");
    if (!wall) {
      setVerticalTestStatus("원자 삭제 대상을 찾지 못함");
      return;
    }
    try {
      const accepted = applyCommand(
        deleteDrawingWallWithOpeningsCommand(
          drawingStateRef.current,
          currentUserId,
          wall.id,
        ),
      );
      setVerticalTestStatus(
        accepted ? "호스트와 개구부 원자 삭제됨" : "원자 삭제 거부됨",
      );
    } catch (error) {
      setVerticalTestStatus(
        `원자 삭제 거부됨 · ${error instanceof Error ? error.message : "검증 오류"}`,
      );
    }
  }, [applyCommand, currentUserId, selectedIds]);
  const runVerticalDirectMutation = useCallback(() => {
    const wall = Object.values(drawingStateRef.current.objects).find(
      (object) => object.geometry.type === "wall",
    );
    if (!wall) {
      setVerticalTestStatus("직접 변경 대상을 찾지 못함");
      return;
    }
    const accepted = applyCommand({
      type: "update_objects",
      actorId: currentUserId,
      updates: [
        {
          objectId: wall.id,
          baseVersion: wall.version,
          patch: { name: `${wall.name} 직접 변경` },
        },
      ],
    });
    setVerticalTestStatus(
      accepted ? "직접 변경 제출됨" : "직접 변경 권한 차단됨",
    );
  }, [applyCommand, currentUserId]);
  const runVerticalLocalDraftFlush = useCallback(async () => {
    try {
      await localDraftFlushRef.current();
      setVerticalTestStatus("로컬 저장 동기화됨");
    } catch (error) {
      setVerticalTestStatus(
        `로컬 저장 동기화 실패 · ${error instanceof Error ? error.message : "저장 오류"}`,
      );
    }
  }, []);
  const runVerticalRemoteWallProjection = useCallback(
    (field: "name" | "thickness") => {
      const adapter = collaborationAdapterRef.current;
      const current = adapter?.getSnapshot().state;
      const wall = current
        ? Object.values(current.objects).find(
            (object) => object.geometry.type === "wall",
          )
        : null;
      if (!adapter || !current || !wall || wall.geometry.type !== "wall") {
        setVerticalTestStatus("원격 벽 변경 대상을 찾지 못함");
        return;
      }
      const applied = applyDrawingCommand(current, {
        type: "update_objects",
        actorId: "00000000-0000-4000-8000-000000000009",
        updates: [
          {
            objectId: wall.id,
            baseVersion: wall.version,
            patch:
              field === "name"
                ? { name: `${wall.name} 원격` }
                : {
                    geometry: {
                      ...wall.geometry,
                      thicknessMillimeters: 24,
                    },
                  },
          },
        ],
      });
      adapter.replaceAuthoritative(applied.state);
      setVerticalTestStatus(
        field === "name" ? "원격 벽 이름 변경됨" : "원격 벽 두께 변경됨",
      );
    },
    [],
  );
  const revertOperation = useCallback(
    async (operationId: string) => {
      try {
        const reverted = revertDrawingOperation(
          drawingState,
          currentUserId,
          operationId,
        );
        if ("kind" in reverted) {
          setHistoryStatus("후속 변경이 있어 안전하게 되돌릴 수 없습니다.");
          return;
        }
        if (await commitApplied(reverted))
          setHistoryStatus("되돌리기 작업을 안전하게 저장했습니다.");
        else setHistoryStatus("현재 상태에서는 작업을 되돌릴 수 없습니다.");
      } catch (error) {
        setHistoryStatus(
          error instanceof Error ? error.message : "작업을 되돌릴 수 없습니다.",
        );
      }
    },
    [commitApplied, currentUserId, drawingState],
  );
  const restoreCheckpoint = useCallback(
    async (checkpoint: { id: string; canonicalJson: unknown }) => {
      const bridge = collaborationCommandRef.current;
      if (
        reviewFrozenRef.current ||
        !authorityCanWrite ||
        !outboxReady ||
        !bridge ||
        !canPersistDrawingMutation(
          effectiveCapability,
          persistenceState,
          effectiveRevisionStatus,
        )
      ) {
        setHistoryStatus("현재 상태에서는 체크포인트를 복원할 수 없습니다.");
        return;
      }
      try {
        const graph =
          checkpoint.canonicalJson as DrawingWorkspaceCollaborationBootstrap["canonicalJson"];
        const target = hydrateDrawingDocumentState({
          revisionId: revision.id,
          pages: graph.pages as DrawingDocumentHydration["pages"],
          canvases: graph.canvases as DrawingDocumentHydration["canvases"],
          layers: canonicalCheckpointEntities(graph.layers, [
            "pageId",
          ]) as DrawingDocumentHydration["layers"],
          objects: canonicalCheckpointEntities(graph.objects, [
            "lineageId",
            "pageId",
            "type",
          ]) as DrawingDocumentHydration["objects"],
          sources: normalizeDrawingCanonicalSources(graph.sources, revision.id),
          styles: graph.styles as DrawingDocumentHydration["styles"],
          blocks: graph.blocks as DrawingDocumentHydration["blocks"],
          blockInstances:
            graph.blockInstances as DrawingDocumentHydration["blockInstances"],
          propertySchemas:
            graph.propertySchemas as DrawingDocumentHydration["propertySchemas"],
          propertyValues:
            graph.propertyValues as DrawingDocumentHydration["propertyValues"],
          tables: graph.tables as DrawingDocumentHydration["tables"],
        });
        const command = createDrawingCheckpointRestoreCommand(
          drawingStateRef.current,
          target,
          currentUserId,
          checkpoint.id,
        );
        const lockConflict = drawingCommandSoftLockConflict(
          command,
          awarenessLockPeers,
        );
        if (lockConflict) {
          reportLockConflict(lockConflict);
          setAwarenessSoftLock(null);
          setHistoryStatus(
            "다른 사용자가 편집 중인 객체가 있어 복원하지 않았습니다.",
          );
          return;
        }
        await bridge.applyCommand(command);
        setHistoryStatus("체크포인트 복원 작업을 안전하게 저장했습니다.");
      } catch (error) {
        setHistoryStatus(
          error instanceof Error
            ? error.message
            : "체크포인트를 복원하지 못했습니다.",
        );
      }
    },
    [
      authorityCanWrite,
      awarenessLockPeers,
      currentUserId,
      effectiveCapability,
      effectiveRevisionStatus,
      outboxReady,
      persistenceState,
      reportLockConflict,
      revision.id,
      setAwarenessSoftLock,
    ],
  );
  const blockMutationAdapter = useMemo(
    () =>
      createDrawingWorkspaceBlockMutationAdapter({
        activeCanvasId: drawingState.activeCanvasId,
        actorId: currentUserId,
        canEdit: editing.canEdit && !selectionLockConflict,
        onCommand: applyCommand,
        onSelectionChange: setAuthorizedSelection,
        selectedIds: transient.selectedIds,
        state: drawingState,
      }),
    [
      applyCommand,
      currentUserId,
      drawingState,
      editing.canEdit,
      selectionLockConflict,
      setAuthorizedSelection,
      transient.selectedIds,
    ],
  );

  const queueHistoryMutation = useCallback(
    (direction: "undo" | "redo", onComplete?: () => void) => {
      if (
        !outboxReady ||
        !authorityCanWrite ||
        !canPersistDrawingMutation(
          effectiveCapability,
          persistenceState,
          effectiveRevisionStatus,
        )
      )
        return false;
      const bridge = collaborationCommandRef.current;
      if (!bridge) return false;
      enqueueDrawingMutation(async (latest) => {
        const result =
          direction === "undo"
            ? undoDrawingCommand(latest, currentUserId)
            : redoDrawingCommand(latest, currentUserId);
        if (!result) return latest;
        if ("kind" in result) {
          setHistoryStatus("후속 변경이 있어 안전하게 되돌릴 수 없습니다.");
          return latest;
        }
        const lockConflict = drawingRecordedOperationSoftLockConflict(
          result.operation,
          awarenessLockPeers,
        );
        if (lockConflict) {
          reportLockConflict(lockConflict);
          setAwarenessSoftLock(null);
          return latest;
        }
        await persistDrawingRecordedOperation(bridge, result);
        onComplete?.();
        return result.state;
      }, markStorageFailed);
      return true;
    },
    [
      authorityCanWrite,
      awarenessLockPeers,
      currentUserId,
      effectiveCapability,
      effectiveRevisionStatus,
      enqueueDrawingMutation,
      markStorageFailed,
      outboxReady,
      persistenceState,
      reportLockConflict,
      setAwarenessSoftLock,
    ],
  );

  const undo = useCallback(
    () => queueHistoryMutation("undo"),
    [queueHistoryMutation],
  );

  const redo = useCallback(
    () => queueHistoryMutation("redo"),
    [queueHistoryMutation],
  );

  const runVerticalHostedWallUndo = useCallback(() => {
    setVerticalTestStatus("원자 삭제 실행 취소 대기");
    if (
      !queueHistoryMutation("undo", () =>
        setVerticalTestStatus("호스트와 개구부 원자 삭제 실행 취소됨"),
      )
    )
      setVerticalTestStatus("원자 삭제 실행 취소 거부됨");
  }, [queueHistoryMutation]);

  const copySelection = useCallback(() => {
    if (!selectionMutationAllowed()) return false;
    const kind = drawingSelectionEntityKind(
      drawingState,
      transient.selectedIds,
    );
    if (kind === "block_instance") {
      try {
        blockClipboardRef.current = copyDrawingBlockInstancesClipboard(
          drawingState,
          transient.selectedIds,
        );
        clipboardRef.current = { items: [] };
        setClipboardError(null);
        return true;
      } catch (error) {
        setClipboardError(
          error instanceof Error
            ? error.message
            : "블록을 복사하지 못했습니다.",
        );
        return false;
      }
    }
    if (kind !== "object") return false;
    blockClipboardRef.current = null;
    const clipboard = copyDrawingSelection(drawingState, transient.selectedIds);
    if (clipboard.items.length === 0) return false;
    clipboardRef.current = clipboard;
    setClipboardError(null);
    return true;
  }, [drawingState, selectionMutationAllowed, transient.selectedIds]);

  const pasteSelection = useCallback(() => {
    if (!editing.canEdit) return false;
    if (blockClipboardRef.current) {
      try {
        if (!transient.activeLayerId || !drawingState.activeCanvasId)
          throw new Error("현재 활성 편집 레이어를 선택하세요.");
        const command = pasteDrawingBlockInstancesClipboardCommand(
          drawingState,
          currentUserId,
          blockClipboardRef.current,
          {
            activeCanvasId: drawingState.activeCanvasId,
            activeLayerId: transient.activeLayerId,
          },
        );
        applyCommand(command);
        setAuthorizedSelection(
          command.actions.flatMap((action) =>
            action.kind === "put_block_instance" ? [action.entity.id] : [],
          ),
        );
        setClipboardError(null);
        return true;
      } catch (error) {
        setClipboardError(
          error instanceof Error
            ? error.message
            : "블록을 붙여넣지 못했습니다.",
        );
        return false;
      }
    }
    if (
      clipboardRef.current.items.some((item) => {
        const targetLayer = activeDrawingState.layers[item.layerId];
        return !targetLayer?.visible || targetLayer.locked;
      })
    )
      return false;
    const command = pasteDrawingClipboard(
      clipboardRef.current,
      currentUserId,
      undefined,
      activeDrawingState,
    );
    if (!command) return false;
    applyCommand(command);
    setAuthorizedSelection(command.objects.map((object) => object.id));
    setClipboardError(null);
    return true;
  }, [
    activeDrawingState,
    applyCommand,
    currentUserId,
    drawingState,
    editing.canEdit,
    setAuthorizedSelection,
    transient.activeLayerId,
  ]);

  const duplicateSelection = useCallback(() => {
    if (!editing.canEdit || !selectionMutationAllowed()) return false;
    const kind = blockMutationAdapter.selectionKind;
    if (kind === "block_instance") {
      return blockMutationAdapter.duplicateSelection();
    }
    if (kind !== "object") return false;
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
    blockMutationAdapter,
    currentUserId,
    drawingState,
    editing.canEdit,
    selectionMutationAllowed,
    setAuthorizedSelection,
    transient.selectedIds,
  ]);

  const deleteSelection = useCallback(() => {
    if (!editing.canEdit || !selectionMutationAllowed()) return false;
    const kind = blockMutationAdapter.selectionKind;
    if (kind === "block_instance") {
      return blockMutationAdapter.deleteSelection();
    }
    if (kind !== "object") return false;
    if (!drawingState.structure) return false;
    applyCommand(
      deleteDrawingObjectsWithReferencesCommand(
        drawingState,
        currentUserId,
        transient.selectedIds,
      ),
    );
    setSelectedIds([]);
    return true;
  }, [
    applyCommand,
    blockMutationAdapter,
    currentUserId,
    drawingState,
    editing.canEdit,
    selectionMutationAllowed,
    transient.selectedIds,
  ]);

  const moveSelection = useCallback(
    (delta: { x: number; y: number }) => {
      if (!editing.canEdit || !selectionMutationAllowed()) return false;
      const kind = blockMutationAdapter.selectionKind;
      if (kind === "block_instance") {
        return blockMutationAdapter.moveSelection(delta);
      }
      if (kind !== "object") return false;
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
      blockMutationAdapter,
      currentUserId,
      drawingState,
      editing.canEdit,
      selectionMutationAllowed,
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
      else if (shortcut.type === "undo") handled = undo();
      else handled = redo();
      if (handled) event.preventDefault();
    }
    window.addEventListener("keydown", handleWorkspaceShortcut);
    return () => window.removeEventListener("keydown", handleWorkspaceShortcut);
  }, [
    copySelection,
    deleteSelection,
    duplicateSelection,
    moveSelection,
    pasteSelection,
    redo,
    undo,
  ]);

  const commandEnabled = useCallback(
    (commandId: DrawingCommandId) =>
      drawingWorkspaceCommandEnabled(commandId, {
        blockSelectionCanMutate: blockMutationAdapter.canMutate,
        canEdit: editing.canEdit,
        canRedo:
          (drawingState.redoStackByActor[currentUserId]?.length ?? 0) > 0,
        canUndo:
          (drawingState.undoStackByActor[currentUserId]?.length ?? 0) > 0,
        selectionKind: blockMutationAdapter.selectionKind,
        selectionHasRemoteLock: Boolean(selectionLockConflict),
      }),
    [
      currentUserId,
      drawingState,
      blockMutationAdapter.canMutate,
      blockMutationAdapter.selectionKind,
      editing.canEdit,
      selectionLockConflict,
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
        commandId === "dimension" ||
        commandId === "wall" ||
        commandId === "opening" ||
        commandId === "space" ||
        commandId === "area" ||
        commandId === "grid" ||
        commandId === "arc"
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
      const requestStorageKey = drawingReviewFreezeStorageKey(
        revision.id,
        revision.version,
      );
      let requestId: string | null = null;
      try {
        requestId = window.sessionStorage.getItem(requestStorageKey);
      } catch {
        // A privacy-restricted browser can still keep the request in the form.
      }
      requestId ||= reviewRequestInputRef.current?.value || crypto.randomUUID();
      if (reviewRequestInputRef.current)
        reviewRequestInputRef.current.value = requestId;
      try {
        window.sessionStorage.setItem(requestStorageKey, requestId);
      } catch {
        // The hidden input preserves retries while this page remains mounted.
      }
      const persistence = persistenceRef.current;
      const outbox = legacyOutboxRef.current;
      const flush = flushOutboxRef.current;
      if (!persistence || !outbox || !flush) return;
      setReviewPreparationError(null);
      try {
        const missingProperties = missingRequiredDrawingProperties(
          drawingStateRef.current,
        );
        if (missingProperties.length)
          throw new Error(
            `필수 사용자 속성 ${missingProperties.length}개를 입력한 뒤 검토를 요청하세요.`,
          );
        await prepareDrawingReview({
          freeze() {
            reviewFrozenRef.current = true;
            setReviewPreparing(true);
            setAuthorizedTool("select");
            semanticBlockSelectionRef.current.clear();
            setAuthorizedSelection([]);
            setAwarenessSoftLock(null);
            awarenessCursorRef.current = null;
            publishAwareness({
              cursorWorld: null,
              selectedIds: [],
              activeTool: "select",
              softLocks: [],
            });
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
    [
      publishAwareness,
      revision.id,
      setAuthorizedSelection,
      setAuthorizedTool,
      setAwarenessSoftLock,
    ],
  );

  return (
    <main className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      {previewHarness?.verticalTest ? (
        <aside
          aria-label="P4 mounted command controls"
          className="fixed bottom-14 right-3 z-[60] flex gap-2 rounded-md bg-slate-950 p-2 text-xs"
        >
          <button onClick={() => void runVerticalInvalidShrink()} type="button">
            P4 선택 벽 잘못 축소 시도
          </button>
          <button onClick={runVerticalHostedWallDelete} type="button">
            P4 선택 벽과 개구부 원자 삭제
          </button>
          <button onClick={runVerticalHostedWallUndo} type="button">
            P4 원자 삭제 복원
          </button>
          <button
            onClick={() => {
              const opening = Object.values(
                drawingStateRef.current.objects,
              ).find((object) => object.geometry.type === "opening");
              if (opening) setAuthorizedSelection([opening.id]);
            }}
            type="button"
          >
            P4 첫 개구부 선택
          </button>
          <button
            onClick={() => {
              const openings = Object.values(
                drawingStateRef.current.objects,
              ).filter((object) => object.geometry.type === "opening");
              if (openings[1]) setAuthorizedSelection([openings[1].id]);
            }}
            type="button"
          >
            P4 두 번째 개구부 선택
          </button>
          <button
            onClick={() =>
              setAwarenessSoftLock(transient.selectedIds[0] ?? null)
            }
            type="button"
          >
            P4 실제 Awareness lease 잠금
          </button>
          <button onClick={runVerticalDirectMutation} type="button">
            P4 직접 변경 시도
          </button>
          <button
            onClick={() => void runVerticalLocalDraftFlush()}
            type="button"
          >
            P4 로컬 저장 동기화
          </button>
          <button
            onClick={() => runVerticalRemoteWallProjection("name")}
            type="button"
          >
            P4 원격 벽 이름 변경
          </button>
          <button
            onClick={() => runVerticalRemoteWallProjection("thickness")}
            type="button"
          >
            P4 원격 벽 두께 변경
          </button>
          <output aria-label="P4 mounted command result">
            {verticalTestStatus}
          </output>
        </aside>
      ) : null}
      <header className="flex min-h-14 flex-wrap items-center gap-2 border-b border-white/10 bg-slate-900 px-2 py-1.5 sm:px-3">
        <Link
          aria-label="협업 도면실로 돌아가기"
          className="inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white"
          to={roomUrl}
        >
          <ArrowLeft className="size-4" /> 협업 도면실
        </Link>
        <div className="min-w-0 flex-1 border-l border-white/10 pl-3">
          <h1 className="truncate text-sm font-bold">
            {drawingDocument.title}
          </h1>
          <p className="truncate text-xs text-slate-400">
            도면 작업실 · {file.original_filename}
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
          <span
            aria-label={`실시간 상태: ${realtime.message}`}
            className={`inline-flex min-h-9 items-center px-2 text-xs ${realtime.phase === "connected" ? "text-emerald-300" : realtime.phase === "disconnected" ? "text-amber-300" : "text-slate-300"}`}
            role="status"
          >
            {realtime.message}
          </span>
          <DrawingCollaborationConnectionStatus
            phase={collaborationPhase}
            readOnly={!authorityCanWrite}
            store={awarenessStoreRef.current}
          />
          <DrawingCollaborationParticipants store={awarenessStoreRef.current} />
          <DrawingExportDialog
            createdAt={drawingDocument.created_at}
            documentState={drawingState}
            sourceUrl={sourceUrl}
            title={drawingDocument.title}
          />
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
              <input
                name="freeze_request_id"
                ref={reviewRequestInputRef}
                type="hidden"
              />
              <Button
                disabled={
                  !drawingReviewSubmissionEnabled({
                    outboxReady,
                    reviewPreparing,
                    pending: saveState.pending,
                    conflicted: saveState.conflicted,
                    volatileCount: persistenceState.volatileCount,
                    persistenceFailed: persistenceState.failed,
                  })
                }
                type="submit"
                variant="secondary"
              >
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

      {clipboardError ? (
        <p
          className="border-b border-red-500/30 bg-red-950 px-4 py-2 text-sm text-red-100"
          role="alert"
        >
          {clipboardError}
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
            effectiveCapability,
            persistenceState,
            effectiveRevisionStatus,
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
                    capability: effectiveCapability,
                    confirmed,
                    outbox: drawingOutbox,
                    revisionStatus: effectiveRevisionStatus,
                  });
                  retryStorageRef.current();
                } catch {
                  markStorageFailed();
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

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:max-h-[calc(100vh-3.5rem)] xl:grid-cols-[15rem_minmax(0,1fr)_18rem]">
        <aside
          aria-label="도면 도구 패널"
          className="order-2 flex min-h-0 max-h-[32rem] flex-col overflow-hidden border-b border-white/10 bg-slate-900 xl:order-1 xl:max-h-[calc(100vh-3.5rem)] xl:border-b-0 xl:border-r"
        >
          <div
            role="tablist"
            aria-label="도면 도구"
            data-drawing-shortcuts="ignore"
            className="grid shrink-0 grid-cols-4 gap-1 border-b border-white/10 p-2 xl:grid-cols-2"
          >
            {drawingWorkspacePanels.map((panel) => {
              const selected = activePanel === panel.id;
              return (
                <button
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`drawing-panel-${panel.id}`}
                  className={`min-h-9 shrink-0 rounded-md px-2 text-xs font-semibold ${selected ? "bg-indigo-500 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}
                  id={`drawing-panel-tab-${panel.id}`}
                  key={panel.id}
                  onClick={() => setActivePanel(panel.id)}
                  onKeyDown={(event) => {
                    const nextPanel = resolveDrawingWorkspacePanelKey(
                      activePanel,
                      event.key,
                    );
                    if (!nextPanel) return;
                    event.preventDefault();
                    setActivePanel(nextPanel);
                    event.currentTarget.parentElement
                      ?.querySelector<HTMLButtonElement>(
                        `#drawing-panel-tab-${nextPanel}`,
                      )
                      ?.focus();
                  }}
                  tabIndex={selected ? 0 : -1}
                  type="button"
                >
                  {panel.label}
                </button>
              );
            })}
          </div>
          <div
            role="tabpanel"
            aria-labelledby="drawing-panel-tab-collaboration"
            className="min-h-0 flex-1 overflow-y-auto p-3"
            hidden={activePanel !== "collaboration"}
            id="drawing-panel-collaboration"
          >
            <section
              aria-label="댓글 및 이슈"
              className="space-y-3 text-sm text-slate-200"
            >
              <h2 className="font-bold text-white">댓글·이슈</h2>
              <p className="text-xs text-slate-400">
                객체 또는 캔버스 영역을 선택한 뒤 이슈에서 댓글과 명시적 멘션을
                연결합니다.
              </p>
              {collaborationRoom?.issues.length ? (
                <>
                  <label
                    className="block text-xs font-semibold"
                    htmlFor="workspace-issue-target"
                  >
                    연결할 이슈
                  </label>
                  <select
                    className="min-h-10 w-full rounded-md border border-white/20 bg-slate-950 px-2"
                    id="workspace-issue-target"
                    name="issue_id"
                    onChange={(event) => setSelectedIssueId(event.target.value)}
                    value={selectedIssueId}
                  >
                    {collaborationRoom.issues.map((issue) => (
                      <option key={issue.id} value={issue.id}>
                        {issue.title} · {issue.status}
                      </option>
                    ))}
                  </select>

                  {baseCanEdit &&
                  transient.selectedIds.find(
                    (id) => drawingState.objects[id],
                  ) ? (
                    <Form method="post">
                      <input name="intent" type="hidden" value="link_issue" />
                      <input
                        name="issue_id"
                        type="hidden"
                        value={selectedIssueId}
                      />
                      <input
                        name="object_id"
                        type="hidden"
                        value={transient.selectedIds.find(
                          (id) => drawingState.objects[id],
                        )}
                      />
                      <button
                        className="min-h-10 w-full rounded-md border border-white/20 px-3 text-xs font-semibold"
                        type="submit"
                      >
                        선택 객체를 이슈에 연결
                      </button>
                    </Form>
                  ) : (
                    <p className="rounded-md bg-white/5 p-2 text-xs text-slate-400">
                      캔버스에서 객체를 선택하면 현재 이슈에 연결할 수 있습니다.
                    </p>
                  )}

                  {effectiveCapability !== "viewer" ? (
                    <>
                      <Form
                        className="space-y-2 rounded-md border border-white/10 p-2"
                        method="post"
                        onSubmit={(event) => {
                          const input =
                            event.currentTarget.elements.namedItem(
                              "comment_id",
                            );
                          if (input instanceof HTMLInputElement)
                            input.value = crypto.randomUUID();
                        }}
                      >
                        <input name="intent" type="hidden" value="comment" />
                        <input
                          name="issue_id"
                          type="hidden"
                          value={selectedIssueId}
                        />
                        <input name="comment_id" type="hidden" />
                        <label
                          className="block text-xs font-semibold"
                          htmlFor="workspace-comment-body"
                        >
                          댓글
                        </label>
                        <textarea
                          className="min-h-20 w-full rounded-md border border-white/20 bg-slate-950 p-2"
                          id="workspace-comment-body"
                          name="body"
                          required
                        />
                        <label
                          className="block text-xs font-semibold"
                          htmlFor="workspace-comment-mentions"
                        >
                          멘션할 멤버
                        </label>
                        <select
                          className="min-h-20 w-full rounded-md border border-white/20 bg-slate-950 p-2"
                          id="workspace-comment-mentions"
                          multiple
                          name="mentioned_user_ids"
                        >
                          {assignees
                            .filter(
                              (assignee) => assignee.userId !== currentUserId,
                            )
                            .map((assignee) => (
                              <option
                                key={assignee.userId}
                                value={assignee.userId}
                              >
                                {assignee.role} · {assignee.userId.slice(0, 8)}
                              </option>
                            ))}
                        </select>
                        <button
                          className="min-h-10 w-full rounded-md bg-indigo-500 px-3 text-xs font-bold text-white"
                          type="submit"
                        >
                          댓글 등록
                        </button>
                      </Form>

                      <Form
                        className="grid grid-cols-2 gap-2 rounded-md border border-white/10 p-2"
                        method="post"
                        onSubmit={(event) => {
                          const input =
                            event.currentTarget.elements.namedItem("anchor_id");
                          if (input instanceof HTMLInputElement)
                            input.value = crypto.randomUUID();
                        }}
                      >
                        <input
                          name="intent"
                          type="hidden"
                          value="add_canvas_region_anchor"
                        />
                        <input
                          name="issue_id"
                          type="hidden"
                          value={selectedIssueId}
                        />
                        <input name="anchor_id" type="hidden" />
                        <input
                          name="revision_id"
                          type="hidden"
                          value={revision.id}
                        />
                        <input
                          name="page_id"
                          type="hidden"
                          value={drawingState.activePageId ?? ""}
                        />
                        <input
                          name="canvas_id"
                          type="hidden"
                          value={drawingState.activeCanvasId ?? ""}
                        />
                        {(
                          ["x_mm", "y_mm", "width_mm", "height_mm"] as const
                        ).map((name) => (
                          <label className="text-xs" key={name}>
                            {name}
                            <input
                              className="mt-1 min-h-10 w-full rounded-md border border-white/20 bg-slate-950 px-2"
                              name={name}
                              required
                              step="any"
                              type="number"
                              min={
                                name === "width_mm" || name === "height_mm"
                                  ? "0.000001"
                                  : undefined
                              }
                            />
                          </label>
                        ))}
                        <label className="col-span-2 text-xs">
                          영역 설명
                          <input
                            className="mt-1 min-h-10 w-full rounded-md border border-white/20 bg-slate-950 px-2"
                            maxLength={240}
                            name="label"
                          />
                        </label>
                        <button
                          className="col-span-2 min-h-10 rounded-md border border-white/20 px-3 text-xs font-semibold"
                          type="submit"
                        >
                          현재 canvas 영역 연결
                        </button>
                      </Form>
                    </>
                  ) : null}

                  <ol className="space-y-2" aria-label="이슈 댓글">
                    {collaborationRoom.comments
                      .filter((comment) => comment.issue_id === selectedIssueId)
                      .map((comment) => (
                        <li
                          className="rounded-md bg-white/5 p-2 text-xs"
                          key={comment.id}
                        >
                          <p className="whitespace-pre-wrap">{comment.body}</p>
                          <p className="mt-1 text-slate-500">
                            {comment.author_id.slice(0, 8)} ·{" "}
                            {comment.created_at}
                          </p>
                          {collaborationRoom.mentions.some(
                            (mention) => mention.comment_id === comment.id,
                          ) ? (
                            <p className="mt-1 text-indigo-300">
                              멘션 ·{" "}
                              {collaborationRoom.mentions
                                .filter(
                                  (mention) =>
                                    mention.comment_id === comment.id,
                                )
                                .map((mention) => mention.user_id.slice(0, 8))
                                .join(", ")}
                            </p>
                          ) : null}
                        </li>
                      ))}
                  </ol>
                  <ol className="space-y-2" aria-label="연결된 원본 객체 근거">
                    {collaborationRoom.anchors
                      .filter(
                        (anchor) =>
                          anchor.issue_id === selectedIssueId && anchor.active,
                      )
                      .map((anchor) => (
                        <li
                          className="rounded-md border border-white/10 p-2 text-xs"
                          key={anchor.id}
                        >
                          {anchor.label ||
                            (anchor.anchor_kind === "ifc_element"
                              ? "IFC 요소"
                              : "PDF 영역")}
                        </li>
                      ))}
                  </ol>
                  <ol
                    className="space-y-2"
                    aria-label="이슈에 연결된 도면 객체"
                  >
                    {revision.issueLinks
                      .filter((link) => link.issue_id === selectedIssueId)
                      .map((link) => (
                        <li
                          className="rounded-md border border-white/10 p-2 text-xs"
                          key={link.id}
                        >
                          {drawingState.objects[link.object_id]?.name ??
                            link.object_id}
                        </li>
                      ))}
                  </ol>
                  <ol className="space-y-2" aria-label="연결된 canvas 영역">
                    {collaborationRoom.canvasRegionAnchors
                      .filter((anchor) => anchor.issue_id === selectedIssueId)
                      .map((anchor) => (
                        <li
                          className="rounded-md border border-white/10 p-2 text-xs"
                          key={anchor.id}
                        >
                          {anchor.label || "영역"} · x {anchor.x_mm}, y{" "}
                          {anchor.y_mm}, {anchor.width_mm} × {anchor.height_mm}{" "}
                          mm
                        </li>
                      ))}
                  </ol>
                </>
              ) : (
                <p className="rounded-md bg-white/5 p-2 text-xs text-slate-400">
                  연결할 프로젝트 이슈가 없습니다.
                </p>
              )}
              <Link
                className="inline-flex min-h-10 items-center rounded-md border border-white/20 px-3 font-semibold hover:bg-white/10"
                to={`/projects/${projectId}/drawings/${file.id}`}
              >
                협업 이슈 열기
              </Link>
              <Link
                className="block text-xs text-indigo-300 underline underline-offset-4"
                to={`/projects/${projectId}/members`}
              >
                프로젝트 멤버 및 역할 관리
              </Link>
            </section>
          </div>
          <div
            role="tabpanel"
            aria-labelledby="drawing-panel-tab-history"
            className="min-h-0 flex-1 overflow-y-auto p-3"
            hidden={activePanel !== "history"}
            id="drawing-panel-history"
          >
            <section
              aria-label="변경 이력"
              className="space-y-3 text-sm text-slate-200"
            >
              <h2 className="font-bold text-white">변경 이력</h2>
              <p className="text-xs text-slate-400">
                저장된 변경은 추가형 작업으로 보존됩니다. 내 작업만 안전할 때
                되돌릴 수 있습니다.
              </p>
              {historyStatus ? (
                <p
                  aria-live="polite"
                  className="rounded-md bg-white/10 p-2 text-xs"
                >
                  {historyStatus}
                </p>
              ) : null}
              {effectiveRevisionStatus === "approved" &&
              ["admin", "editor", "reviewer"].includes(effectiveCapability) ? (
                <Form
                  method="post"
                  className="rounded-md border border-indigo-400/30 p-2"
                >
                  <input
                    name="intent"
                    type="hidden"
                    value="restore_approved_snapshot"
                  />
                  <input
                    name="source_revision_id"
                    type="hidden"
                    value={revision.id}
                  />
                  <input
                    id={`snapshot-request-${revision.id}`}
                    name="request_id"
                    type="hidden"
                  />
                  <p className="text-xs text-slate-300">
                    승인본은 덮어쓰지 않고 새 ID의 하위 초안으로 복원합니다.
                  </p>
                  <button
                    className="mt-2 min-h-10 rounded bg-indigo-500 px-3 text-xs font-bold text-white"
                    onClick={() => {
                      const input = document.getElementById(
                        `snapshot-request-${revision.id}`,
                      ) as HTMLInputElement | null;
                      if (input) input.value = crypto.randomUUID();
                    }}
                    type="submit"
                  >
                    새 초안으로 복원
                  </button>
                </Form>
              ) : null}
              {effectiveRevisionStatus === "draft" &&
              revision.checkpoints.length ? (
                <section
                  aria-label="체크포인트 복원"
                  className="space-y-2 rounded-md border border-white/10 p-2"
                >
                  <h3 className="text-xs font-bold">검토 체크포인트</h3>
                  {revision.checkpoints.map((checkpoint) => (
                    <button
                      className="min-h-10 w-full rounded-md border border-white/20 px-2 text-left text-xs"
                      key={checkpoint.id}
                      onClick={() => void restoreCheckpoint(checkpoint)}
                      type="button"
                    >
                      {new Date(checkpoint.createdAt).toLocaleString("ko-KR")}{" "}
                      상태로 복원
                    </button>
                  ))}
                </section>
              ) : null}
              <ol className="space-y-2" reversed>
                {(
                  activityPage?.items ??
                  drawingState.operations
                    .slice(-25)
                    .reverse()
                    .map((operation) => ({
                      id: operation.clientOperationId,
                      clientOperationId: operation.clientOperationId,
                      action: operation.type,
                      actorId: operation.actorId,
                      createdAt: operation.createdAt,
                    }))
                ).map((operation) => (
                  <li
                    className="rounded-md border border-white/10 p-2"
                    id={`history-${operation.id}`}
                    key={operation.id}
                  >
                    <p className="font-semibold">{operation.action}</p>
                    <p className="mt-1 font-mono text-[11px] text-slate-400">
                      {operation.actorId?.slice(0, 8) ?? "system"} ·{" "}
                      {operation.createdAt}
                    </p>
                    {"detail" in operation ? (
                      <>
                        <p className="mt-1 text-xs text-slate-300">
                          변경 내용 · {drawingActivityDescription(operation)}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          근거 · {drawingActivityProvenance(operation)}
                        </p>
                      </>
                    ) : null}
                    {drawingState.operations.some(
                      (candidate) =>
                        candidate.clientOperationId ===
                          ("clientOperationId" in operation
                            ? operation.clientOperationId
                            : operation.id) &&
                        candidate.actorId === currentUserId &&
                        candidate.undoable,
                    ) ? (
                      <button
                        className="mt-2 min-h-9 rounded border border-white/20 px-2 text-xs font-semibold"
                        onClick={() =>
                          void revertOperation(
                            "clientOperationId" in operation
                              ? operation.clientOperationId
                              : operation.id,
                          )
                        }
                        type="button"
                      >
                        이 작업 되돌리기
                      </button>
                    ) : null}
                  </li>
                ))}
              </ol>
              {(activityPage?.items.length ??
                drawingState.operations.length) === 0 ? (
                <p className="text-xs text-slate-400">
                  아직 저장된 작업이 없습니다.
                </p>
              ) : null}
              {activityPage?.nextCursor ? (
                <Link
                  className="inline-flex min-h-10 items-center text-xs font-semibold text-indigo-300 underline underline-offset-4"
                  to={drawingHistoryPageHref(
                    drawingDocument.id,
                    activityPage.nextCursor,
                    activityPage.items.at(-1)?.id ?? revision.id,
                  )}
                >
                  이전 이력 더 보기
                </Link>
              ) : null}
            </section>
          </div>
          <div
            role="tabpanel"
            aria-labelledby="drawing-panel-tab-structure"
            className="min-h-0 flex-1 overflow-y-auto p-3"
            hidden={activePanel !== "structure"}
            id="drawing-panel-structure"
          >
            <DrawingPagesPanel
              activeCanvasId={drawingState.activeCanvasId}
              actorId={currentUserId}
              canEdit={baseCanEdit}
              onCanvasSelect={(canvasId) =>
                documentStore.selectCanvas(canvasId)
              }
              onCommand={applyCommand}
              state={drawingState}
            />
            <div className="mt-4 border-t border-white/10 pt-4">
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
          </div>
          <div
            role="tabpanel"
            aria-labelledby="drawing-panel-tab-styles"
            className="min-h-0 flex-1 overflow-y-auto p-3 [&>section]:mt-0 [&>section]:border-t-0 [&>section]:pt-0"
            hidden={activePanel !== "styles"}
            id="drawing-panel-styles"
          >
            <DrawingStylesPanel
              actorId={currentUserId}
              canEdit={editing.canEdit}
              onCommand={applyCommand}
              state={drawingState}
            />
          </div>
          <div
            role="tabpanel"
            aria-labelledby="drawing-panel-tab-properties"
            className="min-h-0 flex-1 overflow-y-auto p-3 [&>section]:mt-0 [&>section]:border-t-0 [&>section]:pt-0"
            hidden={activePanel !== "properties"}
            id="drawing-panel-properties"
          >
            <DrawingPropertiesPanel
              actorId={currentUserId}
              canEdit={baseCanEdit}
              onCommand={applyCommand}
              state={drawingState}
            />
          </div>
          <div
            role="tabpanel"
            aria-labelledby="drawing-panel-tab-schedules"
            className="min-h-0 flex-1 overflow-y-auto p-3 [&>section]:mt-0 [&>section]:border-t-0 [&>section]:pt-0"
            hidden={activePanel !== "schedules"}
            id="drawing-panel-schedules"
          >
            <DrawingTablesPanel
              actorId={currentUserId}
              canEdit={baseCanEdit}
              evidence={measurementEvidence}
              evidenceError={measurementEvidenceError}
              hasUnconfirmedChanges={drawingState.operations.length > 0}
              lineage={measurementLineage}
              onCommand={applyCommand}
              selectedIds={transient.selectedIds}
              state={drawingState}
            />
          </div>
          <div
            role="tabpanel"
            aria-labelledby="drawing-panel-tab-blocks"
            className="min-h-0 flex-1 overflow-y-auto p-3 [&>section]:mt-0 [&>section]:border-t-0 [&>section]:pt-0"
            hidden={activePanel !== "blocks"}
            id="drawing-panel-blocks"
          >
            <DrawingBlocksPanel
              activeCanvasId={drawingState.activeCanvasId}
              activeLayerId={resolvedActiveLayerId}
              actorId={currentUserId}
              canEdit={editing.canEdit}
              layers={drawingState.layers}
              onCommand={applyCommand}
              onSelectionChange={setAuthorizedSemanticBlockSelection}
              selectedIds={transient.selectedIds.filter((id) =>
                Boolean(activeDrawingState.objects[id]),
              )}
              state={drawingState}
            />
          </div>
        </aside>

        <section
          aria-label="도면 캔버스"
          className="relative order-1 min-h-[34rem] min-w-0 bg-slate-950 xl:order-2"
        >
          <div
            className={
              surface.layout === "ifc_split"
                ? "grid h-full min-h-[34rem] xl:grid-cols-[minmax(0,1fr)_minmax(28rem,0.9fr)]"
                : "h-full min-h-[34rem]"
            }
          >
            <div className="min-h-0 min-w-0">
              {resolvedObjects.styleError ? (
                <p
                  className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-md bg-red-950 px-3 py-2 text-sm text-red-100"
                  role="alert"
                >
                  {resolvedObjects.styleError}
                </p>
              ) : null}
              {resolvedBlockInstances.error ? (
                <p
                  className="absolute left-1/2 top-16 z-10 -translate-x-1/2 rounded-md bg-red-950 px-3 py-2 text-sm text-red-100"
                  role="alert"
                >
                  {resolvedBlockInstances.error}
                </p>
              ) : null}
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
                  activeCanvasId={drawingState.activeCanvasId!}
                  activeTool={transient.activeTool as DrawingTool}
                  actorId={currentUserId}
                  awarenessStore={awarenessStoreRef.current}
                  background={background}
                  calibration={calibration}
                  calibrationId={calibrationId}
                  canEdit={editing.canEdit}
                  layerId={editing.layerId}
                  layers={Object.values(activeDrawingState.layers)}
                  blockInstances={resolvedBlockInstances.instances}
                  objects={resolvedObjects.objects}
                  onCommand={applyCommand}
                  onCursorWorldChange={(cursorWorld) => {
                    awarenessCursorRef.current = cursorWorld;
                    publishAwareness({ cursorWorld });
                  }}
                  onSelectionChange={(ids) =>
                    setAuthorizedSelection(
                      ids.filter(
                        (id) =>
                          transient.selectedIds.includes(id) ||
                          Boolean(activeDrawingState.objects[id]) ||
                          Boolean(
                            activeDrawingState.structure?.blockInstances[id],
                          ),
                      ),
                    )
                  }
                  onToolComplete={(tool) =>
                    setAuthorizedTool(transient.activeLayerId ? tool : "select")
                  }
                  onSoftLockChange={setAwarenessSoftLock}
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
              ) : previewMode ? (
                <div
                  aria-label="P2 도면 객체 미리보기"
                  className="grid h-full min-h-[34rem] place-items-center overflow-hidden bg-slate-800 p-6"
                >
                  <div className="relative aspect-[1.414/1] w-full max-w-5xl overflow-hidden rounded-sm bg-white shadow-2xl ring-1 ring-black/20">
                    <svg
                      aria-label="A-101 평면 도면"
                      className="size-full"
                      role="img"
                      viewBox="0 0 1000 707"
                    >
                      <defs>
                        <pattern
                          height="20"
                          id="preview-grid-small"
                          patternUnits="userSpaceOnUse"
                          width="20"
                        >
                          <path
                            d="M 20 0 L 0 0 0 20"
                            fill="none"
                            stroke="#e2e8f0"
                            strokeWidth="0.7"
                          />
                        </pattern>
                        <pattern
                          height="100"
                          id="preview-grid"
                          patternUnits="userSpaceOnUse"
                          width="100"
                        >
                          <rect
                            fill="url(#preview-grid-small)"
                            height="100"
                            width="100"
                          />
                          <path
                            d="M 100 0 L 0 0 0 100"
                            fill="none"
                            stroke="#cbd5e1"
                            strokeWidth="1"
                          />
                        </pattern>
                      </defs>
                      <rect
                        fill="url(#preview-grid)"
                        height="707"
                        width="1000"
                      />
                      <g fill="none" stroke="#0f172a" strokeWidth="7">
                        <path d="M120 105 H880 V585 H120 Z" />
                        <path d="M430 105 V345 H120 M430 345 H880 M650 345 V585" />
                      </g>
                      <g fill="#f8fafc" stroke="#334155" strokeWidth="2">
                        <rect height="145" width="190" x="470" y="145" />
                        <rect height="120" width="150" x="705" y="405" />
                      </g>
                      <g fill="none" stroke="#2563eb" strokeWidth="4">
                        <path d="M180 505 L350 430 L520 485 L760 410" />
                        <path d="M742 400 L760 410 L748 426" />
                      </g>
                      <g fill="none" stroke="#ef4444" strokeWidth="3">
                        <circle cx="730" cy="220" r="58" />
                        <path d="M690 180 L770 260 M770 180 L690 260" />
                      </g>
                      <g fill="none" stroke="#64748b" strokeWidth="2">
                        <path d="M170 620 H820 M170 610 V630 M820 610 V630" />
                      </g>
                      <g fill="#0f172a" fontFamily="sans-serif">
                        <text fontSize="18" fontWeight="700" x="145" y="85">
                          A-101 1층 평면도 · P2 VECTOR OVERLAY
                        </text>
                        <text fontSize="16" x="500" y="220">
                          CORE
                        </text>
                        <text
                          fill="#ef4444"
                          fontSize="14"
                          fontWeight="700"
                          x="680"
                          y="300"
                        >
                          창호 간섭 확인
                        </text>
                        <text
                          fill="#475569"
                          fontSize="14"
                          textAnchor="middle"
                          x="495"
                          y="650"
                        >
                          6,500 mm
                        </text>
                      </g>
                    </svg>
                    <div className="absolute left-4 top-4 rounded-md bg-slate-950/85 px-3 py-2 text-xs font-semibold text-white shadow-lg">
                      8 객체 · 3 레이어 · 2 블록 · 1 이슈 연결
                    </div>
                    <div className="absolute bottom-4 right-4 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-900 shadow-lg">
                      PDF 원본은 잠금 · 벡터 오버레이 편집
                    </div>
                  </div>
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
            className="absolute bottom-4 left-1/2 flex max-w-[calc(100%-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-xl border border-white/15 bg-slate-900/95 p-1.5 shadow-xl backdrop-blur"
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
                <div className="relative">
                  <Button
                    aria-expanded={semanticMenuOpen}
                    aria-haspopup="menu"
                    aria-label="건축 객체"
                    onClick={() => setSemanticMenuOpen((open) => !open)}
                    ref={semanticMenuTriggerRef}
                    size="icon"
                    variant={
                      [
                        "wall",
                        "opening",
                        "space",
                        "area",
                        "grid",
                        "arc",
                      ].includes(transient.activeTool)
                        ? "secondary"
                        : "ghost"
                    }
                  >
                    <Building2 className="size-4" />
                  </Button>
                  {semanticMenuOpen ? (
                    <div
                      aria-label="건축 객체 도구"
                      className="absolute bottom-full left-1/2 mb-2 grid w-40 -translate-x-1/2 gap-1 rounded-lg border border-white/15 bg-slate-900 p-1.5 shadow-2xl"
                      role="menu"
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setSemanticMenuOpen(false);
                          semanticMenuTriggerRef.current?.focus();
                          return;
                        }
                        if (
                          event.key !== "ArrowDown" &&
                          event.key !== "ArrowUp"
                        )
                          return;
                        event.preventDefault();
                        const items = Array.from(
                          event.currentTarget.querySelectorAll<HTMLButtonElement>(
                            '[role="menuitem"]',
                          ),
                        );
                        const index = items.indexOf(
                          document.activeElement as HTMLButtonElement,
                        );
                        const offset = event.key === "ArrowDown" ? 1 : -1;
                        items[
                          (index + offset + items.length) % items.length
                        ]?.focus();
                      }}
                    >
                      {(
                        [
                          ["wall", "벽 도구"],
                          ["opening", "개구부 도구"],
                          ["space", "공간 도구"],
                          ["area", "영역 도구"],
                          ["grid", "그리드 도구"],
                          ["arc", "호 도구"],
                        ] as const
                      ).map(([tool, label], index) => (
                        <button
                          aria-label={label}
                          autoFocus={index === 0}
                          className="min-h-10 rounded-md px-3 text-left text-sm hover:bg-white/10 focus:bg-white/10"
                          key={tool}
                          onClick={() => {
                            setAuthorizedTool(tool);
                            setSemanticMenuOpen(false);
                            semanticMenuTriggerRef.current?.focus();
                          }}
                          role="menuitem"
                          type="button"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
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
          className="order-3 max-h-[28rem] overflow-y-auto border-t border-white/10 bg-slate-900 p-3 xl:max-h-none xl:border-l xl:border-t-0"
        >
          {collaborationEditNotice ? (
            <p
              aria-label="공동 편집 작업 차단 안내"
              className="mb-3 max-w-full break-words rounded-md border border-amber-400/30 bg-amber-950/60 p-2 text-xs leading-5 text-amber-100"
              role="status"
            >
              {collaborationEditNotice}
            </p>
          ) : null}
          <DrawingCollaborationLockStatus
            objectNames={Object.fromEntries(
              [
                ...Object.values(activeDrawingState.objects),
                ...Object.values(
                  activeDrawingState.structure?.blockInstances ?? {},
                ),
              ].map((entity) => [entity.id, entity.name]),
            )}
            store={awarenessStoreRef.current}
          />
          <DrawingInspector
            awarenessStore={awarenessStoreRef.current}
            actorId={currentUserId}
            canEdit={
              editing.canEdit &&
              (blockMutationAdapter.selectionKind !== "block_instance" ||
                blockMutationAdapter.canMutate)
            }
            canLinkIssues={drawingIssueLinkReady({
              capability: effectiveCapability,
              objectIds: Object.keys(activeDrawingState.objects),
              saveStatus,
              selectedIds: transient.selectedIds,
              status: effectiveRevisionStatus,
            })}
            evidence={measurementEvidence}
            evidenceError={measurementEvidenceError}
            hasUnconfirmedChanges={drawingState.operations.length > 0}
            lineage={measurementLineage}
            issueLinks={revision.issueLinks}
            issues={revision.issues}
            onCommand={applyCommand}
            onSoftLockChange={setAwarenessSoftLock}
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
