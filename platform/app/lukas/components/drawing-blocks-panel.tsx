import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  canUseDrawingSelectionForBlock,
  createBlockFromSelection,
  deleteDrawingBlockCommand,
  insertDrawingBlockInstanceCommand,
  redefineDrawingBlockFromSelection,
  updateDrawingBlockCommand,
} from "~/lukas/lib/drawing-blocks";
import type {
  DrawingBlock,
  DrawingBlockInstance,
  DrawingLayer,
} from "~/lukas/lib/drawing-workspace.types";
import {
  isEditableDrawingLayer,
  type DrawingCommand,
  type DrawingDocumentState,
} from "~/lukas/lib/drawing-commands";

type Props = {
  activeCanvasId: string | null;
  activeLayerId: string | null;
  actorId: string;
  canEdit: boolean;
  layers: Record<string, DrawingLayer>;
  onCommand: (command: DrawingCommand) => void;
  onSelectionChange: (selectedIds: string[]) => void;
  selectedIds: string[];
  state: DrawingDocumentState;
  nativeCatalogUrl?: string;
  nativeImportReady?: boolean;
  nativeImportNotice?: string | null;
  onNativeImport?: (key: string, clientRequestId: string) => Promise<void>;
};

type NativeSymbol = { key: string; name: string; description: string; classification: string; version: number; recommendedLayer: string };
const nativeCategoryLabels: Record<string, string> = { door: "문", window: "창", wall: "벽", furniture: "가구" };
export function filterNativeDrawingSymbols<T extends Pick<NativeSymbol, "key" | "name" | "classification">>(symbols: T[], query: string, category: string) {
  const search = query.trim().toLocaleLowerCase();
  return symbols.filter(symbol => (category === "all" || symbol.classification === category) && `${symbol.name} ${symbol.key} ${nativeCategoryLabels[symbol.classification] ?? ""}`.toLocaleLowerCase().includes(search));
}

export function nativeDrawingSymbolImportReady(input: {
  canEdit: boolean; online: boolean; outboxReady: boolean; checkpointReady: boolean;
  localMutationCount: number; volatileCount: number; saved: boolean; pending: boolean;
}) {
  return input.canEdit && input.online && input.outboxReady && input.checkpointReady &&
    input.localMutationCount === 0 && input.volatileCount === 0 && input.saved && !input.pending;
}

export function drawingBlockInstancesForCanvas(
  blockId: string,
  activeCanvasId: string | null,
  instances: Record<string, DrawingBlockInstance>,
  layers: Record<string, DrawingLayer>,
) {
  if (!activeCanvasId) return [];
  return Object.values(instances)
    .filter(
      (instance) =>
        instance.blockId === blockId &&
        layers[instance.layerId]?.canvasId === activeCanvasId,
    )
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
}

