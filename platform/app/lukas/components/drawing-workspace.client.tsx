import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  Save,
  Square,
  Type,
  Undo2,
  Waypoints,
  X,
} from "lucide-react";
import { Form, Link } from "react-router";

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
  type DrawingCommand,
  type DrawingClipboard,
  type DrawingDocumentState,
} from "~/lukas/lib/drawing-commands";
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
  drawingWorkspaceReviewControls,
  drawingWorkspaceSurface,
  loadDrawingClientModule,
  type DrawingClientModuleState,
} from "~/lukas/lib/drawing-workspace-view";
import {
  DrawingCommandMenu,
  type DrawingCommandId,
} from "./drawing-command-menu";
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
      candidate.closest?.(
        "input, textarea, select, [contenteditable='true'], [role='dialog']",
      ),
    )
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
  if (key === "delete") return { type: "delete" };
  const amount = event.shiftKey ? 10 : 1;
  if (key === "arrowleft") return { type: "move", delta: { x: -amount, y: 0 } };
  if (key === "arrowright") return { type: "move", delta: { x: amount, y: 0 } };
  if (key === "arrowup") return { type: "move", delta: { x: 0, y: -amount } };
  if (key === "arrowdown") return { type: "move", delta: { x: 0, y: amount } };
  return null;
}

export function drawingEditingContext(
  capability: DrawingWorkspaceCapability,
  layers: WorkspaceLayer[],
) {
  if (capability !== "admin" && capability !== "editor")
    return { canEdit: false, layerId: null };
  const layer =
    layers.find(
      (candidate) =>
        candidate.system_kind === "work" &&
        candidate.visible &&
        !candidate.locked,
    ) ?? layers.find((candidate) => candidate.visible && !candidate.locked);
  return layer
    ? { canEdit: true, layerId: layer.id }
    : { canEdit: false, layerId: null };
}

