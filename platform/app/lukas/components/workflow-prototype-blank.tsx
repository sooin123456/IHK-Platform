import { useState, useRef, useEffect } from "react";
import type { PriceBookEntry } from "../lib/workflow-pricebook";
import {
  editObjectHistory,
  type ScreenObjectHistory,
} from "../lib/drawing-screen-object-history";
import type { WorkflowBlankDocument } from "../lib/workflow-blank-document";
import {
  draftPositionLimit,
  draftPolylineGeometry,
  transformDraftSelection,
  type DraftSelectionAction,
} from "../lib/workflow-blank-document";
import { WorkflowPdfBackground } from "./workflow-prototype-pdf";
import {useWorkflowMeasurement} from './workflow-measurement';
import { WorkflowDraftShape } from "./workflow-draft-shape";
import { WorkflowMultiSelection } from "./workflow-multiselect";
import { WorkflowQuantityEditor } from "./workflow-document-quantity";
import { WorkflowDocumentLayers } from "./workflow-document-layers";
import {
  documentLayers,
  validDraftLayers,
  orderedDraftShapes,
  draftLayer,
  editableDraftLayer,
  canChangeDraftShapes,
} from "../lib/workflow-document-layers";
import { setDocumentQuantity } from "../lib/workflow-document-quantity";
import { WorkflowDocumentReview } from "./workflow-document-review";
import {WorkflowObjectComments} from './workflow-object-comments';
import {WorkflowRfiComposer} from './workflow-local-rfi';
import {WorkflowLocalShare} from './workflow-local-share';
import { WorkflowDocumentFindings } from './workflow-document-findings';
import {
  canEditDocument,
  type DocumentReviewRole,
} from "../lib/workflow-document-review";

