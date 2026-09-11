import { useEffect, useRef, useState } from "react";

import { Button } from "~/core/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/core/components/ui/dialog";
import type { DrawingDocumentSnapshot } from "~/lukas/lib/drawing-document-store";
import {
  exportDrawingPdf,
  exportDrawingPng,
  exportDrawingSvg,
  drawingExportSize,
  type DrawingExportBackground,
} from "~/lukas/lib/drawing-export";
import { drawingPdfImagePlacement } from "~/lukas/lib/drawing-workspace-view";
import { drawingWorkspaceExportPath } from "~/lukas/lib/drawing-workspace-paths";
import type { DrawingWorkspaceDocument } from "~/lukas/lib/drawing-workspace.server";
import type { DrawingCanvas } from "~/lukas/lib/drawing-workspace.types";
import { NativeDrawingDwgExportControl } from "./drawing-native-dwg-export";
import { NativeDrawingDwgResaveControl } from "./drawing-native-dwg-resave-control";

type ExportFormat = "pdf" | "png" | "svg" | "dwg";
type ExportStatus =
  | { kind: "idle" }
  | { kind: "working"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export type DrawingExportDialogProps = {
  auditRequired?: boolean;
  currentUserId?: string | null;
  checkpointSha256: string | null;
  createdAt: string;
  documentState: DrawingDocumentSnapshot;
  hideTrigger?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  operationCheckpoint: number | null;
  outboxReady: boolean;
  projectId: string;
  revisionId: string;
  revisionStatus?: DrawingWorkspaceDocument["revision"]["status"];
  revisionVersion: number;
  saveStatus: "저장됨" | "저장 중" | "오프라인 저장" | "충돌 검토 필요";
  sourceUrl: string | null;
  title: string;
  workspaceId: string;
};

const DRAWING_EXPORT_TIMEOUT_MILLISECONDS = 30_000;

type DrawingExportOperationOptions = {
  cancelScheduled?: (handle: unknown) => void;
  schedule?: (callback: () => void, milliseconds: number) => unknown;
};

type DrawingExportOperation = ReturnType<typeof createDrawingExportOperation>;

type DrawingExportOperationRef = {
  current: DrawingExportOperation | null;
};

type DrawingExportLifecycleOptions<Result> = {
  activeOperationRef: DrawingExportOperationRef;
  createOperation?: () => DrawingExportOperation;
  download: (result: Result) => Promise<void> | void;
  execute: (context: {
    registerDisposer: (dispose: () => Promise<void>) => void;
    signal: AbortSignal;
  }) => Promise<Result>;
  publishStatus: (status: ExportStatus) => void;
};

type DrawingExportDownload = {
  blob: Blob;
  filename: string;
};

type DrawingExportAuditRequestIdentity = {
  key: string;
  requestId: string;
};

export function drawingExportSizeDescription(
  canvas: DrawingCanvas,
  rasterScale?: 1 | 2 | 4,
) {
  const size = drawingExportSize(canvas, rasterScale);
  const dimensions = (width: number, height: number) =>
    `${width.toLocaleString("en-US", { maximumFractionDigits: 6 })} × ${height.toLocaleString("en-US", { maximumFractionDigits: 6 })} mm`;
  const raster = rasterScale ? ` · 래스터 ${size.rasterDpi} DPI` : "";
  if (size.scaleDenominator !== null)
    return `${size.paper} ${size.orientation === "landscape" ? "가로" : "세로"} · 용지 ${dimensions(size.physicalWidthMillimeters, size.physicalHeightMillimeters)} · 도면 ${dimensions(size.worldWidthMillimeters, size.worldHeightMillimeters)} · 축척 1:${size.scaleDenominator.toLocaleString("en-US", { maximumFractionDigits: 6 })}${raster}`;
  return `실제 크기 ${dimensions(size.physicalWidthMillimeters, size.physicalHeightMillimeters)} · 축척 미지정${raster}`;
}

export function drawingExportSelectionDescription(
  canvases: readonly DrawingCanvas[],
  rasterScale: 1 | 2 | 4,
) {
  if (!canvases.length) return "PDF 0쪽 · 내보낼 용지 캔버스 없음";
  const descriptions = canvases.map((canvas) =>
    drawingExportSizeDescription(canvas, rasterScale),
  );
  if (descriptions.every((description) => description === descriptions[0]))
    return `PDF ${canvases.length}쪽 · ${descriptions[0]}`;
  const rasterDpis = new Set(
    canvases.map((canvas) => drawingExportSize(canvas, rasterScale).rasterDpi),
  );
  const raster =
    rasterDpis.size === 1
      ? ` · 래스터 ${rasterDpis.values().next().value} DPI`
      : " · 혼합 래스터 DPI";
  return `PDF ${canvases.length}쪽 · 혼합 용지/방향/축척${raster}`;
}

export function drawingExportAuditRequestIdentity(
  current: DrawingExportAuditRequestIdentity | null,
  key: string,
  createRequestId: () => string = () => crypto.randomUUID(),
): DrawingExportAuditRequestIdentity {
  return current?.key === key ? current : { key, requestId: createRequestId() };
}

export function createDrawingExportOperation({
  cancelScheduled = (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
  schedule = (callback, milliseconds) => setTimeout(callback, milliseconds),
}: DrawingExportOperationOptions = {}) {
  const controller = new AbortController();
  let cancelled = false;
  let finished = false;
  let timedOut = false;
  const timer = schedule(() => {
    if (finished || controller.signal.aborted) return;
    timedOut = true;
    controller.abort();
  }, DRAWING_EXPORT_TIMEOUT_MILLISECONDS);
  return {
    abortError() {
      return new Error(
        timedOut
          ? "도면 내보내기가 30초 제한 시간을 초과했습니다."
          : cancelled
            ? "도면 내보내기가 취소되었습니다."
            : "도면 내보내기가 중단되었습니다.",
      );
    },
    cancel() {
      if (finished || controller.signal.aborted) return;
      cancelled = true;
      controller.abort();
    },
    finish() {
      if (finished) return;
      finished = true;
      cancelScheduled(timer);
    },
    get timedOut() {
      return timedOut;
    },
    signal: controller.signal,
  };
}

function raceDrawingExportOperation<Result>(
  operation: DrawingExportOperation,
  promise: Promise<Result>,
) {
  if (operation.signal.aborted) {
    void promise.catch(() => {});
    return Promise.reject(operation.abortError());
  }
  return new Promise<Result>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      operation.signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(operation.abortError()));
    operation.signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

function onceAsync(dispose: () => Promise<void>) {
  let pending: Promise<void> | null = null;
  return () => (pending ??= Promise.resolve().then(dispose));
}

/** Bounds executor, native download, and cleanup behind one operation gate. */
export async function runDrawingExportLifecycle<Result>({
  activeOperationRef,
  createOperation = createDrawingExportOperation,
  download,
  execute,
  publishStatus,
}: DrawingExportLifecycleOptions<Result>) {
  if (activeOperationRef.current) return false;
  const operation = createOperation();
  activeOperationRef.current = operation;
  const disposers: Array<() => Promise<void>> = [];
  let cleanupStarted = false;
  const registerDisposer = (dispose: () => Promise<void>) => {
    const disposeOnce = onceAsync(dispose);
    if (cleanupStarted) void disposeOnce().catch(() => {});
    else disposers.push(disposeOnce);
  };
  const cleanup = onceAsync(async () => {
    cleanupStarted = true;
    await Promise.allSettled(disposers.map((dispose) => dispose()));
  });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    operation.finish();
    if (activeOperationRef.current === operation)
      activeOperationRef.current = null;
  };
  publishStatus({ kind: "working", message: "내보내기를 준비하는 중입니다." });

  try {
    let failed = false;
    let failure: unknown = null;
    let result: Result | undefined;
    try {
      result = await raceDrawingExportOperation(
        operation,
        Promise.resolve().then(() =>
          execute({ registerDisposer, signal: operation.signal }),
        ),
      );
    } catch (error) {
      failed = true;
      failure = error;
    }
    try {
      await raceDrawingExportOperation(operation, cleanup());
    } catch (error) {
      failed = true;
      failure = error;
    }
    if (failed) throw failure;
    if (operation.signal.aborted || activeOperationRef.current !== operation)
      throw operation.abortError();
    await raceDrawingExportOperation(
      operation,
      Promise.resolve().then(() => {
        if (
          operation.signal.aborted ||
          activeOperationRef.current !== operation
        )
          throw operation.abortError();
        return download(result as Result);
      }),
    );
    if (operation.signal.aborted || activeOperationRef.current !== operation)
      throw operation.abortError();
    release();
    publishStatus({ kind: "success", message: "내보내기를 완료했습니다." });
  } catch (error) {
    release();
    publishStatus({
      kind: "error",
      message: operation.signal.aborted
        ? operation.abortError().message
        : error instanceof Error
          ? error.message
          : "도면을 내보내지 못했습니다.",
    });
  } finally {
    void cleanup().catch(() => {});
    release();
  }
  return true;
}

function safeFilename(value: string) {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .trim();
  return normalized || "drawing-export";
}

/** Starts a browser-native download without a route action or server mutation. */
export function downloadDrawingExport(blob: Blob, filename: string) {
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  )
    throw new Error("Native browser download is unavailable.");
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = filename;
  anchor.href = href;
  try {
    anchor.click();
  } finally {
    URL.revokeObjectURL(href);
  }
}

