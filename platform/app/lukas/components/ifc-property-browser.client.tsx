import { useEffect, useMemo, useRef, useState } from "react";

import {
  AlertCircle,
  Box,
  Cuboid,
  LocateFixed,
  LoaderCircle,
  Maximize2,
  MousePointer2,
  Rotate3D,
  Search,
  SlidersHorizontal,
} from "lucide-react";

import type {
  IfcModelViewer,
  IfcModelViewerDisposeEvidence,
} from "./ifc-model-viewer.client";
import {
  applyIfcControlledView,
  type IfcCameraState,
} from "~/lukas/lib/ifc-anchor";
import {
  ifcDerivativeRefreshDelay,
  ifcDerivativeStatusPresentation,
} from "~/lukas/lib/drawing-ifc-derivative-status";
import { startDrawingWorkspaceStage } from "~/lukas/lib/drawing-runtime";
import type { IfcRenderDerivativeDescriptor } from "~/lukas/lib/ifc-render-descriptor";
import {
  instantiateVerifiedIfcRenderModel,
  loadVerifiedIfcRenderBundle,
  type IfcRenderBundleDescriptor,
  type IfcRenderElement,
  type VerifiedIfcRenderBundle,
} from "~/lukas/lib/ifc-render-model.client";

export type IfcFocusRequest = {
  requestId: string;
  ifcGlobalId?: string | null;
  elementId?: string | null;
  camera?: IfcCameraState | null;
};

export type IfcElementSelection = {
  origin: "user" | "programmatic";
  expressId: number;
  ifcGlobalId: string | null;
  camera: IfcCameraState | null;
};

type DisplayProperty = { key: string; value: string };
type IfcElement = Omit<IfcRenderElement, "name" | "properties"> & {
  name: string;
  properties: DisplayProperty[];
};

type Props = {
  compact?: boolean;
  fileName: string;
  sourceKey: string;
  firstPaintLifecycleKey?: string;
  initialGlobalId?: string | null;
  derivative?: IfcRenderDerivativeDescriptor | null;
  renderBundle?: IfcRenderBundleDescriptor;
  visible?: boolean;
  focusRequest?: IfcFocusRequest | null;
  remoteGlobalIds?: readonly string[];
  onElementSelection?: (selection: IfcElementSelection) => void;
  onViewerDispose?: (evidence: IfcModelViewerDisposeEvidence) => void;
  onDerivativeRefresh?: () => void | Promise<void>;
  activeAnchor?: {
    elementId: string;
    camera: IfcCameraState;
  } | null;
  onAnchorSelected?: (anchor: {
    elementId: string;
    ifcGlobalId: string | null;
    camera: IfcCameraState;
  }) => void;
};

type ViewerPhase = "loading" | "ready" | "skipped" | "empty" | "error";

const IFC_ELEMENT_RESULT_PAGE_SIZE = 50;
const IFC_COMPACT_ELEMENT_RESULT_PAGE_SIZE = 8;

export function ifcElementResultPageSize(compact: boolean) {
  return compact
    ? IFC_COMPACT_ELEMENT_RESULT_PAGE_SIZE
    : IFC_ELEMENT_RESULT_PAGE_SIZE;
}

/** Bounds the accessible result tree while keeping a focused item discoverable. */
export function visibleIfcElementResults<T extends { expressId: number }>(
  elements: readonly T[],
  limit: number,
  selectedExpressId: number | null,
) {
  const visible = elements.slice(0, Math.max(0, Math.floor(limit)));
  if (
    selectedExpressId === null ||
    visible.some((element) => element.expressId === selectedExpressId)
  )
    return visible;
  const selected = elements.find(
    (element) => element.expressId === selectedExpressId,
  );
  return selected ? [...visible, selected] : visible;
}

type IfcFetchEntry = {
  consumers: number;
  controller: AbortController;
  promise: Promise<VerifiedIfcRenderBundle>;
  abortTimer: number | null;
};

const ifcFetches = new Map<string, IfcFetchEntry>();