export function WorkflowBlankStart({
  onCreate,
  disabled = false,
  disabledReason = '이 탭의 빈 작업은 최대 30개입니다.',
}: {
  onCreate: (title: string) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [title, setTitle] = useState("");
  return (
    <section className="flow-card">
      <h2>자료 없이 빈 작업실 만들기</h2>
      <p>
        도면 업로드 없이 배치 구상부터 시작합니다. 기존 예시 프로젝트를 덮어쓰지
        않습니다.
      </p>
      <label className="flow-input">
        작업 이름
        <input
          aria-label="빈 작업 이름"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="예: 1층 배치 구상"
        />
      </label>
      <button
        disabled={disabled || !title.trim()}
        onClick={() => onCreate(title.trim())}
      >
        빈 작업실 열기
      </button>
      {disabled && <p>{disabledReason}</p>}
    </section>
  );
}

export function WorkflowBlankWorkspace({
  document,
  onChange,
  onBack,
  onComparisonBack,
  onFieldBack,
  onScheduleBack,
  onMaterialsBack,
  onOverviewBack,
  onCommentsBack,
  onRfiBack,
  onDocumentsBack,
  fieldReviewId,
  onQuantities,
  pricebook,
  pricebookLabel,
  initialRole = "author",
  readOnlySnapshot = false,
  initialSelectedId = null,
}: {
  document: WorkflowBlankDocument;
  onChange: (document: WorkflowBlankDocument) => void;
  onBack: () => void;
  onComparisonBack?:()=>void;
  onFieldBack?:()=>void;
  onScheduleBack?:()=>void;
  onMaterialsBack?:()=>void;
  onOverviewBack?:()=>void;
  onCommentsBack?:()=>void;
  onRfiBack?:()=>void;
  onDocumentsBack?:()=>void;
  fieldReviewId?:string;
  onQuantities: () => void;
  pricebook?: PriceBookEntry[];
  pricebookLabel?: string;
  initialRole?: DocumentReviewRole;
  readOnlySnapshot?: boolean;
  initialSelectedId?: string | null;
}) {
  const [tool, setTool] = useState<
    "select" | "rectangle" | "line" | "circle" | "text" | "polyline"
  >("select");
  const [selectedIds, setSelectedIds] = useState<string[]>(
    initialSelectedId ? [initialSelectedId] : [],
  );
  const selected = selectedIds.at(-1) ?? null;
  const setSelected = (id: string | null) => setSelectedIds(id ? [id] : []);
  const toggleSelection = (id: string) => {
    setSelectedIds((ids) =>
      ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
    );
    setTool("select");
    const item = document.shapes.find((item) => item.id === id);
    if (item && !draftLayer(document, item)?.visible) setShowHidden(true);
  };
  const [pathPoints, setPathPoints] = useState<{ x: number; y: number }[]>([]);
  const [pointX, setPointX] = useState("0"),
    [pointY, setPointY] = useState("0"),
    [pathMessage, setPathMessage] = useState("");
  const [activeLayer, setActiveLayer] = useState("default");
  const [showHidden, setShowHidden] = useState(() => {
    const target = document.shapes.find(
      (shape) => shape.id === initialSelectedId,
    );
    return Boolean(target && draftLayer(document, target)?.visible === false);
  });
  const [pdfReady, setPdfReady] = useState(false);
  const sourceRegion = useRef<HTMLDivElement>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [snapshotDetailsOpen,setSnapshotDetailsOpen]=useState(false);
  const inspectorScroll = useRef<HTMLDivElement>(null);
  const inspectorSections = useRef<Record<string, HTMLHeadingElement | null>>({});
  const navigateInspector = (section: string) => {
    if(readOnlySnapshot)setSnapshotDetailsOpen(true);
    setInspectorOpen(true);
    requestAnimationFrame(() => {
      const target = inspectorSections.current[section];
      const scroller = inspectorScroll.current;
      if (!target || !scroller) return;
      target.focus({preventScroll:true});
      if (window.matchMedia('(min-width: 701px)').matches) {
        scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
      } else target.scrollIntoView({block:'start'});
    });
  };
  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const update = () =>
      setInspectorOpen(!media.matches || Boolean(initialSelectedId));
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [initialSelectedId]);
  useEffect(() => {
    if (selected) setInspectorOpen(true);
  }, [selected]);
  const [dragPreview, setDragPreview] = useState<{
    ids: string[];
    dx: number;
    dy: number;
  } | null>(null);
  const drag = useRef<{
    id: string;
    ids: string[];
    clientX: number;
    clientY: number;
    x: number;
    y: number;
    width: number;
    height: number;
    nextX: number;
    nextY: number;
  } | null>(null);
  const [previewRole, setRole] = useState<DocumentReviewRole>(initialRole);
  const role = readOnlySnapshot ? "viewer" : previewRole;
  const writable =
    canEditDocument(document, role) && (!document.source || pdfReady);
  const page = document.page ?? 1;
  const measurement=useWorkflowMeasurement(document,pdfReady,writable,onChange);
  useEffect(()=>{if(tool!=='select')measurement.setActive(false);},[tool]);
  type EditState = Pick<WorkflowBlankDocument, "shapes" | "layers">;
  const currentEdit: EditState = {
    shapes: document.shapes,
    ...(document.layers ? { layers: document.layers } : {}),
  };
  const effectiveActive = documentLayers(document).some(
    (layer) => layer.id === activeLayer,
  )
    ? activeLayer
    : "default";
  useEffect(() => {
    setPathPoints([]);
    setPathMessage("");
  }, [tool, page, role, document.revision, effectiveActive]);
  const history = useRef<ScreenObjectHistory<EditState>>({
    past: [],
    present: [currentEdit],
    future: [],
  });
  const historyBoundary = useRef(
    `${document.revision ?? 1}:${document.reviewRounds?.at(-1)?.phase ?? "draft"}:${role}`,
  );
  const boundary = `${document.revision ?? 1}:${document.reviewRounds?.at(-1)?.phase ?? "draft"}:${role}`;
  if (
    historyBoundary.current !== boundary ||
    history.current.present[0].shapes !== document.shapes ||
    history.current.present[0].layers !== document.layers
  ) {
    history.current = { past: [], present: [currentEdit], future: [] };
    historyBoundary.current = boundary;
  }
  const editGroup = useRef(0);
  const publishEdit = (next: EditState) => {
    const { layers: previousLayers, ...base } = document;
    onChange({ ...base, ...next });
  };
  const record = (shapes: WorkflowBlankDocument["shapes"], group?: string) => {
    if (!writable || !canChangeDraftShapes(document, shapes)) return;
    history.current = editObjectHistory(history.current, {
      type: "record",
      update: () => [{ ...currentEdit, shapes }],
      group,
    });
    publishEdit(history.current.present[0]);
  };
  const restore = (type: "undo" | "redo") => {
    if (!writable) return;
    const next = editObjectHistory(history.current, { type });
    if (!canChangeDraftShapes(document, next.present[0].shapes)) return;
    history.current = next;
    publishEdit(history.current.present[0]);
    setSelected(null);
    setTool("select");
  };
  const shape = document.shapes.find((shape) => shape.id === selected);
  const applySelection = (action: DraftSelectionAction) => {
    if (!writable) return;
    const next = transformDraftSelection(document, selectedIds, action);
    if (!next) return;
    record(next);
    if (action.type === "copy") setSelectedIds(action.newIds);
    if (action.type === "delete") setSelected(null);
  };
  const updateLabel = (label: string) => {
    if (!writable) return;
    record(
      document.shapes.map((item) =>
        item.id === selected ? { ...item, label } : item,
      ),
      `name:${selected}:${editGroup.current}`,
    );
  };
  const placeShape = (x: number, y: number) => {
    if (
      tool === "select" ||
      tool === "polyline" ||
      !writable ||
      document.shapes.length >= 500 ||
      !editableDraftLayer(document, { layerId: effectiveActive })
    )
      return;
    const id = crypto.randomUUID();
    record([
      ...document.shapes,
      {
        id,
        x: Math.max(0, Math.min(680, x)),
        y: Math.max(0, Math.min(440, y)),
        label:
          tool === "text"
            ? "텍스트 입력"
            : tool === "line"
              ? "선 표시"
              : tool === "circle"
                ? "원 표시"
                : "구상 영역",
        page,
        kind: tool,
        ...(effectiveActive !== "default" ? { layerId: effectiveActive } : {}),
      },
    ]);
    setSelected(id);
    setTool("select");
  };
  const appendPoint = (x: number, y: number) => {
    if (
      !writable ||
      !editableDraftLayer(document, { layerId: effectiveActive }) ||
      pathPoints.length >= 100
    )
      return;
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      x > 800 ||
      y < 0 ||
      y > 520
    ) {
      setPathMessage("점은 페이지 범위 X 0~800, Y 0~520 안에 입력하세요.");
      return;
    }
    if (pathPoints.at(-1)?.x === x && pathPoints.at(-1)?.y === y) return;
    setPathPoints((points) => [...points, { x, y }]);
    setPathMessage("");
  };
  const finishPolyline = () => {
    if (
      !writable ||
      document.shapes.length >= 500 ||
      !editableDraftLayer(document, { layerId: effectiveActive })
    )
      return;
    const geometry = draftPolylineGeometry(pathPoints);
    if (!geometry) {
      setPathMessage(
        "서로 다른 점 2개 이상, 전체 너비 600·높이 400 이하로 작성하세요.",
      );
      return;
    }
    const id = crypto.randomUUID();
    record([
      ...document.shapes,
      {
        id,
        label: "폴리라인 표시",
        page,
        layerId: effectiveActive,
        ...geometry,
      },
    ]);
    setSelected(id);
    setTool("select");
  };
  return (
    <section
      className="flow-card flow-local-workspace"
      aria-label="원본 없는 빈 작업실"
      tabIndex={0}
      onKeyDown={(event) => {
        const target = event.target as Element;
        if (
          event.defaultPrevented ||
          target.closest('input,textarea,select,[contenteditable="true"]')
        )
          return;
        const key = event.key.toLowerCase();
        if (event.key === "Escape") {
          event.preventDefault();
          setSelected(null);
          setTool("select");
          drag.current = null;
          setDragPreview(null);
          return;
        }
        if (!writable) return;
        if (
          tool === "polyline" &&
          (event.key === "Backspace" || event.key === "Delete")
        ) {
          event.preventDefault();
          setPathPoints((points) => points.slice(0, -1));
          return;
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          !event.altKey &&
          (key === "z" || key === "y")
        ) {
          event.preventDefault();
          restore(key === "y" || event.shiftKey ? "redo" : "undo");
          return;
        }
        if (
          !shape ||
          !target.closest('svg[aria-label="빈 작업 캔버스"]') ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        )
          return;
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          applySelection({ type: "delete" });
          event.currentTarget.focus();
          return;
        }
        const delta = event.shiftKey ? 10 : 1;
        const directions: Record<string, [number, number]> = {
          ArrowLeft: [-delta, 0],
          ArrowRight: [delta, 0],
          ArrowUp: [0, -delta],
          ArrowDown: [0, delta],
        };
        const direction = directions[event.key];
        if (!direction) return;
        event.preventDefault();
        if (selectedIds.length > 1) {
          applySelection({ type: "move", dx: direction[0], dy: direction[1] });
          return;
        }
        record(
          document.shapes.map((item) =>
            item.id === selected
              ? {
                  ...item,
                  x: Math.max(
                    0,
                    Math.min(
                      draftPositionLimit(item, "x"),
                      item.x + direction[0],
                    ),
                  ),
                  y: Math.max(
                    0,
                    Math.min(
                      draftPositionLimit(item, "y"),
                      item.y + direction[1],
                    ),
                  ),
                }
              : item,
          ),
        );
      }}
    >
      <header>
        <h2>{document.title}</h2>
        {readOnlySnapshot && (
          <span className="flow-badge">
            승인본 R{document.revision} · 읽기 전용
          </span>
        )}
        <button onClick={onBack}>내 빈 작업 목록</button>
        {onComparisonBack&&<button onClick={onComparisonBack}>변경 비교로 돌아가기</button>}
        {onFieldBack&&<button onClick={onFieldBack}>현장 기록으로 돌아가기</button>}
        {onScheduleBack&&<button onClick={onScheduleBack}>공정표로 돌아가기</button>}
        {onMaterialsBack&&<button onClick={onMaterialsBack}>자재 기록으로 돌아가기</button>}
        {onOverviewBack&&<button onClick={onOverviewBack}>진행 개요로 돌아가기</button>}
        {onCommentsBack&&<button onClick={onCommentsBack}>댓글 목록으로 돌아가기</button>}
        {onRfiBack&&<button onClick={onRfiBack}>질의 목록으로 돌아가기</button>}
        {onDocumentsBack&&<button onClick={onDocumentsBack}>도면 목록으로 돌아가기</button>}
      </header>
      <p>
        {readOnlySnapshot?'승인 당시 도면을 조회합니다. 원본을 연결하고 객체를 선택해 근거를 확인하세요.':`${document.source ? "PDF 원본 연결" : "원본 미연결"} · 실측 단위 없음 · 수동 적산 미확정`}
      </p>
      <div className="flow-actions flow-draft-toolbar">
        {readOnlySnapshot?<><button aria-label="선택 도구" aria-pressed={tool==='select'} onClick={()=>setTool('select')}>객체 선택</button><span>{document.shapes.length}개 객체 · 읽기 전용</span></>:<>
        <button disabled={!document.source||!pdfReady} aria-pressed={measurement.active} onClick={()=>{setTool('select');measurement.setActive(!measurement.active);}}>PDF 축척·거리</button>
        <button
          disabled={!writable || !history.current.past.length}
          onClick={() => restore("undo")}
          aria-label="구상 실행 취소"
        >
          실행 취소
        </button>
        <button
          disabled={!writable || !history.current.future.length}
          onClick={() => restore("redo")}
          aria-label="구상 다시 실행"
        >
          다시 실행
        </button>
        <button
          aria-pressed={tool === "select"}
          onClick={() => setTool("select")}
          aria-label="선택 도구"
        >
          선택
        </button>
        <button
          aria-pressed={tool === "rectangle"}
          disabled={document.shapes.length >= 500 || !writable}
          onClick={() => setTool("rectangle")}
          aria-label="사각형 구상 도구"
        >
          사각형
        </button>
        <span>{document.shapes.length}개 구상 객체</span>
        {(
          [
            ["line", "선"],
            ["polyline", "폴리라인"],
            ["circle", "원"],
            ["text", "텍스트"],
          ] as const
        ).map(([kind, label]) => (
          <button
            key={kind}
            aria-label={`${label} 구상 도구`}
            aria-pressed={tool === kind}
            disabled={!writable || document.shapes.length >= 500}
            onClick={() => setTool(kind)}
          >
            {label}
          </button>
        ))}
        </>}
      </div>
      {measurement.panel}
      {tool === "polyline" && (
        <section className="flow-card" aria-label="폴리라인 작성">
          <strong>{pathPoints.length}개 점 · 작성 중</strong>
          <p>
            캔버스를 클릭해 점을 추가하세요. Enter는 완료, Backspace는 마지막 점
            취소, Esc는 전체 취소입니다. 최대 100점, 상대 너비 600·높이 400까지
            지원합니다. 미완료 선은 저장되지 않습니다.
          </p>
          <div className="flow-actions">
            <label className="flow-input">
              다음 점 X
              <input
                aria-label="다음 점 X"
                type="number"
                min="0"
                max="800"
                value={pointX}
                onChange={(event) => setPointX(event.target.value)}
              />
            </label>
            <label className="flow-input">
              다음 점 Y
              <input
                aria-label="다음 점 Y"
                type="number"
                min="0"
                max="520"
                value={pointY}
                onChange={(event) => setPointY(event.target.value)}
              />
            </label>
            <button
              disabled={
                !writable ||
                !pointX.trim() ||
                !pointY.trim() ||
                pathPoints.length >= 100
              }
              onClick={() => appendPoint(Number(pointX), Number(pointY))}
            >
              좌표 점 추가
            </button>
            <button
              disabled={!writable || !pathPoints.length}
              onClick={() => setPathPoints((points) => points.slice(0, -1))}
            >
              마지막 점 취소
            </button>
            <button
              disabled={!writable || pathPoints.length < 2}
              onClick={finishPolyline}
            >
              폴리라인 완료
            </button>
            <button onClick={() => setTool("select")}>폴리라인 취소</button>
          </div>
          {pathMessage && <p role="alert">{pathMessage}</p>}
        </section>
      )}
      <details className="flow-draft-help" hidden={readOnlySnapshot}>
        <summary>편집·실행 취소 안내</summary>
        <p>
          도구를 고른 뒤 Tab으로 캔버스에 진입하고 Enter를 누르면 페이지 중앙에
          배치합니다. 이어서 방향키로 위치를 조정할 수 있습니다.
        </p>
        <p>
          객체에 초점을 두고 방향키로 이동합니다. Shift+방향키는 10칸 이동,
          Delete는 삭제, Esc는 선택 해제입니다. Ctrl/⌘+Z는 실행 취소,
          Ctrl/⌘+Shift+Z는 다시 실행입니다. 입력창에서는 기본 입력 동작을
          유지합니다.
        </p>
        <p className="flow-note">
          선택한 객체는 끌어서 이동하거나 위치 값으로 조정할 수 있습니다. 실행
          취소는 이 작업실을 열어둔 동안의 편집에 적용됩니다.
        </p>
      </details>
      <div className="flow-blank-grid">
        <div ref={sourceRegion}>
          <WorkflowPdfBackground
            source={document.source}
            page={page}
            onSource={(source) => onChange({ ...document, source })}
            onReady={setPdfReady}
            onPage={(page) => {
              setSelected(null);
              setTool("select");
              onChange({ ...document, page });
            }}
          >
            <svg
              viewBox="0 0 800 520"
              preserveAspectRatio={document.source ? "none" : "xMidYMid meet"}
              role="img"
              aria-label="빈 작업 캔버스"
              className="flow-blank-canvas"
              tabIndex={0}
              onKeyDown={(event) => {
                if (
                  event.target === event.currentTarget &&
                  event.key === "Enter" &&
                  !event.repeat &&
                  !event.ctrlKey &&
                  !event.metaKey &&
                  !event.altKey
                ) {
                  event.preventDefault();
                  if (tool === "polyline") finishPolyline();
                  else if(!measurement.active) placeShape(340, 220);
                }
              }}
              onClick={(event) => {
                if (tool === "select") {
                  setSelected(null);
                  return;
                }
                if (!writable || document.shapes.length >= 500) return;
                if (tool === "polyline") {
                  const matrix = event.currentTarget.getScreenCTM();
                  if (!matrix) return;
                  const point = new DOMPoint(
                    event.clientX,
                    event.clientY,
                  ).matrixTransform(matrix.inverse());
                  appendPoint(point.x, point.y);
                  return;
                }
                const box = event.currentTarget.getBoundingClientRect();
                const x = Math.max(
                  0,
                  Math.min(
                    680,
                    ((event.clientX - box.left) / box.width) * 800 - 60,
                  ),
                );
                const y = Math.max(
                  0,
                  Math.min(
                    440,
                    ((event.clientY - box.top) / box.height) * 520 - 40,
                  ),
                );
                placeShape(x, y);
              }}
            >
              <defs>
                <pattern
                  id="blank-grid"
                  width="20"
                  height="20"
                  patternUnits="userSpaceOnUse"
                >
                  <path d="M20 0H0V20" fill="none" stroke="#e5e9f0" />
                </pattern>
              </defs>
              {!document.source && (
                <rect width="800" height="520" fill="url(#blank-grid)" />
              )}
              {orderedDraftShapes(document)
                .filter(
                  (item) =>
                    (item.page ?? 1) === page &&
                    (showHidden || draftLayer(document, item)?.visible),
                )
                .map((item) => (
                  <g
                    role="button"
                    tabIndex={0}
                    aria-label={`${item.label} 구상 객체`}
                    key={item.id}
                    transform={
                      dragPreview?.ids.includes(item.id)
                        ? `translate(${dragPreview.dx} ${dragPreview.dy})`
                        : undefined
                    }
                    style={{
                      touchAction: writable ? "none" : "auto",
                      cursor:
                        writable && tool === "select" ? "move" : undefined,
                    }}
                    onPointerDown={(event) => {
                      if (event.shiftKey) return;
                      if (
                        !writable ||
                        !editableDraftLayer(document, item) ||
                        tool !== "select" ||
                        event.button !== 0
                      )
                        return;
                      const bounds =
                        event.currentTarget.ownerSVGElement?.getBoundingClientRect();
                      if (!bounds) return;
                      const ids = selectedIds.includes(item.id)
                        ? selectedIds
                        : [item.id];
                      if (
                        !transformDraftSelection(document, ids, {
                          type: "move",
                          dx: 0,
                          dy: 0,
                        })
                      )
                        return;
                      event.stopPropagation();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      if (!selectedIds.includes(item.id)) setSelected(item.id);
                      drag.current = {
                        id: item.id,
                        ids,
                        clientX: event.clientX,
                        clientY: event.clientY,
                        x: item.x,
                        y: item.y,
                        width: bounds.width,
                        height: bounds.height,
                        nextX: item.x,
                        nextY: item.y,
                      };
                    }}
                    onPointerMove={(event) => {
                      const active = drag.current;
                      if (!active || active.id !== item.id || !writable) return;
                      event.preventDefault();
                      const next = transformDraftSelection(
                        document,
                        active.ids,
                        {
                          type: "move",
                          dx:
                            ((event.clientX - active.clientX) / active.width) *
                            800,
                          dy:
                            ((event.clientY - active.clientY) / active.height) *
                            520,
                        },
                      );
                      const anchor = next?.find(
                        (shape) => shape.id === active.id,
                      );
                      if (!anchor) return;
                      active.nextX = anchor.x;
                      active.nextY = anchor.y;
                      setDragPreview({
                        ids: active.ids,
                        dx: active.nextX - active.x,
                        dy: active.nextY - active.y,
                      });
                    }}
                    onPointerUp={(event) => {
                      const active = drag.current;
                      if (!active || active.id !== item.id) return;
                      drag.current = null;
                      setDragPreview(null);
                      if (
                        event.currentTarget.hasPointerCapture(event.pointerId)
                      )
                        event.currentTarget.releasePointerCapture(
                          event.pointerId,
                        );
                      if (writable) {
                        const next = transformDraftSelection(
                          document,
                          active.ids,
                          {
                            type: "move",
                            dx: active.nextX - active.x,
                            dy: active.nextY - active.y,
                          },
                        );
                        if (next) record(next);
                      }
                    }}
                    onPointerCancel={() => {
                      drag.current = null;
                      setDragPreview(null);
                    }}
                    onClick={(event) => {
                      if (tool === "select") {
                        event.stopPropagation();
                        if (event.shiftKey) toggleSelection(item.id);
                        else if (!selectedIds.includes(item.id))
                          setSelected(item.id);
                        setInspectorOpen(true);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        if (event.shiftKey) toggleSelection(item.id);
                        else setSelected(item.id);
                      }
                    }}
                  >
                    <WorkflowDraftShape
                      shape={item}
                      selected={selectedIds.includes(item.id)}
                    />
                  </g>
                ))}
              {tool === "polyline" && (
                <g pointerEvents="none">
                  <polyline
                    points={pathPoints.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke="#6554d7"
                    strokeWidth="2"
                    strokeDasharray="5 3"
                  />
                  {pathPoints.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r="4" fill="#6554d7" />
                  ))}
                </g>
              )}
              {measurement.overlay}
            </svg>
          </WorkflowPdfBackground>
          {!document.shapes.length && (
            <p>
              아직 그린 객체가 없습니다. 도구를 고르고 캔버스를 클릭하거나,
              캔버스에 초점을 두고 Enter로 중앙에 배치하세요.
            </p>
          )}
        </div>
        <aside className="flow-blank-inspector">
          <nav className="flow-inspector-shortcuts" aria-label="작업실 검사기 바로가기">
            {['레이어','속성','수량','검토'].map(section=><button key={section} aria-label={`${section}${section==='속성'||section==='수량'?'으로':'로'} 이동`} onClick={()=>navigateInspector(section)}>{section}</button>)}
          </nav>
          <div className="flow-inspector-scroll" ref={inspectorScroll}>
          {!readOnlySnapshot && <WorkflowDocumentFindings document={document} onLocate={finding=>{
            if(finding.kind==='source') {sourceRegion.current?.querySelector<HTMLInputElement>('input[type=file]')?.focus();return;}
            if(finding.kind==='quantity-review') {onQuantities();return;}
            const target=document.shapes.find(shape=>shape.id===finding.objectId);
            if(!target)return;
            setSelected(target.id);setTool('select');
            if(!draftLayer(document,target)?.visible)setShowHidden(true);
            onChange({...document,page:target.page??1});
            navigateInspector('수량');
          }}/>} 
          {!readOnlySnapshot&&<WorkflowMultiSelection
            document={document}
            ids={selectedIds}
            writable={writable}
            onToggle={toggleSelection}
            onSelect={(ids) => {
              setSelectedIds(ids);
              setTool("select");
            }}
            onAction={applySelection}
          />}
          <label className="flow-input">
            겹친 객체 선택
            <select
              aria-label="선택할 객체"
              value={selected ?? ""}
              onChange={(event) => {
                const item = document.shapes.find(
                  (item) => item.id === event.target.value,
                );
                setSelected(item?.id ?? null);
                setTool("select");
                if (item) {
                  setInspectorOpen(true);
                  if (!draftLayer(document, item)?.visible) setShowHidden(true);
                }
              }}
            >
              <option value="">객체를 선택하세요</option>
              {document.shapes
                .filter((item) => (item.page ?? 1) === page)
                .map((item, index) => (
                  <option key={item.id} value={item.id}>
                    {index + 1} · {item.label || "이름 없는 객체"}
                  </option>
                ))}
            </select>
          </label>
          {!readOnlySnapshot&&<WorkflowLocalShare document={document} role={role} onChange={onChange}/>}
          {!readOnlySnapshot&&shape&&selectedIds.length===1&&<WorkflowObjectComments key={shape.id} document={document} objectId={shape.id} role={role} onChange={onChange}/>}
          {!readOnlySnapshot&&shape&&selectedIds.length===1&&<WorkflowRfiComposer key={shape.id} document={document} objectId={shape.id} role={role} onChange={onChange}/>}
          {readOnlySnapshot&&<section className="flow-card" aria-label="승인 도면 근거 요약">
            <h3>승인 도면 · R{document.revision??1}</h3>
            <p>읽기 전용입니다. 선택 객체와 승인 당시 근거를 확인하세요.</p>
            <p>{document.source?.name} · {page}쪽</p>
            <strong>{shape?.label??'객체를 선택하세요'}</strong>
            {shape&&<p>레이어: {draftLayer(document,shape)?.name??'기본'} · 위치 ({shape.x}, {shape.y})</p>}
            {shape?.quantity&&<p>도면에 연결된 수량: {shape.quantity.raw+shape.quantity.correction} {shape.quantity.unit} · 단가 {shape.quantity.rate.toLocaleString()}원<br/>수량·금액 승인 여부는 별도 검산 기록에서 확인합니다.</p>}
            <p>승인 의견: {document.reviewRounds?.find(round=>round.phase==='approved'&&round.revision===(document.revision??1))?.approvalNote??'기록 없음'}</p>
          </section>}
          <details open={!readOnlySnapshot||snapshotDetailsOpen} onToggle={event=>{if(event.target===event.currentTarget&&readOnlySnapshot)setSnapshotDetailsOpen(event.currentTarget.open);}}>
          <summary hidden={!readOnlySnapshot}>레이어·속성·검토 상세 보기</summary>
          <h3 tabIndex={-1} ref={node=>{inspectorSections.current['레이어']=node;}}>레이어</h3>
          <WorkflowDocumentLayers
            document={document}
            writable={writable}
            active={effectiveActive}
            onActive={setActiveLayer}
            selected={selectedIds.length === 1 ? shape : undefined}
            showHidden={showHidden}
            onShowHidden={setShowHidden}
            onLayers={(layers) => {
              if (writable && validDraftLayers(document, layers)) {
                setTool("select");
                history.current = editObjectHistory(history.current, {
                  type: "record",
                  update: () => [{ ...currentEdit, layers }],
                });
                publishEdit(history.current.present[0]);
              }
            }}
            onAssign={(layerId) =>
              record(
                document.shapes.map((item) =>
                  item.id === selected ? { ...item, layerId } : item,
                ),
              )
            }
          />
          <details
            className="flow-inspector-disclosure"
            open={inspectorOpen}
            onToggle={(event) => setInspectorOpen(event.currentTarget.open)}
          >
            <summary>속성 · 검토</summary>
            <h3 tabIndex={-1} ref={node=>{inspectorSections.current['속성']=node;}}>속성</h3>
            {shape ? (
              <fieldset
                disabled={
                  !writable ||
                  selectedIds.length > 1 ||
                  !editableDraftLayer(document, shape)
                }
              >
                <label className="flow-input">
                  객체 이름
                  <input
                    aria-label="구상 객체 이름"
                    maxLength={120}
                    value={shape.label}
                    disabled={!writable}
                    onFocus={() => {
                      editGroup.current += 1;
                    }}
                    onChange={(event) => updateLabel(event.target.value)}
                  />
                </label>
                <p>
                  화면용{" "}
                  {
                    (
                      {
                        line: "선",
                        polyline: "폴리라인",
                        circle: "원",
                        text: "텍스트",
                        rectangle: "사각형",
                      } as const
                    )[shape.kind ?? "rectangle"]
                  }{" "}
                  · 실측 객체 아님
                </p>
                {shape.kind === "polyline" && (
                  <>
                    <label>
                      <input
                        aria-label="폴리라인 닫기"
                        type="checkbox"
                        checked={shape.closed ?? false}
                        disabled={(shape.points?.length ?? 0) < 3}
                        onChange={(event) =>
                          record(
                            document.shapes.map((item) =>
                              item.id === selected
                                ? { ...item, closed: event.target.checked }
                                : item,
                            ),
                          )
                        }
                      />
                      닫힌 도형으로 표시
                    </label>
                    <details>
                      <summary>꼭짓점 편집</summary>
                      <p>
                        객체 내부 상대 좌표입니다. 점 수정 후 연결 수량 근거를
                        다시 확인하세요.
                      </p>
                      {shape.points?.map((point, index) => (
                        <div className="flow-actions" key={index}>
                          {(["x", "y"] as const).map((axis) => {
                            const size =
                              axis === "x"
                                ? (shape.width ?? 120)
                                : (shape.height ?? 80);
                            return (
                              <label className="flow-input" key={axis}>
                                점 {index + 1} {axis.toUpperCase()}
                                <input
                                  aria-label={`점 ${index + 1} ${axis.toUpperCase()}`}
                                  type="number"
                                  step="any"
                                  min="0"
                                  max={size}
                                  value={Number(
                                    (point[axis] * size).toFixed(3),
                                  )}
                                  onFocus={() => {
                                    editGroup.current += 1;
                                  }}
                                  onChange={(event) => {
                                    const next =
                                      event.currentTarget.valueAsNumber;
                                    if (
                                      !Number.isFinite(next) ||
                                      next < 0 ||
                                      next > size
                                    )
                                      return;
                                    record(
                                      document.shapes.map((item) =>
                                        item.id === selected
                                          ? {
                                              ...item,
                                              points: item.points?.map(
                                                (p, i) =>
                                                  i === index
                                                    ? {
                                                        ...p,
                                                        [axis]: next / size,
                                                      }
                                                    : p,
                                              ),
                                            }
                                          : item,
                                      ),
                                      `vertex:${selected}:${index}:${axis}:${editGroup.current}`,
                                    );
                                  }}
                                />
                              </label>
                            );
                          })}
                        </div>
                      ))}
                    </details>
                  </>
                )}
                <label className="flow-input">
                  선·글자 색
                  <input
                    aria-label="구상 선 색"
                    type="color"
                    value={shape.stroke ?? "#aaa0d0"}
                    disabled={!writable}
                    onChange={(event) =>
                      record(
                        document.shapes.map((item) =>
                          item.id === selected
                            ? { ...item, stroke: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
                {shape.kind !== "text" && (
                  <label className="flow-input">
                    선 굵기
                    <input
                      aria-label="구상 선 굵기"
                      type="number"
                      min="0.5"
                      max="12"
                      step="0.5"
                      value={shape.lineWidth ?? 2}
                      disabled={!writable}
                      onFocus={() => {
                        editGroup.current += 1;
                      }}
                      onChange={(event) => {
                        const value = event.currentTarget.valueAsNumber;
                        if (
                          !Number.isFinite(value) ||
                          value < 0.5 ||
                          value > 12
                        )
                          return;
                        record(
                          document.shapes.map((item) =>
                            item.id === selected
                              ? { ...item, lineWidth: value }
                              : item,
                          ),
                          `width:${selected}:${editGroup.current}`,
                        );
                      }}
                    />
                  </label>
                )}
                {(!shape.kind ||
                  shape.kind === "rectangle" ||
                  (shape.kind === "polyline" && shape.closed) ||
                  shape.kind === "circle") && (
                  <>
                    <label>
                      <input
                        aria-label="구상 채움 없음"
                        type="checkbox"
                        disabled={!writable}
                        checked={shape.fill === "none"}
                        onChange={(event) =>
                          record(
                            document.shapes.map((item) =>
                              item.id === selected
                                ? {
                                    ...item,
                                    fill: event.target.checked
                                      ? "none"
                                      : "#ede9fe",
                                  }
                                : item,
                            ),
                          )
                        }
                      />{" "}
                      채움 없음
                    </label>
                    <label className="flow-input">
                      채움 색
                      <input
                        aria-label="구상 채움 색"
                        type="color"
                        disabled={!writable || shape.fill === "none"}
                        value={
                          shape.fill && shape.fill !== "none"
                            ? shape.fill
                            : "#ede9fe"
                        }
                        onChange={(event) =>
                          record(
                            document.shapes.map((item) =>
                              item.id === selected
                                ? { ...item, fill: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                  </>
                )}
                <p>
                  위치·크기는 페이지 상대 좌표입니다. 실제 길이 단위가 아닙니다.
                  회전은 중심 기준이며 페이지 밖 부분은 잘려 보일 수 있습니다.
                </p>
                {(shape.kind === "circle"
                  ? (["diameter", "rotation"] as const)
                  : (["width", "height", "rotation"] as const)
                ).map((field) => {
                  const label = {
                    width: "너비",
                    height: "높이",
                    diameter: "지름",
                    rotation: "회전",
                  }[field];
                  const value =
                    field === "diameter"
                      ? Math.min(shape.width ?? 120, shape.height ?? 80)
                      : field === "width"
                        ? (shape.width ?? 120)
                        : field === "height"
                          ? (shape.height ?? 80)
                          : (shape.rotation ?? 0);
                  const min = field === "rotation" ? -180 : 10,
                    max =
                      field === "rotation"
                        ? 180
                        : field === "width"
                          ? 600
                          : 400;
                  return (
                    <label className="flow-input" key={field}>
                      {label}
                      {field === "rotation" ? " (°)" : ""}
                      <input
                        aria-label={`구상 ${label}`}
                        type="number"
                        min={min}
                        max={max}
                        value={value}
                        disabled={!writable}
                        onFocus={() => {
                          editGroup.current += 1;
                        }}
                        onChange={(event) => {
                          const next = event.currentTarget.valueAsNumber;
                          if (
                            !Number.isFinite(next) ||
                            next < min ||
                            next > max
                          )
                            return;
                          record(
                            document.shapes.map((item) => {
                              if (item.id !== selected) return item;
                              const updated =
                                field === "diameter"
                                  ? { ...item, width: next, height: next }
                                  : { ...item, [field]: next };
                              return {
                                ...updated,
                                x: Math.min(
                                  updated.x,
                                  draftPositionLimit(updated, "x"),
                                ),
                                y: Math.min(
                                  updated.y,
                                  draftPositionLimit(updated, "y"),
                                ),
                              };
                            }),
                            `frame:${selected}:${field}:${editGroup.current}`,
                          );
                        }}
                      />
                    </label>
                  );
                })}
                {(["x", "y"] as const).map((axis) => (
                  <label className="flow-input" key={axis}>
                    {axis.toUpperCase()} 위치
                    <input
                      aria-label={`구상 ${axis.toUpperCase()} 위치`}
                      type="number"
                      min="0"
                      max={draftPositionLimit(shape, axis)}
                      value={shape[axis]}
                      disabled={!writable}
                      onFocus={() => {
                        editGroup.current += 1;
                      }}
                      onChange={(event) => {
                        const value = event.currentTarget.valueAsNumber;
                        if (
                          !Number.isFinite(value) ||
                          value < 0 ||
                          value > draftPositionLimit(shape, axis)
                        )
                          return;
                        record(
                          document.shapes.map((item) =>
                            item.id === selected
                              ? { ...item, [axis]: value }
                              : item,
                          ),
                          `position:${selected}:${editGroup.current}`,
                        );
                      }}
                    />
                  </label>
                ))}
                <button
                  disabled={!writable || document.shapes.length >= 500}
                  onClick={() => {
                    const id = crypto.randomUUID();
                    record([
                      ...document.shapes,
                      {
                        ...shape,
                        id,
                        x: Math.min(
                          draftPositionLimit(shape, "x"),
                          shape.x + 20,
                        ),
                        y: Math.min(
                          draftPositionLimit(shape, "y"),
                          shape.y + 20,
                        ),
                        label: `${shape.label} 복사`.slice(0, 120),
                      },
                    ]);
                    setSelected(id);
                  }}
                >
                  선택 구상 복사
                </button>
                <button
                  disabled={!writable}
                  onClick={() => {
                    if (!writable) return;
                    record(
                      document.shapes.filter((item) => item.id !== selected),
                    );
                    setSelected(null);
                  }}
                >
                  선택 구상 삭제
                </button>
              </fieldset>
            ) : (
              <p>객체를 선택하면 이름을 바꿀 수 있습니다.</p>
            )}
            <p className="flow-note">
              이 객체는 PDF 위의 구상 표시입니다. 아래 검토는 화면 체험이며,
              실측 수량·금액 확정이나 실제 CAD 내보내기가 아닙니다.
            </p>
            <h3 tabIndex={-1} ref={node=>{inspectorSections.current['수량']=node;}}>수량</h3>
            {(!shape || selectedIds.length !== 1) && <p>객체 하나를 선택하면 해당 객체의 수량 근거를 확인할 수 있습니다.</p>}
            {shape && selectedIds.length === 1 && (
              <WorkflowQuantityEditor
                key={`${shape.id}:${JSON.stringify(shape.quantity)}`}
                document={document}
                shape={shape}
                writable={writable && editableDraftLayer(document, shape)}
                onOpen={onQuantities}
                pricebook={pricebook}
                pricebookLabel={pricebookLabel}
                onSave={(input) => {
                  if (!writable) return;
                  const updated = setDocumentQuantity(
                    document,
                    shape.id,
                    input,
                  );
                  if (updated !== document) record(updated.shapes);
                }}
              />
            )}
            <h3 tabIndex={-1} ref={node=>{inspectorSections.current['검토']=node;}}>검토</h3>
            <WorkflowDocumentReview
              key={fieldReviewId??'review'}
              fieldReviewId={fieldReviewId}
              roleLocked={readOnlySnapshot}
              document={document}
              selectedId={selectedIds.length === 1 ? selected : null}
              role={role}
              sourceReady={Boolean(document.source && pdfReady)}
              onRole={(role) => {
                setRole(role);
                setTool("select");
              }}
              onChange={(updated) => {
                setTool("select");
                onChange(updated);
              }}
              onLocate={(id, page) => {
                setShowHidden(true);
                setSelected(id);
                setTool("select");
                onChange({ ...document, page });
              }}
            />
          </details>
          </details>
          </div>
        </aside>
      </div>
    </section>
  );
}
