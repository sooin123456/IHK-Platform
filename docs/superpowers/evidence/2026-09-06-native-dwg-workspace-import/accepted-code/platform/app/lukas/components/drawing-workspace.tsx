import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
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
  PanelLeft,
  PanelRight,
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
import {
  Form,
  Link,
  useBlocker,
  useFetcher,
  useLocation,
  useNavigation,
  useRevalidator,
  useSearchParams,
} from "react-router";
import * as Y from "yjs";

import { Button } from "~/core/components/ui/button";
import { DrawingDocumentTitle } from "~/lukas/components/drawing-document-title";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/core/components/ui/dropdown-menu";
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
  redoDrawingCommandUnit,
  rebaseDrawingCommandForProjection,
  revertDrawingOperation,
  undoDrawingCommandUnit,
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
import { drawingDimensionContextForCanvas } from "~/lukas/lib/drawing-layout";
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
  sendDrawingConflictDiscard,
  sendDrawingOperation,
  type DrawingOutbox,
  type DrawingOutboxChangeKind,
  type DrawingPersistenceSnapshot,
} from "~/lukas/lib/drawing-outbox";
import {
  createDrawingAccessTokenResolver,
  createDrawingCollaborationCommandBridge,
  drawingCollaborationAuthority,
  drawingCollaborationLifecycleKey,
  drawingCollaborationProviderReady,
  drawingCollaborationRecentOutcomesKey,
  initializeDrawingCollaborationDocument,
  openDrawingCollaborationLocalAttempt,
  openDrawingCollaborationConnection,
  reconcileDrawingCollaborationDraft,
  synchronizeDrawingCollaborationCheckpoint,
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
  DrawingWorkspaceSourceBundle,
  DrawingWorkspaceSourceCatalogItem,
  DrawingWorkspacePdfSourceDescriptor,
  DrawingWorkspaceSourceAttachCandidate,
} from "~/lukas/lib/drawing-workspace.server";
import {
  drawingWorkspaceModeChangeForPanel,
  drawingWorkspaceModeDefinition,
  drawingWorkspaceModes,
  drawingWorkspacePanels,
  resolveDrawingWorkspaceModeKey,
  resolveDrawingWorkspacePanelKey,
  type DrawingInspectorMode,
  type DrawingWorkspaceMode,
  type DrawingWorkspacePanel,
} from "~/lukas/lib/drawing-workspace-modes";
import type { PreparedDrawingDxfProjectImport } from "~/lukas/lib/drawing-dxf-source.server";
import { DrawingNativeDwgImport } from "./drawing-native-dwg-import";
import type { PreparedNativeDrawingDwgProjectImport } from "~/lukas/lib/drawing-native-dwg-import-source.server";
import {
  applyNativeDrawingDwgImportOperations,
  createNativeDrawingDwgImportSendGate,
  DrawingNativeDwgImportClientError,
  prepareNativeDrawingDwgImportOverHttp,
} from "~/lukas/lib/drawing-native-dwg-import-client";
import {
  applyDrawingDxfImportOperations,
  createDrawingDxfImportSendGate,
  DrawingDxfImportClientError,
  prepareDrawingDxfImportOverHttp,
} from "~/lukas/lib/drawing-dxf-import-client";
import type { DrawingWorkspaceLoaderCollaborationBootstrap } from "~/lukas/lib/drawing-workspace-loader-payload";
import {
  drawingMeasurementEvidenceResourceReady,
  useDeferredDrawingMeasurementEvidenceResource,
} from "~/lukas/lib/drawing-measurement-evidence-hydration";
import type { DrawingObjectQuantityLineageRow } from "~/lukas/lib/drawing-quantity-lineage.server";
import type { DrawingRevisionShare } from "~/lukas/lib/drawing-share.server";
import type { DrawingEstimateSummary } from "~/lukas/lib/drawing-estimate";
import {
  drawingWorkspaceDxfUploadPath,
  drawingWorkspaceDwgUploadPath,
  drawingWorkspacePdfUploadPath,
} from "~/lukas/lib/drawing-entry";
import type {
  DrawingMeasurementEvidenceError,
  DrawingMeasurementEvidenceLineage,
  DrawingServerMeasurementEvidence,
} from "~/lukas/lib/drawing-semantic-schedules";
import { drawingObjectSupportsMeasurement } from "~/lukas/lib/drawing-measurements";
import type { DrawingActivityItem } from "~/lukas/lib/drawing-history.server";
import { reconcileDrawingIssueSelection } from "~/lukas/lib/drawing-pagination";
import type {
  DrawingRevisionReviewItem,
  RelinkDrawingAnchorInput,
} from "~/lukas/lib/drawing-revision.server";
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
  Point,
} from "~/lukas/lib/drawing-workspace.types";
import {
  drawingRevisionDecisionFields,
  drawingIssueLinkReady,
  drawingIfcFocusTarget,
  drawingIfcRemoteHighlightGlobalIds,
  drawingWorkspaceEvidenceFocusBounds,
  drawingWorkspaceEvidenceFocusKey,
  drawingWorkspaceLineageFocusObjectId,
  drawingWorkspaceObjectFocusViewport,
  drawingWorkspaceCanComment,
  drawingWorkspaceCanRestoreApprovedSnapshot,
  drawingWorkspaceReviewControls,
  drawingWorkspaceSurface,
  loadDrawingClientModule,
  type DrawingClientModuleState,
  type DrawingWorkspaceViewMode,
} from "~/lukas/lib/drawing-workspace-view";
import { drawingWorkspaceOperationLocation } from "~/lukas/lib/drawing-workspace-paths";
import {
  canMutateDrawingObjectSources,
  createDrawingIfcSourceIndex,
  linkDrawingIfcSourceCommand,
  linkDrawingPdfRegionSourceCommand,
  matchDrawingObjectsForIfcSelection,
  unlinkDrawingObjectSourceCommand,
} from "~/lukas/lib/drawing-source-links";
import {
  worldBoundsToPdfNormalizedRegion,
  type DrawingPdfPageTransform,
} from "~/lukas/lib/drawing-pdf-transform";
import { geometryBounds } from "~/lukas/lib/drawing-geometry";
import { resolveDrawingPdfRasterSource } from "~/lukas/lib/drawing-pdf-raster-identity";
import { adaptIfcRenderBundleDescriptor } from "~/lukas/lib/ifc-render-descriptor";
import {
  useDrawingWorkspaceRealtime,
  type DrawingWorkspaceRealtimeAdapter,
} from "~/lukas/lib/drawing-workspace-realtime";
import {
  drawingAuthoritativeSnapshotKey,
  drawingLocalEditReady,
  scheduleDrawingLocalInitialization,
  scheduleDrawingSourceReadyConnection,
  drawingWorkspaceFirstPaintReady,
  startDrawingWorkspaceStage,
} from "~/lukas/lib/drawing-runtime";
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
import type { DrawingExportDialogProps } from "./drawing-export-dialog";
import { DrawingInspector } from "./drawing-inspector";
import { DrawingEstimateResultRail } from "./drawing-estimate-result-rail";
import { DrawingBlocksPanel, nativeDrawingSymbolImportReady } from "./drawing-blocks-panel";
import { DrawingLayersPanel } from "./drawing-layers-panel";
import { DrawingPagesPanel } from "./drawing-pages-panel";
import { DrawingPropertiesPanel } from "./drawing-properties-panel";
import { DrawingStylesPanel } from "./drawing-styles-panel";
import { DrawingScaleControl } from "./drawing-scale-control";
import { DrawingTablesPanel } from "./drawing-tables-panel";
import DrawingShareControls from "./drawing-share-controls";
import {
  DrawingCollaborationConnectionStatus,
  DrawingCollaborationLockStatus,
  DrawingCollaborationParticipants,
  useDrawingAwarenessLocks,
  useDrawingAwarenessPeers,
} from "./drawing-collaboration-presence";
import type {
  IfcElementSelection,
  IfcFocusRequest,
} from "./ifc-property-browser.client";

const drawingBlockRenderCache = createDrawingBlockRenderCache();
import type {
  DrawingCanvasBackground,
  DrawingCanvasHandle,
  DrawingCanvasRegionAnnotation,
  DrawingCalibrationCapture,
  DrawingPdfCompareState,
  DrawingTool,
  DimensionCalibrationEvidence,
} from "./drawing-canvas.client";

type CanvasModule = typeof import("./drawing-canvas.client");
type CanvasComponent = CanvasModule["DrawingCanvas"];
type IfcModule = typeof import("./ifc-property-browser.client");
type IfcComponent = IfcModule["default"];
const emptyDrawingRevisionReview: DrawingRevisionReviewItem[] = [];

const LazyDrawingExportDialog = lazy(() =>
  import("./drawing-export-dialog").then(({ DrawingExportDialog }) => ({
    default: DrawingExportDialog,
  })),
);

export function drawingExportCheckpointReady({
  authoritativeCheckpointKey,
  installedCheckpointKey,
  operationSequence,
  revalidationPending,
}: {
  authoritativeCheckpointKey: string;
  installedCheckpointKey: string | null;
  operationSequence: number | null;
  revalidationPending: boolean;
}) {
  return (
    operationSequence !== null &&
    !revalidationPending &&
    installedCheckpointKey === authoritativeCheckpointKey
  );
}

export function DrawingExportLauncher(props: DrawingExportDialogProps) {
  const [requested, setRequested] = useState(false);
  const [open, setOpen] = useState(false);
  const auditReady =
    !props.auditRequired ||
    (props.outboxReady &&
      props.saveStatus === "저장됨" &&
      props.operationCheckpoint !== null &&
      props.checkpointSha256 !== null);

  return (
    <>
      <Button
        disabled={!auditReady}
        onClick={() => {
          setRequested(true);
          setOpen(true);
        }}
        type="button"
        title={
          auditReady
            ? undefined
            : "로컬 변경을 모두 저장한 뒤 내보낼 수 있습니다."
        }
        variant="secondary"
      >
        내보내기
      </Button>
      {requested ? (
        <Suspense fallback={null}>
          <LazyDrawingExportDialog
            {...props}
            hideTrigger
            onOpenChange={setOpen}
            open={open}
          />
        </Suspense>
      ) : null}
    </>
  );
}

export {
  drawingWorkspaceModeChangeForPanel,
  drawingWorkspaceModeDefinition,
  resolveDrawingWorkspaceModeKey,
  resolveDrawingWorkspacePanelKey,
};

type WorkspaceLayer = NonNullable<
  DrawingWorkspace["document"]
>["revision"]["layers"][number];

function DrawingWorkspaceTabPanel({
  active,
  mounted,
  ...props
}: ComponentProps<"div"> & { active: boolean; mounted: boolean }) {
  return mounted ? <div {...props} hidden={!active} /> : null;
}

export function resolveDrawingInspectorModeKey(
  activeMode: DrawingInspectorMode,
  key: string,
): DrawingInspectorMode | null {
  if (key === "Home") return "result";
  if (key === "End") return "object";
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  return activeMode === "result" ? "object" : "result";
}

export function persistDrawingRecordedOperation(
  bridge: {
    applyRecorded(
      applied: AppliedDrawingCommand,
    ): Promise<{ state: DrawingDocumentState }>;
  },
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
  return `${detailType}${
    typeof detail.itemCount === "number" ? ` · ${detail.itemCount}개 항목` : ""
  }`.slice(0, 160);
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
  localMutationCount: number;
  saveStatus: ReturnType<typeof drawingSaveStatus>;
}) {
  return (
    input.outboxReady &&
    !input.reviewPreparing &&
    input.pending === 0 &&
    !input.conflicted &&
    input.volatileCount === 0 &&
    !input.persistenceFailed &&
    input.localMutationCount === 0 &&
    input.saveStatus === "저장됨"
  );
}

export function drawingWorkspaceHasUndurableWork(input: {
  localMutationCount: number;
  volatileCount: number;
}) {
  return input.localMutationCount > 0 || input.volatileCount > 0;
}

/** Keeps in-route URL state replaceable while protecting unsaved work on exit. */
export function drawingWorkspaceShouldBlockNavigation(input: {
  activeRevisionId: string;
  currentPathname: string;
  currentSearch: string;
  hasUndurableWork: boolean;
  nextPathname: string;
  nextSearch: string;
}) {
  if (!input.hasUndurableWork) return false;
  if (input.currentPathname !== input.nextPathname) return true;
  const currentRevisionId =
    new URLSearchParams(input.currentSearch).get("revision") ??
    input.activeRevisionId;
  const nextRevisionId =
    new URLSearchParams(input.nextSearch).get("revision") ??
    input.activeRevisionId;
  return currentRevisionId !== nextRevisionId;
}

/** Merges rapid query-only interactions with an in-flight navigation. */
export function resolveDrawingWorkspaceSearchParams(input: {
  committedSearch: string;
  currentPathname: string;
  pendingLocation: { pathname: string; search: string } | null;
}) {
  return new URLSearchParams(
    input.pendingLocation?.pathname === input.currentPathname
      ? input.pendingLocation.search
      : input.committedSearch,
  );
}

export function drawingWorkspaceLineageSearchSyncReady(input: {
  authoritativeObjectExists: boolean;
  hasCollaborationBootstrap: boolean;
  saveStatus: ReturnType<typeof drawingSaveStatus>;
}) {
  return input.hasCollaborationBootstrap
    ? input.authoritativeObjectExists
    : input.saveStatus === "저장됨";
}

/** Includes the single selection whose URL navigation has not committed yet. */
export function resolveDrawingWorkspaceMutationLineageObjectId(
  requestedObjectId: string | null,
  selectedIds: readonly string[],
  objectExists: (objectId: string) => boolean,
) {
  const selectedObjectId = selectedIds.length === 1 ? selectedIds[0] : null;
  if (selectedObjectId && !objectExists(selectedObjectId))
    return selectedObjectId;
  if (requestedObjectId && !objectExists(requestedObjectId))
    return requestedObjectId;
  return null;
}

export async function prepareDrawingWorkspaceReview({
  drainCommands,
  freeze,
  persistence,
  flush,
  outbox,
}: Parameters<typeof prepareDrawingReview>[0] & {
  drainCommands: () => Promise<void>;
}) {
  let frozen = false;
  const freezeOnce = () => {
    if (frozen) return;
    frozen = true;
    freeze();
  };
  freezeOnce();
  await drainCommands();
  return prepareDrawingReview({
    freeze: freezeOnce,
    persistence,
    flush,
    outbox,
  });
}

