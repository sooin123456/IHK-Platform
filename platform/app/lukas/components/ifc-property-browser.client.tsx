import { useEffect, useMemo, useRef, useState } from "react";

import type { IfcAPI, Properties as IfcProperties } from "web-ifc";
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
import wasmUrl from "web-ifc/web-ifc.wasm?url";

import type { IfcModelViewer } from "./ifc-model-viewer.client";
import type { IfcCameraState } from "~/lukas/lib/ifc-anchor";

type IfcElement = {
  expressId: number;
  typeName: string;
  name: string;
  globalId: string;
};

type DisplayProperty = { key: string; value: string };
type IfcRuntime = {
  api: IfcAPI;
  properties: IfcProperties;
};

type Props = {
  byteSize: number;
  fileName: string;
  sourceKey: string;
  initialGlobalId?: string | null;
  signedUrl: string;
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

const maxBrowserGeometryBytes = 75 * 1024 * 1024;

function ifcValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  if (Array.isArray(value)) return value.map(ifcValue).join(", ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("value" in record) return ifcValue(record.value);
    if ("expressID" in record) return `#${record.expressID}`;
    return JSON.stringify(record);
  }
  return String(value);
}

function propertiesFor(line: unknown): DisplayProperty[] {
  if (!line || typeof line !== "object") return [];
  return Object.entries(line as Record<string, unknown>)
    .filter(([key]) => key !== "type")
    .map(([key, value]) => ({ key, value: ifcValue(value) }))
    .slice(0, 80);
}

function propertySetsFor(propertySets: unknown[]): DisplayProperty[] {
  const result: DisplayProperty[] = [];
  for (const set of propertySets) {
    if (!set || typeof set !== "object") continue;
    const record = set as Record<string, unknown>;
    const setName =
      ifcValue(record.Name) === "—" ? "PropertySet" : ifcValue(record.Name);
    const properties = Array.isArray(record.HasProperties)
      ? record.HasProperties
      : [];
    for (const property of properties) {
      if (!property || typeof property !== "object") continue;
      const item = property as Record<string, unknown>;
      const name = ifcValue(item.Name);
      const value =
        item.NominalValue ??
        item.ListValues ??
        item.EnumerationValues ??
        item.LengthValue ??
        item.AreaValue ??
        item.VolumeValue;
      if (value !== undefined)
        result.push({ key: `${setName} · ${name}`, value: ifcValue(value) });
    }
  }
  return result;
}