export function ifcRenderCapabilityKey(
  sourceKey: string,
  descriptor: IfcRenderBundleDescriptor,
) {
  return [
    sourceKey,
    descriptor.source.fileId,
    descriptor.source.sha256,
    descriptor.derivative.version,
    descriptor.derivative.manifestSha256,
    descriptor.derivative.geometrySha256,
    descriptor.derivative.manifestByteSize,
    descriptor.derivative.geometryByteSize,
    descriptor.derivative.manifestSignedUrl,
    descriptor.derivative.geometrySignedUrl,
  ].join("\u0000");
}

export function resolveIfcFocusElement<
  T extends Pick<IfcElement, "expressId" | "globalId">,
>(
  elements: readonly T[],
  focus: Pick<IfcFocusRequest, "ifcGlobalId" | "elementId">,
) {
  if (focus.ifcGlobalId !== null && focus.ifcGlobalId !== undefined)
    return elements.find((element) => element.globalId === focus.ifcGlobalId);
  const expressId = Number(focus.elementId);
  return Number.isSafeInteger(expressId)
    ? elements.find((element) => element.expressId === expressId)
    : undefined;
}

function acquireIfcRenderBundle(
  sourceKey: string,
  descriptor: IfcRenderBundleDescriptor,
) {
  const cacheKey = ifcRenderCapabilityKey(sourceKey, descriptor);
  let entry = ifcFetches.get(cacheKey);
  if (!entry) {
    const controller = new AbortController();
    const promise = loadVerifiedIfcRenderBundle(descriptor, {
      signal: controller.signal,
    });
    entry = { consumers: 0, controller, promise, abortTimer: null };
    ifcFetches.set(cacheKey, entry);
    void promise.catch(() => {
      if (ifcFetches.get(cacheKey) === entry) ifcFetches.delete(cacheKey);
    });
  }
  entry.consumers += 1;
  if (entry.abortTimer !== null) {
    window.clearTimeout(entry.abortTimer);
    entry.abortTimer = null;
  }
  let released = false;
  return {
    promise: entry.promise,
    release() {
      if (released) return;
      released = true;
      entry!.consumers -= 1;
      if (entry!.consumers > 0) return;
      entry!.abortTimer = window.setTimeout(() => {
        if (entry!.consumers > 0) return;
        entry!.controller.abort();
        if (ifcFetches.get(cacheKey) === entry) ifcFetches.delete(cacheKey);
      });
    },
  };
}