export function DrawingBlockInstancesList({
  block,
  canEdit,
  instances,
  layers,
  onSelectionChange,
}: {
  block: DrawingBlock;
  canEdit: boolean;
  instances: DrawingBlockInstance[];
  layers: Record<string, DrawingLayer>;
  onSelectionChange: (selectedIds: string[]) => void;
}) {
  return (
    <ul
      aria-label={`${block.name} 인스턴스`}
      className="mt-2 space-y-1 border-t border-slate-200 pt-2"
    >
      {instances.map((instance) => {
        const readOnly =
          !canEdit || !isEditableDrawingLayer(layers[instance.layerId]);
        const reasonId = `block-instance-readonly-${instance.id}`;
        return (
          <li className="flex items-center gap-2" key={instance.id}>
            <button
              aria-describedby={readOnly ? reasonId : undefined}
              aria-label={`${instance.name} 인스턴스 선택`}
              className="min-h-9 flex-1 rounded border border-slate-200 px-2 text-left text-sm"
              onClick={() => onSelectionChange([instance.id])}
              type="button"
            >
              {instance.name}
            </button>
            {readOnly ? (
              <span className="text-xs text-slate-500" id={reasonId}>
                읽기 전용
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "블록을 변경하지 못했습니다.";
}

const primitiveTypeLabels = {
  line: "선",
  polyline: "폴리라인",
  rectangle: "사각형",
  circle: "원",
  text: "텍스트",
  dimension: "치수",
} as const;

/** Reusable definitions remain readable to every workspace member. */
export function DrawingBlocksPanel({
  activeCanvasId,
  activeLayerId,
  actorId,
  canEdit,
  layers,
  onCommand,
  onSelectionChange,
  selectedIds,
  state,
  nativeCatalogUrl,
  nativeImportReady = false,
  nativeImportNotice,
  onNativeImport,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [nativeSymbols, setNativeSymbols] = useState<NativeSymbol[]>([]);
  const [nativeQuery, setNativeQuery] = useState("");
  const [nativeCategory, setNativeCategory] = useState("all");
  const [nativeStatus, setNativeStatus] = useState<string | null>(null);
  const [nativeRequest, setNativeRequest] = useState<{ key: string; id: string } | null>(null);
  const [nativeLoading, setNativeLoading] = useState(false);
  const nativeRequestIds = useRef(new Map<string, string>());
  const [nativeCatalogRetry, setNativeCatalogRetry] = useState(0);
  useEffect(() => {
    if (!nativeCatalogUrl) return;
    const controller = new AbortController();
    setNativeStatus("기본 심볼을 불러오는 중…");
    fetch(nativeCatalogUrl, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("기본 심볼을 불러오지 못했습니다. 연결 후 다시 열어 주세요.");
      const value = await response.json();
      if (!Array.isArray(value.items)) throw new Error("기본 심볼 목록이 올바르지 않습니다.");
      setNativeSymbols(value.items);
      setNativeStatus(null);
    }).catch(error => { if (!controller.signal.aborted) setNativeStatus(message(error)); });
    return () => controller.abort();
  }, [nativeCatalogUrl, nativeCatalogRetry]);
  const [expandedBlockIds, setExpandedBlockIds] = useState<Set<string>>(
    () => new Set(),
  );
  const structure = state.structure;
  if (!structure) return null;
  const canonical = structure;
  const filteredNativeSymbols = filterNativeDrawingSymbols(nativeSymbols, nativeQuery, nativeCategory);
  const canUseSelection = Boolean(
    activeLayerId &&
      canUseDrawingSelectionForBlock(state, selectedIds, activeLayerId),
  );
  const blocks = Object.values(canonical.blocks).sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (!activeLayerId) throw new Error("활성 레이어를 선택하세요.");
      const data = new FormData(event.currentTarget);
      onCommand(
        createBlockFromSelection(
          state,
          selectedIds,
          actorId,
          String(data.get("name") ?? ""),
          { activeLayerId },
        ),
      );
      setError(null);
      event.currentTarget.reset();
    } catch (caught) {
      setError(message(caught));
    }
  }

  function update(blockId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const data = new FormData(event.currentTarget);
      onCommand(
        updateDrawingBlockCommand(state, actorId, blockId, {
          name: String(data.get("name") ?? "").trim(),
        }),
      );
      setError(null);
    } catch (caught) {
      setError(message(caught));
    }
  }


  function redefine(blockId: string) {
    try {
      if (!activeLayerId) throw new Error("활성 레이어를 선택하세요.");
      onCommand(
        redefineDrawingBlockFromSelection(
          state,
          selectedIds,
          actorId,
          blockId,
          { activeLayerId },
        ),
      );
      setError(null);
    } catch (caught) {
      setError(message(caught));
    }
  }

  const list = (
    <ul aria-label="도면 블록" className="mt-4 space-y-3">
      {blocks.map((block) => {
        const allInstances = Object.values(canonical.blockInstances)
          .filter((instance) => instance.blockId === block.id)
          .sort(
            (left, right) =>
              left.name.localeCompare(right.name) ||
              left.id.localeCompare(right.id),
          );
        const instances = drawingBlockInstancesForCanvas(
          block.id,
          activeCanvasId,
          canonical.blockInstances,
          layers,
        );
        const used = allInstances.length;
        const activeUsed = instances.length;
        const offCanvasUsed = used - activeUsed;
        const expanded = expandedBlockIds.has(block.id);
        const instancesId = `block-instances-${block.id}`;
        const reasonId = `block-delete-reason-${block.id}`;
        const redefineReasonId = `block-redefine-reason-${block.id}`;
        const canRedefine = canUseSelection;
        return (
          <li
            className="rounded-md border border-slate-200 bg-slate-50 p-2"
            key={block.id}
          >
            {canEdit ? (
              <form
                className="grid gap-2"
                data-drawing-shortcuts="ignore"
                key={`${block.id}:${block.version}`}
                onSubmit={(event) => update(block.id, event)}
              >
                <label
                  className="grid gap-1 text-xs"
                  htmlFor={`block-name-${block.id}`}
                >
                  블록 이름
                  <input
                    className="min-h-9 rounded border border-slate-200 bg-white px-2 text-sm"
                    defaultValue={block.name}
                    id={`block-name-${block.id}`}
                    maxLength={255}
                    name="name"
                    required
                  />
                </label>
                <button
                  className="min-h-9 rounded bg-indigo-600 px-2 text-sm font-semibold text-white"
                  type="submit"
                >
                  이름 저장
                </button>
              </form>
            ) : (
              <>
                <p className="font-medium">{block.name}</p>
                <p className="mt-1 text-xs text-slate-500">
                  도형 요소 {block.primitives.length}개 · 인스턴스 {used}개
                </p>
              </>
            )}
            <ul
              aria-label={`${block.name} 도형 요소`}
              className="mt-2 space-y-1 text-xs text-slate-700"
            >
              {block.primitives.map((primitive) => (
                <li key={primitive.localId}>
                  {primitive.name} · {primitiveTypeLabels[primitive.geometry.type]}
                </li>
              ))}
            </ul>
            {canEdit ? (
              <div className="mt-3 grid gap-2">
                <p className="text-xs text-amber-700">
                  선택 객체로 교체하면 이 블록의 모든 인스턴스에 즉시 반영됩니다.
                  선택 원본은 유지됩니다.
                </p>
                <button
                  aria-describedby={!canRedefine ? redefineReasonId : undefined}
                  className="min-h-9 rounded border border-slate-300 px-2 text-sm disabled:opacity-50"
                  disabled={!canRedefine}
                  onClick={() => redefine(block.id)}
                  type="button"
                >
                  선택 객체로 정의 교체
                </button>
                {!canRedefine ? (
                  <span className="text-xs text-slate-500" id={redefineReasonId}>
                    활성 레이어의 일반 도형을 하나 이상 선택하세요.
                  </span>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                <button
                  className="min-h-9 rounded border border-slate-300 px-2 text-sm disabled:opacity-50"
                  disabled={!activeLayerId}
                  onClick={() => {
                    try {
                      if (!activeLayerId) return;
                      onCommand(
                        insertDrawingBlockInstanceCommand(
                          state,
                          actorId,
                          block.id,
                          { x: 0, y: 0 },
                          { activeLayerId },
                        ),
                      );
                      setError(null);
                    } catch (caught) {
                      setError(message(caught));
                    }
                  }}
                  type="button"
                >
                  인스턴스 삽입
                </button>
                <button
                  aria-describedby={used ? reasonId : undefined}
                  className="min-h-9 rounded border border-slate-300 px-2 text-sm disabled:opacity-50"
                  disabled={used > 0}
                  onClick={() => {
                    try {
                      onCommand(
                        deleteDrawingBlockCommand(state, actorId, block.id),
                      );
                      setError(null);
                    } catch (caught) {
                      setError(message(caught));
                    }
                  }}
                  type="button"
                >
                  정의 삭제
                </button>
                </div>
              </div>
            ) : null}
            <button
              aria-controls={instancesId}
              aria-expanded={expanded}
              aria-label={`${block.name} 인스턴스 ${used}개 ${expanded ? "접기" : "보기"} · 현재 캔버스 ${activeUsed}개 · 다른 캔버스 ${offCanvasUsed}개`}
              className="mt-2 min-h-9 w-full rounded border border-slate-200 px-2 text-left text-xs"
              onClick={() =>
                setExpandedBlockIds((current) => {
                  const next = new Set(current);
                  if (next.has(block.id)) next.delete(block.id);
                  else next.add(block.id);
                  return next;
                })
              }
              type="button"
            >
              인스턴스 {used}개 {expanded ? "접기" : "보기"} · 현재 캔버스{" "}
              {activeUsed}개 · 다른 캔버스 {offCanvasUsed}개
            </button>
            {expanded ? (
              <div id={instancesId}>
                {instances.length ? (
                  <DrawingBlockInstancesList
                    block={block}
                    canEdit={canEdit}
                    instances={instances}
                    layers={layers}
                    onSelectionChange={onSelectionChange}
                  />
                ) : (
                  <p className="mt-2 text-xs text-slate-500">
                    현재 캔버스에 인스턴스가 없습니다.
                  </p>
                )}
              </div>
            ) : null}
            {used ? (
              <span className="mt-2 block text-xs text-slate-500" id={reasonId}>
                사용 중인 정의는 삭제할 수 없습니다.
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <section
      aria-labelledby="drawing-blocks-title"
      className="mt-6 border-t border-slate-200 pt-6"
    >
      <h2 className="text-sm font-bold" id="drawing-blocks-title">
        블록 라이브러리
      </h2>
      {nativeCatalogUrl ? (
        <section aria-labelledby="native-symbols-title" className="mt-4 rounded border border-slate-200 p-3" data-drawing-shortcuts="ignore">
          <h3 id="native-symbols-title" className="text-sm font-semibold">기본 심볼</h3>
          <p className="mt-1 text-xs text-slate-500">1HK 기본 · 예제 · v1 · mm. 블록에 추가한 뒤 인스턴스를 삽입하세요.</p>
          <label className="mt-3 grid gap-1 text-xs">기본 심볼 검색
            <input className="min-h-9 rounded border border-slate-200 bg-white px-2 text-sm" value={nativeQuery} onChange={event => setNativeQuery(event.target.value)} type="search" />
          </label>
          <label className="mt-2 grid gap-1 text-xs">심볼 분류
            <select className="min-h-9 rounded border border-slate-200 bg-white px-2 text-sm" value={nativeCategory} onChange={event => setNativeCategory(event.target.value)}>
              <option value="all">전체</option><option value="door">문</option><option value="window">창</option><option value="wall">벽</option><option value="furniture">가구</option>
            </select>
          </label>
          <p className="mt-2 text-xs text-slate-500" role="status">{filteredNativeSymbols.length}개 심볼</p>
          {filteredNativeSymbols.length === 0 ? <p className="mt-2 text-xs text-slate-500">조건에 맞는 심볼이 없습니다.</p> : null}
          <ul aria-label="기본 심볼 목록" className="mt-3 max-h-72 space-y-2 overflow-y-auto">
            {filteredNativeSymbols.map(symbol => (
              <li aria-label={symbol.name} className="rounded border border-slate-200 p-2" key={symbol.key}>
                <p className="text-sm">{symbol.name}</p>
                <p className="mt-1 text-xs text-slate-500">{symbol.description}</p>
                <p className="mt-1 text-xs text-slate-500">{nativeCategoryLabels[symbol.classification]} · 권장 레이어: {symbol.recommendedLayer}</p>
                {onNativeImport ? <button className="mt-2 min-h-9 rounded border border-slate-300 px-2 text-xs disabled:opacity-50" disabled={!nativeImportReady || nativeLoading} type="button" onClick={async () => {
                  if (!nativeImportReady || nativeLoading) return;
                  const identity = { key: symbol.key, id: nativeRequestIds.current.get(symbol.key) ?? crypto.randomUUID() };
                  nativeRequestIds.current.set(symbol.key, identity.id);
                  setNativeRequest(identity);
                  setNativeLoading(true);
                  try {
                    await onNativeImport(symbol.key, identity.id);
                    nativeRequestIds.current.delete(symbol.key);
                    setNativeRequest(null);
                    setNativeStatus(`${symbol.name} 블록에 추가했습니다. 아래 블록의 인스턴스 삽입을 사용하세요.`);
                  } catch (caught) { setNativeStatus(message(caught)); }
                  finally { setNativeLoading(false); }
                }}>{nativeLoading && nativeRequest?.key === symbol.key ? "추가하는 중…" : "블록에 추가"}</button> : null}
              </li>
            ))}
          </ul>
          {nativeImportNotice ? <p role="status" className="mt-2 text-xs text-amber-700">{nativeImportNotice}</p> : null}
          {nativeStatus ? <p role="status" className="mt-2 text-xs text-slate-700">{nativeStatus}</p> : null}
          {nativeSymbols.length === 0 ? <button className="mt-2 min-h-9 rounded border border-slate-300 px-2 text-xs" type="button" onClick={() => setNativeCatalogRetry(current => current + 1)}>기본 심볼 목록 다시 불러오기</button> : null}
        </section>
      ) : null}
      {!canEdit ? (
        <p className="mt-2 text-xs text-slate-500">읽기 전용 블록 목록</p>
      ) : (
        <form
          className="mt-3 grid gap-2"
          data-drawing-shortcuts="ignore"
          onSubmit={create}
        >
          <label className="text-xs" htmlFor="new-drawing-block-name">
            선택 객체로 블록 만들기
          </label>
          <input
            className="min-h-10 rounded border border-slate-200 bg-white px-2 text-sm"
            id="new-drawing-block-name"
            maxLength={255}
            name="name"
            required
          />
          <button
            className="min-h-10 rounded bg-indigo-600 px-3 text-sm font-semibold text-white disabled:opacity-50"
            disabled={!canUseSelection}
            type="submit"
          >
            블록 만들기
          </button>
        </form>
      )}
      {error ? (
        <p className="mt-3 text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {list}
    </section>
  );
}