export default function IfcPropertyBrowser({
  byteSize,
  fileName,
  sourceKey,
  initialGlobalId,
  signedUrl,
  activeAnchor = null,
  onAnchorSelected,
}: Props) {
  const [elements, setElements] = useState<IfcElement[]>([]);
  const [selected, setSelected] = useState<IfcElement | null>(null);
  const [properties, setProperties] = useState<DisplayProperty[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("IFC 파일을 준비하고 있습니다.");
  const [error, setError] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [viewerPhase, setViewerPhase] = useState<ViewerPhase>("loading");
  const [viewerStatus, setViewerStatus] =
    useState("3D 화면을 준비하고 있습니다.");
  const apiRef = useRef<IfcRuntime | null>(null);
  const modelRef = useRef<number | null>(null);
  const viewerRef = useRef<IfcModelViewer | null>(null);
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const selectionRequestRef = useRef(0);
  const selectedIdRef = useRef<number | null>(null);
  const signedUrlRef = useRef(signedUrl);
  signedUrlRef.current = signedUrl;

  useEffect(() => {
    let disposed = false;
    apiRef.current = null;
    modelRef.current = null;
    viewerRef.current?.dispose();
    viewerRef.current = null;
    selectionRequestRef.current += 1;
    selectedIdRef.current = null;
    setViewerReady(false);
    setViewerPhase("loading");
    setViewerStatus("3D 화면을 준비하고 있습니다.");

    async function load() {
      try {
        setError(null);
        setStatus("IFC 원본을 브라우저에서 읽는 중입니다.");
        const response = await fetch(signedUrlRef.current);
        if (!response.ok)
          throw new Error(
            "원본 IFC 파일을 가져오지 못했습니다. 프로젝트 화면에서 다시 열어 주세요.",
          );
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (disposed) return;

        const webIfc = await import("web-ifc");
        const ifcApi = new webIfc.IfcAPI();
        apiRef.current = {
          api: ifcApi,
          properties: new webIfc.Properties(ifcApi),
        };
        await ifcApi.Init(
          (path) => (path.endsWith(".wasm") ? wasmUrl : path),
          true,
        );
        if (disposed) return;
        const modelId = ifcApi.OpenModel(bytes, {
          COORDINATE_TO_ORIGIN: true,
        });
        modelRef.current = modelId;
        if (modelId < 0)
          throw new Error(
            "이 IFC 파일을 열 수 없습니다. IFC2X3 또는 IFC4 형식인지 확인해 주세요.",
          );

        const found: IfcElement[] = [];
        for (const type of ifcApi.GetAllTypesOfModel(modelId)) {
          if (!ifcApi.IsIfcElement(type.typeID)) continue;
          const ids = ifcApi.GetLineIDsWithType(modelId, type.typeID, false);
          for (let index = 0; index < ids.size(); index += 1) {
            const expressId = ids.get(index);
            const line = ifcApi.GetLine(modelId, expressId) as Record<
              string,
              unknown
            >;
            found.push({
              expressId,
              typeName: type.typeName,
              name:
                ifcValue(line.Name) === "—" ? "이름 없음" : ifcValue(line.Name),
              globalId: ifcValue(line.GlobalId),
            });
          }
        }
        found.sort(
          (a, b) =>
            a.typeName.localeCompare(b.typeName) ||
            a.name.localeCompare(b.name),
        );
        if (disposed) return;
        setElements(found);
        setStatus(
          `요소 ${found.length.toLocaleString("ko-KR")}개를 찾았습니다.`,
        );
        if (found[0]) await choose(found[0], "initial");

        if (byteSize > maxBrowserGeometryBytes) {
          setViewerPhase("skipped");
          setViewerStatus(
            "대형 IFC는 브라우저 메모리를 보호하기 위해 속성만 표시합니다.",
          );
        } else if (viewerContainerRef.current) {
          try {
            setViewerStatus("IFC 3D 형상을 만드는 중입니다.");
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
            if (disposed || !viewerContainerRef.current) return;
            const { createIfcModelViewer } = await import(
              "./ifc-model-viewer.client"
            );
            if (disposed || !viewerContainerRef.current) return;
            const byId = new Map(
              found.map((element) => [element.expressId, element]),
            );
            const viewer = createIfcModelViewer({
              api: ifcApi,
              container: viewerContainerRef.current,
              modelId,
              onSelect: (expressId) => {
                const element = byId.get(expressId);
                if (element) void choose(element, "viewer");
              },
              onStatus: (message) => {
                if (!disposed) setViewerStatus(message);
              },
            });
            if (disposed) {
              viewer.dispose();
              return;
            }
            viewerRef.current = viewer;
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
            if (!disposed) {
              setViewerPhase("error");
              setViewerStatus(
                viewerLoadError instanceof Error
                  ? viewerLoadError.message
                  : "3D 화면을 만들지 못했습니다.",
              );
            }
          }
        }
      } catch (loadError) {
        if (!disposed) {
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
      selectionRequestRef.current += 1;
      viewerRef.current?.dispose();
      viewerRef.current = null;
      if (modelRef.current !== null)
        apiRef.current?.api.CloseModel(modelRef.current);
      apiRef.current?.api.Dispose();
      apiRef.current = null;
      modelRef.current = null;
    };
  }, [byteSize, sourceKey]);

  useEffect(() => {
    if (!initialGlobalId || elements.length === 0) return;
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
    void choose(element, "deep-link");
  }, [elements, initialGlobalId]);

  useEffect(() => {
    if (!activeAnchor || !viewerReady) return;
    const expressId = Number(activeAnchor.elementId);
    const element = elements.find((item) => item.expressId === expressId);
    if (!Number.isInteger(expressId) || !element) {
      setViewerStatus(
        "근거 열기 실패: 이 IFC에서 해당 요소를 찾지 못했습니다.",
      );
      return;
    }
    viewerRef.current?.restoreViewState(activeAnchor.camera);
    void choose(element, "anchor");
  }, [activeAnchor, elements, viewerReady]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    if (!normalized) return elements;
    return elements.filter((element) =>
      `${element.expressId} ${element.typeName} ${element.name} ${element.globalId}`
        .toLocaleLowerCase("ko-KR")
        .includes(normalized),
    );
  }, [elements, query]);

  async function choose(
    element: IfcElement,
    source: "initial" | "list" | "viewer" | "deep-link" | "anchor" = "list",
  ) {
    const requestId = ++selectionRequestRef.current;
    selectedIdRef.current = element.expressId;
    setSelected(element);
    viewerRef.current?.selectElement(element.expressId);
    if (source === "list" || source === "deep-link")
      viewerRef.current?.focusElement(element.expressId);
    const runtime = apiRef.current;
    const modelId = modelRef.current;
    if (!runtime || modelId === null) return;
    const [line, propertySets] = await Promise.all([
      Promise.resolve(runtime.api.GetLine(modelId, element.expressId)),
      runtime.properties.getPropertySets(
        modelId,
        element.expressId,
        true,
        true,
      ),
    ]);
    if (
      modelRef.current !== modelId ||
      selectionRequestRef.current !== requestId
    )
      return;
    setProperties([...propertiesFor(line), ...propertySetsFor(propertySets)]);
    setStatus(`선택한 요소: #${element.expressId} ${element.typeName}`);
    if (
      (source === "list" || source === "viewer") &&
      window.matchMedia("(max-width: 1023px)").matches
    )
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 font-semibold">
              <Cuboid className="size-4 text-primary" /> IFC 3D 모델
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              원본 형상만 표시합니다. 화면 조작이나 선택은 IFC 파일과 물량을
              변경하지 않습니다.
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
        <div className="relative min-h-[22rem] overflow-hidden bg-slate-100 dark:bg-slate-950 sm:h-[34rem]">
          <div
            aria-label="IFC 3D 모델 화면"
            className="absolute inset-0"
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
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {byteSize > maxBrowserGeometryBytes
                    ? "75MB 이하 IFC에서 3D 화면을 지원합니다. 아래 요소·속성 탐색은 계속 사용할 수 있습니다."
                    : "3D가 열리지 않아도 아래 요소 목록과 원본 속성은 계속 사용할 수 있습니다."}
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

      <div className="grid gap-5 lg:grid-cols-[minmax(18rem,.8fr)_minmax(20rem,1.2fr)]">
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
                onChange={(event) => setQuery(event.target.value)}
                placeholder="이름, 유형, #ID 검색"
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
          <div className="max-h-[58vh] overflow-y-auto p-2">
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
            {filtered.map((element) => (
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
                IFC 원본에 기록된 값을 그대로 표시합니다. 계산하거나 추정하지
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
                    title={selected.globalId}
                  >
                    {selected.globalId}
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
                      ifcGlobalId: /^[0-9A-Za-z_$]{22}$/.test(selected.globalId)
                        ? selected.globalId
                        : null,
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
                    요소를 선택하면 원본 속성이 나타납니다.
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