export default function IfcPropertyBrowser({
  compact = false,
  fileName,
  sourceKey: originalSourceKey,
  firstPaintLifecycleKey,
  initialGlobalId,
  derivative,
  renderBundle,
  activeAnchor = null,
  onAnchorSelected,
  visible = true,
  focusRequest = null,
  remoteGlobalIds = [],
  onElementSelection,
  onViewerDispose,
  onDerivativeRefresh,
}: Props) {
  const sourceKey = [
    originalSourceKey,
    renderBundle?.source.fileId ?? "no-source-file",
    renderBundle?.source.sha256 ?? "no-source-sha",
    renderBundle?.derivative.version ?? "no-revision",
    renderBundle?.derivative.manifestSha256 ?? "no-manifest",
    renderBundle?.derivative.geometrySha256 ?? "no-glb",
  ].join(":");
  const fetchCapabilityKey = renderBundle
    ? ifcRenderCapabilityKey(sourceKey, renderBundle)
    : `${sourceKey}:no-capability`;
  const [elements, setElements] = useState<IfcElement[]>([]);
  const [elementsSourceKey, setElementsSourceKey] = useState<string | null>(
    null,
  );
  const [selected, setSelected] = useState<IfcElement | null>(null);
  const [properties, setProperties] = useState<DisplayProperty[]>([]);
  const [query, setQuery] = useState("");
  const resultPageSize = ifcElementResultPageSize(compact);
  const [visibleResultLimit, setVisibleResultLimit] = useState(resultPageSize);
  const [status, setStatus] = useState("IFC 파일을 준비하고 있습니다.");
  const [error, setError] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [viewerPhase, setViewerPhase] = useState<ViewerPhase>("loading");
  const [viewerStatus, setViewerStatus] =
    useState("3D 화면을 준비하고 있습니다.");
  const [contextLost, setContextLost] = useState(false);
  const viewerRef = useRef<IfcModelViewer | null>(null);
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const selectedIdRef = useRef<number | null>(null);
  const loadGenerationRef = useRef(0);
  const handledFocusSelectionRef = useRef<string | null>(null);
  const handledFocusCameraRef = useRef<string | null>(null);
  const loadedViewerInputRef = useRef<{
    bundle: VerifiedIfcRenderBundle;
    elements: IfcElement[];
    generation: number;
  } | null>(null);
  const onElementSelectionRef = useRef(onElementSelection);
  onElementSelectionRef.current = onElementSelection;
  const onViewerDisposeRef = useRef(onViewerDispose);
  onViewerDisposeRef.current = onViewerDispose;
  const onDerivativeRefreshRef = useRef(onDerivativeRefresh);
  onDerivativeRefreshRef.current = onDerivativeRefresh;
  const visibleRef = useRef(visible);
  const firstPaintLifecycleKeyRef = useRef(firstPaintLifecycleKey ?? sourceKey);
  firstPaintLifecycleKeyRef.current = firstPaintLifecycleKey ?? sourceKey;
  visibleRef.current = visible;
  const renderBundleRef = useRef(renderBundle);
  renderBundleRef.current = renderBundle;

  useEffect(() => setVisibleResultLimit(resultPageSize), [resultPageSize]);

  useEffect(() => {
    let cancelled = false;
    let refreshCount = 0;
    let refreshTimer: number | null = null;
    const schedule = () => {
      if (cancelled || !onDerivativeRefreshRef.current) return;
      const delay = ifcDerivativeRefreshDelay(derivative?.status, refreshCount);
      if (delay === null) return;
      refreshTimer = window.setTimeout(async () => {
        if (cancelled) return;
        if (document.visibilityState === "hidden") {
          schedule();
          return;
        }
        try {
          await onDerivativeRefreshRef.current?.();
        } catch {
          // A later bounded refresh may recover a transient route error.
        }
        if (cancelled) return;
        refreshCount += 1;
        schedule();
      }, delay);
    };
    schedule();
    return () => {
      cancelled = true;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [derivative?.sourceSha256, derivative?.status]);

  useEffect(() => {
    const generation = ++loadGenerationRef.current;
    const finishIfcStage = startDrawingWorkspaceStage("ifc");
    const descriptor = renderBundleRef.current;
    if (!descriptor) {
      const presentation = ifcDerivativeStatusPresentation(derivative?.status);
      const message = presentation.message;
      const generating = presentation.waiting;
      setElements([]);
      setElementsSourceKey(null);
      setViewerReady(false);
      setViewerPhase(generating ? "loading" : "error");
      setViewerStatus(message);
      setError(generating ? null : message);
      setStatus(generating ? "파생물 생성 중입니다." : "읽기에 실패했습니다.");
      finishIfcStage();
      return;
    }
    const sourceFetch = acquireIfcRenderBundle(sourceKey, descriptor);
    let disposed = false;
    const isCurrentLoad = () =>
      !disposed && loadGenerationRef.current === generation;
    viewerRef.current?.dispose();
    viewerRef.current = null;
    selectedIdRef.current = null;
    setElements([]);
    setElementsSourceKey(null);
    setSelected(null);
    setProperties([]);
    setViewerReady(false);
    setContextLost(false);
    setViewerPhase("loading");
    setViewerStatus("3D 화면을 준비하고 있습니다.");

    async function load() {
      try {
        setError(null);
        setStatus("검증된 IFC 요소 목록을 읽는 중입니다.");
        const bundle = await sourceFetch.promise;
        if (!isCurrentLoad()) return;
        const found: IfcElement[] = bundle.manifest.elements.map((element) => ({
          ...element,
          name: element.name?.trim() || "이름 없음",
          properties: element.properties.map((property) => ({
            key: `${property.group} · ${property.name}`,
            value: property.value === null ? "—" : String(property.value),
          })),
        }));
        found.sort(
          (a, b) =>
            a.typeName.localeCompare(b.typeName) ||
            a.name.localeCompare(b.name),
        );
        if (!isCurrentLoad()) return;
        setElements(found);
        setElementsSourceKey(sourceKey);
        setStatus(
          `요소 ${found.length.toLocaleString("ko-KR")}개를 찾았습니다.`,
        );
        if (found[0]) choose(found[0], "initial");
        if (!isCurrentLoad()) return;
        loadedViewerInputRef.current = {
          bundle,
          elements: found,
          generation,
        };

        if (bundle.skipped) {
          setViewerPhase("skipped");
          setViewerStatus(
            "대형 GLB는 브라우저 메모리를 보호하기 위해 속성만 표시합니다.",
          );
        } else if (viewerContainerRef.current) await mountViewer(generation);
        finishIfcStage();
      } catch (loadError) {
        if (isCurrentLoad()) {
          if (
            loadError instanceof DOMException &&
            loadError.name === "AbortError"
          )
            return;
          finishIfcStage();
          setViewerPhase("error");
          setViewerStatus(
            loadError instanceof Error
              ? loadError.message
              : "IFC를 읽는 중 오류가 발생했습니다.",
          );
          setError(
            loadError instanceof Error
              ? loadError.message
              : "IFC를 읽는 중 오류가 발생했습니다.",
          );
          setStatus("읽기에 실패했습니다.");
        }
      }
    }
    void load();

    return () => {
      disposed = true;
      sourceFetch.release();
      if (loadGenerationRef.current === generation)
        loadedViewerInputRef.current = null;
      viewerRef.current?.dispose();
      viewerRef.current = null;
    };
  }, [derivative?.status, fetchCapabilityKey, sourceKey]);

  async function mountViewer(generation = loadGenerationRef.current) {
    const input = loadedViewerInputRef.current;
    if (
      !input ||
      input.generation !== generation ||
      generation !== loadGenerationRef.current ||
      !viewerContainerRef.current
    )
      return;
    try {
      viewerRef.current?.dispose();
      viewerRef.current = null;
      setContextLost(false);
      setViewerReady(false);
      setViewerPhase("loading");
      setViewerStatus("IFC 3D 형상을 만드는 중입니다.");
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      if (
        generation !== loadGenerationRef.current ||
        !viewerContainerRef.current
      )
        return;
      const { createIfcModelViewer } = await import(
        "./ifc-model-viewer.client"
      );
      if (
        generation !== loadGenerationRef.current ||
        !viewerContainerRef.current
      )
        return;
      const byId = new Map(
        input.elements.map((element) => [element.expressId, element]),
      );
      const model = await instantiateVerifiedIfcRenderModel(input.bundle);
      if (
        generation !== loadGenerationRef.current ||
        !viewerContainerRef.current
      ) {
        model.dispose();
        return;
      }
      let viewer: IfcModelViewer;
      try {
        viewer = createIfcModelViewer({
          model,
          container: viewerContainerRef.current,
          firstPaintLifecycleKey: firstPaintLifecycleKeyRef.current,
          initialVisible: visibleRef.current,
          onSelect: (expressId) => {
            const element = byId.get(expressId);
            if (element) choose(element, "viewer");
          },
          onStatus: (message) => {
            if (generation === loadGenerationRef.current)
              setViewerStatus(message);
          },
          onContextLost: () => {
            if (generation !== loadGenerationRef.current) return;
            viewer.dispose();
            if (viewerRef.current === viewer) viewerRef.current = null;
            setViewerReady(false);
            setViewerPhase("error");
            setContextLost(true);
          },
          onDispose: (evidence) => onViewerDisposeRef.current?.(evidence),
        });
      } catch (error) {
        model.dispose();
        throw error;
      }
      if (generation !== loadGenerationRef.current) {
        viewer.dispose();
        return;
      }
      viewerRef.current = viewer;
      viewer.setVisible(visibleRef.current);
      if (viewer.renderedElementCount > 0) {
        setViewerReady(true);
        setViewerPhase("ready");
        viewer.selectElement(selectedIdRef.current);
      } else {
        setViewerPhase("empty");
        setViewerStatus(
          "이 IFC에는 브라우저에 표시할 3D 형상이 없습니다. 요소와 속성만 확인할 수 있습니다.",
        );
      }
    } catch (viewerLoadError) {
      if (generation !== loadGenerationRef.current) return;
      setViewerPhase("error");
      setViewerStatus(
        viewerLoadError instanceof Error
          ? viewerLoadError.message
          : "3D 화면을 만들지 못했습니다.",
      );
    }
  }

  useEffect(() => viewerRef.current?.setVisible(visible), [visible]);

  useEffect(() => {
    viewerRef.current?.setFirstPaintLifecycleKey(
      firstPaintLifecycleKey ?? sourceKey,
    );
  }, [firstPaintLifecycleKey, sourceKey]);

  useEffect(() => {
    if (
      !initialGlobalId ||
      elementsSourceKey !== sourceKey ||
      elements.length === 0
    )
      return;
    const element = elements.find(
      (element) => element.globalId === initialGlobalId,
    );
    if (!element) {
      setStatus(
        `요청한 IFC 요소(${initialGlobalId})를 이 파일에서 찾지 못했습니다.`,
      );
      return;
    }
    if (selectedIdRef.current === element.expressId) return;
    choose(element, "deep-link");
  }, [elements, elementsSourceKey, initialGlobalId, sourceKey]);

  useEffect(() => {
    if (!activeAnchor || elementsSourceKey !== sourceKey || !viewerReady)
      return;
    const expressId = Number(activeAnchor.elementId);
    const element = elements.find((item) => item.expressId === expressId);
    if (!Number.isInteger(expressId) || !element) {
      setViewerStatus(
        "근거 열기 실패: 이 IFC에서 해당 요소를 찾지 못했습니다.",
      );
      return;
    }
    viewerRef.current?.restoreViewState(activeAnchor.camera);
    choose(element, "anchor");
  }, [activeAnchor, elements, elementsSourceKey, sourceKey, viewerReady]);

  useEffect(() => {
    if (
      !focusRequest ||
      elementsSourceKey !== sourceKey ||
      elements.length === 0
    )
      return;
    const focusLifecycleKey = `${sourceKey}:${focusRequest.requestId}`;
    const element = resolveIfcFocusElement(elements, focusRequest);
    if (!element) {
      if (handledFocusSelectionRef.current !== focusLifecycleKey) {
        handledFocusSelectionRef.current = focusLifecycleKey;
        setViewerStatus("연결된 IFC 요소를 이 파일에서 찾지 못했습니다.");
      }
      return;
    }
    if (handledFocusSelectionRef.current !== focusLifecycleKey) {
      handledFocusSelectionRef.current = focusLifecycleKey;
      choose(element, "focus-request");
    }
    if (!viewerReady) return;
    if (handledFocusCameraRef.current === focusLifecycleKey) return;
    handledFocusCameraRef.current = focusLifecycleKey;
    const viewer = viewerRef.current;
    if (viewer)
      applyIfcControlledView(viewer, element.expressId, focusRequest.camera);
  }, [elements, elementsSourceKey, focusRequest, sourceKey, viewerReady]);

  useEffect(() => {
    if (elementsSourceKey !== sourceKey) return;
    const wanted = new Set(remoteGlobalIds);
    viewerRef.current?.setRemoteElements(
      elements.flatMap((element) =>
        element.globalId && wanted.has(element.globalId)
          ? [element.expressId]
          : [],
      ),
    );
  }, [elements, elementsSourceKey, remoteGlobalIds, sourceKey, viewerReady]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    if (!normalized) return elements;
    return elements.filter((element) =>
      `${element.expressId} ${element.typeName} ${element.name} ${element.globalId}`
        .toLocaleLowerCase("ko-KR")
        .includes(normalized),
    );
  }, [elements, query]);
  const visibleElements = useMemo(
    () =>
      visibleIfcElementResults(
        filtered,
        visibleResultLimit,
        selected?.expressId ?? null,
      ),
    [filtered, selected?.expressId, visibleResultLimit],
  );
  const hiddenElementCount = Math.max(
    0,
    filtered.length - visibleElements.length,
  );

  function choose(
    element: IfcElement,
    source:
      | "initial"
      | "list"
      | "viewer"
      | "deep-link"
      | "anchor"
      | "focus-request" = "list",
  ) {
    selectedIdRef.current = element.expressId;
    setSelected(element);
    viewerRef.current?.selectElement(element.expressId);
    if (source === "list" || source === "deep-link")
      viewerRef.current?.focusElement(element.expressId);
    setProperties(element.properties);
    setStatus(`선택한 요소: #${element.expressId} ${element.typeName}`);
    onElementSelectionRef.current?.({
      origin:
        source === "list" || source === "viewer" ? "user" : "programmatic",
      expressId: element.expressId,
      ifcGlobalId: element.globalId,
      camera: viewerRef.current?.getViewState() ?? null,
    });
    if (
      (source === "list" || source === "viewer") &&
      window.matchMedia("(max-width: 1023px)").matches
    )
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className={`space-y-5 ${compact ? "h-full overflow-auto" : ""}`}>
      <section className={`overflow-hidden rounded-2xl border bg-card shadow-sm ${compact ? "flex max-h-full min-h-0 flex-col" : ""}`}>
        <div className={`flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between ${compact ? "shrink-0" : ""}`}>
          <div>
            <div className="flex items-center gap-2 font-semibold">
              <Cuboid className="size-4 text-primary" /> IFC 3D 모델
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              검증된 IFC 파생 형상을 표시합니다. 화면 조작이나 선택은 원본 IFC
              파일과 물량을 변경하지 않습니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border bg-background px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!viewerReady}
              onClick={() => viewerRef.current?.fitModel()}
              type="button"
            >
              <Maximize2 className="size-4" /> 전체 보기
            </button>
            <button
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border bg-background px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!viewerReady || !selected}
              onClick={() => {
                if (selected)
                  viewerRef.current?.focusElement(selected.expressId);
              }}
              type="button"
            >
              <LocateFixed className="size-4" /> 선택 항목 보기
            </button>
          </div>
        </div>
        <div
          className={`relative overflow-hidden bg-slate-100 dark:bg-slate-950 ${compact ? "h-[20rem] min-h-0 shrink" : "min-h-[22rem] sm:h-[34rem]"}`}
        >
          <div
            aria-label="IFC 3D 모델 화면"
            className="absolute inset-0"
            data-viewer-phase={viewerPhase}
            ref={viewerContainerRef}
            role="img"
          />
          {viewerPhase !== "ready" ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
              <div className="max-w-md rounded-2xl border bg-background/95 p-5 text-center shadow-lg backdrop-blur">
                {viewerPhase === "loading" ? (
                  <LoaderCircle className="mx-auto size-7 animate-spin text-primary" />
                ) : viewerPhase === "error" ? (
                  <AlertCircle className="mx-auto size-7 text-destructive" />
                ) : (
                  <Cuboid className="mx-auto size-7 text-primary" />
                )}
                <p className="mt-3 text-sm font-medium">{viewerStatus}</p>
                {contextLost ? (
                  <button
                    aria-label="3D 화면 다시 시도"
                    className="pointer-events-auto mt-4 min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
                    onClick={() => void mountViewer()}
                    type="button"
                  >
                    3D 화면 다시 시도
                  </button>
                ) : null}
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {(renderBundle?.derivative.geometryByteSize ?? 0) >
                  75 * 1024 * 1024
                    ? "검증된 GLB가 75MB를 넘으면 요소·속성만 표시합니다."
                    : "3D가 열리지 않아도 아래 요소 목록과 검증된 파생 속성은 계속 사용할 수 있습니다."}
                </p>
              </div>
            </div>
          ) : null}
          <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <p
              aria-live="polite"
              className="w-fit rounded-lg bg-slate-950/80 px-3 py-2 text-xs text-white shadow"
              role="status"
            >
              {viewerStatus}
            </p>
            {viewerReady ? (
              <div className="flex w-fit flex-wrap gap-2 rounded-lg bg-slate-950/80 px-3 py-2 text-[11px] text-white/90 shadow">
                <span className="inline-flex items-center gap-1">
                  <Rotate3D className="size-3.5" /> 드래그 회전
                </span>
                <span className="inline-flex items-center gap-1">
                  <MousePointer2 className="size-3.5" /> 클릭 선택
                </span>
                <span>휠 확대 · 우클릭 이동</span>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <div
        className={`grid min-w-0 gap-5 ${compact ? "grid-cols-1" : "lg:grid-cols-[minmax(18rem,.8fr)_minmax(20rem,1.2fr)]"}`}
      >
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="border-b p-5">
            <div className="flex items-center gap-2 font-semibold">
              <Box className="size-4 text-primary" /> IFC 요소
            </div>
            <p
              className="mt-1 truncate text-xs text-muted-foreground"
              title={fileName}
            >
              {fileName}
            </p>
            <label className="relative mt-4 block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                aria-label="IFC 요소 검색"
                className="h-11 w-full rounded-lg border bg-background pl-9 pr-3 text-sm"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setVisibleResultLimit(resultPageSize);
                }}
                placeholder="이름, 유형, #ID 검색"
                type="search"
                value={query}
              />
            </label>
            <p
              aria-live="polite"
              className="mt-3 text-xs text-muted-foreground"
              role="status"
            >
              {status}
            </p>
          </div>
          <div
            aria-label="IFC 요소 결과 목록"
            className="max-h-[58vh] overflow-y-auto p-2"
            role="region"
          >
            {error ? (
              <div
                aria-live="assertive"
                className="m-3 flex gap-2 rounded-xl bg-destructive/10 p-4 text-sm text-destructive"
                role="alert"
              >
                <AlertCircle
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0"
                />
                {error}
              </div>
            ) : null}
            {!error && elements.length === 0 ? (
              <div className="m-3 flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                요소 목록을 준비하고 있습니다.
              </div>
            ) : null}
            {visibleElements.map((element) => (
              <button
                className={`block w-full rounded-xl px-3 py-3 text-left transition ${selected?.expressId === element.expressId ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                key={element.expressId}
                onClick={() => choose(element)}
                type="button"
              >
                <p className="truncate text-sm font-medium">{element.name}</p>
                <p
                  className={`mt-1 truncate font-mono text-[11px] ${selected?.expressId === element.expressId ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                >
                  #{element.expressId} · {element.typeName}
                </p>
              </button>
            ))}
            {elements.length > 0 && filtered.length === 0 ? (
              <p className="p-5 text-center text-sm text-muted-foreground">
                검색 조건에 맞는 요소가 없습니다.
              </p>
            ) : null}
            {hiddenElementCount > 0 ? (
              <button
                aria-label={`IFC 요소 ${Math.min(resultPageSize, hiddenElementCount)}개 더 보기`}
                className="mt-2 min-h-11 w-full rounded-xl border border-dashed px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() =>
                  setVisibleResultLimit((current) => current + resultPageSize)
                }
                type="button"
              >
                더 보기 · {visibleElements.length}/{filtered.length}개 표시
              </button>
            ) : null}
          </div>
        </section>

        <section
          className="scroll-mt-24 rounded-2xl border bg-card p-6 shadow-sm"
          ref={detailRef}
        >
          <div className="flex items-start gap-3 border-b pb-5">
            <span className="rounded-xl bg-primary/10 p-2 text-primary">
              <SlidersHorizontal className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold">선택 요소 속성</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                검증된 IFC 파생물에 기록된 값을 표시합니다. 계산하거나 추정하지
                않습니다.
              </p>
            </div>
          </div>
          {selected ? (
            <>
              <div className="mt-5 grid gap-3 rounded-xl bg-muted/50 p-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Express ID</p>
                  <p className="mt-1 font-mono text-sm">
                    #{selected.expressId}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">IFC 유형</p>
                  <p className="mt-1 text-sm font-medium">
                    {selected.typeName}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Global ID</p>
                  <p
                    className="mt-1 truncate font-mono text-xs"
                    title={selected.globalId ?? undefined}
                  >
                    {selected.globalId ?? "—"}
                  </p>
                </div>
              </div>
              {onAnchorSelected ? (
                <button
                  className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  disabled={!viewerReady}
                  onClick={() => {
                    const viewer = viewerRef.current;
                    if (!viewer) return;
                    onAnchorSelected({
                      elementId: String(selected.expressId),
                      ifcGlobalId: selected.globalId,
                      camera: viewer.getViewState(),
                    });
                  }}
                  type="button"
                >
                  <LocateFixed className="size-4" /> 이 요소를 이슈 근거로 사용
                </button>
              ) : null}
              <dl className="mt-5 divide-y rounded-xl border">
                {properties.length ? (
                  properties.map((property) => (
                    <div
                      className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr]"
                      key={property.key}
                    >
                      <dt className="text-xs font-medium text-muted-foreground">
                        {property.key}
                      </dt>
                      <dd className="break-all font-mono text-xs leading-5">
                        {property.value}
                      </dd>
                    </div>
                  ))
                ) : (
                  <div className="p-5 text-sm text-muted-foreground">
                    요소를 선택하면 검증된 파생 속성이 나타납니다.
                  </div>
                )}
              </dl>
            </>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">
              왼쪽에서 IFC 요소를 선택하세요.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