/** Reloads the canonical checkpoint even when deleting stale local Yjs data fails. */
export async function finalizeDrawingConflictReset({
  disposeLocalDraft,
  reload,
}: {
  disposeLocalDraft: () => Promise<void>;
  reload: () => void;
}) {
  try {
    await disposeLocalDraft();
  } catch {
    // The authoritative DB disposition and outbox settlement already won.
  } finally {
    reload();
  }
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

export function drawingWorkspaceShortcutEnabled(
  shortcut: DrawingWorkspaceShortcut,
  reviewFrozen: boolean,
) {
  return !reviewFrozen || shortcut.type === "copy";
}

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

/** Resolves the two canvas-first dock shortcuts without stealing input keys. */
export function resolveDrawingWorkspaceDockShortcut(event: {
  altKey?: boolean;
  ctrlKey?: boolean;
  key: string;
  metaKey?: boolean;
  shiftKey?: boolean;
  target: EventTarget | null;
}): "left" | "inspector" | null {
  if (drawingShortcutTargetIsEditable(event.target)) return null;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
    return null;
  if (event.key === "[") return "left";
  if (event.key === "]") return "inspector";
  return null;
}

/** Keeps split panes usable on compact desktops without hiding object lineage. */
export function resolveDrawingWorkspaceSplitDockState(input: {
  enteringSplit: boolean;
  inspectorOpen: boolean;
  leftDockOpen: boolean;
  viewportWidth: number;
}) {
  return {
    leftDockOpen:
      input.enteringSplit && input.viewportWidth < 1440
        ? false
        : input.leftDockOpen,
    inspectorOpen: input.inspectorOpen,
  };
}

export type DrawingWorkspaceLineageStage =
  | "source"
  | "object"
  | "issue"
  | "approval"
  | "quantity"
  | "material";

/** Keeps the selected object's next missing business link deterministic. */
export function drawingWorkspaceLineageProgress(input: {
  hasApproval: boolean;
  hasIssue: boolean;
  hasMaterial: boolean;
  hasObject: boolean;
  hasQuantity: boolean;
  hasSource: boolean;
}): {
  completed: number;
  next: DrawingWorkspaceLineageStage | null;
  total: number;
} {
  const stages: Array<[DrawingWorkspaceLineageStage, boolean]> = [
    ["source", input.hasSource],
    ["object", input.hasObject],
    ["issue", input.hasIssue],
    ["approval", input.hasApproval],
    ["quantity", input.hasQuantity],
    ["material", input.hasMaterial],
  ];
  return {
    completed: stages.filter(([, linked]) => linked).length,
    next: input.hasObject
      ? (stages.find(([, linked]) => !linked)?.[0] ?? null)
      : "object",
    total: stages.length,
  };
}

const drawingWorkspaceLineageSearchParams = [
  "object",
  "revision",
  "boq",
  "line",
  "evidence",
  "quantityCursor",
] as const;

/** Applies an authorized deep-link focus once and clears a deleted object's URL scope. */
export function resolveDrawingWorkspaceLineageFocusTransition(input: {
  appliedFocusKey: string | null;
  focusKey: string | null;
  focusObjectId: string | null;
  requestedObjectExists: boolean;
  requestedObjectId: string | null;
  selectedIds: readonly string[];
}): {
  appliedFocusKey: string | null;
  clearSearchParams:
    | readonly (typeof drawingWorkspaceLineageSearchParams)[number][]
    | null;
  selectedIds: string[] | null;
} {
  if (input.requestedObjectId && !input.requestedObjectExists)
    return {
      appliedFocusKey: null,
      clearSearchParams: drawingWorkspaceLineageSearchParams,
      selectedIds: null,
    };
  if (!input.focusKey || !input.focusObjectId)
    return {
      appliedFocusKey: null,
      clearSearchParams: null,
      selectedIds: null,
    };
  if (input.appliedFocusKey === input.focusKey)
    return {
      appliedFocusKey: input.appliedFocusKey,
      clearSearchParams: null,
      selectedIds: null,
    };
  return {
    appliedFocusKey: input.focusKey,
    clearSearchParams: null,
    selectedIds: [input.focusObjectId],
  };
}

/** Restores an authorized URL focus only when a capability transition sanitizes it. */
export function resolveDrawingWorkspaceAuthorizedSelectionSync(input: {
  focusObjectExists: boolean;
  focusObjectId: string | null;
  inputInvalidated: boolean;
  selectedIds: readonly string[];
  transientSelectedIds: readonly string[];
}) {
  if (
    input.inputInvalidated &&
    input.focusObjectId &&
    input.focusObjectExists &&
    input.selectedIds.length === 1 &&
    input.selectedIds[0] === input.focusObjectId
  )
    return [input.focusObjectId];
  const next = [...input.transientSelectedIds];
  return input.selectedIds.length === next.length &&
    input.selectedIds.every((id, index) => id === next[index])
    ? null
    : next;
}

/** Uses the loader state during a checkpoint swap, then the installed editor state. */
export function resolveDrawingWorkspaceRequestedObjectExists(input: {
  authoritativeCheckpointKey: string;
  authoritativeObjectExists: boolean;
  currentObjectExists: boolean;
  installedCheckpointKey: string | null;
}) {
  return input.installedCheckpointKey === input.authoritativeCheckpointKey
    ? input.currentObjectExists
    : input.authoritativeObjectExists;
}

/** Clears stale URL authority before an acknowledged tombstone can revalidate. */
export function drawingWorkspaceLineageClearReady(input: {
  authoritativeCheckpointKey: string;
  currentObjectExists: boolean;
  installedCheckpointKey: string | null;
  requestedObjectId: string | null;
}) {
  return Boolean(
    input.requestedObjectId &&
      input.installedCheckpointKey === input.authoritativeCheckpointKey &&
      !input.currentObjectExists,
  );
}

/** Mirrors the loader's object → layer → canvas ancestry for URL authority. */
export function drawingWorkspaceStateHasFocusableObject(
  state: Pick<DrawingDocumentState, "layers" | "objects" | "structure">,
  objectId: string | null,
) {
  if (!objectId) return false;
  if (state.structure) {
    const object = state.structure.objects[objectId];
    const layer = object ? state.structure.layers[object.layerId] : null;
    return Boolean(layer?.canvasId && state.structure.canvases[layer.canvasId]);
  }
  const object = state.objects[objectId];
  return Boolean(object && state.layers[object.layerId]);
}

const drawingWorkspaceLineageNextAction: Record<
  DrawingWorkspaceLineageStage,
  { description: string; href: string; label: string; title: string }
> = {
  source: {
    title: "다음 작업 · 원본 근거 연결",
    description: "PDF 영역 또는 IFC 요소를 이 객체의 변경 근거로 연결하세요.",
    href: "#drawing-inspector-source",
    label: "원본 근거 연결로 이동",
  },
  object: {
    title: "다음 작업 · 객체 선택",
    description: "캔버스에서 업무 계보를 확인할 도면 객체를 선택하세요.",
    href: "#drawing-split-panel-2d",
    label: "캔버스로 이동",
  },
  issue: {
    title: "다음 작업 · 검토 이슈 연결",
    description: "변경 사유와 담당자가 남도록 기존 이슈를 연결하세요.",
    href: "#drawing-inspector-issues-title",
    label: "이슈 연결로 이동",
  },
  approval: {
    title: "다음 작업 · 검토 및 승인",
    description:
      "저장된 개정을 검토 요청하고 역할에 따라 승인 결정을 남기세요.",
    href: "#drawing-review-controls",
    label: "검토 제어로 이동",
  },
  quantity: {
    title: "다음 작업 · 물량·금액 연결",
    description: "승인된 객체의 확정 수량을 만들고 BOQ 내역에 연결하세요.",
    href: "#drawing-quantity-title",
    label: "수량 계보로 이동",
  },
  material: {
    title: "다음 작업 · 자재 인계",
    description:
      "연결된 BOQ 행에서 자재 인계를 실행해 후속 업무 계보를 시작하세요.",
    href: "#drawing-quantity-title",
    label: "BOQ·자재 계보로 이동",
  },
};

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

export function drawingStorageFailureDetail(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { message?: unknown; name?: unknown };
  const normalize = (value: unknown) =>
    typeof value === "string"
      ? value.trim().replace(/\s+/g, " ") || null
      : null;
  const name = normalize(candidate.name);
  const message = normalize(candidate.message);
  if (!name && !message) return null;
  const detail =
    name && name !== "Error" && message
      ? `${name}: ${message}`
      : (message ?? name);
  return detail?.slice(0, 240) ?? null;
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
  hasLocalOperations,
  lifecycleKey,
  previousLifecycleKey,
  recoveredState,
}: {
  documentStore: DrawingDocumentStore;
  hasLocalOperations: boolean;
  lifecycleKey: string;
  previousLifecycleKey: string | null;
  recoveredState: DrawingDocumentState;
}) {
  if (previousLifecycleKey === lifecycleKey) return previousLifecycleKey;
  if (previousLifecycleKey !== null || hasLocalOperations)
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
  onCommand: (command: DrawingCommand) => boolean;
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
      if (
        !onCommand(
          deleteDrawingBlockInstancesCommand(state, actorId, selectedIds),
        )
      )
        return false;
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
      if (!onCommand(command)) return false;
      onSelectionChange(
        command.actions.flatMap((action) =>
          action.kind === "put_block_instance" ? [action.entity.id] : [],
        ),
      );
      return true;
    },
    moveSelection(delta: { x: number; y: number }) {
      if (!canMutate) return false;
      if (
        !onCommand(
          moveDrawingBlockInstancesCommand(state, actorId, selectedIds, delta),
        )
      )
        return false;
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
    reviewFrozen?: boolean;
    selectionHasRemoteLock?: boolean;
    selectionKind: ReturnType<typeof drawingSelectionEntityKind>;
  },
) {
  if (commandId === "select" || commandId === "pan") return true;
  if (commandId === "zoom_to_fit") return true;
  if (input.reviewFrozen) return false;
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

export function drawingStateFromRevision(
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
      pages: p2Pages.map(({ id, revisionId, name, sortOrder, version }) => ({
        id,
        revisionId,
        name,
        sortOrder,
        version,
      })),
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
  bootstrap: DrawingWorkspaceLoaderCollaborationBootstrap,
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

type DrawingQuantityLineage = {
  rows: DrawingObjectQuantityLineageRow[];
  nextCursor: string | null;
};

type DrawingQuantityLineageResource = {
  objectId: string;
  quantityLineage: DrawingQuantityLineage;
};

type CanvasRegionAnchorDraft = {
  anchorId: string;
  boundaryKey: string;
  canvasId: string;
  height: number;
  issueId: string;
  pageId: string;
  revisionId: string;
  width: number;
  x: number;
  y: number;
};

export function drawingCanvasRegionPickerBoundaryKey(input: {
  capability: DrawingWorkspaceCapability;
  canvasId: string | null;
  issueId: string;
  pageId: string | null;
  revisionId: string;
}) {
  const values = [
    input.capability,
    input.issueId,
    input.revisionId,
    input.pageId,
    input.canvasId,
  ];
  return values.every((value): value is string => Boolean(value))
    ? values.join(":")
    : null;
}

export function drawingCanvasRegionPickerIsArmed(input: {
  armedBoundaryKey: string | null;
  canArm: boolean;
  currentBoundaryKey: string | null;
}) {
  return Boolean(
    input.canArm &&
      input.currentBoundaryKey &&
      input.armedBoundaryKey === input.currentBoundaryKey,
  );
}

function formatCanvasRegionCoordinate(value: number) {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "";
}

export function resolveDrawingQuantityLineageSelection({
  fetched,
  initial,
  initialObjectId,
  selectedObjectId,
}: {
  fetched: DrawingQuantityLineageResource | null | undefined;
  initial: DrawingQuantityLineage | null | undefined;
  initialObjectId: string | null | undefined;
  selectedObjectId: string | null;
}) {
  if (!selectedObjectId) return null;
  if (initialObjectId === selectedObjectId) return initial ?? null;
  return fetched?.objectId === selectedObjectId
    ? fetched.quantityLineage
    : null;
}

export function drawingVisibleCanvasRegionAnnotations({
  anchors,
  canvasId,
  issues,
  pageId,
  revisionId,
  selectedIssueId,
}: {
  anchors: readonly DrawingCanvasRegionAnchorRow[];
  canvasId: string | null;
  issues: readonly { id: string; title: string }[];
  pageId: string | null;
  revisionId: string;
  selectedIssueId: string | null;
}): DrawingCanvasRegionAnnotation[] {
  const issueTitles = new Map(issues.map((issue) => [issue.id, issue.title]));
  return anchors
    .filter(
      (anchor) =>
        anchor.revision_id === revisionId &&
        anchor.page_id === pageId &&
        anchor.canvas_id === canvasId,
    )
    .map((anchor) => ({
      id: anchor.id,
      issueId: anchor.issue_id,
      label: anchor.label || issueTitles.get(anchor.issue_id) || "이슈 영역",
      x: anchor.x_mm,
      y: anchor.y_mm,
      width: anchor.width_mm,
      height: anchor.height_mm,
      selected: anchor.issue_id === selectedIssueId,
    }));
}

export function transitionDrawingWorkspaceIssueSelection(
  current: {
    consumedCreatedIssueId: string | null;
    selectedIssueId: string;
  },
  input: {
    createdIssueId: string | null;
    issues: Array<{ id: string }>;
  },
) {
  const createdIssueToSelect =
    input.createdIssueId &&
    input.createdIssueId !== current.consumedCreatedIssueId &&
    input.issues.some((issue) => issue.id === input.createdIssueId)
      ? input.createdIssueId
      : null;
  const next = {
    consumedCreatedIssueId:
      createdIssueToSelect ?? current.consumedCreatedIssueId,
    selectedIssueId: createdIssueToSelect
      ? createdIssueToSelect
      : (reconcileDrawingIssueSelection(
          input.issues,
          current.selectedIssueId || null,
          null,
          null,
        ) ?? ""),
  };
  return next.consumedCreatedIssueId === current.consumedCreatedIssueId &&
    next.selectedIssueId === current.selectedIssueId
    ? current
    : next;
}

type Props = {
  actionError?: string | null;
  activityPage?: { items: DrawingActivityItem[]; nextCursor: string | null };
  capability: DrawingWorkspaceCapability;
  collaborationEnabled?: boolean;
  createdIssueId?: string | null;
  currentUserId: string;
  drawingShares?: DrawingRevisionShare[];
  estimateOptions?: Array<{
    id: string;
    title: string;
    versionNo: number;
    priceBookName: string;
  }>;
  estimateSummary?: DrawingEstimateSummary;
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
  revisionRelinkResult?: {
    previousAnchorId: string;
    newAnchorId: string;
  } | null;
  revisionReview?: DrawingRevisionReviewItem[];
  revisionReviewNextHref?: string | null;
  revisionReviewPreviousHref?: string | null;
  projectId: string;
  previewMode?: boolean;
  workspaceNotice?: ReactNode;
  realtimeAdapter?: DrawingWorkspaceRealtimeAdapter;
  previewHarness?: {
    onInvalidate?: () => void;
    onSoftLockChange?: (entityId: string | null) => void;
    onStateChange?: (snapshot: {
      activeCanvasId: string | null;
      layers: DrawingDocumentState["layers"];
      objects: DrawingDocumentState["objects"];
      sources: NonNullable<DrawingDocumentState["structure"]>["sources"];
      operationIds: string[];
      redoIds: string[];
      selectedIds: string[];
      undoIds: string[];
    }) => void;
    p5IfcTest?: boolean;
    p5PdfTest?: boolean;
    verticalTest?: boolean;
    onIfcViewerDispose?: (evidence: {
      phase: "disposed";
      contextLossRequested: true;
      viewerInstance: string | undefined;
    }) => void;
  };
  collaborationBootstrap?: DrawingWorkspaceLoaderCollaborationBootstrap;
  collaborationConnectionFactory?: typeof openDrawingCollaborationConnection;
  collaborationPersistenceFactory?: typeof openDrawingYjsPersistence;
  measurementEvidence?: DrawingServerMeasurementEvidence | null;
  measurementEvidenceError?: DrawingMeasurementEvidenceError | null;
  measurementEvidenceUrl?: string | null;
  boqReturnHref?: string | null;
  quantityLineage?: DrawingQuantityLineage | null;
  quantityLineageObjectId?: string | null;
  quantityLineageUrl?: string | null;
  roomUrl: string;
  sourceUrl?: string | null;
  sourceBundle?: DrawingWorkspaceSourceBundle & { error?: string | null };
  sourceAttach?: {
    canvasId: string | null;
    candidates: DrawingWorkspaceSourceAttachCandidate[];
    error: string | null;
  };
  selectedIfcFileId?: string | null;
  viewMode?: DrawingWorkspaceViewMode;
  workspace: DrawingWorkspace & {
    document: NonNullable<DrawingWorkspace["document"]>;
  };
};

type PdfCompareActionData =
  | {
      ok: true;
      kind: "pdf_compare";
      error: null;
      previousPdf: DrawingWorkspacePdfSourceDescriptor;
    }
  | {
      ok: false;
      kind: "pdf_compare";
      error: string;
      previousPdf: null;
    }
  | {
      ok: true;
      kind: "pdf_compare_cancelled";
      error: null;
    };

type DrawingDxfImportActionData =
  | {
      ok: true;
      kind: "dxf_import_prepared";
      error: null;
      result: PreparedDrawingDxfProjectImport;
    }
  | {
      ok: false;
      kind: string;
      error: string;
      requestId?: string;
    };

function drawingSourceFileSize(byteSize: number) {
  if (byteSize < 1_024) return `${byteSize} B`;
  if (byteSize < 1_048_576) return `${(byteSize / 1_024).toFixed(1)} KB`;
  return `${(byteSize / 1_048_576).toFixed(1)} MB`;
}

export function DrawingWorkspaceSourceAttachControl({
  attach,
  canSubmit,
  pending,
  revisionId,
  roomUrl,
}: {
  attach: NonNullable<Props["sourceAttach"]>;
  canSubmit: boolean;
  pending: boolean;
  revisionId: string;
  roomUrl: string;
}) {
  if (attach.error)
    return (
      <p
        className="rounded-md border border-amber-400/30 bg-amber-950/60 px-3 py-2 text-xs text-amber-100"
        role="alert"
      >
        {attach.error}
      </p>
    );
  if (!attach.canvasId) return null;
  if (attach.candidates.length === 0)
    return (
      <p className="text-xs text-slate-300" role="status">
        연결 가능한 PDF가 없습니다. <Link to={roomUrl}>PDF 업로드로 이동</Link>
      </p>
    );
  return (
    <Form
      aria-label="PDF 원본 연결"
      className="flex flex-wrap items-center gap-2 rounded-md border border-white/15 bg-slate-950/60 p-1.5"
      method="post"
      onSubmit={(event) => {
        const request = event.currentTarget.elements.namedItem("request_id");
        if (request instanceof HTMLInputElement && !request.value)
          request.value = crypto.randomUUID();
      }}
      title={
        !canSubmit && !pending
          ? "로컬 변경을 모두 저장한 뒤 연결할 수 있습니다."
          : undefined
      }
    >
      <input name="intent" type="hidden" value="attach_source" />
      <input name="revision_id" type="hidden" value={revisionId} />
      <input name="canvas_id" type="hidden" value={attach.canvasId} />
      <input name="request_id" type="hidden" />
      <label className="flex min-h-9 items-center gap-2 text-xs font-semibold text-slate-200">
        PDF 원본
        <select
          aria-label="연결할 PDF 원본"
          className="min-h-9 max-w-72 rounded border border-white/15 bg-slate-950 px-2 text-sm text-white"
          disabled={!canSubmit || pending}
          name="source_file_id"
          required
        >
          <option value="">PDF 선택</option>
          {attach.candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.originalFilename} ·{" "}
              {drawingSourceFileSize(candidate.byteSize)} ·{" "}
              {candidate.sha256.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
      <button
        className="min-h-9 rounded bg-indigo-500 px-3 text-xs font-bold text-white disabled:opacity-50"
        disabled={!canSubmit || pending}
        type="submit"
      >
        {pending ? "원본 연결 중" : "PDF 원본 연결"}
      </button>
      {!canSubmit && !pending ? (
        <span className="sr-only" role="status">
          로컬 변경을 모두 저장한 뒤 연결할 수 있습니다.
        </span>
      ) : null}
    </Form>
  );
}

export function drawingObjectHasQuantityLineage(
  rows: readonly DrawingObjectQuantityLineageRow[] | null | undefined,
  objectId: string | null,
) {
  return Boolean(
    objectId && rows?.some((row) => row.quantity.drawingObjectId === objectId),
  );
}

export function drawingObjectHasMaterialLineage(
  rows: readonly DrawingObjectQuantityLineageRow[] | null | undefined,
  objectId: string | null,
) {
  return Boolean(
    objectId &&
      rows?.some(
        (row) =>
          row.quantity.drawingObjectId === objectId &&
          row.boqLinks.some((link) => link.hasMaterialLineage),
      ),
  );
}

export default function DrawingWorkspaceClient({
  actionError,
  activityPage,
  assignees = [],
  capability,
  collaborationEnabled = true,
  createdIssueId = null,
  currentUserId,
  drawingShares = [],
  estimateOptions = [],
  estimateSummary = {
    status: "unbound",
    binding: null,
    boq: null,
    rows: [],
    directCostKrw: "0",
    missingRateCount: 0,
    reviewCount: 0,
  },
  collaborationRoom,
  revisionRelinkResult = null,
  revisionReview = emptyDrawingRevisionReview,
  revisionReviewNextHref = null,
  revisionReviewPreviousHref = null,
  projectId,
  previewMode = false,
  workspaceNotice,
  realtimeAdapter,
  previewHarness,
  collaborationBootstrap,
  collaborationConnectionFactory = openDrawingCollaborationConnection,
  collaborationPersistenceFactory = openDrawingYjsPersistence,
  measurementEvidence,
  measurementEvidenceError,
  measurementEvidenceUrl,
  boqReturnHref = null,
  quantityLineage,
  quantityLineageObjectId = quantityLineage?.rows[0]?.quantity
    .drawingObjectId ?? null,
  quantityLineageUrl = null,
  roomUrl,
  sourceUrl = null,
  sourceBundle,
  sourceAttach,
  selectedIfcFileId = sourceBundle?.ifc?.id ?? null,
  viewMode = "2d",
  workspace,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigation = useNavigation();
  const intendedSearchParams = useMemo(
    () =>
      resolveDrawingWorkspaceSearchParams({
        committedSearch: location.search,
        currentPathname: location.pathname,
        pendingLocation: navigation.location
          ? {
              pathname: navigation.location.pathname,
              search: navigation.location.search,
            }
          : null,
      }),
    [
      location.pathname,
      location.search,
      navigation.location?.pathname,
      navigation.location?.search,
    ],
  );
  const replaceWorkspaceSearchParams = useCallback(
    (
      update: (next: URLSearchParams) => void,
      options?: { defaultShouldRevalidate?: boolean },
    ) => {
      const next = new URLSearchParams(intendedSearchParams);
      update(next);
      setSearchParams(next, { replace: true, ...options });
    },
    [intendedSearchParams, setSearchParams],
  );
  useEffect(() => {
    if (
      performance.getEntriesByName("drawing-workspace:hydration:start").length >
        0 &&
      performance.getEntriesByName("drawing-workspace:hydration").length === 0
    )
      performance.measure(
        "drawing-workspace:hydration",
        "drawing-workspace:hydration:start",
      );
  }, []);
  const canvasRef = useRef<DrawingCanvasHandle>(null);
  const [calibrationCapture, setCalibrationCapture] =
    useState<DrawingCalibrationCapture | null>(null);
  const appliedLineageFocusKeyRef = useRef<string | null>(null);
  const suppressedLineageSearchObjectRef = useRef<{
    id: string;
    tombstoneObserved: boolean;
  } | null>(null);
  const initialEvidenceFocusKeyRef = useRef<string | null>(null);
  const [canvasModule, setCanvasModule] = useState<
    DrawingClientModuleState<CanvasComponent>
  >({ status: "loading" });
  const [ifcModule, setIfcModule] = useState<
    DrawingClientModuleState<IfcComponent>
  >({ status: "loading" });
  const [ifcActivated, setIfcActivated] = useState(false);
  const [narrowSplitTab, setNarrowSplitTab] = useState<"2d" | "3d">("2d");
  const [narrowLayout, setNarrowLayout] = useState(false);
  const [tabletLayout, setTabletLayout] = useState(false);
  const [ifcSelection, setIfcSelection] = useState<IfcElementSelection | null>(
    null,
  );
  const [ifcMatch, setIfcMatch] = useState<
    | { status: "idle" | "no_match" }
    | { status: "ambiguous"; objectIds: readonly string[] }
  >({ status: "idle" });
  const [ifcFocusRequest, setIfcFocusRequest] =
    useState<IfcFocusRequest | null>(null);
  const [pdfCompareTransition, setPdfCompareTransition] = useState<{
    generation: number;
    mode: "current" | "overlay" | "previous";
  }>({ generation: 0, mode: "current" });
  const pdfCompareMode = pdfCompareTransition.mode;
  const [pdfCompareOpacity, setPdfCompareOpacity] = useState(0.5);
  const [pdfDiffGeneration, setPdfDiffGeneration] = useState(0);
  const pdfCompareFetcher = useFetcher<PdfCompareActionData>();
  const dxfImportFetcher = useFetcher<DrawingDxfImportActionData>();
  const [dxfImportCreatedAt, setDxfImportCreatedAt] = useState("");
  useEffect(() => {
    setDxfImportCreatedAt(new Date().toISOString());
  }, []);
  const handledDxfImportRequestRef = useRef<string | null>(null);
  const [dxfImportStatus, setDxfImportStatus] = useState<string | null>(null);
  const [nativeDwgImportStatus, setNativeDwgImportStatus] = useState<string | null>(null);
  const handledPdfCompareTransitionRef = useRef(0);
  const pendingPdfCompareRequestRef = useRef<{
    currentFileId: string;
    currentSha256: string;
    dataBeforeRequest: PdfCompareActionData | undefined;
    pageNumber: number;
    previousFileId: string;
    previousSha256: string;
    revisionEdgeId: string;
  } | null>(null);
  const [previousPdfCapability, setPreviousPdfCapability] =
    useState<DrawingWorkspacePdfSourceDescriptor | null>(null);
  const [pdfCompareState, setPdfCompareState] =
    useState<DrawingPdfCompareState>({ status: "idle", markers: [] });
  const [pdfPageTransform, setPdfPageTransform] =
    useState<DrawingPdfPageTransform | null>(null);
  const [sourceInspectorMessage, setSourceInspectorMessage] = useState("");
  const ifcFocusSequenceRef = useRef(0);
  const pendingIfcSelectionRef = useRef<string | null>(null);
  const [activeTool, setActiveTool] = useState<DrawingTool>("select");
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [repeatMode, setRepeatMode] = useState(false);
  const [workspaceMode, setWorkspaceMode] =
    useState<DrawingWorkspaceMode>("author");
  const [activePanel, setActivePanel] =
    useState<DrawingWorkspacePanel>("structure");
  const [visitedPanels, setVisitedPanels] = useState<
    ReadonlySet<DrawingWorkspacePanel>
  >(() => new Set(["structure"]));
  const [leftDockOpen, setLeftDockOpen] = useState(true);
  const [inspectorOpenOverride, setInspectorOpenOverride] = useState<
    boolean | null
  >(null);
  const [inspectorMode, setInspectorMode] =
    useState<DrawingInspectorMode>("object");
  const [visitedInspectorModes, setVisitedInspectorModes] = useState<
    ReadonlySet<DrawingInspectorMode>
  >(() => new Set(["object"]));
  const visiblePanels = drawingWorkspaceModeDefinition(workspaceMode).panels;
  const showInspectorMode = useCallback((mode: DrawingInspectorMode) => {
    setInspectorMode(mode);
    setVisitedInspectorModes((current) => {
      if (current.has(mode)) return current;
      return new Set([...current, mode]);
    });
  }, []);
  const showWorkspacePanel = useCallback(
    (panel: DrawingWorkspacePanel) => {
      const transition = drawingWorkspaceModeChangeForPanel(
        workspaceMode,
        panel,
      );
      setWorkspaceMode(transition.mode);
      setActivePanel(panel);
      setVisitedPanels((current) => {
        if (current.has(panel)) return current;
        return new Set([...current, panel]);
      });
      if (transition.inspector) showInspectorMode(transition.inspector);
    },
    [showInspectorMode, workspaceMode],
  );
  const showWorkspaceMode = useCallback(
    (mode: DrawingWorkspaceMode) => {
      const definition = drawingWorkspaceModeDefinition(mode);
      setWorkspaceMode(mode);
      setActivePanel(definition.defaultPanel);
      setVisitedPanels((current) => {
        if (current.has(definition.defaultPanel)) return current;
        return new Set([...current, definition.defaultPanel]);
      });
      showInspectorMode(definition.inspector);
    },
    [showInspectorMode],
  );
  const revalidator = useRevalidator();
  const [
    realtimeCheckpointRevalidationCount,
    setRealtimeCheckpointRevalidationCount,
  ] = useState(0);
  const realtimeCheckpointRevalidationPending =
    realtimeCheckpointRevalidationCount > 0;
  const markRealtimeCheckpointRevalidationPending = useCallback(() => {
    setRealtimeCheckpointRevalidationCount((current) => current + 1);
  }, []);
  const settleRealtimeCheckpointRevalidation = useCallback(() => {
    setRealtimeCheckpointRevalidationCount((current) =>
      Math.max(0, current - 1),
    );
  }, []);
  const handleWorkspaceModeKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    const nextMode = resolveDrawingWorkspaceModeKey(workspaceMode, event.key);
    if (!nextMode) return;
    event.preventDefault();
    showWorkspaceMode(nextMode);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`#drawing-workspace-mode-${nextMode}`)
      ?.focus();
  };
  const handleInspectorModeKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    const nextMode = resolveDrawingInspectorModeKey(inspectorMode, event.key);
    if (!nextMode) return;
    event.preventDefault();
    showInspectorMode(nextMode);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(
        nextMode === "result"
          ? "#drawing-estimate-result-tab"
          : "#drawing-object-inspector-tab",
      )
      ?.focus();
  };
  const [historyStatus, setHistoryStatus] = useState<string | null>(null);
  const [issueSelection, setIssueSelection] = useState(() => ({
    consumedCreatedIssueId: null as string | null,
    selectedIssueId: collaborationRoom?.issues[0]?.id ?? "",
  }));
  const selectedIssueId = issueSelection.selectedIssueId;
  const setSelectedIssueId = (selectedIssueId: string) => {
    setIssueSelection((current) => ({ ...current, selectedIssueId }));
  };
  useEffect(() => {
    setIssueSelection((current) =>
      transitionDrawingWorkspaceIssueSelection(current, {
        createdIssueId,
        issues: collaborationRoom?.issues ?? [],
      }),
    );
  }, [collaborationRoom?.issues, createdIssueId]);
  const [canvasRegionDraft, setCanvasRegionDraft] =
    useState<CanvasRegionAnchorDraft | null>(null);
  const [canvasRegionPickerBoundaryKey, setCanvasRegionPickerBoundaryKey] =
    useState<string | null>(null);
  const [canvasRegionLabel, setCanvasRegionLabel] = useState("");
  const [revisionRelinkDraft, setRevisionRelinkDraft] = useState<{
    anchor: RelinkDrawingAnchorInput["anchor"] | null;
    candidate: DrawingRevisionReviewItem;
    focusRequestId: string;
    newAnchorId: string;
  } | null>(null);
  const [revisionRelinkPdfCoordinates, setRevisionRelinkPdfCoordinates] =
    useState({ x: "", y: "", width: "", height: "" });
  const [revisionRelinkMessage, setRevisionRelinkMessage] = useState<
    string | null
  >(null);
  const visibleRevisionReview =
    revisionRelinkDraft &&
    !revisionReview.some(
      (item) =>
        item.previousAnchorId ===
        revisionRelinkDraft.candidate.previousAnchorId,
    )
      ? [revisionRelinkDraft.candidate, ...revisionReview]
      : revisionReview;
  useEffect(() => {
    if (!revisionRelinkResult) return;
    setRevisionRelinkDraft(null);
    setRevisionRelinkMessage("새 개정본의 근거로 안전하게 교체했습니다.");
  }, [revisionRelinkResult?.newAnchorId]);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    const linkedObjectId = searchParams.get("object");
    return linkedObjectId ? [linkedObjectId] : [];
  });
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const semanticBlockSelectionRef = useRef<Set<string>>(new Set());
  const transientAuthorizationRef = useRef<string | null>(null);
  const transientInputInvalidatedRef = useRef(
    searchParams.get("object") === null,
  );
  const setAuthorizedTool = useCallback(
    (tool: DrawingTool) => {
      transientInputInvalidatedRef.current = false;
      if (tool !== "select" && tool !== "pan") {
        semanticBlockSelectionRef.current.clear();
        setSelectedIds([]);
        replaceWorkspaceSearchParams((next) => {
          for (const name of drawingWorkspaceLineageSearchParams)
            if (name !== "revision") next.delete(name);
        });
      }
      setActiveTool(tool);
    },
    [replaceWorkspaceSearchParams],
  );
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
  const [localEditBridgeReady, setLocalEditBridgeReady] = useState(false);
  const [saveState, setSaveState] = useState({
    pending: 0,
    conflicted: false,
    flushing: false,
    online: true,
    storageError: false,
  });
  const [persistenceState, setPersistenceState] =
    useState<DrawingPersistenceSnapshot>({ failed: false, volatileCount: 0 });
  const [localMutationCount, setLocalMutationCount] = useState(0);
  const [nativeImportPending, setNativeImportPending] = useState(false);
  const nativeImportPendingRef = useRef(false);
  const saveStatus = drawingSaveStatus({
    ...saveState,
    volatileCount: persistenceState.volatileCount,
    localMutationCount,
  });
  const [storageErrorDetail, setStorageErrorDetail] = useState<string | null>(
    null,
  );
  const [conflictResolving, setConflictResolving] = useState(false);
  const [conflictResolutionError, setConflictResolutionError] = useState<
    string | null
  >(null);
  const markStorageFailed = useCallback((error?: unknown) => {
    setLocalEditBridgeReady(false);
    setPersistenceState((current) => ({ ...current, failed: true }));
    setSaveState((current) => ({ ...current, storageError: true }));
    const detail = drawingStorageFailureDetail(error);
    if (detail) setStorageErrorDetail(detail);
  }, []);
  const [legacyOperationCount, setLegacyOperationCount] = useState(0);
  const clipboardRef = useRef<DrawingClipboard>({ items: [] });
  const blockClipboardRef = useRef<DrawingBlockInstancesClipboard | null>(null);
  const [clipboardError, setClipboardError] = useState<string | null>(null);
  const legacyOutboxRef = useRef<DrawingOutbox | null>(null);
  const resolveConflictRef = useRef<() => Promise<void>>(async () => {});
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
  const { primarySource: file, document: drawingDocument } = workspace;
  const sourceSha256 =
    file?.sha256 ?? drawingDocument.source_sha256 ?? "0".repeat(64);
  const revalidateAfterAcknowledgementRef = useRef(revalidator.revalidate);
  revalidateAfterAcknowledgementRef.current = revalidator.revalidate;
  const { revision } = drawingDocument;
  const authority = drawingCollaborationAuthority({
    bootstrap: collaborationBootstrap,
    fallbackCapability: capability,
    fallbackRevisionStatus: revision.status,
  });
  const effectiveCapability = authority.capability;
  const effectiveRevisionStatus = authority.revisionStatus;
  const authorityCanWrite = authority.canWrite;
  const [collaborationFrozen, setCollaborationFrozen] = useState(
    effectiveRevisionStatus !== "draft",
  );
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
  const capabilityRef = useRef(effectiveCapability);
  const revisionStatusRef = useRef(effectiveRevisionStatus);
  const authorityCanWriteRef = useRef(authorityCanWrite);
  capabilityRef.current = effectiveCapability;
  revisionStatusRef.current = effectiveRevisionStatus;
  authorityCanWriteRef.current = authorityCanWrite;
  const persistenceLifecycleKey = drawingCollaborationLifecycleKey(
    currentUserId,
    revision.project_id,
    revision.id,
  );
  const dxfImportSendGate = useMemo(
    () => createDrawingDxfImportSendGate(),
    [persistenceLifecycleKey],
  );
  const nativeDwgImportSendGate = useMemo(
    () => createNativeDrawingDwgImportSendGate(),
    [persistenceLifecycleKey],
  );
  useEffect(() => {
    setRealtimeCheckpointRevalidationCount(0);
  }, [collaborationEnabled, persistenceLifecycleKey]);
  const realtime = useDrawingWorkspaceRealtime({
    adapter: realtimeAdapter,
    documentId: drawingDocument.id,
    enabled: collaborationEnabled,
    projectId: revision.project_id,
    revisionId: revision.id,
    userId: currentUserId,
    onInvalidate: previewHarness?.onInvalidate,
    onInvalidateScheduled: markRealtimeCheckpointRevalidationPending,
    onRevalidated: settleRealtimeCheckpointRevalidation,
  });
  const authoritativeSnapshotKey = drawingAuthoritativeSnapshotKey({
    revisionId: revision.id,
    revisionVersion: revision.version,
    revisionUpdatedAt: revision.updated_at,
    sourceSha256,
    ...(collaborationBootstrap
      ? {
          bootstrap: {
            sha256: collaborationBootstrap.sha256,
            operationSequence: collaborationBootstrap.operationSequence,
            recentOutcomesKey: drawingCollaborationRecentOutcomesKey(
              collaborationBootstrap.recentOutcomes,
            ),
          },
        }
      : {}),
  });
  const authoritativeBase = useMemo(
    () =>
      collaborationBootstrap
        ? drawingStateFromBootstrap(collaborationBootstrap)
        : drawingStateFromRevision(revision),
    [authoritativeSnapshotKey],
  );
  const requestedLineageObjectId = searchParams.get("object");
  const lineageFocusObjectId = drawingWorkspaceLineageFocusObjectId({
    revisionId: searchParams.get("revision"),
    objectId: requestedLineageObjectId,
    boqVersionId: searchParams.get("boq"),
    boqLineId: searchParams.get("line"),
  });
  const authoritativeCheckpoint = useMemo(
    () => ({
      key: authoritativeSnapshotKey,
      state: authoritativeBase,
      baseSnapshotSha256: collaborationBootstrap?.sha256 ?? sourceSha256,
      operationSequence: collaborationBootstrap?.operationSequence ?? 0,
      recentOutcomes: collaborationBootstrap?.recentOutcomes ?? [],
    }),
    [authoritativeSnapshotKey, authoritativeBase, sourceSha256],
  );
  const authoritativeCheckpointRef = useRef(authoritativeCheckpoint);
  authoritativeCheckpointRef.current = authoritativeCheckpoint;
  const documentStoreRef = useRef<DrawingDocumentStore | null>(null);
  if (!documentStoreRef.current) {
    documentStoreRef.current = createDrawingDocumentStore(authoritativeBase, {
      activePageId: revision.activePageId,
      activeCanvasId: revision.activeCanvasId,
      revisionStatus: effectiveRevisionStatus,
    });
  }
  const documentStore = documentStoreRef.current;
  const validatedInitialAuthoritativeStateRef = useRef<{
    checkpointKey: string;
    proof: ReturnType<DrawingDocumentStore["getValidatedInitialState"]>;
  } | null>(null);
  validatedInitialAuthoritativeStateRef.current ??= {
    checkpointKey: authoritativeCheckpoint.key,
    proof: documentStore.getValidatedInitialState(),
  };
  const collaborationAdapterRef = useRef<DrawingDraftAdapter | null>(null);
  const collaborationCommandRef = useRef<ReturnType<
    typeof createDrawingCollaborationCommandBridge
  > | null>(null);
  const commandQueueRef = useRef<Promise<void>>(Promise.resolve());
  const commandQueueProjectionRef = useRef<DrawingDocumentState | null>(null);
  const commandQueueSizeRef = useRef(0);
  const undurableMutationCountRef = useRef(0);
  const collaborationConnectionRef =
    useRef<DrawingCollaborationConnection | null>(null);
  const awarenessStoreRef = useRef(createDrawingAwarenessPeerStore());
  const awarenessLockPeers = useDrawingAwarenessLocks(
    awarenessStoreRef.current,
  );
  const awarenessPeers = useDrawingAwarenessPeers(awarenessStoreRef.current);
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
  >(
    previewMode
      ? "connected"
      : collaborationEnabled
        ? "connecting"
        : "degraded",
  );
  const [collaborationEditNotice, setCollaborationEditNotice] = useState<
    string | null
  >(null);
  const [verticalTestStatus, setVerticalTestStatus] = useState("준비됨");
  const initializedPersistenceLifecycleKeyRef = useRef<string | null>(null);
  const installedAuthoritativeCheckpointKeyRef = useRef<string | null>(null);
  const exportCheckpointRevalidationGenerationRef = useRef(0);
  const [
    exportCheckpointRevalidationPending,
    setExportCheckpointRevalidationPending,
  ] = useState(false);
  const [installedExportCheckpointKey, setInstalledExportCheckpointKey] =
    useState<string | null>(null);
  const collaborationSourceReadyRef = useRef(false);
  const connectCollaborationRef = useRef<() => void>(() => undefined);
  const drawingState = useSyncExternalStore(
    documentStore.subscribe,
    documentStore.getSnapshot,
    documentStore.getSnapshot,
  );
  const authoritativeRequestedLineageObjectExists =
    drawingWorkspaceStateHasFocusableObject(
      authoritativeBase,
      requestedLineageObjectId,
    );
  const currentRequestedLineageObjectExists =
    drawingWorkspaceStateHasFocusableObject(
      drawingState,
      requestedLineageObjectId,
    );
  const requestedLineageObjectExists =
    resolveDrawingWorkspaceRequestedObjectExists({
      authoritativeCheckpointKey: authoritativeSnapshotKey,
      authoritativeObjectExists: authoritativeRequestedLineageObjectExists,
      currentObjectExists: currentRequestedLineageObjectExists,
      installedCheckpointKey: installedExportCheckpointKey,
    });
  const currentLineageFocusObjectExists =
    drawingWorkspaceStateHasFocusableObject(drawingState, lineageFocusObjectId);
  const clearLineageSearchParamsForObject = useCallback(
    (objectId: string) => {
      suppressedLineageSearchObjectRef.current = {
        id: objectId,
        tombstoneObserved: false,
      };
      appliedLineageFocusKeyRef.current = null;
      transientInputInvalidatedRef.current = false;
      semanticBlockSelectionRef.current.clear();
      setSelectedIds((current) =>
        current.includes(objectId)
          ? current.filter((selectedId) => selectedId !== objectId)
          : current,
      );
      replaceWorkspaceSearchParams((next) => {
        for (const name of drawingWorkspaceLineageSearchParams)
          next.delete(name);
      });
    },
    [replaceWorkspaceSearchParams],
  );
  const releaseLineageSearchSuppressionForObject = useCallback(
    (objectId: string) => {
      const suppressed = suppressedLineageSearchObjectRef.current;
      if (suppressed?.id === objectId && !suppressed.tombstoneObserved)
        suppressedLineageSearchObjectRef.current = null;
    },
    [],
  );
  const drawingStateRef = useRef<DrawingDocumentState>(drawingState);
  const enqueueDrawingMutation = useCallback(
    (
      mutation: (
        latest: DrawingDocumentState,
        expected: DrawingDocumentState | null,
      ) => Promise<DrawingDocumentState | null>,
      onError?: (error: unknown) => void,
      options: { trackUndurableWork?: boolean } = {},
    ): Promise<boolean> => {
      const trackUndurableWork = options.trackUndurableWork ?? true;
      if (nativeImportPendingRef.current && trackUndurableWork) return Promise.resolve(false);
      commandQueueSizeRef.current += 1;
      if (trackUndurableWork) {
        undurableMutationCountRef.current += 1;
        setLocalMutationCount(undurableMutationCountRef.current);
      }
      const run = async () => {
        const latest =
          collaborationAdapterRef.current?.getSnapshot().state ??
          drawingStateRef.current;
        const next = await mutation(latest, commandQueueProjectionRef.current);
        if (next)
          commandQueueProjectionRef.current =
            collaborationAdapterRef.current?.getSnapshot().state ?? next;
      };
      const result = commandQueueRef.current.then(run);
      commandQueueRef.current = result.then(
        () => undefined,
        () => undefined,
      );
      const settled = () => {
        commandQueueSizeRef.current -= 1;
        if (trackUndurableWork) {
          undurableMutationCountRef.current -= 1;
          setLocalMutationCount(undurableMutationCountRef.current);
        }
        if (commandQueueSizeRef.current === 0)
          commandQueueProjectionRef.current = null;
      };
      return result.then(
        () => {
          settled();
          return true;
        },
        (error) => {
          settled();
          if (onError) onError(error);
          else markStorageFailed(error);
          return false;
        },
      );
    },
    [markStorageFailed],
  );
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
      sources: drawingState.structure?.sources ?? {},
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
  const editReady = drawingLocalEditReady({
    outboxReady,
    bridgeReady: localEditBridgeReady,
    persistenceFailed: persistenceState.failed,
    conflicted: saveState.conflicted,
  });
  const baseCanEdit =
    editReady &&
    !nativeImportPending &&
    !reviewPreparing &&
    !collaborationFrozen &&
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
    const authorizationWasInitialized =
      transientAuthorizationRef.current !== null;
    transientAuthorizationRef.current = authorizationKey;
    if (authorizationWasInitialized)
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
  const inspectorHasContent = true;
  const inspectorOpen = inspectorOpenOverride ?? inspectorHasContent;
  useEffect(
    () =>
      setInspectorOpenOverride((current) => (current === true ? true : null)),
    [transientSelectedIdsKey],
  );
  useEffect(() => {
    if (!tabletLayout || !inspectorOpen) return;
    setLeftDockOpen(false);
  }, [inspectorOpen, tabletLayout]);
  const focusCanvas = useCallback(() => {
    window.requestAnimationFrame(() => canvasRef.current?.focus());
  }, []);
  const toggleWorkspaceDock = useCallback(
    (dock: "left" | "inspector") => {
      if (dock === "left") {
        const next = !leftDockOpen;
        setLeftDockOpen(next);
        if (tabletLayout) setInspectorOpenOverride(false);
        if (tabletLayout && !next) focusCanvas();
        return;
      }
      const next = !inspectorOpen;
      setInspectorOpenOverride(next);
      if (tabletLayout) setLeftDockOpen(false);
      if (tabletLayout && !next) focusCanvas();
    },
    [focusCanvas, inspectorOpen, leftDockOpen, tabletLayout],
  );
  awarenessSelectionRef.current = transient.selectedIds;
  const activeDrawingState = transient.state;
  const activeDrawingLayers = useMemo(
    () => Object.values(activeDrawingState.layers),
    [activeDrawingState.layers],
  );
  const collaborationObjectNames = useMemo(
    () =>
      Object.fromEntries(
        [
          ...Object.values(activeDrawingState.objects),
          ...Object.values(activeDrawingState.structure?.blockInstances ?? {}),
        ].map((entity) => [entity.id, entity.name]),
      ),
    [activeDrawingState.objects, activeDrawingState.structure?.blockInstances],
  );
  const onCanvasSelectionChange = useCallback(
    (ids: string[]) => {
      const authorizedIds = ids.filter(
        (id) =>
          Boolean(activeDrawingState.objects[id]) ||
          Boolean(activeDrawingState.structure?.blockInstances[id]),
      );
      setAuthorizedSelection(authorizedIds);
    },
    [
      activeDrawingState.objects,
      activeDrawingState.structure?.blockInstances,
      setAuthorizedSelection,
    ],
  );
  const onCanvasToolComplete = useCallback(
    (tool: DrawingTool) =>
      setAuthorizedTool(transient.activeLayerId ? tool : "select"),
    [setAuthorizedTool, transient.activeLayerId],
  );
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
        `${conflict.user.displayName}님이 ${name} 편집 중이어서 이 작업을 실행하지 않았습니다. 임시 잠금이며 서버 권한은 별도로 확인됩니다.`,
      );
    },
    [drawingState],
  );
  const publishAwareness = useCallback(
    (patch: Partial<DrawingAwarenessLocalInput> = {}) =>
      awarenessPublicationRef.current?.update(patch),
    [],
  );
  const onCanvasCursorWorldChange = useCallback(
    (cursorWorld: Point | null) => {
      awarenessCursorRef.current = cursorWorld;
      publishAwareness({ cursorWorld });
    },
    [publishAwareness],
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
    const finish = startDrawingWorkspaceStage("style-resolution");
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
    finish();
    return { objects, styleError };
  }, [activeDrawingState.objects, activeDrawingState.structure?.styles]);
  const blockStructure = drawingState.structure;
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
  }, [page?.calibration, page?.height_mm, page?.id, page?.width_mm]);
  const dimensionContext = useMemo(
    () =>
      activeCanvas
        ? drawingDimensionContextForCanvas(activeCanvas)
        : ({ kind: "pdf", calibration } as const),
    [activeCanvas, calibration],
  );
  const resolvedBlockInstances = useMemo(
    () =>
      blockStructure && drawingState.activeCanvasId
        ? drawingBlockRenderCache.select({
            activeCanvasId: drawingState.activeCanvasId,
            blocks: blockStructure.blocks,
            dimensionContext,
            instances: blockStructure.blockInstances,
            layers: drawingState.layers,
            styles: blockStructure.styles,
          })
        : { instances: [], error: null as string | null },
    [
      blockStructure?.blocks,
      blockStructure?.blockInstances,
      blockStructure?.styles,
      dimensionContext,
      drawingState.activeCanvasId,
      drawingState.layers,
    ],
  );
  const resolvedActiveLayerId = transient.activeLayerId;
  const editingContext = drawingEditingContext(
    effectiveCapability,
    activeDrawingLayers,
    resolvedActiveLayerId,
  );
  const editing = {
    ...editingContext,
    canEdit: baseCanEdit && editingContext.canEdit && authorityCanWrite,
  };
  const hasUndurableWork = drawingWorkspaceHasUndurableWork({
    localMutationCount,
    volatileCount: persistenceState.volatileCount,
  });
  const navigationBlocker = useBlocker(({ currentLocation, nextLocation }) =>
    drawingWorkspaceShouldBlockNavigation({
      activeRevisionId: revision.id,
      currentPathname: currentLocation.pathname,
      currentSearch: currentLocation.search,
      hasUndurableWork,
      nextPathname: nextLocation.pathname,
      nextSearch: nextLocation.search,
    }),
  );

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
      if (
        !drawingWorkspaceHasUndurableWork({
          localMutationCount: undurableMutationCountRef.current,
          volatileCount: persistenceRef.current?.snapshot().volatileCount ?? 0,
        })
      )
        return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const calibrationId = calibration?.id ?? null;
  const canComment = drawingWorkspaceCanComment(effectiveCapability);
  const visibleRegionAnnotations = drawingVisibleCanvasRegionAnnotations({
    anchors: collaborationRoom?.canvasRegionAnchors ?? [],
    canvasId: drawingState.activeCanvasId,
    issues: collaborationRoom?.issues ?? [],
    pageId: drawingState.activePageId,
    revisionId: revision.id,
    selectedIssueId: selectedIssueId || null,
  });
  const canvasRegionDraftIdentity = {
    capability: effectiveCapability,
    canvasId: drawingState.activeCanvasId,
    issueId: selectedIssueId,
    pageId: drawingState.activePageId,
    revisionId: revision.id,
  };
  const canvasRegionBoundaryKey = drawingCanvasRegionPickerBoundaryKey(
    canvasRegionDraftIdentity,
  );
  const canArmCanvasRegionPicker = Boolean(
    canComment &&
      !revisionRelinkDraft &&
      !calibrationCapture?.active &&
      canvasRegionDraftIdentity.issueId &&
      canvasRegionDraftIdentity.revisionId &&
      canvasRegionDraftIdentity.pageId &&
      canvasRegionDraftIdentity.canvasId,
  );
  const canvasRegionDraftIsCurrent = Boolean(
    canvasRegionDraft &&
      canvasRegionDraft.anchorId &&
      canvasRegionDraft.boundaryKey === canvasRegionBoundaryKey &&
      canArmCanvasRegionPicker,
  );
  const canvasRegionPickerArmed = drawingCanvasRegionPickerIsArmed({
    armedBoundaryKey: canvasRegionPickerBoundaryKey,
    canArm: canArmCanvasRegionPicker,
    currentBoundaryKey: canvasRegionBoundaryKey,
  });
  const previousCanvasRegionBoundaryKeyRef = useRef(canvasRegionBoundaryKey);
  useEffect(() => {
    const boundaryInvalid =
      !canArmCanvasRegionPicker ||
      (canvasRegionDraft !== null && !canvasRegionDraftIsCurrent) ||
      (canvasRegionPickerBoundaryKey !== null &&
        canvasRegionPickerBoundaryKey !== canvasRegionBoundaryKey);
    const boundaryChanged =
      previousCanvasRegionBoundaryKeyRef.current !== canvasRegionBoundaryKey;
    previousCanvasRegionBoundaryKeyRef.current = canvasRegionBoundaryKey;
    if (boundaryInvalid || boundaryChanged) {
      setCanvasRegionDraft(null);
      setCanvasRegionPickerBoundaryKey(null);
      setCanvasRegionLabel("");
    }
  }, [
    canArmCanvasRegionPicker,
    canvasRegionBoundaryKey,
    canvasRegionDraft,
    canvasRegionDraftIsCurrent,
    canvasRegionPickerBoundaryKey,
  ]);
  const completeCanvasRegionPick = useCallback(
    (region: { x: number; y: number; width: number; height: number }) => {
      if (!canArmCanvasRegionPicker) return;
      setCanvasRegionDraft({
        anchorId: crypto.randomUUID(),
        boundaryKey: canvasRegionBoundaryKey!,
        canvasId: canvasRegionDraftIdentity.canvasId!,
        height: region.height,
        issueId: canvasRegionDraftIdentity.issueId,
        pageId: canvasRegionDraftIdentity.pageId!,
        revisionId: canvasRegionDraftIdentity.revisionId,
        width: region.width,
        x: region.x,
        y: region.y,
      });
      setCanvasRegionPickerBoundaryKey(null);
    },
    [
      canArmCanvasRegionPicker,
      canvasRegionBoundaryKey,
      canvasRegionDraftIdentity.canvasId,
      canvasRegionDraftIdentity.issueId,
      canvasRegionDraftIdentity.pageId,
      canvasRegionDraftIdentity.revisionId,
    ],
  );
  const canvasRegionPicker = useMemo(
    () =>
      canvasRegionPickerArmed && canArmCanvasRegionPicker
        ? {
            identityKey: canvasRegionBoundaryKey!,
            onComplete: completeCanvasRegionPick,
          }
        : null,
    [
      canArmCanvasRegionPicker,
      canvasRegionPickerArmed,
      canvasRegionBoundaryKey,
      completeCanvasRegionPick,
    ],
  );
  const revisionRelinkPdfPicker = useMemo<
    import("./drawing-canvas.client").DrawingCanvasRegionPicker | null
  >(() => {
    const candidate = revisionRelinkDraft?.candidate;
    if (
      !revisionRelinkDraft ||
      revisionRelinkDraft.anchor ||
      candidate?.sourceKind !== "pdf_region" ||
      !canComment ||
      calibrationCapture?.active ||
      file?.kind !== "pdf" ||
      sourceBundle?.pdf?.id !== file.id ||
      !pdfPageTransform
    )
      return null;
    return {
      identityKey: `revision-relink:${revisionRelinkDraft.newAnchorId}:${pdfPageTransform.pageNumber}`,
      onComplete: (bounds) => {
        const selected = worldBoundsToPdfNormalizedRegion(
          pdfPageTransform,
          bounds,
        );
        if (!selected) {
          setRevisionRelinkMessage(
            "PDF 페이지 안에서 새 근거 영역을 다시 선택해 주세요.",
          );
          return;
        }
        const x = Math.max(0, Math.min(1, selected.x));
        const y = Math.max(0, Math.min(1, selected.y));
        const width = Math.min(selected.width, 1 - x);
        const height = Math.min(selected.height, 1 - y);
        if (width <= 0 || height <= 0) return;
        setRevisionRelinkDraft((current) =>
          current?.newAnchorId === revisionRelinkDraft.newAnchorId
            ? {
                ...current,
                anchor: {
                  kind: "pdf_region",
                  fileId: file.id,
                  pageNumber: pdfPageTransform.pageNumber,
                  x,
                  y,
                  width,
                  height,
                  label:
                    `${pdfPageTransform.pageNumber}쪽 ${candidate.issueTitle}`.slice(
                      0,
                      240,
                    ),
                },
              }
            : current,
        );
        setRevisionRelinkMessage(
          `${pdfPageTransform.pageNumber}쪽의 새 영역을 선택했습니다.`,
        );
      },
    };
  }, [
    calibrationCapture?.active,
    canComment,
    file,
    pdfPageTransform,
    revisionRelinkDraft,
    sourceBundle?.pdf?.id,
  ]);
  const applyRevisionRelinkPdfCoordinates = useCallback(() => {
    const values = Object.fromEntries(
      Object.entries(revisionRelinkPdfCoordinates).map(([key, value]) => [
        key,
        value.trim() === "" ? Number.NaN : Number(value),
      ]),
    ) as Record<keyof typeof revisionRelinkPdfCoordinates, number>;
    if (
      !revisionRelinkDraft ||
      revisionRelinkDraft.candidate.sourceKind !== "pdf_region" ||
      !canComment ||
      file?.kind !== "pdf" ||
      !pdfPageTransform ||
      Object.values(values).some((value) => !Number.isFinite(value)) ||
      values.x < 0 ||
      values.y < 0 ||
      values.width <= 0 ||
      values.height <= 0 ||
      values.x + values.width > 100 ||
      values.y + values.height > 100
    ) {
      setRevisionRelinkMessage(
        "좌표는 0~100% 안에서 너비와 높이가 0보다 크도록 입력해 주세요.",
      );
      return;
    }
    const anchor: RelinkDrawingAnchorInput["anchor"] = {
      kind: "pdf_region",
      fileId: file.id,
      pageNumber: pdfPageTransform.pageNumber,
      x: values.x / 100,
      y: values.y / 100,
      width: values.width / 100,
      height: values.height / 100,
      label:
        `${pdfPageTransform.pageNumber}쪽 ${revisionRelinkDraft.candidate.issueTitle}`.slice(
          0,
          240,
        ),
    };
    setRevisionRelinkDraft((current) =>
      current?.newAnchorId === revisionRelinkDraft.newAnchorId
        ? { ...current, anchor }
        : current,
    );
    setRevisionRelinkMessage(
      `${pdfPageTransform.pageNumber}쪽의 새 영역을 좌표로 지정했습니다.`,
    );
  }, [
    canComment,
    file,
    pdfPageTransform,
    revisionRelinkDraft,
    revisionRelinkPdfCoordinates,
  ]);
  const reviewControls = drawingWorkspaceReviewControls({
    capability: effectiveCapability,
    createdBy: revision.created_by,
    currentUserId,
    reviewEvidence: revision.reviewEvidence,
    revisionId: revision.id,
    revisionVersion: revision.version,
    status: effectiveRevisionStatus,
  });
  const loadedIfc = sourceBundle?.ifc ?? null;
  const loadedIfcRenderBundle = adaptIfcRenderBundleDescriptor(loadedIfc);
  const availableIfcSources =
    sourceBundle?.catalog.filter((item) => item.kind === "ifc") ?? [];
  const availableDxfSources =
    sourceBundle?.catalog.filter(
      (item): item is DrawingWorkspaceSourceCatalogItem & { kind: "dxf" } =>
        item.kind === "dxf",
    ) ?? [];
  const requestedDxfSourceId = searchParams.get("dxfSourceFileId");
  const availableDwgSources = sourceBundle?.catalog.filter(item => item.kind === "dwg") ?? [];
  const requestedDwgSourceId = searchParams.get("dwgSourceFileId");
  const uploadedDxfSourceId =
    availableDxfSources.find((item) => item.id === requestedDxfSourceId)?.id ??
    null;
  const selectedIfcChoice =
    availableIfcSources.find(
      (item) => item.kind === "ifc" && item.id === selectedIfcFileId,
    ) ?? null;
  const firstPaintLifecycleKey = [
    revision.id,
    sourceBundle?.pdf?.id ?? "no-pdf",
    sourceBundle?.pdf?.sha256 ?? "no-pdf-sha",
    selectedIfcChoice?.id ?? "no-ifc",
    selectedIfcChoice?.sha256 ?? "no-ifc-sha",
    loadedIfcRenderBundle?.derivative.version ?? "no-ifc-revision",
    loadedIfcRenderBundle?.derivative.manifestSha256 ?? "no-ifc-manifest",
    loadedIfcRenderBundle?.derivative.geometrySha256 ?? "no-ifc-glb",
  ].join(":");
  const [retainedIfc, setRetainedIfc] = useState(loadedIfc);
  useEffect(() => {
    setRetainedIfc(
      (current) =>
        loadedIfc ??
        (current &&
        selectedIfcChoice &&
        current.id === selectedIfcChoice.id &&
        current.sha256 === selectedIfcChoice.sha256
          ? current
          : null),
    );
  }, [loadedIfc, selectedIfcChoice?.id, selectedIfcChoice?.sha256]);
  const selectedIfc =
    loadedIfc ??
    (retainedIfc &&
    selectedIfcChoice &&
    retainedIfc.id === selectedIfcChoice.id &&
    retainedIfc.sha256 === selectedIfcChoice.sha256
      ? retainedIfc
      : null);
  const selectedIfcRenderBundle = adaptIfcRenderBundleDescriptor(selectedIfc);
  const primarySourceUrl =
    sourceBundle?.pdf?.signedUrl ?? (file?.kind === "pdf" ? sourceUrl : null);
  const activeView: DrawingWorkspaceViewMode = selectedIfcChoice
    ? viewMode
    : "2d";
  const previousActiveViewRef = useRef<DrawingWorkspaceViewMode | null>(null);
  useEffect(() => {
    const enteringSplit =
      activeView === "split" && previousActiveViewRef.current !== "split";
    previousActiveViewRef.current = activeView;
    const next = resolveDrawingWorkspaceSplitDockState({
      enteringSplit,
      inspectorOpen,
      leftDockOpen,
      viewportWidth: window.innerWidth,
    });
    if (next.leftDockOpen !== leftDockOpen) setLeftDockOpen(next.leftDockOpen);
  }, [activeView, inspectorOpen, leftDockOpen]);
  const surface = drawingWorkspaceSurface({
    file: file ? { kind: file.kind } : null,
    page: page
      ? {
          width: page.width_mm,
          height: page.height_mm,
          backgroundPdfPage: page.background_pdf_page,
        }
      : null,
    sourceUrl: primarySourceUrl,
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
    if (selectedIfcChoice && viewMode !== "2d") setIfcActivated(true);
  }, [selectedIfcChoice, viewMode]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setNarrowLayout(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const media = window.matchMedia(
      "(min-width: 768px) and (max-width: 1199px)",
    );
    const update = () => setTabletLayout(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!ifcActivated) return;
    return loadDrawingClientModule({
      load: () =>
        import("./ifc-property-browser.client").then(
          (module) => module.default,
        ),
      errorMessage: "검증된 IFC 파생물 화면을 불러오지 못했습니다.",
      onState: setIfcModule,
    });
  }, [ifcActivated]);

  useEffect(() => {
    exportCheckpointRevalidationGenerationRef.current += 1;
    setExportCheckpointRevalidationPending(false);
    setInstalledExportCheckpointKey(null);
    let active = true;
    let outbox: DrawingOutbox;
    let attempt: {
      document: Y.Doc;
      persistence: DrawingYjsPersistence | null;
      adapter: DrawingDraftAdapter;
      dispose(): Promise<void>;
    } | null = null;
    let connection: DrawingCollaborationConnection | null = null;
    let unsubscribeDraft: (() => void) | null = null;
    let unsubscribeAwareness: (() => void) | null = null;
    let awarenessExpiryTimer: number | null = null;
    let connecting: Promise<void> | null = null;
    let initializing: Promise<void> | null = null;
    let conflictResolutionActive = false;
    let attemptReadyForProvider = false;
    let cancelInitialization: (() => void) | null = null;
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
    const actionUrl = `${drawingWorkspaceOperationLocation({
      previewMode,
      projectId,
      workspaceId: drawingDocument.id,
    })}${window.location.search}`;
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
    let exportCheckpointRetryTimer: number | null = null;
    let exportCheckpointRetryDelayMs = 1_000;
    const clearExportCheckpointRetry = () => {
      if (exportCheckpointRetryTimer === null) return;
      window.clearTimeout(exportCheckpointRetryTimer);
      exportCheckpointRetryTimer = null;
    };
    const requestExportCheckpointRevalidation = async () => {
      if (!active) return false;
      clearExportCheckpointRetry();
      const generation = exportCheckpointRevalidationGenerationRef.current + 1;
      exportCheckpointRevalidationGenerationRef.current = generation;
      setExportCheckpointRevalidationPending(true);
      try {
        await Promise.resolve(revalidateAfterAcknowledgementRef.current());
        if (
          active &&
          exportCheckpointRevalidationGenerationRef.current === generation
        ) {
          setExportCheckpointRevalidationPending(false);
          exportCheckpointRetryDelayMs = 1_000;
        }
        return active;
      } catch {
        if (
          active &&
          exportCheckpointRevalidationGenerationRef.current === generation
        ) {
          const retryDelay = exportCheckpointRetryDelayMs;
          exportCheckpointRetryDelayMs = Math.min(
            exportCheckpointRetryDelayMs * 2,
            30_000,
          );
          exportCheckpointRetryTimer = window.setTimeout(() => {
            exportCheckpointRetryTimer = null;
            void requestExportCheckpointRevalidation();
          }, retryDelay);
        }
        return false;
      }
    };
    let flush: () => Promise<void> = async () => {};
    let pendingExternalOutboxChange = false;
    let settledExternalOutboxChange = false;
    let processingExternalOutboxChange = false;
    const reconcileExternalAttempt = async () => {
      const currentAttempt = attempt;
      if (!currentAttempt) return;
      await enqueueDrawingMutation(
        async () => {
          if (
            !active ||
            attempt !== currentAttempt ||
            collaborationAdapterRef.current !== currentAttempt.adapter
          )
            return null;
          await currentAttempt.persistence?.flush();
          const checkpoint = authoritativeCheckpointRef.current;
          await reconcileDrawingCollaborationDraft({
            actorId: currentUserId,
            revisionId: revision.id,
            baseOperationSequence: checkpoint.operationSequence,
            adapter: currentAttempt.adapter,
            outbox,
            recentOutcomes: checkpoint.recentOutcomes,
            commitRecoveredOperation: () =>
              currentAttempt.persistence?.flush() ?? Promise.resolve(),
          });
          return currentAttempt.adapter.getSnapshot().state;
        },
        markStorageFailed,
        { trackUndurableWork: false },
      );
    };
    const processExternalOutboxChanges = async () => {
      if (!active || conflictResolutionActive || processingExternalOutboxChange)
        return;
      processingExternalOutboxChange = true;
      try {
        while (active) {
          if (settledExternalOutboxChange) {
            settledExternalOutboxChange = false;
            const checkpointRevalidation =
              requestExportCheckpointRevalidation();
            await refresh();
            await reconcileExternalAttempt();
            await checkpointRevalidation;
          }
          if (!pendingExternalOutboxChange || !attempt) break;
          pendingExternalOutboxChange = false;
          await reconcileExternalAttempt();
          connection?.flush();
          await flush();
        }
      } catch (error) {
        if (active) markStorageFailed(error);
      } finally {
        processingExternalOutboxChange = false;
      }
    };
    const handleExternalOutboxChange = (kind: DrawingOutboxChangeKind) => {
      if (!active) return;
      if (kind === "pending") pendingExternalOutboxChange = true;
      else settledExternalOutboxChange = true;
      void processExternalOutboxChanges();
    };
    outbox = createDrawingOutbox(undefined, {
      ownerId: currentUserId,
      revisionId: revision.id,
      beforeAcknowledged: async (response) => {
        if (response.authoritativeSequence === undefined) return;
        const acknowledgedAttempt = attempt;
        if (!acknowledgedAttempt)
          throw new Error(
            "Drawing draft must be ready before an acknowledgement settles.",
          );
        let failure: unknown;
        const completed = await enqueueDrawingMutation(
          async () => {
            if (
              !active ||
              attempt !== acknowledgedAttempt ||
              collaborationAdapterRef.current !== acknowledgedAttempt.adapter
            )
              throw new Error(
                "Drawing draft changed before its acknowledgement settled.",
              );
            acknowledgedAttempt.adapter.recordLocalAcknowledgement(
              {
                clientOperationId: response.clientOperationId,
                authoritativeSequence: response.authoritativeSequence,
                resultVersions: response.resultVersions,
              },
              "canonical",
            );
            return acknowledgedAttempt.adapter.getSnapshot().state;
          },
          (error) => {
            failure = error;
            markStorageFailed(error);
          },
          { trackUndurableWork: false },
        );
        if (!completed)
          throw failure instanceof Error
            ? failure
            : new Error("Drawing acknowledgement could not be recorded.");
      },
      onAcknowledged: (count) => {
        if (!active) return;
        if (count < 1) return;
        void requestExportCheckpointRevalidation();
      },
      onChange: () => void refresh(),
      onExternalChange: handleExternalOutboxChange,
    });
    legacyOutboxRef.current = outbox;

    flush = async () => {
      if (
        !active ||
        conflictResolutionActive ||
        !navigator.onLine ||
        !authorityCanWriteRef.current
      ) {
        await refresh();
        return;
      }
      setSaveState((current) => ({ ...current, flushing: true }));
      try {
        await outbox.flush((operation, context) =>
          dxfImportSendGate.send({
            operation,
            knownOperations: () => outbox.replayableOperations(),
            prepare: (request) =>
              prepareDrawingDxfImportOverHttp({
                action: actionUrl,
                request,
                fetch,
                signal: context?.signal,
              }),
            send: () =>
              nativeDwgImportSendGate.send({
                operation,
                knownOperations: () => outbox.replayableOperations(),
                prepare: request => prepareNativeDrawingDwgImportOverHttp({ action: actionUrl, request, fetch, signal: context?.signal }),
                send: () => sendDrawingOperation(operation, actionUrl, fetch, context?.signal),
              }),
          }),
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

    const resolveConflict = async () => {
      if (!active || conflictResolutionActive) return;
      conflictResolutionActive = true;
      setConflictResolving(true);
      setConflictResolutionError(null);
      setLocalEditBridgeReady(false);
      try {
        if (!navigator.onLine)
          throw new Error("네트워크에 다시 연결한 뒤 충돌 작업을 정리하세요.");
        if (
          !authorityCanWriteRef.current ||
          revisionStatusRef.current !== "draft" ||
          (capabilityRef.current !== "admin" &&
            capabilityRef.current !== "editor")
        )
          throw new Error("현재 도면 리비전의 편집 권한을 다시 확인하세요.");
        await commandQueueRef.current;
        const persisted = await persistence.retry();
        const persistenceSnapshot = persistence.snapshot();
        if (
          !persisted ||
          persistenceSnapshot.failed ||
          persistenceSnapshot.volatileCount > 0
        )
          throw new Error(
            "로컬 작업을 안전하게 저장한 뒤 충돌을 정리할 수 있습니다.",
          );
        const entries = await outbox.entries();
        const conflictIndex = entries.findIndex(
          (entry) => entry.status !== "pending",
        );
        if (conflictIndex >= 0) {
          const suffix = entries.slice(conflictIndex);
          const dispositions = await sendDrawingConflictDiscard(
            suffix.map((entry) => entry.operation),
            revision.id,
            actionUrl,
          );
          await outbox.settleConflictedSuffix(dispositions);
        }
        attemptReadyForProvider = false;
        persistence.dispose();
        clearAwareness();
        connection?.dispose();
        connection = null;
        collaborationConnectionRef.current = null;
        unsubscribeDraft?.();
        unsubscribeDraft = null;
        collaborationAdapterRef.current = null;
        collaborationCommandRef.current = null;
        const conflictAttempt = attempt;
        attempt = null;
        await finalizeDrawingConflictReset({
          disposeLocalDraft: () =>
            conflictAttempt?.dispose() ?? Promise.resolve(),
          reload: () => window.location.reload(),
        });
      } catch (error) {
        if (!active) return;
        conflictResolutionActive = false;
        setConflictResolving(false);
        setLocalEditBridgeReady(false);
        setConflictResolutionError(
          error instanceof Error
            ? error.message
            : "충돌 작업을 정리하지 못했습니다. 다시 시도하세요.",
        );
        await refresh().catch(() => undefined);
      }
    };
    resolveConflictRef.current = resolveConflict;

    const runConnect = async () => {
      if (
        !active ||
        conflictResolutionActive ||
        !collaborationEnabled ||
        !navigator.onLine ||
        !drawingCollaborationProviderReady({
          sourceReady: collaborationSourceReadyRef.current,
          checkpointInstalled: attemptReadyForProvider,
        }) ||
        !attempt ||
        connection
      )
        return;
      try {
        const opened = await collaborationConnectionFactory({
          document: attempt.document,
          projectId: revision.project_id,
          revisionId: revision.id,
          resolveToken: createDrawingAccessTokenResolver(),
          url: import.meta.env.VITE_DRAWING_COLLABORATION_URL,
          onPhase: (phase) => active && setCollaborationPhase(phase),
        });
        if (!active || !navigator.onLine) opened?.dispose();
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
    const requestConnection = () => void connect();
    connectCollaborationRef.current = requestConnection;
    const runInitialize = async () => {
      if (conflictResolutionActive) return;
      const capturedCheckpoint = authoritativeCheckpointRef.current;
      try {
        attemptReadyForProvider = false;
        setLocalEditBridgeReady(false);
        if (!previewMode) setOutboxReady(false);
        unsubscribeDraft?.();
        unsubscribeDraft = null;
        setCollaborationFrozen(revisionStatusRef.current !== "draft");
        collaborationAdapterRef.current = null;
        collaborationCommandRef.current = null;
        clearAwareness();
        connection?.dispose();
        connection = null;
        collaborationConnectionRef.current = null;
        const previousAttempt = attempt;
        attempt = null;
        await previousAttempt?.dispose();
        let localBaseMeta:
          | ReturnType<typeof initializeDrawingCollaborationDocument>
          | undefined;
        let recoveryPersistence: DrawingYjsPersistence | null = null;
        attempt = await openDrawingCollaborationLocalAttempt({
          createDocument() {
            const document = new Y.Doc();
            localBaseMeta = initializeDrawingCollaborationDocument({
              document,
              projectId: revision.project_id,
              revisionId: revision.id,
              baseSnapshotSha256: capturedCheckpoint.baseSnapshotSha256,
              baseOperationSequence: capturedCheckpoint.operationSequence,
            });
            return document;
          },
          openPersistence: async (document) => {
            recoveryPersistence = await collaborationPersistenceFactory({
              ownerId: currentUserId,
              revisionId: revision.id,
              document,
            });
            return recoveryPersistence;
          },
          createAdapter: (document) => {
            if (!localBaseMeta)
              throw new Error(
                "Drawing collaboration local base is unavailable.",
              );
            return createDrawingDraftAdapter({
              document,
              localBaseMeta,
              authoritativeState: capturedCheckpoint.state,
              validatedAuthoritativeState:
                validatedInitialAuthoritativeStateRef.current?.checkpointKey ===
                capturedCheckpoint.key
                  ? validatedInitialAuthoritativeStateRef.current.proof
                  : null,
              actorId: currentUserId,
              authorization: capabilityRef.current,
              frozen: revisionStatusRef.current !== "draft",
              enforceServerFreeze: collaborationEnabled,
              baseOperationSequence: capturedCheckpoint.operationSequence,
              replaceProjection: (state) => documentStore.replace(state),
            });
          },
          reconcile: (adapter) =>
            reconcileDrawingCollaborationDraft({
              actorId: currentUserId,
              revisionId: revision.id,
              baseOperationSequence: capturedCheckpoint.operationSequence,
              adapter,
              outbox,
              recentOutcomes: capturedCheckpoint.recentOutcomes,
              commitRecoveredOperation: () =>
                recoveryPersistence?.flush() ?? Promise.resolve(),
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
        const refreshCollaborationFrozen = () => {
          if (active) setCollaborationFrozen(draft.getSnapshot().frozen);
        };
        unsubscribeDraft = draft.subscribe(refreshCollaborationFrozen);
        refreshCollaborationFrozen();
        const installedCheckpointKey =
          await synchronizeDrawingCollaborationCheckpoint({
            appliedKey: capturedCheckpoint.key,
            getCurrentCheckpoint: () => authoritativeCheckpointRef.current,
            applyCheckpoint: async (checkpoint) => {
              await draft.replaceAuthoritative(checkpoint.state, {
                baseOperationSequence: checkpoint.operationSequence,
                recentOutcomes: checkpoint.recentOutcomes,
              });
              await reconcileDrawingCollaborationDraft({
                actorId: currentUserId,
                revisionId: revision.id,
                baseOperationSequence: checkpoint.operationSequence,
                adapter: draft,
                outbox,
                recentOutcomes: checkpoint.recentOutcomes,
                commitRecoveredOperation: () =>
                  attempt?.persistence?.flush() ?? Promise.resolve(),
              });
            },
          });
        if (!active) {
          await attempt.dispose();
          attempt = null;
          return;
        }
        installedAuthoritativeCheckpointKeyRef.current = installedCheckpointKey;
        setInstalledExportCheckpointKey(installedCheckpointKey);
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
            hasLocalOperations: draft.operations().length > 0,
            lifecycleKey: persistenceLifecycleKey,
            previousLifecycleKey: initializedPersistenceLifecycleKeyRef.current,
            recoveredState: draft.getSnapshot().state,
          });
        drawingStateRef.current = documentStore.getSnapshot();
        setLocalEditBridgeReady(true);
        setOutboxReady(true);
        setPersistenceState({ failed: false, volatileCount: 0 });
        setStorageErrorDetail(null);
        setSaveState((current) => ({ ...current, storageError: false }));
        await refresh();
        attemptReadyForProvider = true;
        await processExternalOutboxChanges();
        if (collaborationSourceReadyRef.current) await connect();
        await flush();
      } catch (error) {
        if (active) {
          attemptReadyForProvider = false;
          setCollaborationPhase("degraded");
          setLocalEditBridgeReady(false);
          markStorageFailed(error);
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
    const offline = () => {
      setSaveState((current) => ({ ...current, online: false }));
      if (collaborationEnabled) {
        clearAwareness();
        connection?.dispose();
        connection = null;
        collaborationConnectionRef.current = null;
        setCollaborationPhase("degraded");
      }
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    if (!previewMode) setOutboxReady(false);
    setLocalEditBridgeReady(false);
    setLegacyOperationCount(0);
    setConflictResolving(false);
    setConflictResolutionError(null);
    setPersistenceState({ failed: false, volatileCount: 0 });
    setActiveTool("select");
    setActiveLayerId(null);
    setSelectedIds([]);
    clipboardRef.current = { items: [] };
    blockClipboardRef.current = null;
    cancelInitialization = scheduleDrawingLocalInitialization({
      initialize: () => void initialize(),
    });
    return () => {
      active = false;
      attemptReadyForProvider = false;
      clearExportCheckpointRetry();
      cancelInitialization?.();
      persistence.dispose();
      outbox.dispose();
      clearAwareness();
      connection?.dispose();
      unsubscribeDraft?.();
      unsubscribeDraft = null;
      void attempt?.dispose().catch(() => undefined);
      collaborationAdapterRef.current = null;
      collaborationCommandRef.current = null;
      collaborationConnectionRef.current = null;
      installedAuthoritativeCheckpointKeyRef.current = null;
      if (persistenceRef.current === persistence) persistenceRef.current = null;
      if (legacyOutboxRef.current === outbox) legacyOutboxRef.current = null;
      if (flushOutboxRef.current === flush) flushOutboxRef.current = null;
      if (resolveConflictRef.current === resolveConflict)
        resolveConflictRef.current = async () => {};
      localDraftFlushRef.current = async () => {};
      retryStorageRef.current = () => {};
      if (connectCollaborationRef.current === requestConnection)
        connectCollaborationRef.current = () => undefined;
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [
    collaborationEnabled,
    documentStore,
    dxfImportSendGate,
    nativeDwgImportSendGate,
    enqueueDrawingMutation,
    persistenceLifecycleKey,
  ]);

  useEffect(() => {
    if (!collaborationEnabled) {
      collaborationSourceReadyRef.current = false;
      setCollaborationPhase("degraded");
      return;
    }
    collaborationSourceReadyRef.current = false;
    return scheduleDrawingSourceReadyConnection({
      isReady: () =>
        drawingWorkspaceFirstPaintReady(
          {
            requiresPdf: surface.background.kind === "pdf",
            requiresIfc: Boolean(selectedIfcChoice && viewMode !== "2d"),
          },
          performance,
          firstPaintLifecycleKey,
        ),
      connect: (sourceReady) => {
        collaborationSourceReadyRef.current = true;
        if (!sourceReady) setCollaborationPhase("degraded");
        connectCollaborationRef.current();
      },
    });
  }, [
    collaborationEnabled,
    firstPaintLifecycleKey,
    selectedIfcChoice?.id,
    surface.background.kind,
    viewMode,
  ]);

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
    const nextSelection = resolveDrawingWorkspaceAuthorizedSelectionSync({
      focusObjectExists: currentLineageFocusObjectExists,
      focusObjectId: lineageFocusObjectId,
      inputInvalidated: transientInputInvalidatedRef.current,
      selectedIds,
      transientSelectedIds: transient.selectedIds,
    });
    if (nextSelection) setAuthorizedSelection(nextSelection);
  }, [
    currentLineageFocusObjectExists,
    lineageFocusObjectId,
    selectedIds,
    setAuthorizedSelection,
    transientSelectedIdsKey,
  ]);

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
    if (!adapter) {
      setCollaborationFrozen(effectiveRevisionStatus !== "draft");
      return;
    }
    adapter.setAuthorization(effectiveCapability);
    adapter.setFrozen(effectiveRevisionStatus !== "draft");
    setCollaborationFrozen(adapter.getSnapshot().frozen);
    if (!authorityCanWrite) {
      setAwarenessSoftLock(null);
      awarenessPublicationRef.current?.clear();
      setActiveTool((current) =>
        current === "pan" || current === "select" ? current : "select",
      );
      setActiveLayerId(null);
    } else publishAwareness({});
  }, [
    authorityCanWrite,
    effectiveCapability,
    effectiveRevisionStatus,
    publishAwareness,
    setAwarenessSoftLock,
  ]);

  useEffect(() => {
    enqueueDrawingMutation(
      async () => {
        const adapter = collaborationAdapterRef.current;
        const outbox = legacyOutboxRef.current;
        const checkpoint = authoritativeCheckpointRef.current;
        if (
          !adapter ||
          !outbox ||
          installedAuthoritativeCheckpointKeyRef.current === checkpoint.key
        )
          return null;
        await adapter.replaceAuthoritative(checkpoint.state, {
          baseOperationSequence: checkpoint.operationSequence,
          recentOutcomes: checkpoint.recentOutcomes,
        });
        await reconcileDrawingCollaborationDraft({
          actorId: currentUserId,
          revisionId: revision.id,
          baseOperationSequence: checkpoint.operationSequence,
          adapter,
          outbox,
          recentOutcomes: checkpoint.recentOutcomes,
          commitRecoveredOperation: localDraftFlushRef.current,
        });
        if (collaborationAdapterRef.current !== adapter) return null;
        installedAuthoritativeCheckpointKeyRef.current = checkpoint.key;
        setInstalledExportCheckpointKey(checkpoint.key);
        return adapter.getSnapshot().state;
      },
      undefined,
      { trackUndurableWork: false },
    );
  }, [authoritativeSnapshotKey, currentUserId, enqueueDrawingMutation]);

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

  const commitApplied = useCallback(
    async (operationId: string) => {
      const bridge = collaborationCommandRef.current;
      const adapter = collaborationAdapterRef.current;
      if (
        reviewFrozenRef.current ||
        !authorityCanWrite ||
        !outboxReady ||
        !bridge ||
        !adapter ||
        !canPersistDrawingMutation(
          effectiveCapability,
          persistenceState,
          effectiveRevisionStatus,
        )
      )
        return false;
      let committed = false;
      let statusHandled = false;
      const completed = await enqueueDrawingMutation(
        async (latest) => {
          let reverted: ReturnType<typeof revertDrawingOperation>;
          try {
            reverted = revertDrawingOperation(
              latest,
              currentUserId,
              operationId,
            );
          } catch (error) {
            statusHandled = true;
            setHistoryStatus(
              error instanceof Error
                ? error.message
                : "작업을 되돌릴 수 없습니다.",
            );
            return latest;
          }
          if ("kind" in reverted) {
            statusHandled = true;
            setHistoryStatus("후속 변경이 있어 안전하게 되돌릴 수 없습니다.");
            return latest;
          }
          const lockConflict = drawingRecordedOperationSoftLockConflict(
            reverted.operation,
            awarenessLockPeers,
          );
          if (lockConflict) {
            statusHandled = true;
            reportLockConflict(lockConflict);
            setAwarenessSoftLock(null);
            return latest;
          }
          const lineageObjectId =
            resolveDrawingWorkspaceMutationLineageObjectId(
              requestedLineageObjectId,
              transient.selectedIds,
              (objectId) =>
                drawingWorkspaceStateHasFocusableObject(
                  reverted.state,
                  objectId,
                ),
            );
          if (lineageObjectId)
            clearLineageSearchParamsForObject(lineageObjectId);
          try {
            await persistDrawingRecordedOperation(bridge, reverted);
          } catch (error) {
            if (lineageObjectId)
              releaseLineageSearchSuppressionForObject(lineageObjectId);
            throw error;
          }
          committed = true;
          return adapter.getSnapshot().state;
        },
        (error) => {
          statusHandled = true;
          markStorageFailed(error);
          setHistoryStatus(
            error instanceof Error
              ? error.message
              : "작업을 되돌릴 수 없습니다.",
          );
        },
      );
      if (completed && committed)
        setHistoryStatus("되돌리기 작업을 안전하게 저장했습니다.");
      else if (!statusHandled)
        setHistoryStatus("현재 상태에서는 작업을 되돌릴 수 없습니다.");
      return completed && committed;
    },
    [
      authorityCanWrite,
      awarenessLockPeers,
      clearLineageSearchParamsForObject,
      currentUserId,
      effectiveCapability,
      effectiveRevisionStatus,
      enqueueDrawingMutation,
      markStorageFailed,
      outboxReady,
      persistenceState,
      reportLockConflict,
      releaseLineageSearchSuppressionForObject,
      requestedLineageObjectId,
      setAwarenessSoftLock,
      transientSelectedIdsKey,
    ],
  );

  const applyCommand = useCallback(
    (command: DrawingCommand, canvasCreatedObjectIds?: readonly string[]) => {
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
          const lineageObjectId =
            resolveDrawingWorkspaceMutationLineageObjectId(
              requestedLineageObjectId,
              transient.selectedIds,
              (objectId) =>
                drawingWorkspaceStateHasFocusableObject(
                  prepared.state,
                  objectId,
                ),
            );
          if (lineageObjectId)
            clearLineageSearchParamsForObject(lineageObjectId);
          if (
            nextCommand.type === "add_objects" &&
            canvasCreatedObjectIds?.length &&
            canvasCreatedObjectIds.every((id) => prepared.state.objects[id])
          )
            setAuthorizedSelection([...canvasCreatedObjectIds]);
          return prepared.state;
        },
        (error) => {
          if (error instanceof DrawingCommandError) {
            setCollaborationEditNotice(error.message);
            return;
          }
          markStorageFailed(error);
        },
      );
      return true;
    },
    [
      authorityCanWrite,
      awarenessLockPeers,
      clearLineageSearchParamsForObject,
      effectiveCapability,
      effectiveRevisionStatus,
      enqueueDrawingMutation,
      outboxReady,
      persistenceState,
      reportLockConflict,
      requestedLineageObjectId,
      setAuthorizedSelection,
      setAwarenessSoftLock,
      transientSelectedIdsKey,
    ],
  );
  const applyCanvasCommand = useCallback(
    (command: DrawingCommand) =>
      applyCommand(
        command,
        command.type === "add_objects"
          ? command.objects.map((object) => object.id)
          : undefined,
      ),
    [applyCommand],
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
    await enqueueDrawingMutation(
      async (latest) => {
        const latestWall = latest.objects[wall.id];
        if (!latestWall || latestWall.geometry.type !== "wall") {
          setVerticalTestStatus("축소 대상을 찾지 못함");
          return latest;
        }
        const prepared = await bridge.applyCommand({
          type: "update_objects",
          actorId: currentUserId,
          updates: [
            {
              objectId: latestWall.id,
              baseVersion: latestWall.version,
              patch: {
                geometry: {
                  ...latestWall.geometry,
                  end: {
                    x: latestWall.geometry.start.x + 10,
                    y: latestWall.geometry.start.y,
                  },
                },
              },
            },
          ],
        });
        setVerticalTestStatus("잘못된 축소가 허용됨");
        return prepared.state;
      },
      (error) => {
        setVerticalTestStatus(
          `잘못된 축소 거부됨 · ${error instanceof Error ? error.message : "검증 오류"}`,
        );
      },
    );
  }, [currentUserId, enqueueDrawingMutation, selectedIds]);
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
      if (!(await commitApplied(operationId)))
        setHistoryStatus(
          (current) => current ?? "현재 상태에서는 작업을 되돌릴 수 없습니다.",
        );
    },
    [commitApplied],
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
          sources: normalizeDrawingCanonicalSources(
            graph.sources ?? [],
            revision.id,
          ),
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
        let restored = false;
        const completed = await enqueueDrawingMutation(
          async (latest) => {
            const command = createDrawingCheckpointRestoreCommand(
              latest,
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
              return latest;
            }
            const prepared = await bridge.applyCommand(command);
            restored = true;
            return prepared.state;
          },
          (error) => {
            markStorageFailed(error);
            setHistoryStatus(
              error instanceof Error
                ? error.message
                : "체크포인트를 복원하지 못했습니다.",
            );
          },
        );
        if (completed && restored)
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
      enqueueDrawingMutation,
      markStorageFailed,
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
        reviewFrozenRef.current ||
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
            ? undoDrawingCommandUnit(latest, currentUserId)
            : redoDrawingCommandUnit(latest, currentUserId);
        if (!result) return latest;
        if ("kind" in result) {
          setHistoryStatus("후속 변경이 있어 안전하게 되돌릴 수 없습니다.");
          return latest;
        }
        for (const applied of result.applied) {
          const lockConflict = drawingRecordedOperationSoftLockConflict(
            applied.operation,
            awarenessLockPeers,
          );
          if (lockConflict) {
            reportLockConflict(lockConflict);
            setAwarenessSoftLock(null);
            return latest;
          }
        }
        const lineageObjectId = resolveDrawingWorkspaceMutationLineageObjectId(
          requestedLineageObjectId,
          transient.selectedIds,
          (objectId) =>
            drawingWorkspaceStateHasFocusableObject(result.state, objectId),
        );
        if (lineageObjectId) clearLineageSearchParamsForObject(lineageObjectId);
        try {
          for (const applied of result.applied)
            await persistDrawingRecordedOperation(bridge, applied);
        } catch (error) {
          if (lineageObjectId)
            releaseLineageSearchSuppressionForObject(lineageObjectId);
          throw error;
        }
        onComplete?.();
        return result.state;
      }, markStorageFailed);
      return true;
    },
    [
      authorityCanWrite,
      awarenessLockPeers,
      clearLineageSearchParamsForObject,
      currentUserId,
      effectiveCapability,
      effectiveRevisionStatus,
      enqueueDrawingMutation,
      markStorageFailed,
      outboxReady,
      persistenceState,
      reportLockConflict,
      releaseLineageSearchSuppressionForObject,
      requestedLineageObjectId,
      setAwarenessSoftLock,
      transientSelectedIdsKey,
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
        if (!applyCommand(command)) return false;
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
    if (!applyCommand(command)) return false;
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
    if (!applyCommand(command)) return false;
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
    if (
      !applyCommand(
        deleteDrawingObjectsWithReferencesCommand(
          drawingState,
          currentUserId,
          transient.selectedIds,
        ),
      )
    )
      return false;
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
      if (!applyCommand(command)) return false;
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

  const handleWorkspaceShortcut = useCallback(
    (event: KeyboardEvent) => {
      function openCommandMenu() {
        if (!(event.metaKey || event.ctrlKey)) return false;
        if (event.key.toLowerCase() !== "k") return false;
        if (drawingShortcutTargetIsEditable(event.target)) return false;
        event.preventDefault();
        setCommandMenuOpen(true);
        return true;
      }
      if (openCommandMenu()) return;
      const dock = resolveDrawingWorkspaceDockShortcut(event);
      if (dock) {
        event.preventDefault();
        toggleWorkspaceDock(dock);
        return;
      }
      const shortcut = resolveDrawingWorkspaceShortcut(event);
      if (!shortcut) return;
      if (!drawingWorkspaceShortcutEnabled(shortcut, reviewFrozenRef.current))
        return;
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
    },
    [
      copySelection,
      deleteSelection,
      duplicateSelection,
      moveSelection,
      pasteSelection,
      redo,
      toggleWorkspaceDock,
      undo,
    ],
  );
  const workspaceShortcutHandlerRef = useRef(handleWorkspaceShortcut);
  workspaceShortcutHandlerRef.current = handleWorkspaceShortcut;
  useEffect(() => {
    function listener(event: KeyboardEvent) {
      workspaceShortcutHandlerRef.current(event);
    }
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const commandEnabled = useCallback(
    (commandId: DrawingCommandId) =>
      drawingWorkspaceCommandEnabled(commandId, {
        blockSelectionCanMutate: blockMutationAdapter.canMutate,
        canEdit: editing.canEdit,
        canRedo:
          (drawingState.redoStackByActor[currentUserId]?.length ?? 0) > 0,
        canUndo:
          (drawingState.undoStackByActor[currentUserId]?.length ?? 0) > 0,
        reviewFrozen: reviewFrozenRef.current,
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
  const drawingSources = useMemo(
    () => drawingState.structure?.sources ?? {},
    [drawingState.structure?.sources],
  );
  const ifcSourceIndex = useMemo(
    () => createDrawingIfcSourceIndex(drawingSources),
    [drawingSources],
  );
  const ifcFocusTarget = useMemo(
    () =>
      selectedIfc
        ? drawingIfcFocusTarget({
            selectedIds: transient.selectedIds,
            sources: drawingSources,
            sourceFileId: selectedIfc.id,
            sourceSha256: selectedIfc.sha256,
          })
        : null,
    [drawingSources, selectedIfc, transient.selectedIds],
  );
  useEffect(() => {
    if (!ifcFocusTarget) {
      setIfcFocusRequest(null);
      return;
    }
    setIfcFocusRequest({
      ...ifcFocusTarget,
      requestId: `drawing-ifc-focus-${++ifcFocusSequenceRef.current}`,
    });
  }, [ifcFocusTarget]);
  const effectiveIfcFocusRequest =
    revisionRelinkDraft?.candidate.sourceKind === "ifc_element"
      ? revisionRelinkDraft.candidate.ifcGlobalId
        ? {
            requestId: revisionRelinkDraft.focusRequestId,
            ifcGlobalId: revisionRelinkDraft.candidate.ifcGlobalId,
            elementId: null,
            camera: null,
          }
        : null
      : ifcFocusRequest;
  const remoteIfcGlobalIds = useMemo(
    () =>
      selectedIfc
        ? drawingIfcRemoteHighlightGlobalIds({
            peers: awarenessPeers,
            sources: drawingSources,
            sourceFileId: selectedIfc.id,
            sourceSha256: selectedIfc.sha256,
          })
        : [],
    [awarenessPeers, drawingSources, selectedIfc],
  );
  const selectIfcLinkedObject = useCallback(
    (objectId: string) => {
      const state = drawingStateRef.current;
      const object = state.objects[objectId];
      const canvasId = object ? state.layers[object.layerId]?.canvasId : null;
      if (!object || !canvasId) return;
      pendingIfcSelectionRef.current = objectId;
      if (canvasId !== drawingState.activeCanvasId)
        documentStore.selectCanvas(canvasId);
      else {
        pendingIfcSelectionRef.current = null;
        setAuthorizedSelection([objectId]);
      }
    },
    [documentStore, drawingState.activeCanvasId, setAuthorizedSelection],
  );
  useEffect(() => {
    const objectId = pendingIfcSelectionRef.current;
    if (!objectId) return;
    const object = drawingState.objects[objectId];
    if (
      object &&
      drawingState.layers[object.layerId]?.canvasId ===
        drawingState.activeCanvasId
    ) {
      pendingIfcSelectionRef.current = null;
      setAuthorizedSelection([objectId]);
    }
  }, [drawingState, setAuthorizedSelection]);
  const handleIfcElementSelection = useCallback(
    (selection: IfcElementSelection) => {
      setIfcSelection(selection);
      if (!selectedIfc) return;
      const match = matchDrawingObjectsForIfcSelection(ifcSourceIndex, {
        origin: selection.origin,
        sourceFileId: selectedIfc.id,
        sourceSha256: selectedIfc.sha256,
        ifcGlobalId: selection.ifcGlobalId,
      });
      if (match.status === "unique") {
        setIfcMatch({ status: "idle" });
        selectIfcLinkedObject(match.objectId);
      } else if (match.status === "ambiguous")
        setIfcMatch({ status: "ambiguous", objectIds: match.objectIds });
      else if (match.status === "no_match") setIfcMatch({ status: "no_match" });
      else setIfcMatch({ status: "idle" });
    },
    [ifcSourceIndex, selectIfcLinkedObject, selectedIfc],
  );
  useEffect(() => {
    setIfcSelection(null);
    setIfcMatch({ status: "idle" });
  }, [selectedIfc?.id, selectedIfc?.sha256]);
  const selectedDrawingObjectId =
    transient.selectedIds.length === 1 &&
    drawingState.objects[transient.selectedIds[0]]
      ? transient.selectedIds[0]
      : null;
  const quantityLineageFetcher = useFetcher<DrawingQuantityLineageResource>();
  const quantityLineageLoadRef = useRef(quantityLineageFetcher.load);
  quantityLineageLoadRef.current = quantityLineageFetcher.load;
  const selectedQuantityObject = selectedDrawingObjectId
    ? drawingState.objects[selectedDrawingObjectId]
    : null;
  const quantityLineageRequestUrl = useMemo(() => {
    if (
      inspectorMode !== "object" ||
      !quantityLineageUrl ||
      !selectedDrawingObjectId ||
      !selectedQuantityObject ||
      !drawingObjectSupportsMeasurement(selectedQuantityObject) ||
      !authoritativeBase.objects[selectedDrawingObjectId] ||
      quantityLineageObjectId === selectedDrawingObjectId
    )
      return null;
    const query = new URLSearchParams({
      revision: revision.id,
      object: selectedDrawingObjectId,
    });
    if (
      intendedSearchParams.get("object") === selectedDrawingObjectId &&
      intendedSearchParams.get("revision") === revision.id
    )
      for (const name of ["boq", "line", "evidence", "quantityCursor"])
        if (intendedSearchParams.has(name))
          query.set(name, intendedSearchParams.get(name)!);
    return `${quantityLineageUrl}?${query}`;
  }, [
    authoritativeBase.objects,
    inspectorMode,
    intendedSearchParams,
    quantityLineageObjectId,
    quantityLineageUrl,
    revision.id,
    selectedDrawingObjectId,
    selectedQuantityObject,
  ]);
  useEffect(() => {
    if (quantityLineageRequestUrl)
      void quantityLineageLoadRef.current(quantityLineageRequestUrl);
  }, [quantityLineageRequestUrl]);
  const resolvedQuantityLineage = resolveDrawingQuantityLineageSelection({
    fetched: quantityLineageFetcher.data,
    initial: quantityLineage,
    initialObjectId: quantityLineageObjectId,
    selectedObjectId: selectedDrawingObjectId,
  });
  const evidenceFocusKey = drawingWorkspaceEvidenceFocusKey({
    revisionId: searchParams.get("revision"),
    objectId: searchParams.get("object"),
    boqVersionId: searchParams.get("boq"),
    boqLineId: searchParams.get("line"),
    evidenceFileId: searchParams.get("evidence"),
  });
  const lineageFocusKey = lineageFocusObjectId
    ? [
        searchParams.get("revision"),
        lineageFocusObjectId,
        searchParams.get("boq"),
        searchParams.get("line"),
      ].join(":")
    : null;
  const evidenceFocusObjectId = evidenceFocusKey ? lineageFocusObjectId : null;
  useLayoutEffect(() => {
    const suppressed = suppressedLineageSearchObjectRef.current;
    if (!suppressed) return;
    const currentObjectExists = drawingWorkspaceStateHasFocusableObject(
      drawingState,
      suppressed.id,
    );
    if (!currentObjectExists) suppressed.tombstoneObserved = true;
    else if (suppressed.tombstoneObserved) {
      suppressedLineageSearchObjectRef.current = null;
      return;
    }
    if (searchParams.get("object") !== suppressed.id) return;
    appliedLineageFocusKeyRef.current = null;
    replaceWorkspaceSearchParams((next) => {
      for (const name of drawingWorkspaceLineageSearchParams) next.delete(name);
    });
  }, [drawingState, replaceWorkspaceSearchParams, searchParams]);
  useLayoutEffect(() => {
    if (
      !drawingWorkspaceLineageClearReady({
        authoritativeCheckpointKey: authoritativeSnapshotKey,
        currentObjectExists: currentRequestedLineageObjectExists,
        installedCheckpointKey: installedExportCheckpointKey,
        requestedObjectId: requestedLineageObjectId,
      })
    )
      return;
    appliedLineageFocusKeyRef.current = null;
    replaceWorkspaceSearchParams((next) => {
      for (const name of drawingWorkspaceLineageSearchParams) next.delete(name);
    });
  }, [
    authoritativeSnapshotKey,
    currentRequestedLineageObjectExists,
    installedExportCheckpointKey,
    requestedLineageObjectId,
    replaceWorkspaceSearchParams,
  ]);
  useEffect(() => {
    const transition = resolveDrawingWorkspaceLineageFocusTransition({
      appliedFocusKey: appliedLineageFocusKeyRef.current,
      focusKey: lineageFocusKey,
      focusObjectId: currentLineageFocusObjectExists
        ? lineageFocusObjectId
        : null,
      requestedObjectExists: requestedLineageObjectExists,
      requestedObjectId: requestedLineageObjectId,
      selectedIds,
    });
    appliedLineageFocusKeyRef.current = transition.appliedFocusKey;
    if (transition.clearSearchParams) {
      replaceWorkspaceSearchParams((next) => {
        for (const name of transition.clearSearchParams!) next.delete(name);
      });
      return;
    }
    if (transition.selectedIds) setAuthorizedSelection(transition.selectedIds);
  }, [
    currentLineageFocusObjectExists,
    lineageFocusKey,
    lineageFocusObjectId,
    requestedLineageObjectId,
    requestedLineageObjectExists,
    selectedIds,
    setAuthorizedSelection,
    replaceWorkspaceSearchParams,
  ]);
  useEffect(() => {
    if (!evidenceFocusKey) {
      initialEvidenceFocusKeyRef.current = null;
      return;
    }
    if (
      initialEvidenceFocusKeyRef.current === evidenceFocusKey ||
      !selectedDrawingObjectId ||
      selectedDrawingObjectId !== evidenceFocusObjectId ||
      !canvasRef.current
    )
      return;
    const object = activeDrawingState.objects[selectedDrawingObjectId];
    const layer = object
      ? activeDrawingState.layers[object.layerId]
      : undefined;
    const canvas = layer?.canvasId
      ? activeDrawingState.structure?.canvases[layer.canvasId]
      : undefined;
    const host = document.getElementById("drawing-split-panel-2d");
    if (!object || !layer?.canvasId || !canvas || !host) return;
    const evidenceFileId = searchParams.get("evidence");
    const evidenceSources = Object.values(drawingSources).filter(
      (source) =>
        source.objectId === selectedDrawingObjectId &&
        source.sourceFileId === evidenceFileId,
    );
    if (evidenceSources.length !== 1) return;
    const evidenceSource = evidenceSources[0];
    const bounds = drawingWorkspaceEvidenceFocusBounds({
      evidence: evidenceSource,
      objectBounds: geometryBounds(object.geometry, activeDrawingState.objects),
      pdfPageTransform,
    });
    if (!bounds) return;
    const size = host.getBoundingClientRect();
    const focus = drawingWorkspaceObjectFocusViewport({
      bounds,
      canvasId: canvas.id,
      pageId: canvas.pageId,
      viewportSize: { width: size.width, height: size.height },
    });
    if (
      focus.activeCanvasId !== activeDrawingState.activeCanvasId ||
      focus.activePageId !== activeDrawingState.activePageId
    )
      return;
    canvasRef.current.setViewport(focus.viewport);
    initialEvidenceFocusKeyRef.current = evidenceFocusKey;
  }, [
    activeDrawingState,
    canvasModule.status,
    drawingSources,
    evidenceFocusKey,
    evidenceFocusObjectId,
    pdfPageTransform,
    searchParams,
    selectedDrawingObjectId,
  ]);
  useEffect(() => {
    if (!selectedDrawingObjectId) return;
    if (
      suppressedLineageSearchObjectRef.current?.id === selectedDrawingObjectId
    )
      return;
    const selected = drawingState.objects[selectedDrawingObjectId];
    if (
      !selected ||
      !drawingObjectSupportsMeasurement(selected) ||
      !drawingWorkspaceLineageSearchSyncReady({
        authoritativeObjectExists: Boolean(
          authoritativeBase.objects[selectedDrawingObjectId],
        ),
        hasCollaborationBootstrap: Boolean(collaborationBootstrap),
        saveStatus,
      }) ||
      (intendedSearchParams.get("object") === selectedDrawingObjectId &&
        intendedSearchParams.get("revision") === revision.id)
    )
      return;
    replaceWorkspaceSearchParams(
      (next) => {
        next.set("object", selectedDrawingObjectId);
        next.set("revision", revision.id);
        next.delete("boq");
        next.delete("line");
        next.delete("evidence");
        next.delete("quantityCursor");
      },
      { defaultShouldRevalidate: false },
    );
  }, [
    authoritativeBase.objects,
    collaborationBootstrap,
    drawingState.objects,
    revision.id,
    saveStatus,
    intendedSearchParams,
    replaceWorkspaceSearchParams,
    selectedDrawingObjectId,
  ]);
  const selectedObjectAlreadyLinked = selectedIfc
    ? Object.values(drawingSources).some(
        (source) =>
          source.sourceKind === "ifc_element" &&
          source.objectId === selectedDrawingObjectId &&
          source.sourceFileId === selectedIfc.id &&
          source.sourceSha256 === selectedIfc.sha256,
      )
    : false;
  const canLinkIfcSelection = Boolean(
    baseCanEdit &&
      selectedIfc &&
      ifcSelection?.origin === "user" &&
      ifcSelection.ifcGlobalId &&
      ifcMatch.status === "no_match" &&
      selectedDrawingObjectId &&
      !selectedObjectAlreadyLinked &&
      canMutateDrawingObjectSources({
        capability: effectiveCapability,
        revisionStatus: effectiveRevisionStatus,
        frozen: reviewPreparing,
      }),
  );
  const linkIfcSelection = useCallback(() => {
    if (
      !canLinkIfcSelection ||
      !selectedIfc ||
      !ifcSelection?.ifcGlobalId ||
      !selectedDrawingObjectId
    )
      return;
    const applied = applyCommand(
      linkDrawingIfcSourceCommand(
        drawingStateRef.current,
        currentUserId,
        selectedDrawingObjectId,
        {
          id: crypto.randomUUID(),
          sourceFileId: selectedIfc.id,
          sourceSha256: selectedIfc.sha256,
          ifcGlobalId: ifcSelection.ifcGlobalId,
          elementId: String(ifcSelection.expressId),
          camera: ifcSelection.camera,
        },
      ),
    );
    if (applied) setIfcMatch({ status: "idle" });
  }, [
    applyCommand,
    canLinkIfcSelection,
    currentUserId,
    ifcSelection,
    selectedDrawingObjectId,
    selectedIfc,
  ]);
  const selectedObjectSources = selectedDrawingObjectId
    ? Object.values(drawingSources).filter(
        (source) => source.objectId === selectedDrawingObjectId,
      )
    : [];
  const selectedObjectHasIssue = Boolean(
    selectedDrawingObjectId &&
      revision.issueLinks.some(
        (link) => link.object_id === selectedDrawingObjectId,
      ),
  );
  const selectedObjectHasApproval =
    effectiveRevisionStatus === "approved" ||
    effectiveRevisionStatus === "superseded";
  const selectedObjectHasQuantity = drawingObjectHasQuantityLineage(
    resolvedQuantityLineage?.rows,
    selectedDrawingObjectId,
  );
  const selectedObjectHasMaterial = drawingObjectHasMaterialLineage(
    resolvedQuantityLineage?.rows,
    selectedDrawingObjectId,
  );
  const selectedObjectLineage = drawingWorkspaceLineageProgress({
    hasApproval: selectedObjectHasApproval,
    hasIssue: selectedObjectHasIssue,
    hasMaterial: selectedObjectHasMaterial,
    hasObject: Boolean(selectedDrawingObjectId),
    hasQuantity: selectedObjectHasQuantity,
    hasSource: selectedObjectSources.length > 0,
  });
  const selectedObjectLineageAction = selectedObjectLineage.next
    ? drawingWorkspaceLineageNextAction[selectedObjectLineage.next]
    : null;
  const mayMutateSources =
    canMutateDrawingObjectSources({
      capability: effectiveCapability,
      revisionStatus: effectiveRevisionStatus,
      frozen: reviewPreparing,
    }) && baseCanEdit;
  const selectedObjectHasCurrentPdf = Boolean(
    sourceBundle?.pdf &&
      selectedObjectSources.some(
        (source) =>
          source.sourceKind === "pdf_region" &&
          source.sourceFileId === sourceBundle.pdf?.id &&
          source.sourceSha256 === sourceBundle.pdf.sha256,
      ),
  );
  const linkSelectedObjectPdfRegion = useCallback(() => {
    const state = drawingStateRef.current;
    const object = selectedDrawingObjectId
      ? state.objects[selectedDrawingObjectId]
      : null;
    const currentPdf = sourceBundle?.pdf;
    if (!object || !currentPdf || !pdfPageTransform || !mayMutateSources)
      return;
    const region = worldBoundsToPdfNormalizedRegion(
      pdfPageTransform,
      geometryBounds(object.geometry, state.objects),
    );
    if (!region) {
      setSourceInspectorMessage("선택 객체가 현재 PDF 페이지 밖에 있습니다.");
      return;
    }
    const applied = applyCommand(
      linkDrawingPdfRegionSourceCommand(state, currentUserId, object.id, {
        id: crypto.randomUUID(),
        sourceFileId: currentPdf.id,
        sourceSha256: currentPdf.sha256,
        pdfPageNumber: pdfPageTransform.pageNumber,
        ...region,
      }),
    );
    if (applied)
      setSourceInspectorMessage(
        `${pdfPageTransform.pageNumber}쪽의 회전된 PDF 좌표로 연결했습니다.`,
      );
  }, [
    applyCommand,
    currentUserId,
    mayMutateSources,
    pdfPageTransform,
    selectedDrawingObjectId,
    sourceBundle?.pdf,
  ]);
  const unlinkSelectedObjectSource = useCallback(
    (sourceId: string) => {
      if (!mayMutateSources) return;
      const applied = applyCommand(
        unlinkDrawingObjectSourceCommand(
          drawingStateRef.current,
          currentUserId,
          sourceId,
        ),
      );
      if (applied) setSourceInspectorMessage("원본 근거 연결을 해제했습니다.");
    },
    [applyCommand, currentUserId, mayMutateSources],
  );
  const updateWorkspaceView = useCallback(
    (view: DrawingWorkspaceViewMode) => {
      replaceWorkspaceSearchParams((next) => next.set("view", view));
    },
    [replaceWorkspaceSearchParams],
  );
  const startRevisionRelink = useCallback(
    (candidate: DrawingRevisionReviewItem) => {
      const sourceKind =
        file?.kind === "pdf"
          ? "pdf_region"
          : file?.kind === "ifc"
            ? "ifc_element"
            : null;
      if (!canComment || candidate.sourceKind !== sourceKind) return;
      setSelectedIssueId(candidate.issueId);
      setRevisionRelinkDraft({
        anchor: null,
        candidate,
        focusRequestId: crypto.randomUUID(),
        newAnchorId: crypto.randomUUID(),
      });
      setRevisionRelinkPdfCoordinates({
        x: "",
        y: "",
        width: "",
        height: "",
      });
      setRevisionRelinkMessage(
        candidate.sourceKind === "pdf_region"
          ? "새 PDF에서 영역을 직접 드래그해 주세요."
          : "새 IFC에서 요소를 선택한 뒤 근거 사용 버튼을 눌러 주세요.",
      );
      setCanvasRegionDraft(null);
      setCanvasRegionPickerBoundaryKey(null);
      setCanvasRegionLabel("");
      setCalibrationCapture(null);
      setAuthorizedTool("select");
      showWorkspacePanel("collaboration");
      setLeftDockOpen(true);
      if (tabletLayout) setInspectorOpenOverride(false);
      if (candidate.sourceKind === "pdf_region") {
        if (activeView !== "2d") updateWorkspaceView("2d");
      } else {
        setIfcActivated(true);
        setNarrowSplitTab("3d");
        if (activeView === "2d") updateWorkspaceView("split");
      }
    },
    [
      activeView,
      canComment,
      file?.kind,
      setAuthorizedTool,
      showWorkspacePanel,
      tabletLayout,
      updateWorkspaceView,
    ],
  );
  const completeRevisionRelinkIfcPick = useCallback(
    (anchor: {
      elementId: string;
      ifcGlobalId: string | null;
      camera: NonNullable<IfcElementSelection["camera"]>;
    }) => {
      if (
        !canComment ||
        !anchor.ifcGlobalId ||
        file?.kind !== "ifc" ||
        selectedIfc?.id !== file.id
      ) {
        setRevisionRelinkMessage(
          "GlobalId와 카메라가 확인되는 IFC 요소를 선택해 주세요.",
        );
        return;
      }
      setRevisionRelinkDraft((current) =>
        current?.candidate.sourceKind === "ifc_element"
          ? {
              ...current,
              anchor: {
                kind: "ifc_element",
                fileId: file.id,
                elementId: anchor.elementId,
                ifcGlobalId: anchor.ifcGlobalId!,
                camera: {
                  position: [...anchor.camera.position],
                  target: [...anchor.camera.target],
                },
                label: `IFC #${anchor.elementId}`.slice(0, 240),
              },
            }
          : current,
      );
      setRevisionRelinkMessage(`IFC #${anchor.elementId}를 선택했습니다.`);
      showWorkspacePanel("collaboration");
      setLeftDockOpen(true);
    },
    [canComment, file, selectedIfc?.id, showWorkspacePanel],
  );
  const ifcVisible =
    activeView === "3d" ||
    (activeView === "split" && (!narrowLayout || narrowSplitTab === "3d"));
  const backgroundPdfSource =
    file && (file.kind === "pdf" || file.kind === "ifc")
      ? resolveDrawingPdfRasterSource({
          bundledPdf:
            sourceBundle?.pdf?.kind === "pdf"
              ? { ...sourceBundle.pdf, kind: "pdf" }
              : null,
          fallbackSignedUrl: sourceUrl,
          workspaceFile: {
            id: file.id,
            kind: file.kind,
            sha256: file.sha256,
          },
        })
      : null;
  const background: DrawingCanvasBackground = activeCanvas
    ? activeCanvas.background && backgroundPdfSource
      ? {
          kind: "pdf",
          width: activeCanvas.widthMillimeters,
          height: activeCanvas.heightMillimeters,
          pageNumber: activeCanvas.background.pdfPageNumber ?? 1,
          signedUrl: backgroundPdfSource.signedUrl,
          sourceFileId: backgroundPdfSource.id,
          sourceSha256: backgroundPdfSource.sha256,
        }
      : {
          kind: "blank",
          width: activeCanvas.widthMillimeters,
          height: activeCanvas.heightMillimeters,
        }
    : surface.background;
  const previousPdfEvidence =
    background.kind === "pdf" &&
    sourceBundle?.pdf &&
    sourceBundle.previousPdf &&
    sourceBundle.revisionEdge?.currentFileId === sourceBundle.pdf.id &&
    sourceBundle.revisionEdge.currentSha256 === sourceBundle.pdf.sha256 &&
    sourceBundle.revisionEdge.previousFileId === sourceBundle.previousPdf.id &&
    sourceBundle.revisionEdge.previousSha256 === sourceBundle.previousPdf.sha256
      ? sourceBundle.previousPdf
      : null;
  const exactPreviousPdf =
    previousPdfEvidence &&
    previousPdfCapability?.id === previousPdfEvidence.id &&
    previousPdfCapability.sha256 === previousPdfEvidence.sha256
      ? previousPdfCapability
      : null;
  const activePdfPageNumber =
    background.kind === "pdf" ? background.pageNumber : null;
  useEffect(() => {
    setPdfCompareTransition((transition) => ({
      generation: transition.generation + 1,
      mode: "current",
    }));
    setPdfDiffGeneration(0);
    setPdfCompareState({ status: "idle", markers: [] });
    setPreviousPdfCapability(null);
    pendingPdfCompareRequestRef.current = null;
  }, [
    background.kind === "pdf" ? background.pageNumber : 0,
    previousPdfEvidence?.id,
    previousPdfEvidence?.sha256,
  ]);
  useEffect(() => {
    const request = pendingPdfCompareRequestRef.current;
    if (
      !request ||
      pdfCompareFetcher.state !== "idle" ||
      pdfCompareFetcher.data === request.dataBeforeRequest
    )
      return;
    pendingPdfCompareRequestRef.current = null;
    handledPdfCompareTransitionRef.current = pdfCompareTransition.generation;
    const candidate =
      pdfCompareFetcher.data?.kind === "pdf_compare" &&
      pdfCompareFetcher.data.ok
        ? pdfCompareFetcher.data.previousPdf
        : null;
    if (
      pdfCompareMode !== "current" &&
      previousPdfEvidence &&
      sourceBundle?.revisionEdge?.id === request.revisionEdgeId &&
      sourceBundle.revisionEdge.currentFileId === request.currentFileId &&
      sourceBundle.revisionEdge.currentSha256 === request.currentSha256 &&
      previousPdfEvidence.id === request.previousFileId &&
      previousPdfEvidence.sha256 === request.previousSha256 &&
      activePdfPageNumber === request.pageNumber &&
      candidate?.id === previousPdfEvidence.id &&
      candidate.sha256 === previousPdfEvidence.sha256
    )
      setPreviousPdfCapability(candidate);
  }, [
    pdfCompareFetcher.data,
    pdfCompareMode,
    pdfCompareFetcher.state,
    pdfCompareTransition.generation,
    activePdfPageNumber,
    previousPdfEvidence?.id,
    previousPdfEvidence?.sha256,
    sourceBundle?.revisionEdge,
  ]);
  useEffect(() => {
    if (
      handledPdfCompareTransitionRef.current === pdfCompareTransition.generation
    )
      return;
    if (pdfCompareMode === "current") {
      handledPdfCompareTransitionRef.current = pdfCompareTransition.generation;
      if (pdfCompareFetcher.state !== "idle")
        pdfCompareFetcher.submit(
          { intent: "cancel_pdf_compare" },
          { method: "post" },
        );
      return;
    }
    if (!previousPdfEvidence || exactPreviousPdf) {
      handledPdfCompareTransitionRef.current = pdfCompareTransition.generation;
      return;
    }
    if (pdfCompareFetcher.state !== "idle") return;
    handledPdfCompareTransitionRef.current = pdfCompareTransition.generation;
    const edge = sourceBundle?.revisionEdge;
    if (!edge || activePdfPageNumber === null) return;
    const form = new FormData();
    form.set("intent", "load_pdf_compare");
    form.set("revision_edge_id", edge.id);
    form.set("current_file_id", edge.currentFileId);
    form.set("current_sha256", edge.currentSha256);
    form.set("previous_file_id", previousPdfEvidence.id);
    form.set("previous_sha256", previousPdfEvidence.sha256);
    form.set("page_number", String(activePdfPageNumber));
    pendingPdfCompareRequestRef.current = {
      currentFileId: edge.currentFileId,
      currentSha256: edge.currentSha256,
      dataBeforeRequest: pdfCompareFetcher.data,
      pageNumber: activePdfPageNumber,
      previousFileId: previousPdfEvidence.id,
      previousSha256: previousPdfEvidence.sha256,
      revisionEdgeId: edge.id,
    };
    pdfCompareFetcher.submit(form, { method: "post" });
  }, [
    activePdfPageNumber,
    exactPreviousPdf,
    pdfCompareFetcher,
    pdfCompareMode,
    pdfCompareTransition.generation,
    previousPdfEvidence,
    sourceBundle?.revisionEdge,
  ]);
  const requestPdfCompareMode = useCallback(
    (mode: "current" | "overlay" | "previous") => {
      setPdfCompareTransition((transition) => ({
        generation: transition.generation + 1,
        mode,
      }));
      if (mode !== "current") return;
      setPreviousPdfCapability(null);
      setPdfDiffGeneration(0);
      setPdfCompareState({ status: "idle", markers: [] });
      pendingPdfCompareRequestRef.current = null;
    },
    [],
  );
  const pdfCompareTransitionPending =
    pdfCompareMode !== "current" &&
    !exactPreviousPdf &&
    (pdfCompareFetcher.state !== "idle" ||
      handledPdfCompareTransitionRef.current !==
        pdfCompareTransition.generation);
  const pdfCompare = useMemo(
    () =>
      background.kind === "pdf" && exactPreviousPdf
        ? {
            generation: pdfDiffGeneration,
            mode: pdfCompareMode,
            opacity: pdfCompareOpacity,
            previousPageNumber: background.pageNumber,
            previousSignedUrl: exactPreviousPdf.signedUrl,
          }
        : null,
    [
      background.kind,
      background.kind === "pdf" ? background.pageNumber : 0,
      exactPreviousPdf?.id,
      exactPreviousPdf?.sha256,
      exactPreviousPdf?.signedUrl,
      pdfCompareMode,
      pdfCompareOpacity,
      pdfDiffGeneration,
    ],
  );
  const exportCheckpointReady = drawingExportCheckpointReady({
    authoritativeCheckpointKey: authoritativeSnapshotKey,
    installedCheckpointKey: installedExportCheckpointKey,
    operationSequence: collaborationBootstrap?.operationSequence ?? null,
    revalidationPending:
      exportCheckpointRevalidationPending ||
      realtimeCheckpointRevalidationPending ||
      revalidator.state !== "idle",
  });
  const measurementEvidenceConsumerVisible =
    activePanel === "schedules" ||
    (inspectorOpen &&
      inspectorMode === "object" &&
      Boolean(
        selectedQuantityObject &&
          drawingObjectSupportsMeasurement(selectedQuantityObject),
      ));
  const deferredMeasurementEvidence =
    useDeferredDrawingMeasurementEvidenceResource({
      bootstrap: collaborationBootstrap,
      enabled: drawingMeasurementEvidenceResourceReady({
        checkpointReady: exportCheckpointReady,
        consumerVisible: measurementEvidenceConsumerVisible,
        saved: saveStatus === "저장됨",
      }),
      onCheckpointStale: revalidator.revalidate,
      url: measurementEvidenceUrl,
    });
  const resolvedMeasurementEvidence =
    measurementEvidence ?? deferredMeasurementEvidence.evidence;
  const resolvedMeasurementEvidenceError =
    measurementEvidenceError ?? deferredMeasurementEvidence.error;
  const sourceAttachPending =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "attach_source";
  const nativeImportReady = nativeDrawingSymbolImportReady({
    canEdit: baseCanEdit && effectiveRevisionStatus === "draft" && !previewMode,
    online: saveState.online,
    outboxReady,
    checkpointReady: exportCheckpointReady,
    localMutationCount,
    volatileCount: persistenceState.volatileCount,
    saved: saveStatus === "저장됨",
    pending: nativeImportPending,
  });
  const importNativeSymbol = async (key: string, clientRequestId: string) => {
    if (!nativeImportReady || nativeImportPendingRef.current || commandQueueSizeRef.current !== 0)
      throw new Error("연결과 저장이 완료된 뒤 기본 심볼을 추가하세요.");
    nativeImportPendingRef.current = true;
    setNativeImportPending(true);
    try {
      const form = new FormData();
      for (const [name, value] of Object.entries({ intent: "import_native_symbol", key, version: "1", revisionId: drawingStateRef.current.revisionId, clientRequestId })) form.set(name, value);
      const actionUrl = `${drawingWorkspaceOperationLocation({ previewMode: false, projectId, workspaceId: workspace.document.id })}?revision=${encodeURIComponent(drawingStateRef.current.revisionId)}`;
      const response = await fetch(actionUrl, { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok || result.ok !== true || result.kind !== "native_symbol_import")
        throw new Error(result.error || "기본 심볼을 추가하지 못했습니다. 같은 요청으로 다시 시도하세요.");
      await revalidator.revalidate();
    } finally {
      nativeImportPendingRef.current = false;
      setNativeImportPending(false);
    }
  };
  const sourceAttachReady = Boolean(
    !file &&
      sourceAttach?.canvasId &&
      baseCanEdit &&
      authorityCanWrite &&
      (effectiveCapability === "admin" || effectiveCapability === "editor") &&
      effectiveRevisionStatus === "draft" &&
      outboxReady &&
      saveStatus === "저장됨",
  );
  const dxfImportPending = dxfImportFetcher.state !== "idle";
  const dxfImportReady = Boolean(
    dxfImportCreatedAt &&
      drawingState.activeCanvasId &&
      baseCanEdit &&
      authorityCanWrite &&
      (effectiveCapability === "admin" || effectiveCapability === "editor") &&
      effectiveRevisionStatus === "draft" &&
      outboxReady &&
      exportCheckpointReady &&
      localMutationCount === 0 &&
      persistenceState.volatileCount === 0 &&
      !persistenceState.failed &&
      saveStatus === "저장됨" &&
      !dxfImportPending,
  );
  const nativeDwgCanRequest = baseCanEdit && authorityCanWrite &&
    (effectiveCapability === "admin" || effectiveCapability === "editor") &&
    effectiveRevisionStatus === "draft" && !previewMode;
  // Ignore only this queued import's bookkeeping count when rechecking readiness.
  // The button still requires zero local mutations; the callback requires exactly its own one.
  const nativeDwgPersistenceReady = nativeDwgCanRequest && saveState.online && outboxReady &&
    exportCheckpointReady && persistenceState.volatileCount === 0 &&
    !persistenceState.failed && drawingSaveStatus({ ...saveState, volatileCount: persistenceState.volatileCount, localMutationCount: 0 }) === "저장됨" && !dxfImportPending;
  const nativeDwgImportReady = nativeDwgPersistenceReady && localMutationCount === 0;
  const nativeDwgTargetKey = [currentUserId, revision.project_id, workspace.document.id, revision.id, drawingState.activeCanvasId].join(":");
  const nativeDwgApplyContextRef = useRef({ key: nativeDwgTargetKey, ready: nativeDwgPersistenceReady, sources: availableDwgSources });
  nativeDwgApplyContextRef.current = { key: nativeDwgTargetKey, ready: nativeDwgPersistenceReady, sources: availableDwgSources };
  useEffect(() => { setNativeDwgImportStatus(null); }, [nativeDwgTargetKey]);
  const applyPreparedNativeDwgImport = async (plan: PreparedNativeDrawingDwgProjectImport) => {
    if (!nativeDwgImportReady || commandQueueSizeRef.current !== 0)
      throw new DrawingNativeDwgImportClientError("현재 작업을 저장하고 체크포인트를 동기화한 뒤 DWG를 가져오세요.");
    const expectedTarget = nativeDwgTargetKey;
    let failure: unknown;
    const completed = await enqueueDrawingMutation(async latest => {
      const assertCurrentTarget = () => {
        const current = nativeDwgApplyContextRef.current;
        if (current.key !== expectedTarget || !current.ready || !authorityCanWriteRef.current ||
          revisionStatusRef.current !== "draft" || !navigator.onLine ||
          undurableMutationCountRef.current !== 1 || latest.revisionId !== revision.id ||
          !drawingState.activeCanvasId || !latest.structure?.canvases[drawingState.activeCanvasId] ||
          !plan.operations.length || !plan.sources.length ||
          plan.operations.some(operation => operation.revisionId !== latest.revisionId) ||
          plan.layers.some(layer => layer.canvasId !== drawingState.activeCanvasId) ||
          plan.sources.some(source => !current.sources.some(file => file.id === source.sourceFileId && file.sha256 === source.sourceSha256)))
          throw new DrawingNativeDwgImportClientError("DWG 대상 캔버스, 원본 또는 편집 권한이 변경되었습니다. 현재 대상에서 다시 확인하세요.");
      };
      // Recheck in the serialized mutation, not just when the button was clicked.
      assertCurrentTarget();
      const bridge = collaborationCommandRef.current;
      if (!bridge) throw new DrawingNativeDwgImportClientError("DWG 편집 연결이 아직 준비되지 않았습니다.");
      const prepared = await applyNativeDrawingDwgImportOperations(latest, currentUserId, plan.operations, plan.canonicalReceipts);
      assertCurrentTarget();
      if (bridge !== collaborationCommandRef.current) throw new DrawingNativeDwgImportClientError("DWG 편집 연결이 변경되었습니다. 다시 확인하세요.");
      nativeDwgImportSendGate.rememberPrepared(plan.requestId, plan.operations);
      if (prepared.canonicalHistoryState) bridge.hydrateCanonicalHistory(prepared.canonicalHistoryState);
      for (const applied of prepared.applied) await persistDrawingRecordedOperation(bridge, applied);
      setNativeDwgImportStatus(prepared.canonicalDisposition === "reverted"
        ? "이 DWG 가져오기는 후속 이력에서 취소되었습니다. 원본 작업을 재전송하지 않았습니다."
        : prepared.canonicalDisposition === "history_advanced"
          ? `DWG 객체 ${plan.coverage.importedEntities}개가 후속 이력과 함께 이미 반영되어 있습니다.`
          : prepared.applied.length === 0
            ? `DWG 객체 ${plan.coverage.importedEntities}개가 이미 정확히 반영되어 있습니다.`
            : `DWG 객체 ${plan.coverage.importedEntities}개와 원본 계보를 저장 대기열에 추가했습니다. 상단 ‘저장됨’을 확인하세요.`);
      const editableLayer = plan.layers.find(layer => layer.visible && !layer.locked);
      if (editableLayer) setAuthorizedActiveLayer(editableLayer.id);
      return prepared.state;
    }, cause => {
      failure = cause;
      if (!(cause instanceof DrawingNativeDwgImportClientError)) markStorageFailed(cause);
    });
    if (!completed) throw failure ?? new DrawingNativeDwgImportClientError("DWG 가져오기를 시작하지 못했습니다. 현재 편집 상태를 확인하세요.");
  };
  useEffect(() => {
    if (dxfImportFetcher.state !== "idle" || !dxfImportFetcher.data) return;
    const response = dxfImportFetcher.data;
    if (!response.ok) {
      setDxfImportStatus(response.error);
      return;
    }
    const plan = response.result;
    const blocking = plan.report.blocking[0];
    if (blocking) {
      setDxfImportStatus(
        blocking.code === "UNIT_REQUIRED"
          ? "DXF 단위를 확인할 수 없습니다. 단위를 선택한 뒤 다시 가져오세요."
          : `DXF를 가져올 수 없습니다: ${blocking.detail}`,
      );
      return;
    }
    if (!plan.requestId || plan.operations.length === 0) {
      setDxfImportStatus("가져올 수 있는 DXF 객체가 없습니다.");
      return;
    }
    const planRequestId = plan.requestId;
    if (handledDxfImportRequestRef.current === planRequestId) return;
    const bridge = collaborationCommandRef.current;
    if (!dxfImportReady || !bridge) {
      setDxfImportStatus(
        "현재 작업을 모두 저장한 뒤 DXF 가져오기를 다시 시도합니다.",
      );
      return;
    }
    handledDxfImportRequestRef.current = planRequestId;
    enqueueDrawingMutation(
      async (latest) => {
        const prepared = await applyDrawingDxfImportOperations(
          latest,
          currentUserId,
          plan.operations,
          plan.canonicalReceipts,
        );
        dxfImportSendGate.rememberPrepared(planRequestId, plan.operations);
        if (prepared.canonicalHistoryState)
          bridge.hydrateCanonicalHistory(prepared.canonicalHistoryState);
        for (const applied of prepared.applied)
          await persistDrawingRecordedOperation(bridge, applied);
        const imported = plan.report.imported;
        setDxfImportStatus(
          prepared.canonicalDisposition === "reverted"
            ? "이 DXF 가져오기는 후속 변경으로 이미 취소되었습니다. 원본 작업은 재전송하지 않았으며 새 가져오기 시도가 필요합니다."
            : prepared.canonicalDisposition === "history_advanced"
              ? `DXF 객체 ${imported}개가 후속 이력과 함께 이미 반영되어 있습니다.`
              : prepared.applied.length === 0
                ? `DXF 객체 ${imported}개가 이미 정확히 반영되어 있습니다.`
                : `DXF 객체 ${imported}개와 원본 계보를 저장 대기열에 추가했습니다.`,
        );
        const editableLayer = plan.layers.find(
          (layer) => layer.visible && !layer.locked,
        );
        if (editableLayer) setAuthorizedActiveLayer(editableLayer.id);
        return prepared.state;
      },
      (error) => {
        handledDxfImportRequestRef.current = null;
        setDxfImportStatus(
          error instanceof DrawingDxfImportClientError
            ? error.message
            : "DXF 작업을 로컬 저장소에 기록하지 못했습니다.",
        );
        if (!(error instanceof DrawingDxfImportClientError))
          markStorageFailed(error);
      },
    );
  }, [
    currentUserId,
    dxfImportFetcher.data,
    dxfImportFetcher.state,
    dxfImportReady,
    dxfImportSendGate,
    enqueueDrawingMutation,
    markStorageFailed,
    setAuthorizedActiveLayer,
  ]);
  const decisionFields = reviewControls.decisionEvidence
    ? drawingRevisionDecisionFields({
        revisionId: revision.id,
        evidence: reviewControls.decisionEvidence,
        decision: effectiveCapability === "approver" ? "approved" : "reviewed",
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
        await prepareDrawingWorkspaceReview({
          drainCommands: () => commandQueueRef.current,
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
    <main className="drawing-workspace flex min-h-screen flex-col bg-slate-950 text-slate-100 xl:h-dvh xl:min-h-0 xl:overflow-hidden xl:[contain:strict]">
      {previewHarness?.verticalTest ||
      previewHarness?.p5IfcTest ||
      previewHarness?.p5PdfTest ? (
        <aside
          aria-label={
            previewHarness.p5IfcTest || previewHarness.p5PdfTest
              ? "P5 mounted command controls"
              : "P4 mounted command controls"
          }
          className="fixed bottom-14 right-3 z-[60] flex gap-2 rounded-md bg-slate-950 p-2 text-xs"
        >
          {previewHarness.p5IfcTest || previewHarness.p5PdfTest ? (
            <>
              <button
                onClick={() => {
                  const source = previewHarness.p5IfcTest
                    ? Object.values(
                        drawingStateRef.current.structure?.sources ?? {},
                      ).find(
                        (candidate) => candidate.sourceKind === "ifc_element",
                      )
                    : null;
                  const objectId =
                    source?.objectId ??
                    Object.keys(drawingStateRef.current.objects)[1];
                  if (objectId) setAuthorizedSelection([objectId]);
                }}
                type="button"
              >
                P5 연결 객체 선택
              </button>
              <button onClick={() => setAuthorizedSelection([])} type="button">
                P5 도면 선택 해제
              </button>
            </>
          ) : null}
          {previewHarness.verticalTest ? (
            <>
              <button
                onClick={() => {
                  const object = Object.values(
                    drawingStateRef.current.objects,
                  ).find((candidate) => candidate.geometry.type === "line");
                  if (object) setAuthorizedSelection([object.id]);
                }}
                type="button"
              >
                P4 첫 선 객체 선택
              </button>
              <button
                onClick={() => void runVerticalInvalidShrink()}
                type="button"
              >
                P4 선택 벽 잘못 축소 시도
              </button>
              <button onClick={runVerticalHostedWallDelete} type="button">
                P4 선택 벽과 개구부 원자 삭제
              </button>
              <button
                disabled={!outboxReady}
                onClick={runVerticalHostedWallUndo}
                type="button"
              >
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
            </>
          ) : null}
          <output aria-label="P4 mounted command result">
            {verticalTestStatus}
          </output>
        </aside>
      ) : null}
      <header className="drawing-workspace-topbar flex min-h-14 flex-wrap items-center gap-2 border-b border-white/10 bg-slate-900 px-2 py-1.5 sm:px-3">
        <Link
          aria-label="협업 도면실로 돌아가기"
          className="inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white"
          to={roomUrl}
        >
          <ArrowLeft className="size-4" />
          <span className="drawing-workspace-topbar-label">협업 도면실</span>
        </Link>
        {boqReturnHref ? (
          <Link
            className="inline-flex min-h-10 items-center rounded-md px-2 text-sm font-semibold text-indigo-200 hover:bg-white/10 hover:text-white"
            to={boqReturnHref}
          >
            내역으로 돌아가기
          </Link>
        ) : null}
        <div className="drawing-workspace-topbar-title min-w-0 flex-1 border-l border-white/10 pl-3">
          <DrawingDocumentTitle
            canRename={
              !previewMode &&
              effectiveRevisionStatus === "draft" &&
              (effectiveCapability === "admin" ||
                effectiveCapability === "editor")
            }
            previewMode={previewMode}
            title={drawingDocument.title}
          />
          <p className="drawing-workspace-topbar-subtitle truncate text-xs text-slate-400">
            도면 작업실 · {file?.original_filename ?? "원본 없음 · 빈 캔버스"}
          </p>
        </div>
        <div className="drawing-workspace-topbar-actions flex flex-wrap items-center gap-1">
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
            className={`drawing-workspace-presence-status inline-flex min-h-9 items-center px-2 text-xs ${realtime.phase === "connected" ? "text-emerald-300" : realtime.phase === "disconnected" ? "text-amber-300" : "text-slate-300"}`}
            role="status"
          >
            <span
              aria-hidden="true"
              className="drawing-workspace-status-dot size-2 rounded-full bg-current"
            />
            <span className="drawing-workspace-status-message">
              {realtime.message}
            </span>
          </span>
          <DrawingCollaborationConnectionStatus
            enabled={collaborationEnabled}
            phase={collaborationPhase}
            readOnly={!authorityCanWrite}
            store={awarenessStoreRef.current}
          />
          {collaborationEnabled ? (
            <DrawingCollaborationParticipants
              store={awarenessStoreRef.current}
            />
          ) : null}
          <DrawingShareControls
            capability={effectiveCapability}
            revisionStatus={effectiveRevisionStatus}
            shares={drawingShares}
            snapshotReady={Boolean(collaborationBootstrap?.sha256)}
          />
          <DrawingExportLauncher
            auditRequired={!previewMode}
            checkpointSha256={collaborationBootstrap?.sha256 ?? null}
            createdAt={drawingDocument.created_at}
            documentState={drawingState}
            operationCheckpoint={
              collaborationBootstrap?.operationSequence ?? null
            }
            outboxReady={outboxReady && exportCheckpointReady}
            projectId={projectId}
            revisionId={revision.id}
            revisionStatus={effectiveRevisionStatus}
            revisionVersion={revision.version}
            saveStatus={saveStatus}
            sourceUrl={primarySourceUrl}
            title={drawingDocument.title}
            workspaceId={drawingDocument.id}
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
            <Form
              id="drawing-review-controls"
              method="post"
              onSubmit={prepareReviewSubmission}
            >
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
                    localMutationCount,
                    saveStatus,
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
                aria-label={
                  effectiveCapability === "approver"
                    ? "도면 최종 승인"
                    : "도면 검토 완료"
                }
                name="decision"
                type="submit"
                value={
                  effectiveCapability === "approver" ? "approved" : "reviewed"
                }
                variant="secondary"
              >
                <Check className="size-4" />
                {effectiveCapability === "approver" ? "최종 승인" : "검토 완료"}
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

      {saveState.conflicted ? (
        <div
          className="border-b border-red-500/30 bg-red-950 px-4 py-2 text-sm text-red-100"
          role="alert"
        >
          <p>
            다른 사용자의 변경과 충돌하여 편집을 중지했습니다. 최신 서버 상태로
            돌아가면 충돌 작업과 그 이후 이 브라우저의 로컬 작업은 폐기되고,
            서버에 이미 저장된 변경은 유지됩니다.
          </p>
          {conflictResolutionError ? (
            <p className="mt-1 text-xs text-red-200">
              정리 실패: {conflictResolutionError}
            </p>
          ) : null}
          {authorityCanWrite &&
          canPersistDrawingMutation(
            effectiveCapability,
            persistenceState,
            effectiveRevisionStatus,
          ) ? (
            <Button
              className="mt-2"
              disabled={conflictResolving}
              onClick={() => {
                const confirmed = window.confirm(
                  "충돌 작업과 그 이후 이 브라우저의 로컬 작업을 폐기하고 최신 상태를 여시겠습니까? 서버에 이미 저장된 변경은 유지됩니다.",
                );
                if (confirmed) void resolveConflictRef.current();
              }}
              size="sm"
              type="button"
              variant="destructive"
            >
              {conflictResolving
                ? "충돌 작업 정리 중…"
                : "충돌 작업 폐기 후 최신 상태 열기"}
            </Button>
          ) : (
            <p className="mt-1 text-xs text-red-200">
              편집 권한이 있는 사용자에게 충돌 정리를 요청하세요.
            </p>
          )}
        </div>
      ) : null}

      {saveState.storageError ? (
        <div
          className="border-b border-red-500/30 bg-red-950 px-4 py-2 text-sm text-red-100"
          data-storage-error-detail={storageErrorDetail ?? undefined}
          role="alert"
        >
          로컬 저장 실패: 이 탭을 닫지 말고 브라우저 저장소 설정을 확인하세요.{" "}
          {storageErrorDetail ? `진단: ${storageErrorDetail} ` : null}
          <Button
            onClick={() => {
              setStorageErrorDetail(null);
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
                } catch (error) {
                  markStorageFailed(error);
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

      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-slate-900 px-3 py-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
          작업
        </span>
        <div
          role="radiogroup"
          aria-label="작업 모드"
          className="flex rounded-lg border border-white/15 bg-slate-950/60 p-1 shadow-inner"
          data-drawing-shortcuts="ignore"
        >
          {drawingWorkspaceModes.map((mode) => (
            <button
              role="radio"
              aria-checked={workspaceMode === mode.id}
              className={`min-h-9 rounded-md px-3 text-xs font-semibold ${workspaceMode === mode.id ? "bg-indigo-500 text-white" : "text-slate-300 hover:bg-white/10"}`}
              id={`drawing-workspace-mode-${mode.id}`}
              key={mode.id}
              onClick={() => showWorkspaceMode(mode.id)}
              onKeyDown={handleWorkspaceModeKeyDown}
              tabIndex={workspaceMode === mode.id ? 0 : -1}
              type="button"
            >
              {mode.label}
            </button>
          ))}
        </div>
        <span aria-hidden="true" className="mx-1 h-6 w-px bg-white/10" />
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
          보기
        </span>
        <div
          aria-label="도면 작업실 보기"
          className="flex rounded-lg border border-white/15 bg-slate-950/60 p-1 shadow-inner"
          role="group"
        >
          {(
            [
              ["2d", "2D 도면"],
              ["3d", "IFC 3D"],
              ["split", "분할 보기"],
            ] as const
          ).map(([mode, label]) => (
            <button
              aria-pressed={activeView === mode}
              className={`min-h-10 rounded-md px-3 text-xs font-semibold ${activeView === mode ? "bg-indigo-500 text-white" : "text-slate-300 hover:bg-white/10"}`}
              disabled={mode !== "2d" && !selectedIfcChoice}
              key={mode}
              onClick={() => updateWorkspaceView(mode)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        {sourceBundle?.error ? (
          <p
            aria-label="도면 원본 오류"
            className="rounded-md border border-amber-400/30 bg-amber-950/60 px-3 py-2 text-xs text-amber-100"
            role="alert"
          >
            {sourceBundle.error}
          </p>
        ) : null}
        {!file && sourceAttach ? (
          <DrawingWorkspaceSourceAttachControl
            attach={sourceAttach}
            canSubmit={sourceAttachReady}
            pending={sourceAttachPending}
            revisionId={revision.id}
            roomUrl={drawingWorkspacePdfUploadPath(
              revision.project_id,
              workspace.document.id,
            )}
          />
        ) : null}
        {sourceBundle && availableDxfSources.length > 0 ? (
          <dxfImportFetcher.Form
            aria-label="DXF 도면 가져오기"
            className="flex flex-wrap items-center gap-2 rounded-lg border border-white/15 bg-slate-950/60 p-1"
            method="post"
            onSubmit={() => setDxfImportStatus("DXF 원본을 검증하는 중입니다.")}
          >
            <input name="intent" type="hidden" value="prepare_dxf_import" />
            <input name="revision_id" type="hidden" value={revision.id} />
            <input
              name="canvas_id"
              type="hidden"
              value={drawingState.activeCanvasId ?? ""}
            />
            <input name="created_at" type="hidden" value={dxfImportCreatedAt} />
            <label className="flex min-h-10 items-center gap-2 text-xs font-semibold text-slate-300">
              DXF 원본
              <select
                aria-label="가져올 DXF 원본"
                className="min-h-10 max-w-64 rounded-md border border-white/15 bg-slate-950 px-2 text-sm text-white"
                defaultValue={uploadedDxfSourceId ?? ""}
                disabled={!dxfImportReady}
                name="source_file_id"
                required
              >
                <option value="">DXF 선택</option>
                {availableDxfSources.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.originalFilename} ·{" "}
                    {drawingSourceFileSize(item.byteSize)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-h-10 items-center gap-2 text-xs font-semibold text-slate-300">
              단위
              <select
                aria-label="DXF 단위"
                className="min-h-10 rounded-md border border-white/15 bg-slate-950 px-2 text-sm text-white"
                disabled={!dxfImportReady}
                name="unit_code"
              >
                <option value="">파일 선언값</option>
                <option value="4">mm</option>
                <option value="5">cm</option>
                <option value="6">m</option>
                <option value="1">in</option>
                <option value="2">ft</option>
              </select>
            </label>
            <button
              className="min-h-10 rounded-md bg-indigo-500 px-3 text-xs font-bold text-white disabled:opacity-50"
              disabled={!dxfImportReady}
              type="submit"
            >
              {dxfImportPending ? "DXF 준비 중" : "DXF 도면 가져오기"}
            </button>
          </dxfImportFetcher.Form>
        ) : null}
        {sourceBundle && authorityCanWrite ? (
          <Link
            className="min-h-10 rounded-md border border-white/15 px-3 py-2 text-xs font-semibold text-slate-200"
            to={drawingWorkspaceDxfUploadPath(
              revision.project_id,
              workspace.document.id,
            )}
          >
            {availableDxfSources.length > 0 ? "새 DXF 업로드" : "DXF 업로드"}
          </Link>
        ) : null}
        {!dxfImportStatus && uploadedDxfSourceId ? (
          <p className="text-xs text-emerald-200" role="status">
            방금 올린 DXF를 선택했습니다. 단위를 확인한 뒤 도면 가져오기를
            실행하세요.
          </p>
        ) : null}
        {dxfImportStatus ? (
          <p className="text-xs text-slate-200" role="status">
            {dxfImportStatus}
          </p>
        ) : null}
        {sourceBundle && drawingState.activeCanvasId ? (
          <DrawingNativeDwgImport
            action={`${drawingWorkspaceOperationLocation({ previewMode: false, projectId: revision.project_id, workspaceId: workspace.document.id })}?revision=${encodeURIComponent(revision.id)}`}
            scope={{ actorId: currentUserId, projectId: revision.project_id, documentId: workspace.document.id, revisionId: revision.id, canvasId: drawingState.activeCanvasId }}
            sources={availableDwgSources}
            initialSourceId={availableDwgSources.some(source => source.id === requestedDwgSourceId) ? requestedDwgSourceId : null}
            canRequest={nativeDwgCanRequest}
            canApply={nativeDwgImportReady}
            online={saveState.online}
            onPrepared={applyPreparedNativeDwgImport}
          />
        ) : null}
        {sourceBundle && authorityCanWrite ? (
          <Link className="min-h-10 rounded-md border border-white/15 px-3 py-2 text-xs font-semibold text-slate-200" to={drawingWorkspaceDwgUploadPath(revision.project_id, workspace.document.id)}>
            {availableDwgSources.length ? "새 DWG 업로드" : "DWG 업로드"}
          </Link>
        ) : null}
        {nativeDwgImportStatus ? <p className="text-xs text-slate-200" role="status">{nativeDwgImportStatus}</p> : null}
        {sourceBundle && availableIfcSources.length > 0 ? (
          <label className="flex min-h-10 items-center gap-2 text-xs font-semibold text-slate-300">
            IFC 파일 선택
            <select
              aria-label="IFC 원본 선택"
              className="min-h-10 max-w-64 rounded-md border border-white/15 bg-slate-950 px-2 text-sm text-white"
              onChange={(event) => {
                const ifcFileId = event.target.value;
                replaceWorkspaceSearchParams((next) => {
                  if (ifcFileId) next.set("ifc", ifcFileId);
                  else {
                    next.delete("ifc");
                    next.set("view", "2d");
                  }
                });
              }}
              value={selectedIfcChoice?.id ?? ""}
            >
              <option value="">IFC 선택 안 함</option>
              {availableIfcSources.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.originalFilename}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {sourceBundle &&
        !sourceBundle.error &&
        availableIfcSources.length > 0 &&
        !selectedIfcChoice ? (
          <p className="text-xs text-amber-200" role="status">
            IFC 파일을 선택하면 3D와 분할 보기를 사용할 수 있습니다.
          </p>
        ) : null}
        {sourceBundle && background.kind === "pdf" ? (
          previousPdfEvidence ? (
            <div
              aria-label="PDF 개정 비교"
              className="flex flex-wrap items-center gap-2 rounded-lg border border-white/15 p-1 text-xs text-white"
              role="group"
            >
              {(
                [
                  ["current", "현재 도면"],
                  ["overlay", "겹쳐 보기"],
                  ["previous", "이전 도면"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  aria-pressed={pdfCompareMode === mode}
                  className={`min-h-9 rounded px-2 font-semibold ${pdfCompareMode === mode ? "bg-amber-400 text-slate-950" : "text-slate-200"}`}
                  key={mode}
                  onClick={() => requestPdfCompareMode(mode)}
                  type="button"
                >
                  {label}
                </button>
              ))}
              <label className="flex min-h-9 items-center gap-2 px-1">
                이전 도면 불투명도
                <input
                  aria-label="이전 도면 불투명도"
                  disabled={pdfCompareMode !== "overlay"}
                  max="100"
                  min="0"
                  onChange={(event) =>
                    setPdfCompareOpacity(Number(event.target.value) / 100)
                  }
                  type="range"
                  value={Math.round(pdfCompareOpacity * 100)}
                />
              </label>
              <button
                className="min-h-9 rounded bg-amber-500 px-3 font-semibold text-slate-950 disabled:opacity-50"
                disabled={pdfCompareMode === "current" || !exactPreviousPdf}
                onClick={() => setPdfDiffGeneration((value) => value + 1)}
                type="button"
              >
                변경 표시 계산
              </button>
              {pdfCompareMode !== "current" && !exactPreviousPdf ? (
                pdfCompareTransitionPending ? (
                  <span role="status">이전 PDF 접근 권한을 요청합니다.</span>
                ) : pdfCompareFetcher.data?.kind === "pdf_compare" &&
                  !pdfCompareFetcher.data.ok ? (
                  <span className="text-amber-200" role="alert">
                    {pdfCompareFetcher.data.error}
                  </span>
                ) : null
              ) : pdfCompareState.status === "loading" ? (
                <span role="status">이전 PDF를 여는 중입니다.</span>
              ) : pdfCompareState.status === "missing" ||
                pdfCompareState.status === "error" ? (
                <span className="text-amber-200" role="alert">
                  {pdfCompareState.message}
                </span>
              ) : pdfCompareState.status === "refused" ? (
                <span className="text-amber-200" role="alert">
                  {pdfCompareState.reason === "rotation_mismatch"
                    ? "회전이 달라 변경 표시를 계산하지 않습니다. 수동 겹쳐 보기는 유지됩니다."
                    : "페이지 비율이 1% 넘게 달라 변경 표시를 계산하지 않습니다. 수동 겹쳐 보기는 유지됩니다."}
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-slate-300" role="status">
              바로 이전 PDF 개정본이 없어 비교할 수 없습니다.
            </p>
          )
        ) : null}
        {activeView === "split" ? (
          <div
            aria-label="분할 보기 패널"
            className="ml-auto flex rounded-md border border-white/15 p-1 md:hidden"
            role="tablist"
          >
            {(
              [
                ["2d", "2D 도면"],
                ["3d", "IFC 3D"],
              ] as const
            ).map(([tab, label]) => (
              <button
                aria-controls={`drawing-split-panel-${tab}`}
                aria-selected={narrowSplitTab === tab}
                className={`min-h-10 rounded px-3 text-xs font-semibold ${narrowSplitTab === tab ? "bg-indigo-500 text-white" : "text-slate-300"}`}
                id={`drawing-split-tab-${tab}`}
                key={tab}
                onClick={() => setNarrowSplitTab(tab)}
                onKeyDown={(event) => {
                  const next =
                    event.key === "Home"
                      ? "2d"
                      : event.key === "End"
                        ? "3d"
                        : event.key === "ArrowLeft" ||
                            event.key === "ArrowRight"
                          ? tab === "2d"
                            ? "3d"
                            : "2d"
                          : null;
                  if (!next) return;
                  event.preventDefault();
                  setNarrowSplitTab(next);
                  document.getElementById(`drawing-split-tab-${next}`)?.focus();
                }}
                role="tab"
                tabIndex={narrowSplitTab === tab ? 0 : -1}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        {workspaceNotice ? (
          <p
            className="rounded-full bg-amber-300 px-3 py-1.5 text-xs font-bold text-slate-950"
            role="status"
          >
            {workspaceNotice}
          </p>
        ) : null}
      </div>

      <div
        data-inspector-open={inspectorOpen ? "true" : "false"}
        data-left-dock-open={leftDockOpen ? "true" : "false"}
        className={`drawing-workspace-shell grid min-h-0 flex-1 grid-cols-1 ${leftDockOpen && inspectorOpen ? "xl:grid-cols-[15rem_minmax(0,1fr)_18rem]" : leftDockOpen ? "xl:grid-cols-[15rem_minmax(0,1fr)]" : inspectorOpen ? "xl:grid-cols-[minmax(0,1fr)_18rem]" : "xl:grid-cols-[minmax(0,1fr)]"} xl:overflow-hidden`}
      >
        <aside
          aria-label="도면 도구 패널"
          className="drawing-workspace-tools order-2 flex min-h-0 max-h-[32rem] flex-col overflow-hidden border-b border-white/10 bg-slate-900 xl:order-1 xl:max-h-[calc(100vh-3.5rem)] xl:border-b-0 xl:border-r"
          hidden={!leftDockOpen}
        >
          <div
            role="tablist"
            aria-label="도면 도구"
            data-drawing-shortcuts="ignore"
            className="grid shrink-0 grid-cols-4 gap-1 border-b border-white/10 p-2 xl:grid-cols-2"
          >
            {drawingWorkspacePanels
              .filter((panel) => visiblePanels.includes(panel.id))
              .map((panel) => {
                const selected = activePanel === panel.id;
                return (
                  <button
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`drawing-panel-${panel.id}`}
                    className={`min-h-9 shrink-0 rounded-md px-2 text-xs font-semibold ${selected ? "bg-indigo-500 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}
                    id={`drawing-panel-tab-${panel.id}`}
                    key={panel.id}
                    onClick={() => showWorkspacePanel(panel.id)}
                    onKeyDown={(event) => {
                      const nextPanel = resolveDrawingWorkspacePanelKey(
                        activePanel,
                        event.key,
                        visiblePanels,
                      );
                      if (!nextPanel) return;
                      event.preventDefault();
                      showWorkspacePanel(nextPanel);
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
          <DrawingWorkspaceTabPanel
            active={activePanel === "collaboration"}
            mounted={visitedPanels.has("collaboration")}
            role="tabpanel"
            aria-labelledby="drawing-panel-tab-collaboration"
            className="min-h-0 flex-1 overflow-y-auto p-3"
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
              {revisionRelinkResult ? (
                <p
                  className="rounded-md border border-emerald-400/30 bg-emerald-950/60 p-2 text-xs text-emerald-100"
                  role="status"
                >
                  새 개정본의 근거로 교체했습니다 · 신규 근거{" "}
                  {revisionRelinkResult.newAnchorId.slice(0, 8)}
                </p>
              ) : null}
              {revisionRelinkMessage ? (
                <p className="rounded-md bg-white/5 p-2 text-xs" role="status">
                  {revisionRelinkMessage}
                </p>
              ) : null}
              {visibleRevisionReview.length ? (
                <section
                  aria-label="개정 근거 재연결"
                  className="space-y-2 rounded-md border border-amber-300/30 bg-amber-950/30 p-2"
                >
                  <div>
                    <h3 className="text-xs font-bold text-amber-100">
                      개정 도면 재검토 {visibleRevisionReview.length}건
                    </h3>
                    <p className="mt-1 text-xs text-amber-100/80">
                      이전 좌표를 복사하지 않고 새 원본에서 직접 확인한 뒤
                      교체합니다.
                    </p>
                  </div>
                  {visibleRevisionReview.map((candidate) => {
                    const active =
                      revisionRelinkDraft?.candidate.previousAnchorId ===
                      candidate.previousAnchorId;
                    const sourceMatches =
                      (file?.kind === "pdf" &&
                        candidate.sourceKind === "pdf_region") ||
                      (file?.kind === "ifc" &&
                        candidate.sourceKind === "ifc_element");
                    return (
                      <article
                        className="space-y-2 rounded-md border border-white/10 bg-slate-950/70 p-2"
                        key={candidate.previousAnchorId}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-white">
                              {candidate.issueTitle}
                            </p>
                            <p className="mt-1 text-[11px] text-slate-400">
                              {candidate.sourceKind === "pdf_region"
                                ? "PDF 영역"
                                : "IFC 요소"}
                              {candidate.kind === "ifc_candidate"
                                ? " · GlobalId 후보 있음"
                                : " · 수동 확인 필요"}
                            </p>
                          </div>
                          <button
                            aria-pressed={active}
                            className="min-h-9 shrink-0 rounded-md border border-amber-300/50 px-2 text-xs font-semibold text-amber-100 disabled:opacity-40"
                            disabled={!canComment || !sourceMatches}
                            onClick={() => startRevisionRelink(candidate)}
                            type="button"
                          >
                            {active ? "검토 중인 후보" : "후보 검토"}
                          </button>
                        </div>
                        {active && revisionRelinkDraft ? (
                          <div className="space-y-2">
                            {candidate.sourceKind === "pdf_region" ? (
                              <>
                                <p className="text-xs text-slate-300">
                                  PDF 좌표는 자동 복사하지 않습니다. 새 도면에서
                                  영역을 다시 선택하세요.
                                </p>
                                <fieldset
                                  aria-label="PDF 근거 영역 좌표 입력"
                                  className="space-y-2 rounded-md border border-white/10 p-2"
                                >
                                  <legend className="px-1 text-xs font-semibold text-slate-200">
                                    키보드 좌표 입력
                                  </legend>
                                  <p className="text-[11px] text-slate-400">
                                    현재 PDF 페이지 기준 백분율로 입력합니다.
                                  </p>
                                  <div className="grid grid-cols-2 gap-2">
                                    {(
                                      [
                                        ["x", "왼쪽 위치 (%)"],
                                        ["y", "위쪽 위치 (%)"],
                                        ["width", "너비 (%)"],
                                        ["height", "높이 (%)"],
                                      ] as const
                                    ).map(([field, label]) => (
                                      <label
                                        className="space-y-1 text-[11px] text-slate-300"
                                        key={field}
                                      >
                                        <span>{label}</span>
                                        <input
                                          className="min-h-9 w-full rounded-md border border-white/20 bg-slate-950 px-2 text-xs text-white"
                                          inputMode="decimal"
                                          max={100}
                                          min={0}
                                          onChange={(event) =>
                                            setRevisionRelinkPdfCoordinates(
                                              (current) => ({
                                                ...current,
                                                [field]: event.target.value,
                                              }),
                                            )
                                          }
                                          step="0.01"
                                          type="number"
                                          value={
                                            revisionRelinkPdfCoordinates[field]
                                          }
                                        />
                                      </label>
                                    ))}
                                  </div>
                                  <button
                                    className="min-h-9 w-full rounded-md border border-amber-300/50 px-2 text-xs font-semibold text-amber-100"
                                    disabled={!pdfPageTransform}
                                    onClick={applyRevisionRelinkPdfCoordinates}
                                    type="button"
                                  >
                                    입력 좌표 적용
                                  </button>
                                </fieldset>
                                <button
                                  className="min-h-9 w-full rounded-md border border-white/20 px-2 text-xs font-semibold"
                                  disabled={!pdfPageTransform}
                                  onClick={() => {
                                    setRevisionRelinkDraft((current) =>
                                      current
                                        ? { ...current, anchor: null }
                                        : null,
                                    );
                                    setRevisionRelinkMessage(
                                      "새 PDF에서 영역을 직접 드래그해 주세요.",
                                    );
                                  }}
                                  type="button"
                                >
                                  영역 지정
                                </button>
                              </>
                            ) : (
                              <p className="text-xs text-slate-300">
                                새 IFC에서 요소를 선택하고 “이 요소를 이슈
                                근거로 사용”을 누르세요.
                              </p>
                            )}
                            <p className="text-xs text-slate-400">
                              {revisionRelinkDraft.anchor
                                ? revisionRelinkDraft.anchor.kind ===
                                  "pdf_region"
                                  ? `${revisionRelinkDraft.anchor.pageNumber}쪽 새 영역 선택됨`
                                  : `IFC #${revisionRelinkDraft.anchor.elementId} 선택됨`
                                : "새 근거를 선택하기 전에는 교체할 수 없습니다."}
                            </p>
                            <Form
                              aria-label="개정 근거 원자적 교체"
                              className="space-y-2"
                              method="post"
                            >
                              <input
                                name="intent"
                                type="hidden"
                                value="relink_anchor"
                              />
                              <input
                                name="previous_anchor_id"
                                type="hidden"
                                value={candidate.previousAnchorId}
                              />
                              <input
                                name="new_anchor_id"
                                type="hidden"
                                value={revisionRelinkDraft.newAnchorId}
                              />
                              <input
                                name="current_file_id"
                                type="hidden"
                                value={file?.id ?? ""}
                              />
                              <input
                                name="anchor_json"
                                type="hidden"
                                value={JSON.stringify(
                                  revisionRelinkDraft.anchor,
                                )}
                              />
                              <label
                                className="block text-xs font-semibold"
                                htmlFor={`revision-relink-note-${candidate.previousAnchorId}`}
                              >
                                교체 검토 메모
                              </label>
                              <textarea
                                className="min-h-20 w-full rounded-md border border-white/20 bg-slate-950 p-2 text-xs"
                                id={`revision-relink-note-${candidate.previousAnchorId}`}
                                maxLength={1000}
                                name="note"
                                required
                              />
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  className="min-h-10 rounded-md border border-white/20 px-2 text-xs font-semibold"
                                  onClick={() => {
                                    setRevisionRelinkDraft(null);
                                    setRevisionRelinkMessage(null);
                                  }}
                                  type="button"
                                >
                                  취소
                                </button>
                                <button
                                  className="min-h-10 rounded-md bg-amber-400 px-2 text-xs font-bold text-slate-950 disabled:opacity-40"
                                  disabled={
                                    !revisionRelinkDraft.anchor ||
                                    navigation.state !== "idle"
                                  }
                                  type="submit"
                                >
                                  원자적으로 근거 교체 확인
                                </button>
                              </div>
                            </Form>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                  {revisionReviewPreviousHref ? (
                    <Link
                      className="block min-h-9 rounded-md border border-amber-300/50 px-2 py-2 text-center text-xs font-semibold text-amber-100"
                      preventScrollReset
                      to={revisionReviewPreviousHref}
                    >
                      이전 50개 검토 후보 보기
                    </Link>
                  ) : null}
                  {revisionReviewNextHref ? (
                    <Link
                      className="block min-h-9 rounded-md border border-amber-300/50 px-2 py-2 text-center text-xs font-semibold text-amber-100"
                      preventScrollReset
                      to={revisionReviewNextHref}
                    >
                      다음 50개 검토 후보 보기
                    </Link>
                  ) : null}
                </section>
              ) : null}
              {canComment ? (
                <Form
                  className="space-y-2 rounded-md border border-white/10 p-2"
                  method="post"
                >
                  <input name="intent" type="hidden" value="create_issue" />
                  <label
                    className="block text-xs font-semibold"
                    htmlFor="workspace-issue-title"
                  >
                    이슈 제목
                  </label>
                  <input
                    className="min-h-10 w-full rounded-md border border-white/20 bg-slate-950 px-2"
                    id="workspace-issue-title"
                    maxLength={200}
                    name="title"
                    required
                  />
                  <label
                    className="block text-xs font-semibold"
                    htmlFor="workspace-issue-description"
                  >
                    설명
                  </label>
                  <textarea
                    className="min-h-20 w-full rounded-md border border-white/20 bg-slate-950 p-2"
                    id="workspace-issue-description"
                    maxLength={4000}
                    name="description"
                  />
                  <label
                    className="block text-xs font-semibold"
                    htmlFor="workspace-issue-priority"
                  >
                    우선순위
                  </label>
                  <select
                    className="min-h-10 w-full rounded-md border border-white/20 bg-slate-950 px-2"
                    defaultValue="normal"
                    id="workspace-issue-priority"
                    name="priority"
                  >
                    <option value="low">낮음</option>
                    <option value="normal">보통</option>
                    <option value="high">높음</option>
                    <option value="urgent">긴급</option>
                  </select>
                  <button
                    className="min-h-10 w-full rounded-md bg-indigo-500 px-3 text-xs font-bold text-white"
                    type="submit"
                  >
                    새 이슈 만들기
                  </button>
                </Form>
              ) : null}
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
                        disabled={navigation.state !== "idle"}
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

                  {canComment ? (
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
                      >
                        <input
                          name="intent"
                          type="hidden"
                          value="add_canvas_region_anchor"
                        />
                        <input
                          name="issue_id"
                          type="hidden"
                          value={canvasRegionDraft?.issueId ?? ""}
                        />
                        <input
                          name="anchor_id"
                          type="hidden"
                          value={canvasRegionDraft?.anchorId ?? ""}
                        />
                        <input
                          name="revision_id"
                          type="hidden"
                          value={canvasRegionDraft?.revisionId ?? ""}
                        />
                        <input
                          name="page_id"
                          type="hidden"
                          value={canvasRegionDraft?.pageId ?? ""}
                        />
                        <input
                          name="canvas_id"
                          type="hidden"
                          value={canvasRegionDraft?.canvasId ?? ""}
                        />
                        <input
                          name="x_mm"
                          type="hidden"
                          value={canvasRegionDraft?.x ?? ""}
                        />
                        <input
                          name="y_mm"
                          type="hidden"
                          value={canvasRegionDraft?.y ?? ""}
                        />
                        <input
                          name="width_mm"
                          type="hidden"
                          value={canvasRegionDraft?.width ?? ""}
                        />
                        <input
                          name="height_mm"
                          type="hidden"
                          value={canvasRegionDraft?.height ?? ""}
                        />
                        <div className="col-span-2 rounded-md bg-white/5 p-2 text-xs">
                          {canvasRegionPickerArmed ? (
                            <p role="status">
                              캔버스에서 드래그하여 영역을 선택하세요.
                            </p>
                          ) : canvasRegionDraftIsCurrent &&
                            canvasRegionDraft ? (
                            <p>
                              선택 영역 · x{" "}
                              {formatCanvasRegionCoordinate(
                                canvasRegionDraft.x,
                              )}
                              , y{" "}
                              {formatCanvasRegionCoordinate(
                                canvasRegionDraft.y,
                              )}
                              ,{" "}
                              {formatCanvasRegionCoordinate(
                                canvasRegionDraft.width,
                              )}{" "}
                              ×{" "}
                              {formatCanvasRegionCoordinate(
                                canvasRegionDraft.height,
                              )}{" "}
                              mm
                            </p>
                          ) : (
                            <p>영역을 선택하면 좌표가 여기에 표시됩니다.</p>
                          )}
                        </div>
                        <button
                          className="col-span-2 min-h-10 rounded-md border border-amber-300/60 px-3 text-xs font-semibold text-amber-100 disabled:opacity-50"
                          disabled={!canArmCanvasRegionPicker}
                          onClick={() => {
                            setCanvasRegionDraft(null);
                            setCanvasRegionLabel("");
                            setCanvasRegionPickerBoundaryKey(
                              canvasRegionBoundaryKey,
                            );
                          }}
                          type="button"
                        >
                          {canvasRegionDraftIsCurrent
                            ? "캔버스에서 영역 다시 선택"
                            : "캔버스에서 영역 선택"}
                        </button>
                        {canvasRegionPickerArmed ||
                        canvasRegionDraftIsCurrent ? (
                          <button
                            className="col-span-2 min-h-10 rounded-md border border-white/20 px-3 text-xs font-semibold"
                            onClick={() => {
                              setCanvasRegionPickerBoundaryKey(null);
                              setCanvasRegionDraft(null);
                              setCanvasRegionLabel("");
                            }}
                            type="button"
                          >
                            영역 선택 취소
                          </button>
                        ) : null}
                        <label className="col-span-2 text-xs">
                          영역 설명
                          <input
                            className="mt-1 min-h-10 w-full rounded-md border border-white/20 bg-slate-950 px-2"
                            maxLength={240}
                            name="label"
                            onChange={(event) =>
                              setCanvasRegionLabel(event.target.value)
                            }
                            value={canvasRegionLabel}
                          />
                        </label>
                        <button
                          className="col-span-2 min-h-10 rounded-md border border-white/20 px-3 text-xs font-semibold"
                          disabled={!canvasRegionDraftIsCurrent}
                          type="submit"
                        >
                          현재 캔버스 영역 연결
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
                      .filter((anchor) => anchor.issue_id === selectedIssueId)
                      .map((anchor) => (
                        <li
                          className="rounded-md border border-white/10 p-2 text-xs"
                          key={anchor.id}
                        >
                          <p>
                            {anchor.label ||
                              (anchor.anchor_kind === "ifc_element"
                                ? "IFC 요소"
                                : "PDF 영역")}
                          </p>
                          <p className="mt-1 text-slate-400">
                            {anchor.active ? "사용 중" : "해제됨"} · 근거{" "}
                            {anchor.id.slice(0, 8)}
                            {anchor.replaces_anchor_id
                              ? ` · 이전 ${anchor.replaces_anchor_id.slice(0, 8)}`
                              : ""}
                          </p>
                          {anchor.deactivation_note ? (
                            <p className="mt-1 text-slate-500">
                              {anchor.deactivation_note}
                            </p>
                          ) : null}
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
                  <ol className="space-y-2" aria-label="연결된 캔버스 영역">
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
                to={
                  file
                    ? `/projects/${projectId}/drawings/${file.id}`
                    : `/projects/${projectId}`
                }
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
          </DrawingWorkspaceTabPanel>
          <DrawingWorkspaceTabPanel
            active={activePanel === "history"}
            mounted={visitedPanels.has("history")}
            role="tabpanel"
            aria-labelledby="drawing-panel-tab-history"
            className="min-h-0 flex-1 overflow-y-auto p-3"
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
              drawingWorkspaceCanRestoreApprovedSnapshot(
                effectiveCapability,
              ) ? (
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
                      disabled={
                        !outboxReady ||
                        !authorityCanWrite ||
                        !canPersistDrawingMutation(
                          effectiveCapability,
                          persistenceState,
                          effectiveRevisionStatus,
                        )
                      }
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
          </DrawingWorkspaceTabPanel>
          <DrawingWorkspaceTabPanel
            active={activePanel === "structure"}
            mounted={visitedPanels.has("structure")}
            role="tabpanel"
            aria-labelledby="drawing-panel-tab-structure"
            className="min-h-0 flex-1 overflow-y-auto p-3"
            id="drawing-panel-structure"
          >
            {activeCanvas ? (
              <DrawingScaleControl
                actorId={currentUserId}
                canEdit={editing.canEdit}
                canvas={activeCanvas}
                onCalibrationCaptureChange={setCalibrationCapture}
                onCommand={applyCommand}
                state={drawingState}
              />
            ) : null}
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
          </DrawingWorkspaceTabPanel>
          <DrawingWorkspaceTabPanel
            active={activePanel === "styles"}
            mounted={visitedPanels.has("styles")}
            role="tabpanel"
            aria-labelledby="drawing-panel-tab-styles"
            className="min-h-0 flex-1 overflow-y-auto p-3 [&>section]:mt-0 [&>section]:border-t-0 [&>section]:pt-0"
            id="drawing-panel-styles"
          >
            <DrawingStylesPanel
              actorId={currentUserId}
              canEdit={baseCanEdit}
              onCommand={applyCommand}
              persistenceStatus={
                persistenceState.failed || saveState.storageError
                  ? "failed"
                  : saveState.conflicted
                    ? "conflicted"
                    : saveStatus === "저장됨"
                      ? "settled"
                      : "pending"
              }
              state={drawingState}
            />
          </DrawingWorkspaceTabPanel>
          <DrawingWorkspaceTabPanel
            active={activePanel === "properties"}
            mounted={visitedPanels.has("properties")}
            role="tabpanel"
            aria-labelledby="drawing-panel-tab-properties"
            className="min-h-0 flex-1 overflow-y-auto p-3 [&>section]:mt-0 [&>section]:border-t-0 [&>section]:pt-0"
            id="drawing-panel-properties"
          >
            <DrawingPropertiesPanel
              actorId={currentUserId}
              canEdit={baseCanEdit}
              onCommand={applyCommand}
              state={drawingState}
            />
          </DrawingWorkspaceTabPanel>
          <DrawingWorkspaceTabPanel
            active={activePanel === "schedules"}
            mounted={visitedPanels.has("schedules")}
            role="tabpanel"
            aria-labelledby="drawing-panel-tab-schedules"
            className="min-h-0 flex-1 overflow-y-auto p-3 [&>section]:mt-0 [&>section]:border-t-0 [&>section]:pt-0"
            id="drawing-panel-schedules"
          >
            <DrawingTablesPanel
              actorId={currentUserId}
              canEdit={baseCanEdit}
              evidence={resolvedMeasurementEvidence}
              evidenceError={resolvedMeasurementEvidenceError}
              hasUnconfirmedChanges={drawingState.operations.length > 0}
              lineage={measurementLineage}
              onCommand={applyCommand}
              persistenceStatus={
                persistenceState.failed || saveState.storageError
                  ? "failed"
                  : saveState.conflicted
                    ? "conflicted"
                    : saveStatus === "저장됨"
                      ? "settled"
                      : "pending"
              }
              selectedIds={transient.selectedIds}
              state={drawingState}
            />
          </DrawingWorkspaceTabPanel>
          <DrawingWorkspaceTabPanel
            active={activePanel === "blocks"}
            mounted={visitedPanels.has("blocks")}
            role="tabpanel"
            aria-labelledby="drawing-panel-tab-blocks"
            className="min-h-0 flex-1 overflow-y-auto p-3 [&>section]:mt-0 [&>section]:border-t-0 [&>section]:pt-0"
            id="drawing-panel-blocks"
          >
            <DrawingBlocksPanel
              nativeCatalogUrl={previewMode ? undefined : `/projects/${projectId}/drawing-native-assets?kind=block`}
              nativeImportReady={nativeImportReady}
              nativeImportNotice={!saveState.online ? "오프라인입니다. 연결 후 기본 심볼을 추가할 수 있습니다." : nativeImportPending ? "심볼을 추가하고 저장된 도면을 불러오는 중…" : !nativeImportReady ? "편집 가능한 도면의 연결과 저장이 완료되면 추가할 수 있습니다." : null}
              onNativeImport={effectiveCapability === "admin" || effectiveCapability === "editor" ? importNativeSymbol : undefined}
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
          </DrawingWorkspaceTabPanel>
        </aside>

        <section
          aria-label="도면 캔버스"
          className="drawing-workspace-canvas relative order-1 min-h-[34rem] min-w-0 bg-slate-950 xl:order-2 xl:min-h-0 xl:overflow-hidden"
          data-edit-ready={editReady ? "true" : "false"}
          aria-busy={!editReady}
        >
          <div className="absolute left-2 top-2 z-50 flex gap-1 rounded-md bg-slate-950/85 p-1 shadow-lg">
            <Button
              aria-label={`왼쪽 도구 패널 ${leftDockOpen ? "숨기기" : "열기"}`}
              aria-pressed={leftDockOpen}
              className="drawing-workspace-dock-toggle"
              onClick={() => toggleWorkspaceDock("left")}
              size="icon"
              title={`왼쪽 도구 패널 ${leftDockOpen ? "숨기기" : "열기"} ([)`}
              variant="ghost"
            >
              <PanelLeft className="size-4" />
            </Button>
            <Button
              aria-label={`속성 검사기 ${inspectorOpen ? "숨기기" : "열기"}`}
              aria-pressed={inspectorOpen}
              className="drawing-workspace-dock-toggle"
              onClick={() => toggleWorkspaceDock("inspector")}
              size="icon"
              title={`속성 검사기 ${inspectorOpen ? "숨기기" : "열기"} (])`}
              variant="ghost"
            >
              <PanelRight className="size-4" />
            </Button>
          </div>
          <div
            className={
              activeView === "split"
                ? "grid h-full min-h-[34rem] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:min-h-0"
                : "h-full min-h-[34rem] xl:min-h-0"
            }
          >
            <div
              aria-labelledby={
                activeView === "split" && narrowLayout
                  ? "drawing-split-tab-2d"
                  : undefined
              }
              className={`min-h-0 min-w-0 ${activeView === "3d" ? "hidden" : activeView === "split" && narrowSplitTab === "3d" ? "hidden md:block" : "block"}`}
              hidden={
                activeView === "split" &&
                narrowLayout &&
                narrowSplitTab !== "2d"
              }
              id="drawing-split-panel-2d"
              role={
                activeView === "split" && narrowLayout ? "tabpanel" : undefined
              }
            >
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
              {surface.sourceError ? (
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
                  firstPaintLifecycleKey={firstPaintLifecycleKey}
                  onPdfCompareState={setPdfCompareState}
                  onPdfPageTransform={setPdfPageTransform}
                  pdfCompare={pdfCompare}
                  calibration={calibration}
                  calibrationId={calibrationId}
                  dimensionContext={dimensionContext}
                  calibrationCapture={calibrationCapture}
                  regionPicker={revisionRelinkPdfPicker ?? canvasRegionPicker}
                  regionAnnotations={visibleRegionAnnotations}
                  canEdit={editing.canEdit}
                  layerId={editing.layerId}
                  layers={activeDrawingLayers}
                  blockInstances={resolvedBlockInstances.instances}
                  objects={resolvedObjects.objects}
                  onCommand={applyCanvasCommand}
                  onCursorWorldChange={onCanvasCursorWorldChange}
                  onRegionAnnotationSelect={(issueId) => {
                    setSelectedIssueId(issueId);
                    showWorkspacePanel("collaboration");
                    setLeftDockOpen(true);
                    if (tabletLayout) setInspectorOpenOverride(false);
                  }}
                  onSelectionChange={onCanvasSelectionChange}
                  onToolComplete={onCanvasToolComplete}
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
            {selectedIfc && ifcActivated ? (
              <aside
                aria-label="IFC 3D 원본"
                aria-labelledby={
                  activeView === "split" && narrowLayout
                    ? "drawing-split-tab-3d"
                    : undefined
                }
                className={`max-h-[calc(100vh-4rem)] min-w-0 overflow-auto border-t border-white/10 bg-background p-4 text-foreground md:border-l md:border-t-0 ${activeView === "2d" ? "hidden" : activeView === "split" && narrowSplitTab === "2d" ? "hidden md:block" : "block"}`}
                hidden={
                  activeView === "split" &&
                  narrowLayout &&
                  narrowSplitTab !== "3d"
                }
                id="drawing-split-panel-3d"
                role={
                  activeView === "split" && narrowLayout
                    ? "tabpanel"
                    : undefined
                }
              >
                <h2 className="text-sm font-bold">검증된 IFC 파생물 보기</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  GlobalId 연결을 기준으로 2D 객체와 IFC 요소를 함께 찾습니다.
                </p>
                {ifcMatch.status === "ambiguous" ? (
                  <div className="mt-3 rounded-md border p-3 text-sm">
                    <p className="font-semibold">
                      연결된 도면 객체가 여러 개입니다. 이동할 객체를
                      선택하세요.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {ifcMatch.objectIds.map((objectId) => (
                        <button
                          className="min-h-10 rounded-md border px-3 text-xs"
                          key={objectId}
                          onClick={() => selectIfcLinkedObject(objectId)}
                          type="button"
                        >
                          {drawingState.objects[objectId]?.name ?? objectId}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {ifcMatch.status === "no_match" ? (
                  <div className="mt-3 rounded-md border border-amber-400/30 bg-amber-50 p-3 text-sm text-slate-900">
                    <p>선택한 IFC 요소와 연결된 도면 객체가 없습니다.</p>
                    <button
                      className="mt-2 min-h-10 rounded-md bg-indigo-600 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!canLinkIfcSelection}
                      onClick={linkIfcSelection}
                      type="button"
                    >
                      선택 도면 객체에 연결
                    </button>
                  </div>
                ) : null}
                {ifcLoadError ? (
                  <p
                    className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
                    role="alert"
                  >
                    {ifcLoadError}
                  </p>
                ) : IfcViewer ? (
                  <div className="mt-4">
                    <IfcViewer
                      compact={activeView === "split"}
                      derivative={selectedIfc.derivative}
                      fileName={selectedIfc.originalFilename}
                      firstPaintLifecycleKey={firstPaintLifecycleKey}
                      focusRequest={effectiveIfcFocusRequest}
                      onAnchorSelected={
                        revisionRelinkDraft?.candidate.sourceKind ===
                        "ifc_element"
                          ? completeRevisionRelinkIfcPick
                          : undefined
                      }
                      onDerivativeRefresh={revalidator.revalidate}
                      onElementSelection={handleIfcElementSelection}
                      onViewerDispose={previewHarness?.onIfcViewerDispose}
                      remoteGlobalIds={remoteIfcGlobalIds}
                      renderBundle={selectedIfcRenderBundle}
                      sourceKey={[
                        selectedIfc.id,
                        selectedIfc.sha256,
                        selectedIfcRenderBundle?.derivative.manifestSha256 ??
                          "no-manifest",
                        selectedIfcRenderBundle?.derivative.geometrySha256 ??
                          "no-glb",
                      ].join(":")}
                      visible={ifcVisible}
                    />
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
            className={`drawing-workspace-toolbar absolute bottom-4 left-1/2 z-50 -translate-x-1/2 flex-nowrap items-center justify-start gap-0.5 overflow-x-auto rounded-2xl border border-white/15 bg-slate-900/95 p-1.5 shadow-2xl backdrop-blur ${activeView === "3d" || (activeView === "split" && narrowLayout && narrowSplitTab === "3d") ? "hidden" : "flex"}`}
            style={
              activeView === "split" && !narrowLayout
                ? { left: "25%", maxWidth: "calc(50% - 1rem)" }
                : { maxWidth: "calc(100% - 2rem)" }
            }
          >
            <span
              aria-label="캔버스 작성 도구"
              className="hidden px-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 lg:inline"
            >
              작성
            </span>
            <Button
              aria-label="선택 도구"
              aria-pressed={transient.activeTool === "select"}
              className="gap-1.5 px-2"
              onClick={() => setAuthorizedTool("select")}
              size="sm"
              variant={
                transient.activeTool === "select" ? "secondary" : "ghost"
              }
            >
              <MousePointer2 className="size-4" />
              <span data-tool-label="선택">선택</span>
            </Button>
            {authorityCanWrite ? (
              <fieldset
                aria-label="작성 도구"
                className="contents"
                disabled={!editing.canEdit}
              >
                <Button
                  aria-label="선 도구"
                  aria-pressed={transient.activeTool === "line"}
                  className="gap-1.5 px-2"
                  onClick={() => setAuthorizedTool("line")}
                  size="sm"
                  variant={
                    transient.activeTool === "line" ? "secondary" : "ghost"
                  }
                >
                  <Minus className="size-4" />
                  <span data-tool-label="선">선</span>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-label="건축 객체"
                      className="gap-1.5 px-2"
                      size="sm"
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
                      <span data-tool-label="건축">건축</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="center"
                    aria-label="건축 객체 도구"
                    className="w-40 border-white/15 bg-slate-900 p-1.5 text-slate-100 shadow-2xl"
                    side="top"
                    sideOffset={8}
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
                    ).map(([tool, label]) => (
                      <DropdownMenuItem
                        aria-label={label}
                        className="min-h-10 px-3 text-sm focus:bg-white/10 focus:text-white"
                        key={tool}
                        onSelect={() => setAuthorizedTool(tool)}
                      >
                        {label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  aria-label="폴리라인 도구"
                  aria-pressed={transient.activeTool === "polyline"}
                  className="gap-1.5 px-2"
                  onClick={() => setAuthorizedTool("polyline")}
                  size="sm"
                  variant={
                    transient.activeTool === "polyline" ? "secondary" : "ghost"
                  }
                >
                  <Waypoints className="size-4" />
                  <span data-tool-label="폴리라인">폴리라인</span>
                </Button>
                <Button
                  aria-label="사각형 도구"
                  aria-pressed={transient.activeTool === "rectangle"}
                  className="gap-1.5 px-2"
                  onClick={() => setAuthorizedTool("rectangle")}
                  size="sm"
                  variant={
                    transient.activeTool === "rectangle" ? "secondary" : "ghost"
                  }
                >
                  <Square className="size-4" />
                  <span data-tool-label="사각형">사각형</span>
                </Button>
                <Button
                  aria-label="원 도구"
                  aria-pressed={transient.activeTool === "circle"}
                  className="gap-1.5 px-2"
                  onClick={() => setAuthorizedTool("circle")}
                  size="sm"
                  variant={
                    transient.activeTool === "circle" ? "secondary" : "ghost"
                  }
                >
                  <CircleIcon className="size-4" />
                  <span data-tool-label="원">원</span>
                </Button>
                <Button
                  aria-label="텍스트 도구"
                  aria-pressed={transient.activeTool === "text"}
                  className="gap-1.5 px-2"
                  onClick={() => setAuthorizedTool("text")}
                  size="sm"
                  variant={
                    transient.activeTool === "text" ? "secondary" : "ghost"
                  }
                >
                  <Type className="size-4" />
                  <span data-tool-label="텍스트">텍스트</span>
                </Button>
                <Button
                  aria-label="치수 도구"
                  aria-pressed={transient.activeTool === "dimension"}
                  className="gap-1.5 px-2"
                  onClick={() => setAuthorizedTool("dimension")}
                  size="sm"
                  variant={
                    transient.activeTool === "dimension" ? "secondary" : "ghost"
                  }
                >
                  <Ruler className="size-4" />
                  <span data-tool-label="치수">치수</span>
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
              </fieldset>
            ) : null}
            <Button
              aria-label="이동 도구"
              aria-pressed={transient.activeTool === "pan"}
              className="gap-1.5 px-2"
              onClick={() => setAuthorizedTool("pan")}
              size="sm"
              variant={transient.activeTool === "pan" ? "secondary" : "ghost"}
            >
              <Hand className="size-4" />
              <span data-tool-label="이동">이동</span>
            </Button>
            <Button
              aria-label="화면 맞춤"
              className="gap-1.5 px-2"
              onClick={() => canvasRef.current?.resetViewport()}
              size="sm"
              variant="ghost"
            >
              <RotateCcw className="size-4" />
              <span data-tool-label="화면 맞춤">화면 맞춤</span>
            </Button>
          </nav>
        </section>

        <aside
          aria-label="속성 검사기"
          className="drawing-workspace-inspector order-3 min-h-0 max-h-[28rem] overflow-y-auto border-t border-white/10 bg-slate-900 p-3 xl:max-h-none xl:border-l xl:border-t-0"
          hidden={!inspectorOpen}
        >
          <div
            aria-label="검사기 보기"
            className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-950 p-1"
            role="tablist"
          >
            <button
              aria-controls="drawing-estimate-result-panel"
              aria-selected={inspectorMode === "result"}
              className="min-h-9 rounded px-3 font-bold text-white aria-selected:bg-indigo-500"
              id="drawing-estimate-result-tab"
              onClick={() => showInspectorMode("result")}
              onKeyDown={handleInspectorModeKeyDown}
              role="tab"
              tabIndex={inspectorMode === "result" ? 0 : -1}
              type="button"
            >
              결과
            </button>
            <button
              aria-controls="drawing-object-inspector-panel"
              aria-selected={inspectorMode === "object"}
              className="min-h-9 rounded px-3 font-bold text-white aria-selected:bg-indigo-500"
              id="drawing-object-inspector-tab"
              onClick={() => showInspectorMode("object")}
              onKeyDown={handleInspectorModeKeyDown}
              role="tab"
              tabIndex={inspectorMode === "object" ? 0 : -1}
              type="button"
            >
              객체
            </button>
          </div>
          <div
            aria-labelledby="drawing-estimate-result-tab"
            hidden={inspectorMode !== "result"}
            id="drawing-estimate-result-panel"
            role="tabpanel"
          >
            {visitedInspectorModes.has("result") ? (
              <DrawingEstimateResultRail
                capability={effectiveCapability}
                drawingRevisionId={revision.id}
                estimateOptions={estimateOptions}
                projectId={projectId}
                summary={estimateSummary}
                workspaceId={workspace.document.id}
              />
            ) : null}
          </div>
          <div
            aria-labelledby="drawing-object-inspector-tab"
            hidden={inspectorMode !== "object"}
            id="drawing-object-inspector-panel"
            role="tabpanel"
          >
            {visitedInspectorModes.has("object") ? (
              <>
                <header className="sticky top-0 z-10 -mx-3 -mt-3 mb-3 border-b border-white/10 bg-slate-900/95 px-3 py-3 backdrop-blur">
                  <h2 className="text-sm font-bold text-white">객체 검사기</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    속성부터 근거·검토·물량까지 한 흐름으로 확인합니다.
                  </p>
                  <div aria-label="업무 계보">
                    <ol
                      aria-label="선택 객체 업무 계보"
                      className="mt-3 grid grid-cols-6 overflow-hidden rounded-md border border-white/10 bg-slate-950/70 text-center text-[10px] font-semibold"
                    >
                      {(
                        [
                          ["원본", selectedObjectSources.length > 0],
                          ["객체", Boolean(selectedDrawingObjectId)],
                          ["이슈", selectedObjectHasIssue],
                          ["승인", selectedObjectHasApproval],
                          ["물량·금액", selectedObjectHasQuantity],
                          ["자재 인계", selectedObjectHasMaterial],
                        ] as const
                      ).map(([step, linked]) => (
                        <li
                          className={`border-r border-white/10 px-1 py-2 last:border-r-0 ${linked ? "bg-emerald-500/15 text-emerald-200" : "text-slate-500"}`}
                          data-lineage-step={step}
                          data-lineage-state={linked ? "linked" : "empty"}
                          key={step}
                        >
                          {step}
                          <span className="mt-1 block text-[9px] font-medium">
                            {linked ? "연결됨" : "대기"}
                          </span>
                        </li>
                      ))}
                    </ol>
                    <div
                      className="mt-2 rounded-lg border border-indigo-400/25 bg-indigo-500/10 p-2.5"
                      role="status"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold text-indigo-200">
                            계보 {selectedObjectLineage.completed}/
                            {selectedObjectLineage.total}
                          </p>
                          <p className="mt-0.5 text-xs font-bold text-white">
                            {selectedDrawingObjectId
                              ? (selectedObjectLineageAction?.title ??
                                "도면→BOQ→자재 인계 연결됨")
                              : "객체를 선택해 업무 계보 시작"}
                          </p>
                        </div>
                        {selectedObjectLineageAction ? (
                          <a
                            className="shrink-0 rounded-md bg-indigo-500 px-2 py-1.5 text-[10px] font-bold text-white hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                            href={selectedObjectLineageAction.href}
                          >
                            {selectedObjectLineageAction.label}
                          </a>
                        ) : null}
                      </div>
                      <p className="mt-1.5 text-[10px] leading-4 text-slate-300">
                        {selectedDrawingObjectId
                          ? (selectedObjectLineageAction?.description ??
                            "후속 발주·입고·현장·탄소 기록은 자재 계보에서 각각 확인합니다.")
                          : "객체를 선택하면 원본부터 자재 인계까지 연결 상태를 안내합니다."}
                      </p>
                    </div>
                  </div>
                </header>
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
                  objectNames={collaborationObjectNames}
                  store={awarenessStoreRef.current}
                />
                <section
                  aria-label="선택 객체 원본 근거"
                  className="mb-3 rounded-lg border border-white/15 bg-slate-950/60 p-3 text-xs"
                  id="drawing-inspector-source"
                >
                  <h2 className="font-bold text-white">선택 객체 원본 근거</h2>
                  {!mayMutateSources ? (
                    <p className="mt-2 text-slate-400">
                      조회 전용 · 원본 근거를 연결하거나 해제할 수 없습니다.
                    </p>
                  ) : null}
                  {!selectedDrawingObjectId ? (
                    <p className="mt-2 text-slate-400">
                      도면 객체 하나를 선택하세요.
                    </p>
                  ) : (
                    <>
                      <ul className="mt-2 space-y-2">
                        {selectedObjectSources.map((source) => (
                          <li
                            className="rounded border border-white/10 p-2"
                            key={source.id}
                          >
                            <p className="font-semibold text-slate-200">
                              {source.sourceKind === "pdf_region"
                                ? `PDF ${source.pdfPageNumber}쪽 영역`
                                : source.sourceKind === "ifc_element"
                                  ? `IFC GlobalId ${source.ifcGlobalId}`
                                  : source.sourceKind === "dxf_entity"
                                    ? `DXF ${source.entityType} · ${source.sourceLayer}`
                                    : `DWG ${source.entityType} · ${source.sourceLayer}`}
                            </p>
                            <p className="mt-1 break-all font-mono text-[10px] text-slate-400">
                              {source.sourceFileId} · {source.sourceSha256}
                            </p>
                            {mayMutateSources ? (
                              <button
                                className="mt-2 min-h-9 rounded border border-white/20 px-2 font-semibold text-white"
                                onClick={() =>
                                  unlinkSelectedObjectSource(source.id)
                                }
                                type="button"
                              >
                                원본 근거 해제
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                      {selectedObjectSources.length === 0 ? (
                        <p className="mt-2 text-slate-400">
                          연결된 원본 근거가 없습니다.
                        </p>
                      ) : null}
                      {mayMutateSources ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {sourceBundle?.pdf &&
                          pdfPageTransform &&
                          !selectedObjectHasCurrentPdf ? (
                            <button
                              className="min-h-9 rounded bg-indigo-500 px-3 font-semibold text-white"
                              onClick={linkSelectedObjectPdfRegion}
                              type="button"
                            >
                              PDF 영역 원본 근거 연결
                            </button>
                          ) : null}
                          {canLinkIfcSelection ? (
                            <button
                              className="min-h-9 rounded bg-indigo-500 px-3 font-semibold text-white"
                              onClick={linkIfcSelection}
                              type="button"
                            >
                              IFC 원본 근거 연결
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {sourceInspectorMessage ? (
                        <p className="mt-2 text-amber-200" role="status">
                          {sourceInspectorMessage}
                        </p>
                      ) : null}
                    </>
                  )}
                </section>
                <DrawingInspector
                  awarenessStore={awarenessStoreRef.current}
                  actorId={currentUserId}
                  canCreateQuantity={
                    effectiveCapability === "admin" ||
                    effectiveCapability === "editor"
                  }
                  canEdit={
                    editing.canEdit &&
                    (blockMutationAdapter.selectionKind !== "block_instance" ||
                      blockMutationAdapter.canMutate)
                  }
                  canLinkIssues={drawingIssueLinkReady({
                    capability: effectiveCapability,
                    objectIds:
                      selectedDrawingObjectId &&
                      activeDrawingState.objects[selectedDrawingObjectId]
                        ? [selectedDrawingObjectId]
                        : [],
                    saveStatus,
                    selectedIds: transient.selectedIds,
                    status: effectiveRevisionStatus,
                  })}
                  evidence={resolvedMeasurementEvidence}
                  evidenceError={resolvedMeasurementEvidenceError}
                  hasUnconfirmedChanges={drawingState.operations.length > 0}
                  lineage={measurementLineage}
                  issueLinks={revision.issueLinks}
                  issues={revision.issues}
                  onCommand={applyCommand}
                  onSoftLockChange={setAwarenessSoftLock}
                  projectId={projectId}
                  quantityLineage={resolvedQuantityLineage}
                  revisionStatus={effectiveRevisionStatus}
                  selectedIds={transient.selectedIds}
                  state={activeDrawingState}
                />
              </>
            ) : null}
          </div>
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