export async function auditDrawingExport(
  blob: Blob,
  filename: string,
  workspaceId: string,
  projectId: string,
  revisionId: string,
  revisionVersion: number,
  operationCheckpoint: number,
  checkpointSha256: string,
  requestId: string,
) {
  const extension = filename.split(".").at(-1)?.toLowerCase();
  if (!extension || !["pdf", "png", "svg"].includes(extension))
    throw new Error("지원하지 않는 도면 내보내기 형식입니다.");
  const path = drawingWorkspaceExportPath(projectId, workspaceId);
  const form = new FormData();
  form.set("artifact", blob, filename);
  form.set("artifact_type", `drawing_${extension}`);
  form.set("filename", filename);
  form.set("request_id", requestId);
  form.set("revision_id", revisionId);
  form.set("revision_version", String(revisionVersion));
  form.set("operation_checkpoint", String(operationCheckpoint));
  form.set("checkpoint_sha256", checkpointSha256);
  const post = () => fetch(path, { body: form, method: "POST" });
  let response: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await post();
      if (response.ok || response.status < 500 || attempt === 1) break;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  if (!response) throw new Error("도면 내보내기 감사 응답을 받지 못했습니다.");
  if (response.redirected)
    throw new Error("도면 내보내기 감사 기록이 redirect 되었습니다.");
  if (!response.ok)
    throw new Error(`도면 내보내기 감사 기록 실패 (${response.status})`);
  const returnedType = response.headers.get("content-type")?.split(";", 1)[0];
  const expectedType =
    extension === "pdf"
      ? "application/pdf"
      : `image/${extension === "svg" ? "svg+xml" : extension}`;
  if (returnedType !== expectedType)
    throw new Error("도면 내보내기 감사 응답 형식이 일치하지 않습니다.");
  downloadDrawingExport(await response.blob(), filename);
}