function drawingStateFromRevision(
  revision: NonNullable<DrawingWorkspace["document"]>["revision"],
): DrawingDocumentState {
  return createDrawingDocumentState({
    revisionId: revision.id,
    layers: revision.layers.map((layer) =>
      DrawingLayerSchema.parse({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        version: layer.version,
      }),
    ),
    objects: revision.objects.map((object) =>
      DrawingObjectSchema.parse({
        id: object.id,
        layerId: object.layer_id,
        geometry: object.geometry,
        style: object.style,
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
  const [reviewNote, setReviewNote] = useState("");
  const [hasLocalChanges, setHasLocalChanges] = useState(false);
  const clipboardRef = useRef<DrawingClipboard>({ items: [] });
  const { file, document: drawingDocument } = workspace;
  const { revision } = drawingDocument;
  const [drawingState, setDrawingState] = useState(() =>
    drawingStateFromRevision(revision),
  );
  const visibleObjects = useMemo(
    () =>
      Object.values(drawingState.objects).filter(
        (object) => drawingState.layers[object.layerId]?.visible,
      ),
    [drawingState.layers, drawingState.objects],
  );
  const page = revision.pages[0];
  const editing = drawingEditingContext(capability, revision.layers);
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
    setDrawingState(drawingStateFromRevision(revision));
    setActiveTool("select");
    setSelectedIds([]);
    clipboardRef.current = { items: [] };
    setHasLocalChanges(false);
  }, [revision]);

  const applyCommand = useCallback((command: DrawingCommand) => {
    setDrawingState((state) => applyDrawingCommand(state, command).state);
    setHasLocalChanges(true);
  }, []);

  const undo = useCallback(() => {
    const result = undoDrawingCommand(drawingState, currentUserId);
    if (!result || "kind" in result) return;
    setDrawingState(result.state);
    setHasLocalChanges(true);
  }, [currentUserId, drawingState]);

  const redo = useCallback(() => {
    const result = redoDrawingCommand(drawingState, currentUserId);
    if (!result || "kind" in result) return;
    setDrawingState(result.state);
    setHasLocalChanges(true);
  }, [currentUserId, drawingState]);

  const copySelection = useCallback(() => {
    const clipboard = copyDrawingSelection(drawingState, selectedIds);
    if (clipboard.items.length === 0) return false;
    clipboardRef.current = clipboard;
    return true;
  }, [drawingState, selectedIds]);

  const pasteSelection = useCallback(() => {
    if (!editing.canEdit) return false;
    if (
      clipboardRef.current.items.some((item) => {
        const targetLayer = drawingState.layers[item.layerId];
        return !targetLayer?.visible || targetLayer.locked;
      })
    )
      return false;
    const command = pasteDrawingClipboard(clipboardRef.current, currentUserId);
    if (!command) return false;
    applyCommand(command);
    setSelectedIds(command.objects.map((object) => object.id));
    return true;
  }, [applyCommand, currentUserId, drawingState.layers, editing.canEdit]);

  const duplicateSelection = useCallback(() => {
    if (!editing.canEdit) return false;
    const command = duplicateDrawingSelection(
      drawingState,
      selectedIds,
      currentUserId,
    );
    if (!command) return false;
    applyCommand(command);
    setSelectedIds(command.objects.map((object) => object.id));
    return true;
  }, [applyCommand, currentUserId, drawingState, editing.canEdit, selectedIds]);

  const deleteSelection = useCallback(() => {
    if (!editing.canEdit) return false;
    const command = deleteDrawingSelection(
      drawingState,
      selectedIds,
      currentUserId,
    );
    if (!command) return false;
    applyCommand(command);
    setSelectedIds([]);
    return true;
  }, [applyCommand, currentUserId, drawingState, editing.canEdit, selectedIds]);

  const moveSelection = useCallback(
    (delta: { x: number; y: number }) => {
      if (!editing.canEdit) return false;
      const command = moveDrawingSelection(
        drawingState,
        selectedIds,
        currentUserId,
        delta,
      );
      if (!command) return false;
      applyCommand(command);
      return true;
    },
    [applyCommand, currentUserId, drawingState, editing.canEdit, selectedIds],
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
        return (drawingState.undoStackByActor[currentUserId]?.length ?? 0) > 0;
      if (commandId === "redo")
        return (drawingState.redoStackByActor[currentUserId]?.length ?? 0) > 0;
      if (commandId === "duplicate" || commandId === "delete")
        return editing.canEdit && selectedIds.length > 0;
      return editing.canEdit;
    },
    [currentUserId, drawingState, editing.canEdit, selectedIds.length],
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
        setActiveTool(commandId);
      } else if (commandId === "undo") undo();
      else if (commandId === "redo") redo();
      else if (commandId === "duplicate") duplicateSelection();
      else if (commandId === "delete") deleteSelection();
      else if (commandId === "zoom_to_fit") canvasRef.current?.resetViewport();
    },
    [commandEnabled, deleteSelection, duplicateSelection, redo, undo],
  );
  const background: DrawingCanvasBackground = surface.background;
  const decisionFields = reviewControls.decisionEvidence
    ? drawingRevisionDecisionFields({
        revisionId: revision.id,
        evidence: reviewControls.decisionEvidence,
        decision: "approved",
        note: reviewNote,
      })
    : null;

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
            aria-label={`저장 상태: ${hasLocalChanges ? "로컬 변경(저장되지 않음)" : "저장됨"}`}
            className={`inline-flex min-h-9 items-center gap-1 px-2 text-xs ${hasLocalChanges ? "text-amber-300" : "text-emerald-300"}`}
            role="status"
          >
            <Cloud className="size-4" />
            {hasLocalChanges ? "로컬 변경" : "저장됨"}
          </span>
          <Button
            aria-label="저장"
            disabled
            size="icon"
            title="저장됨"
            variant="ghost"
          >
            <Save className="size-4" />
          </Button>
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
          {reviewControls.requestReview ? (
            <Form method="post">
              <input name="intent" type="hidden" value="request_review" />
              <input name="revision_id" type="hidden" value={revision.id} />
              <Button type="submit" variant="secondary">
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

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[14rem_minmax(0,1fr)_17rem]">
        <aside
          aria-label="레이어 패널"
          className="border-b border-white/10 bg-slate-900 p-4 lg:border-b-0 lg:border-r"
        >
          <h2 className="text-sm font-bold">레이어</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {revision.layers.map((layer) => (
              <li
                className="flex items-center justify-between gap-2 rounded-md bg-white/5 px-3 py-2"
                key={layer.id}
              >
                <span className="truncate">{layer.name}</span>
                <span className="text-xs text-slate-400">
                  {layer.locked ? "잠김" : layer.visible ? "표시" : "숨김"}
                </span>
              </li>
            ))}
          </ul>
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
                  activeTool={activeTool}
                  actorId={currentUserId}
                  background={background}
                  calibration={calibration}
                  calibrationId={calibrationId}
                  canEdit={editing.canEdit}
                  layerId={editing.layerId}
                  layers={Object.values(drawingState.layers)}
                  objects={visibleObjects}
                  onCommand={applyCommand}
                  onSelectionChange={setSelectedIds}
                  onToolComplete={setActiveTool}
                  ref={canvasRef}
                  repeatMode={repeatMode}
                  selectedIds={selectedIds}
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
              aria-pressed={activeTool === "select"}
              onClick={() => setActiveTool("select")}
              size="icon"
              variant={activeTool === "select" ? "secondary" : "ghost"}
            >
              <MousePointer2 className="size-4" />
            </Button>
            <Button
              aria-label="선 도구"
              aria-pressed={activeTool === "line"}
              disabled={!editing.canEdit}
              onClick={() => setActiveTool("line")}
              size="icon"
              variant={activeTool === "line" ? "secondary" : "ghost"}
            >
              <Minus className="size-4" />
            </Button>
            <Button
              aria-label="폴리라인 도구"
              aria-pressed={activeTool === "polyline"}
              disabled={!editing.canEdit}
              onClick={() => setActiveTool("polyline")}
              size="icon"
              variant={activeTool === "polyline" ? "secondary" : "ghost"}
            >
              <Waypoints className="size-4" />
            </Button>
            <Button
              aria-label="사각형 도구"
              aria-pressed={activeTool === "rectangle"}
              disabled={!editing.canEdit}
              onClick={() => setActiveTool("rectangle")}
              size="icon"
              variant={activeTool === "rectangle" ? "secondary" : "ghost"}
            >
              <Square className="size-4" />
            </Button>
            <Button
              aria-label="원 도구"
              aria-pressed={activeTool === "circle"}
              disabled={!editing.canEdit}
              onClick={() => setActiveTool("circle")}
              size="icon"
              variant={activeTool === "circle" ? "secondary" : "ghost"}
            >
              <CircleIcon className="size-4" />
            </Button>
            <Button
              aria-label="텍스트 도구"
              aria-pressed={activeTool === "text"}
              disabled={!editing.canEdit}
              onClick={() => setActiveTool("text")}
              size="icon"
              variant={activeTool === "text" ? "secondary" : "ghost"}
            >
              <Type className="size-4" />
            </Button>
            <Button
              aria-label="치수 도구"
              aria-pressed={activeTool === "dimension"}
              disabled={!editing.canEdit}
              onClick={() => setActiveTool("dimension")}
              size="icon"
              variant={activeTool === "dimension" ? "secondary" : "ghost"}
            >
              <Ruler className="size-4" />
            </Button>
            <Button
              aria-label="도구 반복"
              aria-pressed={repeatMode}
              disabled={!editing.canEdit}
              onClick={() => setRepeatMode((enabled) => !enabled)}
              size="icon"
              variant={repeatMode ? "secondary" : "ghost"}
            >
              <Repeat2 className="size-4" />
            </Button>
            <Button
              aria-label="이동 도구"
              aria-pressed={activeTool === "pan"}
              onClick={() => setActiveTool("pan")}
              size="icon"
              variant={activeTool === "pan" ? "secondary" : "ghost"}
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
          <h2 className="text-sm font-bold">속성</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-xs text-slate-400">리비전</dt>
              <dd>{revision.sequence}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">상태</dt>
              <dd>{revision.status}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">페이지</dt>
              <dd>{page?.name ?? "도면 1"}</dd>
            </div>
          </dl>
          <p className="mt-6 text-sm leading-6 text-slate-400">
            객체를 선택하면 이 영역에서 속성을 확인할 수 있습니다.
          </p>
        </aside>
      </div>
      <DrawingCommandMenu
        enabled={commandEnabled}
        onClose={() => setCommandMenuOpen(false)}
        onRun={runCommand}
        open={commandMenuOpen}
      />
    </main>
  );
}
