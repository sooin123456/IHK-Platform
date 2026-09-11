import { useEffect, useMemo, useRef, useState } from "react";

import { createDrawingAwarenessPeerStore } from "~/lukas/lib/drawing-awareness";
import { drawingDimensionContextForCanvas } from "~/lukas/lib/drawing-layout";
import type { PublicDrawingShareView } from "~/lukas/lib/drawing-share.server";

import type {
  DimensionCalibrationEvidence,
  DrawingCanvasBackground,
} from "./drawing-canvas.client";

type CanvasModule = typeof import("./drawing-canvas.client");

const PUBLIC_VIEWER_ACTOR_ID = "00000000-0000-4000-8000-000000000000";

type Props = {
  selectedCanvasId: string;
  view: PublicDrawingShareView;
};

export default function SharedDrawingViewer({ selectedCanvasId, view }: Props) {
  const awarenessStoreRef = useRef(createDrawingAwarenessPeerStore());
  const [canvasModule, setCanvasModule] = useState<
    | { status: "loading" }
    | { status: "ready"; value: CanvasModule["DrawingCanvas"] }
    | { status: "error" }
  >({ status: "loading" });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    import("./drawing-canvas.client")
      .then((module) => {
        if (active)
          setCanvasModule({ status: "ready", value: module.DrawingCanvas });
      })
      .catch(() => {
        if (active) setCanvasModule({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => setSelectedIds([]), [selectedCanvasId]);

  const canvas = view.canvases.find(
    (candidate) => candidate.id === selectedCanvasId,
  );
  const layers = useMemo(
    () => view.layers.filter((layer) => layer.canvasId === selectedCanvasId),
    [selectedCanvasId, view.layers],
  );
  const layerIds = useMemo(
    () => new Set(layers.map((layer) => layer.id)),
    [layers],
  );
  const objects = useMemo(
    () => view.objects.filter((object) => layerIds.has(object.layerId)),
    [layerIds, view.objects],
  );
  const blockInstances = useMemo(
    () =>
      view.blockInstances.filter((model) =>
        layerIds.has(model.instance.layerId),
      ),
    [layerIds, view.blockInstances],
  );
  const selectedObject =
    objects.find((object) => object.id === selectedIds[0]) ?? null;
  const dimensionContext = useMemo(
    () =>
      canvas
        ? drawingDimensionContextForCanvas(canvas)
        : ({ kind: "pdf", calibration: null } as const),
    [canvas],
  );

  if (!canvas)
    return (
      <p
        className="grid min-h-[32rem] place-items-center text-sm text-red-700"
        role="alert"
      >
        공유된 캔버스를 열 수 없습니다.
      </p>
    );

  const pdfSource = canvas.background
    ? view.pdfSources[canvas.background.sourceFileId]
    : null;
  const background: DrawingCanvasBackground =
    canvas.background && canvas.background.pdfPageNumber !== null && pdfSource
      ? {
          kind: "pdf",
          width: canvas.widthMillimeters,
          height: canvas.heightMillimeters,
          pageNumber: canvas.background.pdfPageNumber,
          signedUrl: pdfSource.signedUrl,
          sourceFileId: pdfSource.id,
          sourceSha256: pdfSource.sha256,
        }
      : {
          kind: "blank",
          width: canvas.widthMillimeters,
          height: canvas.heightMillimeters,
        };
  const calibration: DimensionCalibrationEvidence | null =
    dimensionContext.kind === "pdf" ? dimensionContext.calibration : null;
  const Canvas = canvasModule.status === "ready" ? canvasModule.value : null;

  return (
    <section
      aria-label="도면 캔버스"
      className="grid min-h-[36rem] overflow-hidden rounded-xl border border-slate-700 bg-slate-950 lg:grid-cols-[minmax(0,1fr)_16rem]"
      data-active-canvas-id={canvas.id}
      data-background-kind={background.kind}
      data-background-source-file-id={
        background.kind === "pdf" ? background.sourceFileId : ""
      }
      data-background-source-sha256={
        background.kind === "pdf" ? background.sourceSha256 : ""
      }
    >
      <div className="relative min-h-[36rem]">
        {Canvas ? (
          <Canvas
            activeCanvasId={canvas.id}
            activeTool="select"
            actorId={PUBLIC_VIEWER_ACTOR_ID}
            awarenessStore={awarenessStoreRef.current}
            background={background}
            blockInstances={blockInstances}
            calibration={calibration}
            calibrationId={calibration?.id ?? null}
            dimensionContext={dimensionContext}
            canEdit={false}
            firstPaintLifecycleKey={`${view.revision.id}:${view.snapshotSha256}:${canvas.id}:${pdfSource?.sha256 ?? "blank"}`}
            layerId={null}
            layers={layers}
            objects={objects}
            onCommand={() => undefined}
            onCursorWorldChange={() => undefined}
            onSelectionChange={setSelectedIds}
            onSoftLockChange={() => undefined}
            onToolComplete={() => undefined}
            repeatMode={false}
            selectedIds={selectedIds}
          />
        ) : canvasModule.status === "error" ? (
          <p
            className="grid h-full min-h-[36rem] place-items-center text-sm text-red-200"
            role="alert"
          >
            도면 캔버스를 불러오지 못했습니다.
          </p>
        ) : (
          <p
            className="grid h-full min-h-[36rem] place-items-center text-sm text-slate-300"
            role="status"
          >
            도면을 불러오는 중입니다…
          </p>
        )}
      </div>
      <aside className="border-t border-slate-700 bg-slate-900 p-4 text-sm text-slate-200 lg:border-l lg:border-t-0">
        <h2 className="font-semibold text-white">선택 정보</h2>
        {selectedObject ? (
          <dl className="mt-3 grid gap-2">
            <div>
              <dt className="text-xs text-slate-400">이름</dt>
              <dd>{selectedObject.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">종류</dt>
              <dd>{selectedObject.geometry.type}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-3 text-slate-400">
            객체를 선택하면 기본 정보를 확인할 수 있습니다.
          </p>
        )}
      </aside>
    </section>
  );
}