export async function pdfBackground(
  canvas: DrawingCanvas,
  sourceUrl: string | null,
  signal?: AbortSignal,
): Promise<{
  background: DrawingExportBackground | undefined;
  dispose: () => Promise<void>;
}> {
  if (!canvas.background)
    return { background: undefined, dispose: async () => {} };
  if (!sourceUrl) throw new Error("PDF background pixels are missing.");
  const { openPdfDocument, renderPdfPageToCanvas } = await import(
    "~/lukas/lib/pdf-page-renderer.client"
  );
  if (signal?.aborted) throw new Error("Drawing export was cancelled.");
  const opened = await openPdfDocument(sourceUrl, signal);
  const pixels = document.createElement("canvas");
  let rendered: Awaited<ReturnType<typeof renderPdfPageToCanvas>> | undefined;
  const dispose = onceAsync(async () => {
    try {
      rendered?.cleanup();
    } finally {
      pixels.width = 0;
      pixels.height = 0;
      await opened.destroy();
    }
  });
  try {
    if (signal?.aborted) throw new Error("Drawing export was cancelled.");
    rendered = await renderPdfPageToCanvas({
      canvas: pixels,
      document: opened.document,
      hostWidth: 1600,
      pageNumber: canvas.background.pdfPageNumber ?? 1,
      signal,
      zoom: 1,
    });
    if (signal?.aborted) throw new Error("Drawing export was cancelled.");
    return {
      background: {
        bounds: drawingPdfImagePlacement(rendered.canvasSize, {
          height: canvas.heightMillimeters,
          width: canvas.widthMillimeters,
        }),
        canvas: pixels,
        pdfPageNumber: canvas.background.pdfPageNumber,
        sourceFileId: canvas.background.sourceFileId,
        sourceSha256: canvas.background.sourceSha256,
      },
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

export function DrawingExportDialog({
  auditRequired = true,
  currentUserId,
  checkpointSha256,
  createdAt,
  documentState,
  hideTrigger = false,
  onOpenChange,
  open: controlledOpen,
  operationCheckpoint,
  outboxReady,
  projectId,
  revisionId,
  revisionStatus = "draft",
  revisionVersion,
  saveStatus,
  sourceUrl,
  title,
  workspaceId,
}: DrawingExportDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [scale, setScale] = useState<1 | 2 | 4>(2);
  const [currentModelOnly, setCurrentModelOnly] = useState(false);
  const [includeBackground, setIncludeBackground] = useState(() =>
    Boolean(
      documentState.activeCanvasId &&
        documentState.structure?.canvases[documentState.activeCanvasId]
          ?.background,
    ),
  );
  const [status, setStatus] = useState<ExportStatus>({ kind: "idle" });
  const activeOperationRef = useRef<DrawingExportOperation | null>(null);
  const auditRequestIdentityRef =
    useRef<DrawingExportAuditRequestIdentity | null>(null);
  const mountedRef = useRef(true);
  const activeCanvas = documentState.activeCanvasId
    ? documentState.structure?.canvases[documentState.activeCanvasId]
    : undefined;
  const pdfCanvases =
    currentModelOnly && activeCanvas?.spaceKind === "model"
      ? [activeCanvas]
      : Object.values(documentState.structure?.canvases ?? {}).filter(
          (canvas) => canvas.spaceKind === "paper",
        );
  const exportSizeDescription =
    format === "pdf"
      ? drawingExportSelectionDescription(pdfCanvases, scale)
      : activeCanvas
        ? drawingExportSizeDescription(
            activeCanvas,
            format === "png" ? scale : undefined,
          )
        : null;
  const exporting = status.kind === "working";
  const approvalReady =
    !auditRequired ||
    revisionStatus === "approved" ||
    revisionStatus === "superseded";
  const auditReady =
    !auditRequired ||
    (outboxReady &&
      saveStatus === "저장됨" &&
      operationCheckpoint !== null &&
      checkpointSha256 !== null);
  const auditRequestKey = JSON.stringify([
    format,
    scale,
    currentModelOnly,
    includeBackground,
    activeCanvas?.id ?? null,
    revisionId,
    revisionVersion,
    operationCheckpoint,
    checkpointSha256,
  ]);
  const open = controlledOpen ?? internalOpen;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeOperationRef.current?.cancel();
    };
  }, []);

  useEffect(() => {
    auditRequestIdentityRef.current = null;
  }, [auditRequestKey]);

  async function runExport() {
    if (!approvalReady) {
      setStatus({
        kind: "error",
        message:
          "승인된 개정만 내보낼 수 있습니다. 먼저 검토 요청과 최종 승인을 완료해 주세요.",
      });
      return;
    }
    if (!auditReady) {
      setStatus({
        kind: "error",
        message: "로컬 변경을 모두 저장한 뒤 내보낼 수 있습니다.",
      });
      return;
    }
    if (!activeCanvas) {
      setStatus({ kind: "error", message: "내보낼 캔버스가 없습니다." });
      return;
    }
    await runDrawingExportLifecycle<DrawingExportDownload>({
      activeOperationRef,
      download: async ({ blob, filename }) => {
        if (!auditRequired) {
          downloadDrawingExport(blob, filename);
          return;
        }
        const identity = drawingExportAuditRequestIdentity(
          auditRequestIdentityRef.current,
          auditRequestKey,
        );
        auditRequestIdentityRef.current = identity;
        await auditDrawingExport(
          blob,
          filename,
          workspaceId,
          projectId,
          revisionId,
          revisionVersion,
          operationCheckpoint as number,
          checkpointSha256 as string,
          identity.requestId,
        );
        if (auditRequestIdentityRef.current?.requestId === identity.requestId)
          auditRequestIdentityRef.current = null;
      },
      execute: async ({ registerDisposer, signal }) => {
        const baseName = safeFilename(title);
        if (format === "svg") {
          const xml = exportDrawingSvg(documentState, activeCanvas.id);
          return {
            blob: new Blob([xml], { type: "image/svg+xml;charset=utf-8" }),
            filename: `${baseName}.svg`,
          };
        }
        if (format === "png") {
          const rendered = includeBackground
            ? await pdfBackground(activeCanvas, sourceUrl, signal)
            : { background: undefined, dispose: async () => {} };
          registerDisposer(rendered.dispose);
          const blob = await exportDrawingPng(documentState, activeCanvas.id, {
            background: rendered.background,
            includeBackground,
            scale,
            signal,
          });
          return { blob, filename: `${baseName}@${scale}x.png` };
        }
        const bytes = await exportDrawingPdf(documentState, {
          canvasIds:
            currentModelOnly && activeCanvas.spaceKind === "model"
              ? [activeCanvas.id]
              : undefined,
          createdAt,
          getBackground: async (canvas) => {
            const rendered = await pdfBackground(canvas, sourceUrl, signal);
            registerDisposer(rendered.dispose);
            return rendered.background;
          },
          scale,
          signal,
          subject: "Canonical drawing workspace export",
          title,
        });
        return {
          blob: new Blob([Uint8Array.from(bytes).buffer], {
            type: "application/pdf",
          }),
          filename: `${baseName}.pdf`,
        };
      },
      publishStatus: (nextStatus) => {
        if (mountedRef.current) setStatus(nextStatus);
      },
    });
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) activeOperationRef.current?.cancel();
        if (controlledOpen === undefined) setInternalOpen(nextOpen);
        onOpenChange?.(nextOpen);
        if (nextOpen) {
          setIncludeBackground(Boolean(activeCanvas?.background));
          setStatus({ kind: "idle" });
        }
      }}
      open={open}
    >
      {hideTrigger ? null : (
        <DialogTrigger asChild>
          <Button type="button" variant="secondary">
            내보내기
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>도면 내보내기</DialogTitle>
          <DialogDescription>
            현재 캔버스를 SVG/PNG로 받거나, 모든 용지 캔버스를 정렬된 PDF로
            받습니다. 원본 파일과 리비전은 변경되지 않습니다.
          </DialogDescription>
        </DialogHeader>
        {exportSizeDescription ? (
          <p className="text-sm text-muted-foreground">
            {exportSizeDescription}
          </p>
        ) : null}
        <fieldset className="grid gap-2" disabled={exporting}>
          <legend className="text-sm font-semibold">파일 형식</legend>
          {(["pdf", "png", "svg", "dwg"] as const).map((value) => (
            <label className="flex min-h-10 items-center gap-2" key={value}>
              <input
                checked={format === value}
                name="drawing-export-format"
                onChange={() => setFormat(value)}
                type="radio"
              />
              {value === "dwg" ? "DWG (시험)" : value.toUpperCase()}
            </label>
          ))}
        </fieldset>
        {format === "pdf" || format === "png" ? (
          <label className="grid gap-2 text-sm" htmlFor="drawing-export-scale">
            PNG 렌더 배율
            <select
              className="min-h-10 rounded-md border bg-background px-3"
              disabled={exporting}
              id="drawing-export-scale"
              onChange={(event) =>
                setScale(Number(event.target.value) as 1 | 2 | 4)
              }
              value={scale}
            >
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={4}>4x</option>
            </select>
          </label>
        ) : null}
        {format === "png" ? (
          <div className="grid gap-1">
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input
                aria-describedby="drawing-export-background-description"
                checked={includeBackground && Boolean(activeCanvas?.background)}
                disabled={exporting || !activeCanvas?.background}
                onChange={(event) => setIncludeBackground(event.target.checked)}
                type="checkbox"
              />
              PDF 배경 포함
            </label>
            <p
              className="text-xs text-muted-foreground"
              id="drawing-export-background-description"
            >
              {activeCanvas?.background
                ? "선택 해제하면 흰색 배경과 벡터만 내보냅니다."
                : "현재 캔버스에는 포함할 PDF 배경이 없습니다."}
            </p>
          </div>
        ) : null}
        {format === "pdf" && activeCanvas?.spaceKind === "model" ? (
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              checked={currentModelOnly}
              disabled={exporting}
              onChange={(event) => setCurrentModelOnly(event.target.checked)}
              type="checkbox"
            />
            현재 모델 캔버스만 명시적으로 PDF에 포함
          </label>
        ) : null}
        {format === "dwg" &&
        Object.values(documentState.structure?.sources ?? {}).some(
          (source) => source.sourceKind === "dwg_entity",
        ) ? (
          <NativeDrawingDwgResaveControl
            currentUserId={currentUserId}
            open={open}
            readiness={
              auditRequired &&
              outboxReady &&
              saveStatus === "저장됨" &&
              operationCheckpoint !== null &&
              checkpointSha256 !== null &&
              (revisionStatus === "approved" || revisionStatus === "superseded")
            }
            scope={
              documentState.activeCanvasId && checkpointSha256
                ? {
                    projectId,
                    documentId: workspaceId,
                    revisionId,
                    revisionVersion,
                    canvasId: documentState.activeCanvasId,
                    snapshotSha256: checkpointSha256,
                  }
                : null
            }
          />
        ) : format === "dwg" ? (
          <NativeDrawingDwgExportControl
            backendAvailable={auditRequired}
            documentState={documentState}
            open={open}
            outboxReady={outboxReady}
            projectId={projectId}
            revisionId={revisionId}
            revisionStatus={revisionStatus}
            revisionVersion={revisionVersion}
            saveStatus={saveStatus}
            snapshotSha256={checkpointSha256}
            workspaceId={workspaceId}
          />
        ) : null}
        {status.kind !== "idle" ? (
          <p
            aria-live="polite"
            className={
              status.kind === "error" ? "text-sm text-destructive" : "text-sm"
            }
            role={status.kind === "error" ? "alert" : "status"}
          >
            {status.message}
          </p>
        ) : null}
        {!approvalReady && status.kind === "idle" ? (
          <p className="text-sm text-amber-700" role="status">
            승인된 개정만 내보낼 수 있습니다. 먼저 검토 요청과 최종 승인을
            완료해 주세요.
          </p>
        ) : null}
        {approvalReady &&
        auditRequired &&
        !auditReady &&
        status.kind === "idle" ? (
          <p className="text-sm text-amber-700" role="status">
            로컬 변경을 모두 저장한 뒤 감사 내보내기를 사용할 수 있습니다.
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button
              onClick={() => activeOperationRef.current?.cancel()}
              type="button"
              variant="secondary"
            >
              {exporting ? "취소" : "닫기"}
            </Button>
          </DialogClose>
          {format === "dwg" ? null : (
            <Button
              disabled={
                exporting || !activeCanvas || !auditReady || !approvalReady
              }
              onClick={runExport}
              type="button"
            >
              {exporting ? "내보내는 중…" : "다운로드"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
