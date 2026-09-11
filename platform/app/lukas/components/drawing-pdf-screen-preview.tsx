import { useEffect, useReducer, useRef, useState } from "react";
import {DrawingObjectReviewLinks} from "./drawing-object-review-links";
import {DrawingObjectCorrectionContext} from "./drawing-object-correction-context";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Command,
  ChevronLeft,
  ChevronRight,
  Circle,
  Download,
  FileText,
  FolderOpen,
  Hand,
  LockKeyhole,
  ListChecks,
  Maximize,
  MessageSquare,
  Minus,
  MousePointer2,
  PanelLeft,
  PanelRight,
  Plus,
  Ruler,
  Search,
  Share2,
  Slash,
  Square,
  Type,
  TableProperties,
  X,
} from "lucide-react";
import "./drawing-pdf-screen-preview.css";
import {
  localPdfSelectionError,
  localPdfFingerprint,
  isSameLocalPdf,
  peekLocalPdf,
  releaseLocalPdf,
} from "~/lukas/lib/drawing-pdf-screen-handoff";
import { DrawingScreenWorkflow } from "./drawing-screen-workflow";
import { createReviewLoop, DrawingReviewLoop, DrawingReviewMarker, DrawingReviewIssueSummary, reviewLoopLabels, reviewLoopReducer, parseReviewLoopSession, reviewRevisionFor } from "./drawing-review-loop";
import {screenBlocks,type ScreenBlockCode} from "./drawing-screen-blocks";
import { parseChangeRounds } from "./project-change-preview";
import { ExternalRequestPanel } from "./project-sharing-preview";
import "./drawing-review-loop.css";
import { DrawingTakeoffPreview } from "./drawing-takeoff-preview";
import { DrawingScreenObjectPreview, initialScreenShapeStyle, moveScreenSelection, type ScreenShape, type ScreenShapeStyle } from "./drawing-screen-object-preview";
import type {ChangeRequestPreview} from "./drawing-change-request-preview";
import type {DrawingRequestSnapshot} from "./drawing-request-snapshot";
import { DrawingWorkbenchPreview } from "./drawing-workbench-preview";
import { IfcViewportPreview } from "./drawing-source-preview";
import { DrawingRegistrationNotice, type RegistrationRecord } from "./drawing-native-start-preview";
import { createPreviewLayers, revealPreviewLayer, DrawingLayerPreview } from "./drawing-document-preview";
import {drawingChangeItems, nextDrawingChange, DrawingChangePanel, DrawingChangePins, DrawingChangeLegend} from "./drawing-change-preview";
import {parseScreenDraft} from "../lib/drawing-screen-draft-storage";
import {screenObjectHistory,canRestoreScreenObjects,type ScreenObjectHistory} from "../lib/drawing-screen-object-history";
export { localPdfSelectionError } from "~/lukas/lib/drawing-pdf-screen-handoff";

type Renderer = typeof import("./drawing-pdf-screen-renderer.client");
type Panel = "pages" | "layers";

/** Local screen prototype: no upload, drawing mutation, or persistence. */
function ScreenCoordinateInput({label,value,min=0,max,disabled,onChange}:{label:string;value:number;min?:number;max:number;disabled:boolean;onChange:(value:number)=>void}){
  const [draft,setDraft]=useState<string|null>(null);
  useEffect(()=>{if(disabled)setDraft(null);},[disabled]);
  return <input aria-label={label} type="number" min={min} max={max} step="1" value={draft??value} disabled={disabled}
    onChange={event=>{setDraft(event.currentTarget.value);const next=event.currentTarget.valueAsNumber;if(Number.isFinite(next)&&next>=min&&next<=max)onChange(next);}}
    onBlur={()=>setDraft(null)}/>;
}

export function DrawingPdfScreenPreview({
  returnHref = "/workspace-preview",
  handoffToken,
  startKind = "pdf",
  title = "",
  reviewPreview = false,
  initialWorkflowPanel,
  initialReviewState,
  takeoffPreview = false,
  viewer: viewerInput = false,
  paper = "A3",
  initialViewMode = "2d",
  documentId,
  registrationRecord,
  changeRoundId,
  initialRequestRound,
}: {
  returnHref?: string;
  handoffToken?: string | null;
  startKind?: "pdf" | "blank" | "office" | "house";
  title?: string;
  reviewPreview?: boolean;
  initialWorkflowPanel?: "review" | "export" | "share";
  initialReviewState?: "requested" | "changes" | "approved";
  takeoffPreview?: boolean;
  viewer?: boolean;
  paper?: "A3" | "A4" | "A2";
  initialViewMode?: "2d" | "3d" | "split";
  documentId?: string;
  registrationRecord?: RegistrationRecord | null;
  changeRoundId?: string;
  initialRequestRound?: number;
} = {}) {
  const viewer = viewerInput || changeRoundId !== undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  const selectionAttempt = useRef(0);
  const [sourceNotice,setSourceNotice] = useState("");
  useEffect(() => () => { selectionAttempt.current += 1; }, []);
  const twoDModeRef = useRef<HTMLButtonElement>(null);
  const leftRef = useRef<HTMLElement>(null);
  const rightRef = useRef<HTMLElement>(null);
  const changePanelOpener = useRef<HTMLElement|null>(null);
  const [file, setFile] = useState<File | null>(() =>
    peekLocalPdf(handoffToken),
  );
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [renderer, setRenderer] = useState<Renderer | null>(null);
  const [status, setStatus] = useState<"empty" | "loading" | "ready" | "error">(
    "empty",
  );
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<Panel>("pages");
  const [mobilePanel, setMobilePanel] = useState<"pages" | "info" | null>(null);
  const [compact, setCompact] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(true);
  const [pan, setPan] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [fitKey, setFitKey] = useState(0);
  const pdfPosition=useRef({left:0,top:0});
  const restoreSequence=useRef(0);
  const [restorePosition,setRestorePosition]=useState<{key:number;left:number;top:number}|null>(null);
  const [explorationOrigin,setExplorationOrigin]=useState<{page:number;zoom:number;view:"2d"|"3d"|"split";left:number;top:number;change:string|null;shape:string|null}|null>(null);
  const [workspaceMode,setWorkspaceMode]=useState<"author"|"review">(initialRequestRound!==undefined||viewer||reviewPreview||initialReviewState||initialWorkflowPanel==="review"?"review":"author");
  const [selectedChangeId,setSelectedChangeId]=useState<string|null>(null);
  const [compareChanges,setCompareChanges]=useState(false);
  const [mutedSource,setMutedSource]=useState(true);
  const [changeRequestOpen,setChangeRequestOpen]=useState(initialRequestRound!==undefined);
  const [requestSelection,setRequestSelection]=useState<{ids:string[];nonce:number}>();
  const [infoTab, setInfoTab] = useState<"changes" | "info" | "comments" | "tool" | "review">(initialRequestRound!==undefined?"changes":reviewPreview||initialReviewState||initialWorkflowPanel==="review"?"review":"changes");
  const [activeTool, setActiveTool] = useState("");
  const [pathControlsHost,setPathControlsHost]=useState<HTMLDivElement|null>(null);
  const [pendingBlock,setPendingBlock]=useState<ScreenBlockCode|null>(null);
  const [shapeHistory,shapeHistoryDispatch]=useReducer(screenObjectHistory,{past:[],present:[],future:[]} as ScreenObjectHistory);
  const localShapes=shapeHistory.present;
  const setScreenShapes=(update:(objects:ScreenShape[])=>ScreenShape[],group?:string)=>shapeHistoryDispatch({type:"record",update,group});
  const shapeEditSequence=useRef(0);
  const shapeEditGroup=useRef<{id:string;group:string}|null>(null);
  const [approvedRequest,setApprovedRequest]=useState<ChangeRequestPreview>();
  const [requestRecords,setRequestRecords]=useState<ChangeRequestPreview[]|null>(null);
  const [requestToOpen,setRequestToOpen]=useState<{round:number;nonce:number}>();
  const [deletedShape,setDeletedShape]=useState<{object:ScreenShape;index:number}|null>(null);
  const [shapesRestored,setShapesRestored]=useState(!documentId||changeRoundId!==undefined);
  const [shapeReadError,setShapeReadError]=useState(false);
  const [shapeSaveError,setShapeSaveError]=useState(false);
  const [selectedShapeIds,setSelectedShapeIds]=useState<string[]>([]);
  const [multiSelecting,setMultiSelecting]=useState(false);
  useEffect(()=>{if(activeTool||pan||workspaceMode!=="author")setMultiSelecting(false);},[activeTool,pan,workspaceMode]);
  useEffect(()=>{setMultiSelecting(false);},[page]);
  const selectedShapeId=selectedShapeIds.at(-1)??null;
  const setSelectedShapeId=(id:string|null)=>setSelectedShapeIds(id?[id]:[]);
  const [toolStyles,setToolStyles] = useState<Record<string,ScreenShapeStyle>>({});
  const selectedInitialReviewState =
    initialReviewState ?? (reviewPreview ? "requested" : "draft");
  const [workflowOpen, setWorkflowOpen] = useState<
    "review" | "export" | "share" | null
  >(!takeoffPreview && initialWorkflowPanel !== "review" ? initialWorkflowPanel ?? null : null);
  const [reviewLoop, reviewDispatch] = useReducer(reviewLoopReducer, selectedInitialReviewState, createReviewLoop);
  const reviewState = reviewLoop.phase === "changed" || reviewLoop.phase === "revised" ? "draft" : reviewLoop.phase;
  const [layers, setLayers] = useState(createPreviewLayers);
  const screenShapes=reviewLoop.target?[...localShapes.filter(shape=>shape.id!==reviewLoop.target!.id),reviewLoop.target]:localShapes;
  const editableRevision=["draft","changed","revised"].includes(reviewLoop.phase);
  // Start a new geometry history at revision/approval boundaries, not every draft edit.
  useEffect(()=>{shapeHistoryDispatch({type:"reset",objects:screenShapes});setDeletedShape(null);},[editableRevision,reviewLoop.revision,reviewLoop.target?.id,shapesRestored]);
  const selectedShape=screenShapes.find(shape=>shape.id===selectedShapeId&&shape.page===page);
  const selectedShapes=screenShapes.filter(shape=>selectedShapeIds.includes(shape.id)&&shape.page===page&&(layers.find(layer=>layer.id===shape.layer)?.visible??false));
  const batchLocked=selectedShapes.some(shape=>!layers.some(layer=>layer.id===shape.layer&&!layer.locked));
  const commonStyle=(key:"layer"|"color"|"lineWidth"|"fill")=>selectedShapes.every(shape=>shape[key]===selectedShapes[0]?.[key])?selectedShapes[0]?.[key]??"":"";
  const commonRotation=selectedShapes.every(shape=>(shape.rotation??0)===(selectedShapes[0]?.rotation??0))?selectedShapes[0]?.rotation??0:"";
  const changeCommonStyle=(patch:Partial<Pick<ScreenShape,"layer"|"color"|"lineWidth"|"fill"|"rotation">>)=>{
    if(shapeReadOnly||materialFailed||batchLocked||selectedShapes.length<2)return;
    if(patch.rotation!==undefined&&(!Number.isFinite(patch.rotation)||patch.rotation<0||patch.rotation>359))return;
    if(patch.layer&&!layers.some(layer=>layer.id===patch.layer&&!layer.locked))return;
    const ids=new Set(selectedShapes.map(shape=>shape.id));
    setScreenShapes(shapes=>shapes.map(shape=>ids.has(shape.id)?{...shape,...patch}:shape));
    if(reviewLoop.target&&ids.has(reviewLoop.target.id))reviewDispatch({type:"edit-target",object:{...reviewLoop.target,...patch}});
  };
  const inspectorTool=selectedShape?.kind??activeTool;
  const shapeStyle=selectedShape??toolStyles[activeTool]??initialScreenShapeStyle;
  const changeShapeStyle=(patch:Partial<ScreenShape>)=>{
    if(shapeReadOnly)return;
    const group=shapeEditGroup.current?.id===selectedShape?.id?shapeEditGroup.current?.group:undefined;
    if(selectedShape?.id===reviewLoop.target?.id&&selectedShape){
      const object={...selectedShape,...patch};
      setScreenShapes(shapes=>shapes.map(shape=>shape.id===object.id?object:shape),group);
      reviewDispatch({type:"edit-target",object});
    }
    else if(selectedShape)setScreenShapes(shapes=>shapes.map(shape=>shape.id===selectedShape.id?{...shape,...patch}:shape),group);
    else setToolStyles(styles=>({...styles,[activeTool]:{...(styles[activeTool]??initialScreenShapeStyle),...patch}}));
  };
  const shapeReadOnly=!shapesRestored||shapeReadError||workspaceMode==="review"||viewer||reviewLoop.role!=="author"||!["draft","changed","revised"].includes(reviewLoop.phase)||Boolean(layers.find(layer=>layer.id===(shapeStyle.layer||layers[0]?.id))?.locked);
  const [comment, setComment] = useState("");
  const [comments, setComments] = useState<
    Array<{ text: string; page: number }>
  >([]);
  const [sourceVersion, setSourceVersion] = useState(0);
  const [previousTakeoffSource,setPreviousTakeoffSource]=useState<{draftKey:string;documentName:string}|undefined>();
  const shapeStorageKey=documentId&&sourceVersion===0&&changeRoundId===undefined?`1hk:preview:screen-draft:${documentId}`:null;
  const shapeSource=`${startKind}:${paper}`;
  const restoreShapes=()=>{
    if(!shapeStorageKey){setShapesRestored(true);setShapeReadError(false);setShapeSaveError(false);return;}
    try{
      const raw=sessionStorage.getItem(shapeStorageKey);
      if(raw!==null){const draft=parseScreenDraft(raw,shapeSource);shapeHistoryDispatch({type:"reset",objects:draft.objects});setLayers(draft.layers);}
      setShapesRestored(true);setShapeReadError(false);
    }catch{setShapeReadError(true);setShapesRestored(false);}
  };
  const saveShapes=()=>{
    if(!shapeStorageKey||!shapesRestored||shapeReadError||viewer)return;
    try{sessionStorage.setItem(shapeStorageKey,JSON.stringify({schemaVersion:1,source:shapeSource,objects:localShapes,layers}));setShapeSaveError(false);}
    catch{setShapeSaveError(true);}
  };
  useEffect(restoreShapes,[shapeStorageKey,shapeSource]);
  useEffect(saveShapes,[shapeStorageKey,shapeSource,shapesRestored,shapeReadError,viewer,localShapes,layers]);
  useEffect(()=>{setExplorationOrigin(null);setRestorePosition(null);pdfPosition.current={left:0,top:0};},[sourceVersion]);
  const [reviewRestored, setReviewRestored] = useState(false);
  const [reviewStorageError, setReviewStorageError] = useState(false);
  const [changeTargetLabel, setChangeTargetLabel] = useState("");
  const [changeTargetError, setChangeTargetError] = useState(false);
  useEffect(() => {
    if (documentId) {
      try {
        const raw = sessionStorage.getItem(`1hk:preview:review:${documentId}`);
        if (raw) {
          const saved = parseReviewLoopSession(raw);
          if (saved && changeRoundId !== undefined) {
            const projectId = new URL(returnHref, "http://preview.local").searchParams.get("project") ?? "";
            const rounds = parseChangeRounds(sessionStorage.getItem(`1hk:preview:changes:${projectId}`) ?? "[]", projectId);
            const round = rounds?.find(item => item.id === changeRoundId);
            const ref = round?.revisions.find(item => item.documentId === documentId);
            const target = ref ? reviewRevisionFor(saved, ref.revision, ref.page) : null;
            if (!target || !round) setChangeTargetError(true);
            else {
              reviewDispatch({type:"restore",state:target});
              setPage(target.page);
              setChangeTargetLabel(`제${round.number}차 변경 · ${round.title} · R${target.revision} · ${target.page}쪽 · 검토 기록 읽기 전용`);
            }
          } else if (saved) {
            reviewDispatch({type:"restore",state:saved}); setPage(saved.page);
            if(initialRequestRound===undefined&&!initialWorkflowPanel&&!takeoffPreview&&["requested","changes","reviewed","approved"].includes(saved.phase)){
              setWorkspaceMode("review");
              setInfoTab("review");
            }
          }
          else setReviewStorageError(true);
        } else if (changeRoundId !== undefined) setChangeTargetError(true);
      } catch { setReviewStorageError(true); if (changeRoundId !== undefined) setChangeTargetError(true); }
    } else if (changeRoundId !== undefined) {
      setChangeTargetError(true);
    }
    setReviewRestored(true);
  }, [documentId, changeRoundId, returnHref]);
  useEffect(() => {
    if (!documentId || !reviewRestored || sourceVersion !== 0 || viewer || reviewStorageError) return;
    try { sessionStorage.setItem(`1hk:preview:review:${documentId}`, JSON.stringify(reviewLoop)); }
    catch { setReviewStorageError(true); }
  }, [documentId, reviewRestored, reviewLoop, sourceVersion, viewer, reviewStorageError]);
  const [takeoffOpen, setTakeoffOpen] = useState(takeoffPreview);
  const [takeoffTarget,setTakeoffTarget]=useState<{object:ScreenShape;sourceVersion:number}|null>(null);
  const [takeoffReviewOrigin,setTakeoffReviewOrigin]=useState<{object:ScreenShape;sourceVersion:number;mode:"author"|"review"}|null>(null);
  const [materialFailed, setMaterialFailed] = useState(false);
  const historyAvailable=(direction:"undo"|"redo")=>{
    const next=direction==="undo"?shapeHistory.past.at(-1):shapeHistory.future[0];
    return !shapeReadOnly&&!materialFailed&&!!next&&canRestoreScreenObjects(localShapes,next,layers,reviewLoop.target?.id);
  };
  const restoreShapeHistory=(direction:"undo"|"redo")=>{
    if(!historyAvailable(direction))return;
    const next=direction==="undo"?shapeHistory.past.at(-1)!:shapeHistory.future[0];
    const restored=next.filter(shape=>JSON.stringify(localShapes.find(current=>current.id===shape.id))!==JSON.stringify(shape));
    const changed=restored[0];
    const target=next.find(shape=>shape.id===reviewLoop.target?.id);
    if(target&&JSON.stringify(target)!==JSON.stringify(reviewLoop.target))reviewDispatch({type:"edit-target",object:target});
    shapeHistoryDispatch({type:direction});setDeletedShape(null);setActiveTool("");setSelectedChangeId(null);
    setSelectedShapeIds(restored.map(shape=>shape.id));
    if(changed){setPage(changed.page);setInfoTab("tool");setRightOpen(true);}
  };
  const [exitPrevented,setExitPrevented]=useState(false);
  const [requestSaveFailed,setRequestSaveFailed]=useState(false);
  const drawingSaveFailed=shapeSaveError||requestSaveFailed;
  const drawingSaveFailedRef=useRef(drawingSaveFailed);
  drawingSaveFailedRef.current=drawingSaveFailed;
  useEffect(()=>{
    if(!drawingSaveFailed){setExitPrevented(false);return;}
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",warn);
    return()=>window.removeEventListener("beforeunload",warn);
  },[drawingSaveFailed]);
  const [sourceIdentity, setSourceIdentity] = useState<{file:File;fingerprint:string} | null>(null);
  const sourceFingerprint = sourceIdentity?.file === file ? sourceIdentity.fingerprint : undefined;
  useEffect(() => {
    let active = true;
    if (file) void localPdfFingerprint(file).then(fingerprint => { if (active) setSourceIdentity({file,fingerprint}); }).catch(() => { if (active) setSourceNotice("원본 식별 정보를 계산하지 못해 자재 근거 지정을 사용할 수 없습니다."); });
    return () => { active = false; };
  }, [file]);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [workbenchSection, setWorkbenchSection] = useState<"blocks" | "sources" | "authoring" | "properties" | "documents">("blocks");
  const [viewMode, setViewMode] = useState<"2d" | "3d" | "split">(initialViewMode);
  const [anchorPage, setAnchorPage] = useState<number | null>(null);
  const [focusAnchor, setFocusAnchor] = useState(false);
  const [metrics, setMetrics] = useState<{
    widthPoints: number;
    heightPoints: number;
    rotation: number;
  } | null>(null);

  useEffect(() => {
    releaseLocalPdf(handoffToken);
  }, [handoffToken]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1000px)");
    const update = () => {
      setCompact(media.matches);
      setMobilePanel(null);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!compact || !mobilePanel) return;
    const previous = changePanelOpener.current ?? document.activeElement;
    changePanelOpener.current = null;
    const panelElement =
      mobilePanel === "pages" ? leftRef.current : rightRef.current;
    panelElement
      ?.querySelector<HTMLButtonElement>(".pdf-mobile-close")
      ?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [compact, mobilePanel]);

  useEffect(() => {
    if (!file) return;
    const controller = new AbortController();
    const url = URL.createObjectURL(file);
    let opened: { destroy: () => Promise<void> } | undefined;
    setPdf(null);
    setStatus("loading");
    setError(null);
    void Promise.all([
      import("~/lukas/lib/pdf-page-renderer.client"),
      import("./drawing-pdf-screen-renderer.client"),
    ])
      .then(async ([reader, nextRenderer]) => {
        if (controller.signal.aborted) return;
        const next = await reader.openPdfDocument(url, controller.signal);
        if (controller.signal.aborted) {
          await next.destroy();
          return;
        }
        opened = next;
        if (documentId && sourceVersion === 0 && handoffToken && !viewer) {
          try {
            const fingerprint = await localPdfFingerprint(file);
            if (controller.signal.aborted) return;
            const key = `1hk:preview:pdf-source:${documentId}`;
            const previous = sessionStorage.getItem(key);
            if (!previous) sessionStorage.setItem(key, fingerprint);
            else if (previous !== fingerprint) setSourceNotice("등록 원본의 식별 정보가 다릅니다. 원본을 다시 확인해 주세요.");
          } catch { setSourceNotice("원본 식별 정보를 보관하지 못했습니다. 다음에 열 때 동일 원본 자동 확인이 제한됩니다."); }
        }
        if (controller.signal.aborted) return;
        setRenderer(nextRenderer);
        setPdf(next.document);
        setStatus("ready");
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          reason instanceof Error && reason.name === "PasswordException"
            ? "암호가 필요한 PDF입니다. 암호 없이 열 수 있는 사본을 선택해 주세요."
            : "PDF를 표시하지 못했습니다. 파일을 다시 선택해 주세요.",
        );
        setStatus("error");
      });
    return () => {
      controller.abort();
      if (opened) void opened.destroy().catch(() => {});
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const chooseFile = async (next: File | undefined) => {
    if (!reviewRestored) return;
    if (materialFailed) { setTakeoffOpen(true); return; }
    if (changeRoundId !== undefined) { setError("이 화면은 보관된 검토 기록입니다. 원본 파일 복구는 현재 도면 작업실에서 진행해 주세요."); return; }
    if (!next) return;
    const attempt = ++selectionAttempt.current;
    const invalid = localPdfSelectionError(next);
    if (invalid) {
      setError(invalid);
      return;
    }
    try {
      const fingerprint = file ? await localPdfFingerprint(file) : documentId && sourceVersion === 0 ? sessionStorage.getItem(`1hk:preview:pdf-source:${documentId}`) : null;
      const same = await isSameLocalPdf(next, fingerprint);
      if (attempt !== selectionAttempt.current) return;
      if (same) {
        setFile(next);
        setError(null);
        setSourceNotice("동일한 PDF 원본을 확인했습니다. 현재 페이지와 검토 기록을 유지합니다.");
        return;
      }
      if(drawingSaveFailedRef.current){
        setSourceNotice("보관하지 못한 작업이 있어 원본 교체를 멈췄습니다. 보관을 다시 시도한 후 파일을 선택해 주세요.");
        setExitPrevented(true);
        return;
      }
      if ((file || documentId) && !window.confirm("동일한 PDF 원본인지 확인할 수 없습니다. 다른 원본으로 열면 현재 화면의 검토·댓글·레이어가 초기화됩니다. 기존 도면의 보관 기록은 덮어쓰지 않습니다. 다른 원본으로 여시겠습니까?")) return;
    } catch {
      if (attempt === selectionAttempt.current) setError("원본을 확인하지 못했습니다. 현재 도면과 검토 기록은 유지했습니다. 파일을 다시 선택해 주세요.");
      return;
    }
    if(documentId&&sourceVersion===0&&changeRoundId===undefined&&(!file||sourceFingerprint)){
      setPreviousTakeoffSource({draftKey:`1hk:preview:takeoff-rows:${documentId}:${sourceFingerprint??shapeSource}`,documentName:fileName||"이전 도면"});
    }
    setSourceNotice("");
    setFile(next);
    setSourceVersion((value) => value + 1);
    setWorkspaceMode(viewer?"review":"author");
    setSelectedChangeId(null);
    setCompareChanges(false);
    setChangeRequestOpen(false);
    shapeHistoryDispatch({type:"reset",objects:[]});setSelectedShapeId(null);setToolStyles({});
    setDeletedShape(null);
    setApprovedRequest(undefined);
    setAnchorPage(null);
    setTakeoffOpen(false);
    setWorkbenchOpen(false);
    setViewMode("2d");
    setWorkbenchSection("blocks");
    setFocusAnchor(false);
    setPage(1);
    setQuery("");
    setZoom(1);
    setFitKey((value) => value + 1);
    setMetrics(null);
    reviewDispatch({ type: "reset" });
    setComments([]);
    setComment("");
    setLayers(createPreviewLayers());
    setActiveTool("");
    setInfoTab("review");
  };
  const goToPage = (next: number) => {
    if (!pdf) return;
    setPage(Math.min(pdf.numPages, Math.max(1, next)));
    setZoom(1);
    setFitKey((value) => value + 1);
    setMetrics(null);
    setMobilePanel(null);
  };
  const fit = () => {
    setZoom(1);
    setFitKey((value) => value + 1);
  };
  const exampleKind = !file && startKind !== "pdf" ? startKind : null;
  const exampleImage =
    exampleKind === "office"
      ? "/images/workspace-start/office-plan.png"
      : exampleKind === "house"
        ? "/images/workspace-start/house-plan.png"
        : null;
  const ready = (status === "ready" || Boolean(exampleKind)) && (changeRoundId === undefined || Boolean(changeTargetLabel) && !changeTargetError && !reviewStorageError);
  const pageCount = pdf?.numPages ?? (exampleKind ? 1 : 0);
  const requestSnapshotSource:DrawingRequestSnapshot["source"]=file&&sourceFingerprint?{kind:"pdf",fileName:file.name,byteSize:file.size,fingerprint:sourceFingerprint}:exampleKind?{kind:exampleKind,paper}:undefined;
  const changeItems=ready?drawingChangeItems(screenShapes,exampleKind==="office"&&reviewLoop.phase==="draft"&&reviewLoop.position===0&&!reviewLoop.target):[];
  const switchWorkspaceMode=(mode:"author"|"review")=>{
    if(materialFailed){setTakeoffOpen(true);return;}
    if(mode==="author"&&viewer)return;
    setWorkspaceMode(mode);setActiveTool("");setInfoTab("changes");setRightOpen(true);
    setTakeoffOpen(false);setWorkflowOpen(null);setWorkbenchOpen(false);
    if(compact)setMobilePanel("info");
  };
  const selectChange=(id:string|null)=>{
    if(materialFailed){setTakeoffOpen(true);return;}
    if(compact&&mobilePanel!=="info"&&document.activeElement instanceof HTMLElement){
      changePanelOpener.current=document.activeElement;
    }
    const item=changeItems.find(value=>value.id===id);
    if(item&&!explorationOrigin&&(id!==selectedChangeId||item.page!==page||viewMode==="3d")){
      setExplorationOrigin({page,zoom,view:viewMode,...pdfPosition.current,change:selectedChangeId,shape:selectedShapeId});
    }
    setSelectedChangeId(id);setInfoTab("changes");setRightOpen(true);setTakeoffOpen(false);setChangeRequestOpen(false);
    if(item){
      setActiveTool("");
      // A direct location request must expose the drawing; keep split view intact.
      setViewMode(current=>current==="3d"?"2d":current);
      const shape=screenShapes.find(value=>value.id===item.id);
      if(shape)setLayers(current=>revealPreviewLayer(current,shape.layer));
    }
    if(item&&item.page!==page)goToPage(item.page);
    if(item&&!item.sample)setSelectedShapeId(item.id);
    if(compact)setMobilePanel("info");
  };
  const stepChange=(direction:-1|1)=>{
    const next=nextDrawingChange(changeItems,selectedChangeId,direction);
    if(next)selectChange(next);
  };
  const returnFromExploration=()=>{
    if(!explorationOrigin||materialFailed)return;
    const origin=explorationOrigin;
    setPage(origin.page);setZoom(origin.zoom);setViewMode(origin.view);
    setFitKey(value=>value+1);
    setRestorePosition({key:++restoreSequence.current,left:origin.left,top:origin.top});
    setSelectedChangeId(origin.change);setSelectedShapeId(origin.shape);
    setActiveTool("");setChangeRequestOpen(false);setInfoTab("changes");
    setExplorationOrigin(null);setMobilePanel(null);
  };
  const editSelectedChange=(id=selectedChangeId)=>{
    if(viewer||materialFailed)return;
    const shape=screenShapes.find(value=>value.id===id);
    if(shape)selectChange(shape.id);
    switchWorkspaceMode("author");
    if(shape)setInfoTab("tool");
  };
  const pageLabel = (value: number) =>
    `페이지 ${String(value).padStart(2, "0")}`;
  const pages = Array.from(
    { length: pdf?.numPages ?? 0 },
    (_, index) => index + 1,
  ).filter((value) => pageLabel(value).includes(query.trim()));
  const Surface = renderer?.PdfScreenSurface;
  const Thumbnail = renderer?.PdfScreenThumbnail;
  const fileName =
    file?.name.normalize("NFC") ??
    (exampleKind
      ? title || (exampleKind === "blank" ? "새 도면" : "템플릿 도면")
      : sourceVersion === 0 ? registrationRecord?.fileName.normalize("NFC") ?? (documentId ? title : undefined) : undefined);
  const sourceLabel =
    exampleKind === "blank"
      ? "빈 도면"
      : exampleKind
        ? "템플릿 이미지 · 예시"
        : "원본 PDF";
  const openReview = () => {
    if (materialFailed) { setTakeoffOpen(true); return; }
    setWorkflowOpen(null);
    setTakeoffOpen(false);
    setWorkbenchOpen(false);
    setMobilePanel(null);
    setRightOpen(true);
    setInfoTab("review");
    setWorkspaceMode("review");
    setViewMode("2d");
    requestAnimationFrame(()=>{rightRef.current?.scrollTo({top:0,behavior:"instant"});});
  };
  const requestSelectedObjects=(ids:string[])=>{
    if(viewer||drawingSaveFailed||materialFailed||!ids.length||ids.some(id=>!changeItems.some(item=>item.id===id)))return;
    setRequestSelection(current=>({ids:[...new Set(ids)],nonce:(current?.nonce??0)+1}));
    setWorkspaceMode("review");setInfoTab("changes");setRightOpen(true);setChangeRequestOpen(true);setActiveTool("");
    if(compact)setMobilePanel("info");
  };
  const locateReview = () => {
    openReview();
    if (reviewLoop.target || reviewLoop.phase !== "draft" || reviewLoop.position > 0) goToPage(reviewLoop.page);
    if(reviewLoop.target){setSelectedShapeId(reviewLoop.target.id);setLayers(current=>current.map(layer=>layer.id===reviewLoop.target?.layer?{...layer,visible:true}:layer));}
    fit();
    reviewDispatch({ type: "focus" });
    requestAnimationFrame(() => {
      if(reviewLoop.target)document.querySelector<SVGElement>(`[data-screen-shape="${CSS.escape(reviewLoop.target.id)}"]`)?.focus();
      else document.querySelector<HTMLButtonElement>("[data-review-pin]")?.focus();
    });
  };
  const handleReviewAction = (action:Parameters<typeof reviewLoopReducer>[1]) => {
    const next=reviewLoopReducer(reviewLoop,action);
    reviewDispatch(action);
    if(!viewer&&next!==reviewLoop&&(action.type==="resolve"||action.type==="new-revision")){
      setWorkspaceMode("author");
      setActiveTool("");
    }
  };
  const openFile = () => inputRef.current?.click();
  const openWorkbench = (section: "blocks" | "sources" | "authoring" | "properties" | "documents") => {
    if (materialFailed) { setTakeoffOpen(true); return; }
    setMobilePanel(null);
    setTakeoffOpen(false);
    setWorkflowOpen(null);
    setWorkbenchSection(section);
    setWorkbenchOpen(true);
  };
  const openTakeoff = () => {
    if(materialFailed){setTakeoffOpen(true);return;}
    setAnchorPage(null);
    const object=selectedShape??screenShapes.find(shape=>shape.id===selectedChangeId);
    setTakeoffTarget(object?{object:{...object},sourceVersion}:null);
    setMobilePanel(null);
    setWorkflowOpen(null);
    setTakeoffOpen(true);
  };
  const anchorOverlay = <>
    <DrawingScreenObjectPreview objects={screenShapes.filter(shape=>shape.page===page&&(layers.find(layer=>layer.id===shape.layer)?.visible??shape.id===reviewLoop.target?.id))} selected={selectedShapeId} selectedIds={selectedShapes.map(shape=>shape.id)} tool={shapeReadOnly?"":activeTool}
      onBoxSelect={multiSelecting&&!materialFailed&&!viewer?(ids,extend)=>setSelectedShapeIds(extend?[...new Set([...selectedShapes.map(shape=>shape.id),...ids])]:ids):undefined}
      onCancelTool={()=>setActiveTool("")}
      controlsHost={pathControlsHost}
      onChangePoints={!shapeReadOnly&&!materialFailed&&!activeTool&&!multiSelecting&&!batchLocked&&selectedShapes.length===1?(id,points)=>{if(id!==selectedShapeId)return;changeShapeStyle({points});}:undefined}
      onMove={!shapeReadOnly&&!materialFailed&&!activeTool&&!multiSelecting&&!batchLocked?(id,x,y)=>{
        const next=moveScreenSelection(screenShapes,selectedShapes.map(shape=>shape.id),id,x,y);
        if(next===screenShapes)return;
        setScreenShapes(()=>next);
        const target=next.find(shape=>shape.id===reviewLoop.target?.id);
        if(target&&target!==reviewLoop.target)reviewDispatch({type:"edit-target",object:target});
      }:undefined}
      onCreate={(kind,x,y,geometry)=>{if(shapeReadOnly||materialFailed)return;const block=kind==="블록"?screenBlocks.find(block=>block.code===pendingBlock):undefined;if(kind==="블록"&&!block)return;const id=crypto.randomUUID();setScreenShapes(shapes=>[...shapes,{...shapeStyle,id,kind,page,x,y,...geometry,...(block?{blockCode:block.code}:{}),layer:shapeStyle.layer||layers[0]?.id||"",name:shapeStyle.name||block?.name||`${kind} ${String(screenShapes.length+1).padStart(2,"0")}`}]);setSelectedShapeId(id);setActiveTool("");setPendingBlock(null);setInfoTab("tool");setRightOpen(true);}}
      onSelect={(id,extend)=>{if(materialFailed)return;if(workspaceMode==="review"){selectChange(id);return;}if(extend||multiSelecting)setSelectedShapeIds(selectedShapes.some(shape=>shape.id===id)?selectedShapes.filter(shape=>shape.id!==id).map(shape=>shape.id):[...selectedShapes.map(shape=>shape.id),id]);else setSelectedShapeId(id);setActiveTool("");setInfoTab("tool");setRightOpen(!multiSelecting);setTakeoffOpen(false);}}/>
    {!activeTool&&<DrawingChangePins items={changeItems.filter(item=>!(workspaceMode==="author"&&!shapeReadOnly&&selectedShapes.length===1&&selectedShape?.kind==="폴리라인"&&item.id===selectedShapeId))} selected={selectedChangeId} page={page} onSelect={selectChange} highlight={workspaceMode==="review"} compare={compareChanges}/>}
    {ready && reviewLoop.page === page && <DrawingReviewMarker state={reviewLoop} onLocate={locateReview} />}
    {ready && anchorPage === page && takeoffTarget?.sourceVersion!==sourceVersion ? (
    <button
      className="pdf-takeoff-anchor"
      aria-label={`A01 예시 영역 · ${page}쪽 물량·내역 보기`}
      onPointerDown={event => event.stopPropagation()}
      onClick={openTakeoff}
      ref={node => { if (node && focusAnchor) node.focus(); }}
      onFocus={() => setFocusAnchor(false)}
      type="button"
    ><span>A01 · 예시</span></button>
  ) : null}</>;
  const toggleLeft = () => {
    if (compact)
      setMobilePanel((value) => (value === "pages" ? null : "pages"));
    else setLeftOpen((value) => !value);
  };
  const toggleRight = () => {
    setRightOpen((value) => !value);
  };
  const showTool = (name: string) => {
    if(shapeReadOnly||materialFailed)return;
    setSelectedShapeId(null);
    setPan(false);
    setActiveTool(name);
    setInfoTab("tool");
    setRightOpen(true);
    setMobilePanel(null);
  };
  return (
    <div
      className="pdf-screen"
      data-workspace-mode={workspaceMode}
      data-muted={mutedSource}
      data-local-pdf-screen
      tabIndex={-1}
      onFocusCapture={event=>{
        if(selectedShape&&event.target instanceof Element&&event.target.matches("input,textarea,select"))shapeEditGroup.current={id:selectedShape.id,group:`input-${++shapeEditSequence.current}`};
      }}
      onBlurCapture={()=>{shapeEditGroup.current=null;}}
      onClickCapture={event=>{
        if(!drawingSaveFailed||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
        const link=event.target instanceof Element?event.target.closest("a[href]"):null;
        if(!link||link.hasAttribute("download")||link.getAttribute("target")==="_blank")return;
        event.preventDefault();event.stopPropagation();setExitPrevented(true);
      }}
      onKeyDown={(event) => {
        const key=event.key.toLowerCase();
        const editing=event.target instanceof Element&&Boolean(event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'));
        if(!event.defaultPrevented&&!event.nativeEvent.isComposing&&!editing&&!event.altKey&&(event.metaKey||event.ctrlKey)&&!workflowOpen&&!takeoffOpen&&!workbenchOpen&&(key==="z"||key==="y")){
          if(!event.repeat&&historyAvailable(key==="y"||event.shiftKey?"redo":"undo")){
            event.preventDefault();event.stopPropagation();
            restoreShapeHistory(key==="y"||event.shiftKey?"redo":"undo");
            event.currentTarget.focus({preventScroll:true});
          }
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !workflowOpen && !takeoffOpen && !workbenchOpen) {
          event.preventDefault();
          openWorkbench("authoring");
          return;
        }
        if (event.key === "Escape") {
          setMobilePanel(null);
          if(!event.defaultPrevented&&!event.nativeEvent.isComposing&&!editing&&!workflowOpen&&!takeoffOpen&&!workbenchOpen&&activeTool){
            event.preventDefault();setActiveTool("");
          }
        }
        if (event.key !== "Tab" || !compact || !mobilePanel || workflowOpen || takeoffOpen || workbenchOpen)
          return;
        const element =
          mobilePanel === "pages" ? leftRef.current : rightRef.current;
        const controls = Array.from(
          element?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
          ) ?? [],
        );
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        aria-label="로컬 PDF 선택"
        disabled={!reviewRestored}
        hidden
        onChange={(event) => {
          void chooseFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <header className="pdf-screen-header">
        <a
          href={returnHref}
          className="pdf-icon-button"
          aria-label="작업공간으로 돌아가기"
          title="작업공간으로 돌아가기"
        >
          <ArrowLeft size={18} />
        </a>
        <div className="pdf-screen-brand">
          1HK<span>도면 작업실</span>
        </div>
        <span className="pdf-header-divider" />
        <div className="pdf-screen-document">
          <FileText size={17} />
          <h1>{fileName ?? "새 도면 작업실"}</h1>
          <span className="pdf-format-badge">{exampleKind ? "2D" : "PDF"}</span>
        </div>
        <span className="pdf-preview-badge">화면 미리보기</span>
        <div className="pdf-work-mode" role="group" aria-label="작업 모드">
          <button aria-label="작성 모드" aria-pressed={workspaceMode==="author"} disabled={viewer} onClick={()=>switchWorkspaceMode("author")}>작성</button>
          <button aria-label="검토 모드" aria-pressed={workspaceMode==="review"} onClick={()=>switchWorkspaceMode("review")}>검토 <span>{changeItems.length}</span></button>
        </div>
        <div className="pdf-screen-header-actions">
          <button className="pdf-subtle-button pdf-request-action" aria-label="검토 요청 구성 열기" disabled={viewer||!ready} onClick={()=>{switchWorkspaceMode("review");setChangeRequestOpen(true);}}><ListChecks size={15}/><span>검토 요청</span></button>
          <details className="pdf-header-more"><summary aria-label="도면 업무 더보기">더보기</summary><div className="pdf-header-more-menu">
          <button className="pdf-subtle-button" onClick={event=>{event.currentTarget.closest("details")?.removeAttribute("open");openTakeoff();}} aria-label="물량·내역 화면 열기">
            <TableProperties size={16}/><span>물량·내역</span>
          </button>
          <button
            className="pdf-subtle-button"
            onClick={openFile}
            disabled={!reviewRestored}
            aria-label="PDF 열기"
          >
            <FolderOpen size={16} />
            <span>PDF 열기</span>
          </button>
          <button
            className="pdf-subtle-button"
            onClick={openReview}
            aria-label="개정 검토 흐름 열기"
          >
            <ListChecks size={16} />
            <span>개정 검토 기록</span>
          </button>
          <button
            className="pdf-subtle-button pdf-export-action"
            onClick={() => {
              setMobilePanel(null);
              setWorkflowOpen("export");
            }}
            aria-label="내보내기 화면 열기"
          >
            <Download size={16} />
            <span>내보내기</span>
          </button>
          <button
            className="pdf-icon-button pdf-share-button"
            onClick={() => {
              setMobilePanel(null);
              setWorkflowOpen("share");
            }}
            title="공유 화면 미리보기 · 실제 전송 없음"
            aria-label="공유 화면 열기"
          >
            <Share2 size={17} />
          </button>
          </div></details>
        </div>
      </header>

      {changeRoundId !== undefined && <div role={changeTargetError || reviewStorageError ? "alert" : "status"} className="pdf-flowbar">{changeTargetError || reviewStorageError ? "해당 변경 회차의 개정·페이지 기록을 찾을 수 없습니다. 현재 개정으로 대신 열지 않았습니다." : changeTargetLabel || "변경 회차의 검토 기록을 확인하고 있습니다."}<a className="underline" href={`${returnHref}&panel=project-changes&changeRound=${encodeURIComponent(changeRoundId)}`}>변경 이력으로 돌아가기</a><span>보관된 예시 검토 오버레이이며 원본 도면 파일의 개정 복원은 아닙니다.</span></div>}
      {registrationRecord && sourceVersion === 0 ? <DrawingRegistrationNotice record={registrationRecord} localListing={Boolean(documentId) && startKind === "pdf"}/> : null}

      {sourceNotice && <p role="status" className="pdf-flowbar">{sourceNotice}</p>}
      {deletedShape&&<div role="status" className="pdf-flowbar">{deletedShape.object.name} 표시를 삭제했습니다. 원본과 요청 이력은 변경하지 않았습니다.<button disabled={shapeReadOnly||materialFailed||Boolean(layers.find(layer=>layer.id===deletedShape.object.layer)?.locked)||!layers.some(layer=>layer.id===deletedShape.object.layer)} onClick={()=>{
        if(shapeReadOnly||materialFailed||!layers.some(layer=>layer.id===deletedShape.object.layer&&!layer.locked))return;
        const {object,index}=deletedShape;setScreenShapes(current=>current.some(shape=>shape.id===object.id)?current:[...current.slice(0,index),object,...current.slice(index)]);setSelectedShapeId(object.id);setPage(object.page);setInfoTab("tool");setRightOpen(true);setDeletedShape(null);
      }}>도형 삭제 취소</button></div>}
      {shapeReadError&&<div role="alert" className="pdf-flowbar">화면 도형을 복원하지 못했습니다. 기존 기록을 보호하기 위해 편집을 막았습니다.<button onClick={restoreShapes}>도형 기록 다시 읽기</button></div>}
      {shapeSaveError&&<div role="alert" className="pdf-flowbar">화면 도형을 보관하지 못했습니다. 이동·새로고침 전에 다시 시도해 주세요.<button onClick={saveShapes}>도형 보관 다시 시도</button></div>}
      {drawingSaveFailed&&exitPrevented&&<div role="alert" className="pdf-flowbar">보관하지 못한 작업이 있어 이동을 멈췄습니다. {shapeSaveError?"도형":"검토 요청 묶음"} 보관을 다시 시도한 뒤 이동해 주세요. 현재 작업은 화면에 유지됩니다.{requestSaveFailed&&<button onClick={()=>{setInfoTab("changes");setRightOpen(true);if(compact)setMobilePanel("info");}}>요청 보관 상태 보기</button>}</div>}
      {documentId && (reviewStorageError || sourceVersion > 0) ? <p role="status" className="pdf-flowbar">{reviewStorageError ? "검토 기록을 보관하거나 복원하지 못했습니다. 현재 작업은 이 화면에서만 유지됩니다." : sourceVersion > 0 ? "다른 원본을 열었습니다. 이전 도면의 검토 기록을 덮어쓰지 않습니다." : "검토 예시는 이 브라우저 탭에 보관됩니다. 실제 승인·서버 저장은 아닙니다."}</p> : null}

      <div className="pdf-flowbar pdf-mode-guide" aria-label="도면 작업 흐름">
        <div className="pdf-mode-guide-copy"><strong>{workspaceMode==="author"?"도면 위에 작성하세요":"같은 도면에서 변경을 확인하세요"}</strong></div>
        <button className="pdf-mode-guide-action" disabled={!ready} onClick={()=>{switchWorkspaceMode("review");selectChange(null);}}>{workspaceMode==="author"?"변경 위치 확인":"변경 목록 열기"}<ArrowRight size={14}/></button>
        <details className="pdf-workspace-help"><summary>작업 안내</summary><div><p>{workspaceMode==="author"?"표시한 도형은 검토 모드에서 위치별 대화로 이어집니다.":"변경 핀을 누르면 누가 무엇을 바꿨는지와 대화를 볼 수 있습니다."}</p><p>{reviewStorageError?"검토 기록을 보관하거나 복원하지 못했습니다. 현재 작업은 이 화면에서만 유지됩니다.":sourceVersion>0?"다른 원본을 열었습니다. 이전 도면의 검토 기록을 덮어쓰지 않습니다.":documentId?"검토 예시는 이 브라우저 탭에 보관됩니다. 실제 승인·서버 저장은 아닙니다.":"화면 체험 · 실제 전송·승인 없음"}</p></div></details>
      </div>

      <div className="pdf-screen-modebar pdf-work-modebar">
        <div className="pdf-context-label"><FileText size={13}/><strong>{ready?pageLabel(page):"도면을 열어 주세요"}</strong><span>·</span><span>{viewer?"읽기 전용":`R${reviewLoop.revision} · ${reviewLoopLabels[reviewLoop.phase]}`}</span></div>
        {explorationOrigin&&<button className="pdf-subtle-button" aria-label="탐색 전 위치로 돌아가기" onClick={returnFromExploration}><ArrowLeft size={14}/><span>탐색 전 위치 · {explorationOrigin.page}쪽</span></button>}
        {workspaceMode==="review"&&<div className="pdf-review-options"><DrawingChangeLegend items={changeItems} page={page}/><button aria-pressed={!mutedSource} onClick={()=>setMutedSource(value=>!value)}>원본색 유지</button></div>}
        <details className="pdf-view-settings"><summary>보기 설정</summary>
        <div className="pdf-screen-mode">
          <button ref={twoDModeRef} className={viewMode === "2d" ? "pdf-active-mode" : ""} aria-pressed={viewMode === "2d"} onClick={() => setViewMode("2d")}>2D 도면</button>
          <button className={viewMode === "3d" ? "pdf-active-mode" : ""} aria-pressed={viewMode === "3d"} onClick={() => setViewMode("3d")}>3D 모델</button>
          <button className={viewMode === "split" ? "pdf-active-mode" : ""} aria-pressed={viewMode === "split"} onClick={() => setViewMode("split")}>분할 보기</button>
        </div>
        </details>
        <span className="pdf-screen-private">
          <LockKeyhole size={12} />
          {exampleKind
            ? "템플릿 배경 · 원본 수정 없음"
            : "브라우저에서만 열림 · 업로드 안 함"}
        </span>
        <div className="pdf-screen-dock-buttons">
          <button className="pdf-subtle-button" aria-label="작업실 메뉴 열기" onClick={() => openWorkbench("blocks")}><BookOpen size={16} /><span>작업실 메뉴</span></button>
          <button
            className="pdf-icon-button"
            onClick={toggleLeft}
            aria-label="페이지 패널 전환"
            aria-controls="pdf-pages-panel"
            aria-expanded={compact ? mobilePanel === "pages" : leftOpen}
          >
            <PanelLeft size={16} />
          </button>
          <button
            className="pdf-icon-button"
            onClick={toggleRight}
            aria-label="정보 패널 전환"
            aria-controls="pdf-info-panel"
            aria-expanded={rightOpen}
          >
            <PanelRight size={16} />
          </button>
        </div>
      </div>

      <div className="pdf-screen-body" data-review-open={rightOpen || takeoffOpen} data-request-open={rightOpen&&infoTab==="changes"&&changeRequestOpen&&!takeoffOpen}>
        {mobilePanel && (
          <button
            className="pdf-screen-scrim"
            onClick={() => setMobilePanel(null)}
            aria-label="패널 닫기"
          />
        )}
        <aside
          id="pdf-pages-panel"
          ref={leftRef}
          className={`pdf-screen-left ${leftOpen ? "" : "pdf-desktop-hidden"}`}
          data-mobile-open={mobilePanel === "pages"}
          aria-label={exampleKind ? "도면 페이지" : "PDF 페이지"}
        >
          <div className="pdf-panel-tabs">
            <button
              aria-pressed={panel === "pages"}
              onClick={() => setPanel("pages")}
            >
              페이지 <span>{pageCount || "—"}</span>
            </button>
            <button
              aria-pressed={panel === "layers"}
              onClick={() => setPanel("layers")}
            >
              레이어
            </button>
            <button
              className="pdf-mobile-close"
              onClick={() => setMobilePanel(null)}
              aria-label="페이지 패널 닫기"
            >
              <X size={16} />
            </button>
          </div>
          {panel === "pages" ? (
            <>
              <label className="pdf-page-search">
                <Search size={14} />
                <input
                  aria-label="페이지 번호 검색"
                  placeholder="페이지 찾기"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  disabled={!pdf}
                />
              </label>
              <div className="pdf-page-section">
                <span>{sourceLabel}</span>
                <span>{pageCount ? `${pageCount}페이지` : "파일 없음"}</span>
              </div>
              <nav className="pdf-page-list" aria-label="페이지 목록">
                {pages.map((number) => (
                  <button
                    key={number}
                    className="pdf-page-card"
                    aria-current={number === page ? "page" : undefined}
                    onClick={() => goToPage(number)}
                    aria-label={`${pageLabel(number)} 열기`}
                  >
                    <div className="pdf-page-thumbnail">
                      {pdf && Thumbnail && (
                        <Thumbnail document={pdf} pageNumber={number} />
                      )}
                      <span className="pdf-page-number">
                        {String(number).padStart(2, "0")}
                      </span>
                    </div>
                    <span className="pdf-page-caption">
                      <span>{pageLabel(number)}</span>
                      {number === page && (
                        <span className="pdf-current-label">현재</span>
                      )}
                    </span>
                  </button>
                ))}
                {exampleKind && (
                  <button
                    className="pdf-page-card"
                    aria-current="page"
                    onClick={() => setMobilePanel(null)}
                  >
                    {exampleImage ? (
                      <img
                        className="pdf-example-thumb"
                        src={exampleImage}
                        alt="예시 템플릿 페이지"
                      />
                    ) : (
                      <div className="pdf-blank-thumb">
                        <FileText size={28} />
                        <span>빈 도면</span>
                      </div>
                    )}
                    <span className="pdf-page-caption">
                      페이지 01 <span className="pdf-current-label">현재</span>
                    </span>
                  </button>
                )}
                {!pdf && !exampleKind && (
                  <p className="pdf-panel-empty">
                    PDF를 열면 실제 페이지가
                    <br />
                    이곳에 표시됩니다.
                  </p>
                )}
                {pdf && !pages.length && (
                  <div className="pdf-panel-empty">
                    해당 페이지가 없습니다.
                    <button
                      className="pdf-text-button"
                      onClick={() => setQuery("")}
                    >
                      검색 초기화
                    </button>
                  </div>
                )}
              </nav>
              <button className="pdf-page-open" onClick={openFile} disabled={!reviewRestored}>
                <Plus size={15} />
                다른 PDF 열기
              </button>
            </>
          ) : (
            <div className="pdf-layer-list">
              <p className="pdf-panel-eyebrow">현재 페이지</p>
              <div className="pdf-layer-row">
                <FileText size={16} />
                <span>{sourceLabel}</span>
                <LockKeyhole size={13} />
              </div>
              <p className="pdf-panel-description">
                원본은 잠긴 배경으로 표시됩니다.
                <br />
                아래 레이어 목록은 화면 예시입니다.
              </p>
              <DrawingLayerPreview layers={layers} viewer={viewer||shapeReadError||!shapesRestored} onChange={setLayers} />
            </div>
          )}
        </aside>

        <main
          className="pdf-screen-canvas"
          aria-label={exampleKind ? "도면 화면 미리보기" : "실제 PDF 도면 화면"}
        >
          <div className="pdf-canvas-breadcrumb" hidden={viewMode === "3d"}>
            <FileText size={13} />
            <span>{fileName ?? "PDF 도면"}</span>
            <ChevronRight size={12} />
            <strong>{ready ? pageLabel(page) : "파일을 열어 주세요"}</strong>
          </div>
          {error && (
            <div role="alert" className="pdf-screen-error">
              <span>{error}</span>
              <button
                onClick={() => setError(null)}
                aria-label="오류 안내 닫기"
              >
                <X size={15} />
              </button>
            </div>
          )}
          <div className="pdf-viewports" data-view={viewMode}>
          <div className="pdf-drawing-viewport" hidden={viewMode === "3d"}>
          {status === "ready" && pdf && Surface ? (
            <Surface
              document={pdf}
              pageNumber={page}
              zoom={zoom}
              panEnabled={pan}
              fitKey={fitKey}
              restorePosition={restorePosition}
              onPositionChange={position=>{pdfPosition.current=position;}}
              onMetrics={setMetrics}
              overlay={anchorOverlay}
            />
          ) : exampleKind ? (
            <div className="pdf-example-stage">
              <div className="pdf-example-sheet">
                {anchorOverlay}
                {exampleImage ? (
                  <img
                    src={exampleImage}
                    alt={`${fileName} · 편집되지 않는 템플릿 이미지 예시`}
                  />
                ) : (
                  <div className="pdf-blank-sheet-message">
                    <FileText size={26} />
                    <h2>빈 도면</h2>
                    <p>아이디어를 시작할 공간입니다.</p>
                    <span>도구를 선택해 작성 화면 구성을 살펴보세요.</span>
                  </div>
                )}
              </div>
              <span className="pdf-example-caption">
                {sourceLabel} · {paper} 가로 · 배경 원본은 수정하지 않습니다
              </span>
            </div>
          ) : (
            <div className="pdf-screen-empty">
              <div className="pdf-empty-icon">
                <FileText size={28} />
              </div>
              <h2>
                {status === "loading"
                  ? "실제 도면을 불러오고 있습니다"
                  : (handoffToken || documentId) && !file ? "로컬 PDF를 다시 선택해 주세요" : "도면을 중심에 두고 시작하세요"}
              </h2>
              <p>
                {status === "loading"
                  ? "원본 PDF 페이지를 준비하고 있습니다."
                  : (handoffToken || documentId) && !file ? "원본 파일은 브라우저에 영구 보관되지 않습니다. 새로고침하거나 다시 열 때 원본 PDF를 선택해야 페이지를 볼 수 있습니다." : "PDF를 열어 작업실의 화면 구성을 확인하세요."}
              </p>
              {status !== "loading" && (
                <button className="pdf-primary-button" onClick={openFile} disabled={!reviewRestored}>
                  <FolderOpen size={17} />
                  {(handoffToken || documentId) && !file ? "PDF 다시 선택" : "PDF 열기"}
                </button>
              )}
              {documentId && !file && status !== "loading" && <p>이전에 확인한 원본과 바이트가 같으면 검토 기록을 유지합니다. 식별 정보가 없는 오래된 도면은 동일 원본을 자동 확인할 수 없어 교체 확인이 표시됩니다. 기존 기록을 유지하려면 교체를 취소하세요.</p>}
              <span>
                파일은 서버에 업로드되지 않습니다. 새로고침하면 다시 선택해
                주세요.
              </span>
            </div>
          )}

          <div ref={setPathControlsHost} className="pdf-canvas-toolbar pdf-path-controls-host" style={{display:activeTool==="폴리라인"&&!shapeReadOnly?"flex":"none"}} />
          <div
            className="pdf-canvas-toolbar"
            style={{display:activeTool==="폴리라인"&&!shapeReadOnly?"none":undefined}}
            role="toolbar"
            aria-label="도면 도구"
          >
            <button
              aria-pressed={!pan && !activeTool && !multiSelecting}
              title="화면 도형 선택 · 원본 내부 객체는 선택하지 않습니다"
              aria-label="선택 도구 모양"
              onClick={() => {
                setMultiSelecting(false);
                setPan(false);
                setActiveTool("");
                setSelectedShapeId(null);
                if(workspaceMode==="author")setInfoTab("info");
              }}
            >
              <MousePointer2 size={18} />
              <span>선택</span>
            </button>
            {workspaceMode==="author"&&<button aria-label={multiSelecting?"다중 선택 완료":"다중 선택 시작"} aria-pressed={multiSelecting} disabled={viewer||materialFailed||!ready} title="도형을 차례로 눌러 선택하고 완료하면 속성을 확인합니다" onClick={()=>{
              if(multiSelecting){setMultiSelecting(false);if(selectedShapes.length){setInfoTab("tool");setRightOpen(true);if(compact)setMobilePanel("info");}}
              else{setPan(false);setActiveTool("");setSelectedShapeId(null);setMultiSelecting(true);setRightOpen(false);setMobilePanel(null);}
            }}>{multiSelecting?`완료 ${selectedShapes.length}`:"다중"}</button>}
            {multiSelecting&&<span className="whitespace-nowrap text-xs text-muted-foreground" role="status" title="상자에 완전히 포함된 도형을 선택합니다. Shift로 추가 선택할 수 있습니다.">빈 곳 드래그 · Esc 취소</span>}
            <button
              aria-pressed={pan && !activeTool}
              title="드래그하여 도면 이동"
              aria-label="도면 이동"
              onClick={() => {
                setPan(true);
                setActiveTool("");
                setSelectedShapeId(null);
                if(workspaceMode==="author")setInfoTab("info");
              }}
            >
              <Hand size={18} />
              <span>이동</span>
            </button>
            <span className="pdf-author-tools"><i />
            <button aria-label="도형 실행 취소" aria-keyshortcuts="Control+z Meta+z" title="도형 실행 취소 · Ctrl/⌘ Z · 현재 세션 최대 100단계" disabled={!historyAvailable("undo")} onClick={()=>restoreShapeHistory("undo")}><span aria-hidden="true">↶</span></button>
            <button aria-label="도형 다시 실행" aria-keyshortcuts="Control+Shift+z Meta+Shift+z Control+y" title="도형 다시 실행 · Ctrl/⌘ Shift Z 또는 Ctrl Y" disabled={!historyAvailable("redo")} onClick={()=>restoreShapeHistory("redo")}><span aria-hidden="true">↷</span></button>
            <button
              disabled={shapeReadOnly}
              title="선 도구 속성 화면"
              aria-label="선 도구 화면"
              aria-pressed={activeTool === "선"}
              onClick={() => showTool("선")}
            >
              <Slash size={17} />
            </button>
            <button
              disabled={shapeReadOnly}
              title="사각형 도구 속성 화면"
              aria-label="사각형 도구 화면"
              aria-pressed={activeTool === "사각형"}
              onClick={() => showTool("사각형")}
            >
              <Square size={17} />
            </button>
            <button
              disabled={shapeReadOnly}
              title="원 도구 속성 화면"
              aria-label="원 도구 화면"
              aria-pressed={activeTool === "원"}
              onClick={() => showTool("원")}
            >
              <Circle size={17} />
            </button>
            <button
              disabled={shapeReadOnly}
              title="텍스트 도구 속성 화면"
              aria-label="텍스트 도구 화면"
              aria-pressed={activeTool === "텍스트"}
              onClick={() => showTool("텍스트")}
            >
              <Type size={18} />
            </button>
            <i />
            <button
              disabled={shapeReadOnly}
              title="치수 도구 속성 화면 · 계산 없음"
              aria-label="치수 도구 화면"
              aria-pressed={activeTool === "치수"}
              onClick={() => showTool("치수")}
            >
              <Ruler size={18} />
            </button>
            <button
              onClick={() => {
                setInfoTab("comments");
                setRightOpen(true);
                setMobilePanel(null);
              }}
              title="댓글 패널 구성 보기"
              aria-label="댓글 패널 보기"
            >
              <MessageSquare size={18} />
            </button>
            <button title="작성 도구·명령 · Ctrl/⌘ K" aria-label="작성 도구·명령 열기" onClick={() => openWorkbench("authoring")}><Command size={17} /></button>
            </span>
            {workspaceMode==="review"&&<div className="pdf-review-toolbar"><span>변경 탐색</span><button aria-label="이전 변경" disabled={!changeItems.length} onClick={()=>stepChange(-1)}><ChevronLeft size={16}/></button><button aria-label="다음 변경" disabled={!changeItems.length} onClick={()=>stepChange(1)}><ChevronRight size={16}/></button><button disabled={!changeItems.length} onClick={()=>selectChange(selectedChangeId??changeItems[0]?.id??null)}><MessageSquare size={16}/> 대화</button></div>}
          </div>
          </div>
          {viewMode !== "2d" && <IfcViewportPreview onInspect={() => openWorkbench("sources")} onReturn={() => { setViewMode("2d"); twoDModeRef.current?.focus(); }} />}
          </div>
        </main>

        <aside
          id="pdf-info-panel"
          ref={rightRef}
          className={`pdf-screen-right pdf-review-dock ${rightOpen ? "" : "pdf-desktop-hidden"}`}
          style={takeoffOpen ? { display: "none" } : undefined}
          data-mobile-open={mobilePanel === "info"}
          aria-label="도면 정보 패널"
        >
          <div className="pdf-panel-tabs">
            <button aria-pressed={infoTab === "changes"} onClick={()=>{setInfoTab("changes");setChangeRequestOpen(false);}}>변경</button>
            <button aria-label="검토 화면 열기" aria-pressed={infoTab === "review"} onClick={openReview}>검토 기록</button>
            <button
              aria-pressed={infoTab === "info"}
              onClick={() => setInfoTab("info")}
            >
              도면 정보
            </button>
            <button
              aria-pressed={infoTab === "comments"}
              onClick={() => setInfoTab("comments")}
            >
              개인 메모
            </button>
            {inspectorTool && (
              <button
                aria-pressed={infoTab === "tool"}
                onClick={() => setInfoTab("tool")}
              >
                속성
              </button>
            )}
            <button
              className="pdf-mobile-close"
              onClick={() => { setMobilePanel(null); setRightOpen(false); }}
              aria-label="정보 패널 닫기"
            >
              <X size={16} />
            </button>
          </div>
          <div hidden={infoTab!=="changes"}>
            {takeoffReviewOrigin?.sourceVersion===sourceVersion&&<div className="border-b p-3"><button className="pdf-subtle-button" disabled={materialFailed} onClick={()=>{
              if(materialFailed||takeoffReviewOrigin.sourceVersion!==sourceVersion)return;
              const object=screenShapes.find(shape=>shape.id===takeoffReviewOrigin.object.id);
              setTakeoffTarget({object:object??takeoffReviewOrigin.object,sourceVersion});
              if(object){if(object.page!==page)goToPage(object.page);setSelectedShapeId(object.id);}
              setWorkspaceMode(viewer?"review":takeoffReviewOrigin.mode);setTakeoffOpen(true);setTakeoffReviewOrigin(null);setMobilePanel(null);
            }}>물량 항목으로 돌아가기</button><p className="mt-1 text-xs text-muted-foreground">검토를 열었던 도형의 물량 입력으로 돌아갑니다.</p></div>}
            <DrawingChangePanel onRequestsChange={setRequestRecords} requestToOpen={requestToOpen} drawingRevision={reviewLoop.revision} requestSelection={requestSelection} currentFile={file??undefined} snapshot={ready?{documentName:fileName??"도면",pageCount:Math.max(1,pageCount),objects:screenShapes,layers,source:requestSnapshotSource}:undefined} onDelivery={request=>{if(viewer||drawingSaveFailed||materialFailed)return;setApprovedRequest(structuredClone(request));setWorkflowOpen("export");}} onSaveFailure={setRequestSaveFailed} initialRequestRound={initialRequestRound} key={`${documentId??"temporary"}:${sourceVersion}`} storageKey={documentId&&sourceVersion===0&&changeRoundId===undefined?`1hk:preview:change-requests:${documentId}`:undefined} items={changeItems} selected={selectedChangeId} onSelect={selectChange} mode={workspaceMode} onReview={()=>switchWorkspaceMode("review")} onAuthor={editSelectedChange} viewer={viewer} compare={compareChanges} onCompare={()=>setCompareChanges(value=>!value)} requesting={changeRequestOpen} onRequest={setChangeRequestOpen} onLegacyReview={openReview} hasReviewRecord={!!reviewLoop.target||reviewLoop.position>0||reviewLoop.phase!=="draft"} page={page}/>
          </div>
          <div hidden={infoTab !== "review"}>
            <DrawingReviewLoop key={sourceVersion} state={reviewLoop} dispatch={handleReviewAction} ready={ready} viewer={viewer} page={page} onLocate={locateReview} showIssueSummary={!(documentId && sourceVersion === 0 && changeRoundId === undefined && new URL(returnHref,"http://preview.local").searchParams.get("project"))}/>
            {documentId && sourceVersion === 0 && new URL(returnHref,"http://preview.local").searchParams.get("project") && <ExternalRequestPanel key={documentId} projectId={new URL(returnHref,"http://preview.local").searchParams.get("project")!} documentId={documentId} viewer={viewer || reviewLoop.role !== "author"} internalEntries={changeRoundId===undefined?[{documentId,title:fileName??title,state:reviewLoop,onLocate:locateReview}]:undefined}/>}
          </div>
          {infoTab === "review" || infoTab === "changes" ? null : infoTab === "info" ? (
            <div className="pdf-info-content">
              <div className="pdf-info-heading">
                <div className="pdf-info-icon">
                  <FileText size={20} />
                </div>
                <h2>{ready ? pageLabel(page) : "도면 정보"}</h2>
                <span>{sourceLabel}</span>
              </div>
              <dl className="pdf-info-list">
                <div>
                  <dt>{exampleKind ? "도면" : "파일"}</dt>
                  <dd>{fileName ?? "아직 열지 않음"}</dd>
                </div>
                <div>
                  <dt>페이지</dt>
                  <dd>{ready ? `${page} / ${pageCount}` : "—"}</dd>
                </div>
                <div>
                  <dt>용지 크기</dt>
                  <dd>
                    {metrics
                      ? `${Math.round((metrics.widthPoints * 25.4) / 72)} × ${Math.round((metrics.heightPoints * 25.4) / 72)} mm`
                      : exampleKind
                        ? `${paper} 가로 · 예시`
                        : "—"}
                  </dd>
                </div>
                <div>
                  <dt>파일 크기</dt>
                  <dd>
                    {file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : "—"}
                  </dd>
                </div>
              </dl>
              <div className="pdf-info-section">
                <h3>
                  측정 기준 <span>설정 전</span>
                </h3>
                <p>
                  도면의 실제 길이를 지정한 뒤<br />
                  길이와 면적을 측정합니다.
                </p>
                <button disabled={viewer} onClick={() => showTool("치수")}>
                  축척 설정 화면
                </button>
              </div>
              <div className="pdf-info-section">
                <h3>
                  {exampleKind === "blank" ? "도면과 근거" : "원본과 편집"}
                </h3>
                <div className="pdf-source-lock">
                  <LockKeyhole size={15} />
                  <span>
                    {exampleKind === "blank"
                      ? "원본 없이 시작"
                      : exampleKind
                        ? "예시 이미지 사용"
                        : "원본 파일 유지"}
                  </span>
                </div>
                <p>
                  추가할 선·주석·측정은 별도 레이어에
                  <br />
                  저장하는 구조로 연결할 예정입니다.
                </p>
              </div>
              <div className="pdf-info-note">
                현재는 화면 구성 단계입니다.
                <br />
                편집·저장·공유는 아직 연결되지 않았습니다.
              </div>
              <button
                className="pdf-legacy-link"
                onClick={openReview}
              >
                이 도면에서 편집·검토 체험
              </button>
            </div>
          ) : infoTab === "tool" && selectedShapes.length>1 ? (
            <section className="pdf-tool-properties space-y-3" aria-label="다중 도형 선택">
              <h2 className="text-lg font-semibold">도형 {selectedShapes.length}개 선택</h2>
              <fieldset disabled={shapeReadOnly||materialFailed||batchLocked} className="space-y-3">
                <legend className="text-sm font-semibold">공통 속성</legend>
                <label>회전 각도<select aria-label="공통 회전 각도" aria-describedby="multi-rotation-hint" value={commonRotation} onChange={event=>changeCommonStyle({rotation:Number(event.target.value)})}>
                  <option value="" disabled>여러 값</option>
                  {Array.from(new Set([0,45,90,180,270,...selectedShapes.map(shape=>shape.rotation??0)])).sort((a,b)=>a-b).map(angle=><option key={angle} value={angle}>{angle}°</option>)}
                </select><small id="multi-rotation-hint">각 도형의 중심 기준 · 위치 유지</small></label>
                <label>레이어<select aria-label="공통 레이어" value={commonStyle("layer")} onChange={event=>changeCommonStyle({layer:event.target.value})}>
                  <option value="" disabled>여러 값</option>
                  {layers.map(layer=><option key={layer.id} value={layer.id} disabled={layer.locked}>{layer.name}{layer.locked?" · 잠김":""}</option>)}
                </select></label>
                <label>선 색상<select aria-label="공통 선 색상" value={commonStyle("color")} onChange={event=>changeCommonStyle({color:event.target.value})}>
                  <option value="" disabled>여러 값</option>
                  {Array.from(new Set(["#6650f5","#1e293b","#dc2626","#2563eb","#16a34a",...selectedShapes.map(shape=>shape.color)])).map(color=><option key={color} value={color}>{({"#6650f5":"보라","#1e293b":"먹색","#dc2626":"빨강","#2563eb":"파랑","#16a34a":"초록"} as Record<string,string>)[color]??color}</option>)}
                </select></label>
                <div className="pdf-property-pair">
                  <label>선 굵기<select aria-label="공통 선 굵기" value={commonStyle("lineWidth")} onChange={event=>changeCommonStyle({lineWidth:event.target.value})}>
                    <option value="" disabled>여러 값</option>
                    {["0.25 mm","0.50 mm","1.00 mm"].map(value=><option key={value}>{value}</option>)}
                  </select></label>
                  <label>채움<select aria-label="공통 채움" value={commonStyle("fill")} onChange={event=>changeCommonStyle({fill:event.target.value})}>
                    <option value="" disabled>여러 값</option>
                    {["없음","연한 보라","연한 회색"].map(value=><option key={value}>{value}</option>)}
                  </select></label>
                </div>
              </fieldset>
              <button className="change-primary" disabled={viewer||drawingSaveFailed||materialFailed||selectedShapes.some(shape=>!changeItems.some(item=>item.id===shape.id))} onClick={()=>requestSelectedObjects(selectedShapes.map(shape=>shape.id))}>선택한 {selectedShapes.length}개 도형으로 검토 요청</button>
              <details className="pdf-path-points">
                <summary>선택 사용법</summary>
                <p>Shift+클릭 또는 Shift+Enter로 선택을 추가·해제합니다. 일괄 작업은 한 번에 되돌릴 수 있습니다.</p>
                <p>여러 값은 서로 다른 설정입니다. 바꾼 속성만 선택한 도형에 적용합니다.</p>
                <p>회전은 각 도형을 자신의 중심에서 같은 각도로 설정합니다. 묶음 전체를 회전하지 않습니다.</p>
              </details>
              <ul className="grid gap-2">{selectedShapes.map(shape=><li key={shape.id}><button className="change-secondary" onClick={()=>setSelectedShapeId(shape.id)}>{shape.name} · {shape.page}쪽</button></li>)}</ul>
              <button className="change-primary" disabled={shapeReadOnly||materialFailed||batchLocked} onClick={()=>{
                if(shapeReadOnly||materialFailed||batchLocked)return;
                const dx=Math.min(20,1000-Math.max(...selectedShapes.map(shape=>shape.x))),dy=Math.min(20,700-Math.max(...selectedShapes.map(shape=>shape.y)));
                const copies=selectedShapes.map(shape=>({...shape,id:crypto.randomUUID(),name:`${shape.name.slice(0,75)} 복사본`,x:shape.x+dx,y:shape.y+dy}));
                setScreenShapes(current=>[...current,...copies]);setSelectedShapeIds(copies.map(shape=>shape.id));
              }}>선택한 도형 함께 복사</button>
              <button className="change-secondary" disabled={shapeReadOnly||materialFailed||batchLocked||selectedShapes.some(shape=>shape.id===reviewLoop.target?.id)} onClick={()=>{
                if(shapeReadOnly||materialFailed||batchLocked||selectedShapes.some(shape=>shape.id===reviewLoop.target?.id))return;
                const ids=new Set(selectedShapes.map(shape=>shape.id));setScreenShapes(current=>current.filter(shape=>!ids.has(shape.id)));setSelectedShapeId(null);setSelectedChangeId(null);setDeletedShape(null);
              }}>선택한 도형 함께 삭제</button>
              {batchLocked&&<p className="pdf-info-note">잠긴 레이어가 포함되어 일괄 편집할 수 없습니다.</p>}
              {selectedShapes.some(shape=>shape.id===reviewLoop.target?.id)&&<p className="pdf-info-note">검토 대상 도형이 포함되어 함께 삭제할 수 없습니다.</p>}
              <button className="change-secondary" onClick={()=>{setSelectedShapeId(null);setInfoTab("info");}}>선택 해제</button>
            </section>
          ) : infoTab === "tool" ? (
            <div className="pdf-tool-properties" key={selectedShapeId??activeTool}>
              <p className="pdf-panel-eyebrow">작성 도구 · 화면 예시</p>
              <h2>{inspectorTool} {selectedShape?"화면 도형":"도구"}</h2>
              {selectedShape&&workspaceMode==="author"&&<DrawingObjectCorrectionContext objectId={selectedShape.id} requests={requestRecords} availableIds={screenShapes.map(shape=>shape.id)} layerLocked={Boolean(layers.find(layer=>layer.id===selectedShape.layer)?.locked)} onLayers={()=>openWorkbench("documents")} onEdit={viewer||materialFailed?undefined:editSelectedChange} onOpen={round=>{
                if(materialFailed)return;
                setWorkspaceMode("review");setInfoTab("changes");setRightOpen(true);setChangeRequestOpen(true);setRequestToOpen({round,nonce:Date.now()});
                if(compact)setMobilePanel("info");
              }}/>}
              <label>
                이름
                <input
                  value={shapeStyle.name||(!selectedShape?`${activeTool} 01`:"")}
                  onChange={event=>changeShapeStyle({name:event.target.value})}
                  maxLength={80}
                  disabled={shapeReadOnly}
                />
              </label>
              <label>
                레이어
                <select disabled={shapeReadOnly} value={shapeStyle.layer||layers[0]?.id||""} onChange={event=>changeShapeStyle({layer:event.target.value})}>
                  {layers.map((layer) => (
                    <option key={layer.id} value={layer.id}>{layer.name}</option>
                  ))}
                </select>
              </label>
              {selectedShape&&<section className="pdf-object-geometry" aria-label="선택 도형 위치와 크기"><h3>위치 · 크기 · 회전</h3>
                <div className="pdf-property-pair">{(["x","y"] as const).map(axis=><label key={`${selectedShape.id}:${axis}`}>화면 {axis.toUpperCase()} 위치<ScreenCoordinateInput label={`화면 ${axis.toUpperCase()} 위치`} max={axis==="x"?1000:700} value={selectedShape[axis]} disabled={shapeReadOnly||materialFailed} onChange={value=>changeShapeStyle({[axis]:value})}/></label>)}</div>
                {['사각형','블록'].includes(selectedShape.kind)&&<section aria-label="선택 도형 표시 크기" className="pdf-geometry-row"><div className="pdf-property-pair">
                  <label>화면 도형 가로<ScreenCoordinateInput label="화면 도형 가로" min={1} max={1000} value={selectedShape.width??140} disabled={shapeReadOnly||materialFailed} onChange={width=>{if(!shapeReadOnly&&!materialFailed)changeShapeStyle({width});}}/></label>
                  <label>화면 도형 세로<ScreenCoordinateInput label="화면 도형 세로" min={1} max={700} value={selectedShape.height??90} disabled={shapeReadOnly||materialFailed} onChange={height=>{if(!shapeReadOnly&&!materialFailed)changeShapeStyle({height});}}/></label>
                </div></section>}
                <section aria-label="선택 도형 회전" className="pdf-geometry-row">
                  <label>화면 회전 각도<ScreenCoordinateInput label="화면 회전 각도" max={359} value={selectedShape.rotation??0} disabled={shapeReadOnly||materialFailed} onChange={rotation=>{if(!shapeReadOnly&&!materialFailed)changeShapeStyle({rotation});}}/></label>
                  <button disabled={shapeReadOnly||materialFailed} onClick={()=>{if(shapeReadOnly||materialFailed)return;changeShapeStyle({rotation:((selectedShape.rotation??0)+90)%360});}}>선택 도형 90도 회전</button>
                </section>
                <small>화면 기준 값 · 실제 길이·축척 아님</small>
                {selectedShape.kind==="폴리라인"&&selectedShape.points&&<details className="pdf-path-points">
                  <summary>경로 꼭짓점 · {selectedShape.points.length}개</summary>
                  <p>현재 경로 틀의 왼쪽 위는 0%, 오른쪽 아래는 100%입니다. 실제 좌표·길이가 아니며, 틀 밖으로 늘리는 편집은 지원하지 않습니다.</p>
                  <div className="pdf-path-point-list">{selectedShape.points.map((point,index)=><fieldset key={index}><legend>점 {index+1}</legend>
                    <div className="pdf-property-pair">{(["x","y"] as const).map(axis=><label key={axis}>{axis==="x"?"가로":"세로"} (%)<ScreenCoordinateInput label={`점 ${index+1} ${axis==="x"?"가로":"세로"} 위치 (%)`} max={100} value={Number((point[axis]/(axis==="x"?140:90)*100).toFixed(4))} disabled={shapeReadOnly||materialFailed} onChange={value=>{if(shapeReadOnly||materialFailed)return;changeShapeStyle({points:selectedShape.points!.map((item,position)=>position===index?{...item,[axis]:value/100*(axis==="x"?140:90)}:item)});}}/></label>)}</div>
                    <div className="pdf-property-pair">
                      <button disabled={shapeReadOnly||materialFailed||selectedShape.points!.length<=2} aria-label={`점 ${index+1} 삭제`} onClick={()=>{if(shapeReadOnly||materialFailed||selectedShape.points!.length<=2)return;changeShapeStyle({points:selectedShape.points!.filter((_,position)=>position!==index)});}}>점 삭제</button>
                      {index<selectedShape.points!.length-1&&<button disabled={shapeReadOnly||materialFailed||selectedShape.points!.length>=256} aria-label={`점 ${index+1} 뒤에 중간점 추가`} onClick={()=>{if(shapeReadOnly||materialFailed||selectedShape.points!.length>=256)return;const points=selectedShape.points!,next=points[index+1];changeShapeStyle({points:[...points.slice(0,index+1),{x:(point.x+next.x)/2,y:(point.y+next.y)/2},...points.slice(index+1)]});}}>중간점 추가</button>}
                    </div>
                  </fieldset>)}</div>
                </details>}
              </section>}
              <div className="pdf-property-pair">
                <label>
                  선 색상
                  <input
                    type="color"
                    value={shapeStyle.color}
                    onChange={event=>changeShapeStyle({color:event.target.value})}
                    disabled={shapeReadOnly}
                  />
                </label>
                <label>
                  선 굵기
                  <select disabled={shapeReadOnly} value={shapeStyle.lineWidth} onChange={event=>changeShapeStyle({lineWidth:event.target.value})}>
                    <option>0.25 mm</option>
                    <option>0.50 mm</option>
                    <option>1.00 mm</option>
                  </select>
                </label>
              </div>
              {inspectorTool === "텍스트" ? (
                <label>
                  텍스트
                  <textarea
                    value={shapeStyle.text}
                    onChange={event=>changeShapeStyle({text:event.target.value})}
                    maxLength={500}
                    disabled={shapeReadOnly}
                  />
                </label>
              ) : (
                <label>
                  채움
                  <select disabled={shapeReadOnly} value={shapeStyle.fill} onChange={event=>changeShapeStyle({fill:event.target.value})}>
                    <option>없음</option>
                    <option>연한 보라</option>
                    <option>연한 회색</option>
                  </select>
                </label>
              )}
              {inspectorTool === "치수" && (
                <label>
                  축척
                  <select disabled={viewer}>
                    <option>지정 전</option>
                    <option>1:100 · 예시</option>
                    <option>1:200 · 예시</option>
                  </select>
                </label>
              )}
              <details><summary>편집 안내</summary><p className="pdf-info-note">
                원본 위의 화면용 도형입니다. CAD 객체·실측·서버 저장이 아닙니다.
                등록 도면의 표시는 이 브라우저 탭에 보관합니다. 개정 검토 대상과 요청 당시 기록은 별도로 유지합니다.
                도형을 선택해 드래그하거나 도형에 초점을 두고 방향키로 이동하세요. Shift+방향키는 10칸 이동합니다.
              </p></details>
              {selectedShape&&<>
                <section aria-label="선택 도형 사용자 속성" className="space-y-2 rounded border p-3 text-sm"><details><summary>사용자 속성 상세</summary><p>{selectedShape.properties?.classification??"미분류"} · {selectedShape.properties?.code||"코드 없음"}</p><p className="break-words">{selectedShape.properties?.note||"메모 없음"}</p><p>{selectedShape.properties?.required?"후속 검토 표시 있음 · 요청/승인과 별도":"후속 검토 표시 없음"}</p><button onClick={()=>openWorkbench("properties")}>사용자 속성 편집</button></details></section>
                <button disabled={shapeReadOnly||materialFailed} onClick={()=>{if(shapeReadOnly||materialFailed)return;const copy={...selectedShape,id:crypto.randomUUID(),name:`${selectedShape.name.slice(0,75)} 복사본`,x:Math.min(1000,selectedShape.x+20),y:Math.min(700,selectedShape.y+20)};setScreenShapes(current=>[...current,copy]);setSelectedShapeId(copy.id);}}>선택 도형 복사</button>
                <button disabled={shapeReadOnly||materialFailed||selectedShape.id===reviewLoop.target?.id} onClick={()=>{if(shapeReadOnly||materialFailed||selectedShape.id===reviewLoop.target?.id)return;setDeletedShape({object:{...selectedShape},index:localShapes.findIndex(shape=>shape.id===selectedShape.id)});setScreenShapes(current=>current.filter(shape=>shape.id!==selectedShape.id));setSelectedShapeId(null);setSelectedChangeId(null);}}>선택 도형 삭제</button>
                {selectedShape.id===reviewLoop.target?.id&&<p className="pdf-info-note">개정 검토 대상은 이력 보존을 위해 여기서 삭제할 수 없습니다.</p>}
              </>}
              {selectedShape&&<>
                <button disabled={viewer||drawingSaveFailed||materialFailed||!changeItems.some(item=>item.id===selectedShape.id)} onClick={()=>{
                  requestSelectedObjects([selectedShape.id]);
                }}>선택 도형으로 검토 요청</button>
                <details><summary>기존 단일 도형 개정 검토</summary><p className="pdf-info-note">기존 개정 체험은 별도 기록입니다. 위 요청 묶음의 상태와 자동 합쳐지지 않습니다.</p><button disabled={shapeReadOnly||reviewLoop.phase!=="draft"||Boolean(reviewLoop.target)||reviewLoop.position>0} onClick={()=>{reviewDispatch({type:"target",object:selectedShape});openReview();}}>선택 도형 검토 대상으로 지정</button></details>
              </>}
              {selectedShape&&reviewLoop.target&&<p>{selectedShape.id===reviewLoop.target.id?`R${reviewLoop.revision} 검토 대상 도형입니다.`:"이번 검토는 이미 지정한 다른 도형 1개에 한정됩니다."}</p>}
              <button
                className="pdf-subtle-button"
                onClick={() => {
                  setInfoTab("info");
                  setMobilePanel(null);
                }}
              >
                도면으로 돌아가기
              </button>
            </div>
          ) : (
            <div className="pdf-comments-content">
              <MessageSquare size={26} />
              <h2>도면 위에서 함께 검토</h2>
              <p>
                도면의 의견을 확인하는 화면입니다. 작성 내용은 전송되지
                않습니다.
              </p>
              <DrawingReviewIssueSummary state={reviewLoop} onLocate={locateReview}/>
              <h3>개인 메모 · 검토 요청과 별도</h3>
              {comments.length === 0 ? (
                <div className="pdf-comment-empty">
                  아직 개인 메모가 없습니다.
                  <br />
                  {viewer
                    ? "보기 전용에서는 작성된 의견만 확인할 수 있습니다."
                    : "첫 검토 메모를 입력해 보세요."}
                </div>
              ) : (
                <ul>
                  {comments.map((item, index) => (
                    <li key={index}>
                      <strong>
                        내 메모 <span>미전송 · 페이지 {item.page}</span>
                      </strong>
                      <p>{item.text}</p>
                    </li>
                  ))}
                </ul>
              )}
              {!viewer && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (comment.trim()) {
                      setComments([
                        ...comments,
                        { text: comment.trim(), page },
                      ]);
                      setComment("");
                    }
                  }}
                >
                  <label htmlFor="screen-comment">개인 메모</label>
                  <textarea
                    id="screen-comment"
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    maxLength={500}
                    placeholder="예: 기둥 치수와 기준선을 확인해 주세요."
                  />
                  <button
                    className="pdf-primary-button"
                    disabled={!comment.trim() || !ready}
                  >
                    메모 화면에 추가
                  </button>
                </form>
              )}
              <button
                className="pdf-subtle-button"
                onClick={openReview}
              >
                검토 화면으로 계속
              </button>
            </div>
          )}
        </aside>
        <DrawingTakeoffPreview
          reviewEvidence={takeoffTarget?.sourceVersion===sourceVersion&&<DrawingObjectReviewLinks objectId={takeoffTarget.object.id} requests={requestRecords} onOpen={round=>{if(materialFailed||!requestRecords?.some(request=>request.round===round))return;setTakeoffReviewOrigin({...takeoffTarget,mode:workspaceMode});setTakeoffOpen(false);setWorkspaceMode("review");setInfoTab("changes");setRightOpen(true);setChangeRequestOpen(true);setRequestToOpen({round,nonce:Date.now()});if(compact)setMobilePanel("info");}}/>}
          previousSource={previousTakeoffSource}
          onExampleOpen={()=>{if(ready&&anchorPage===null)setAnchorPage(page);}}
          onExampleExit={()=>setAnchorPage(null)}
          availableObjects={screenShapes}
          onShowObjectList={()=>{if(!materialFailed)setTakeoffTarget(null);}}
          onChooseObject={id=>{if(materialFailed)return;const object=screenShapes.find(shape=>shape.id===id);if(!object)return;setTakeoffTarget({object:{...object},sourceVersion});setSelectedShapeId(object.page===page?object.id:null);}}
          selectedDraftKey={documentId&&sourceVersion===0&&changeRoundId===undefined&&(!file||sourceFingerprint)?`1hk:preview:takeoff-rows:${documentId}:${sourceFingerprint??shapeSource}`:undefined}
          selectedObject={takeoffTarget?.sourceVersion===sourceVersion?(screenShapes.find(shape=>shape.id===takeoffTarget.object.id)??takeoffTarget.object):undefined}
          selectedObjectMissing={Boolean(takeoffTarget?.sourceVersion===sourceVersion&&!screenShapes.some(shape=>shape.id===takeoffTarget.object.id))}
          onReturnToObject={selectChange}
          materialDraftKey={documentId && sourceVersion === 0 && changeRoundId === undefined && new URL(returnHref, "http://preview.local").searchParams.get("project") ? `1hk:preview:material-draft:${new URL(returnHref, "http://preview.local").searchParams.get("project")}:${documentId}` : undefined}
          onMaterialSaveFailure={setMaterialFailed}
          materialSourceCandidate={reviewRestored && !reviewStorageError && ready && (!file || sourceFingerprint) ? { revision: reviewLoop.revision, page, source: { kind: exampleKind ?? "pdf", paper, ...(sourceFingerprint ? {fingerprint:sourceFingerprint} : {}) } } : undefined}
          reviewContext={reviewLoop.target||reviewLoop.position > 0 ? { revision: reviewLoop.revision, page: reviewLoop.page,targetName:reviewLoop.target?.name } : undefined}
          key={`takeoff:${sourceVersion}`}
          documentName={fileName ?? "도면 미선택"}
          sourceLabel={sourceLabel}
          page={anchorPage ?? page}
          ready={ready}
          viewer={viewer}
          open={takeoffOpen}
          onOpenChange={setTakeoffOpen}
          onReturnToAnchor={() => {
            setViewMode("2d");
            if (anchorPage !== null) goToPage(anchorPage);
            fit();
            setMobilePanel(null);
            setFocusAnchor(true);
          }}
        />
      </div>

      <footer className="pdf-screen-footer">
        <span className="pdf-footer-status" aria-label="현재 페이지 편집 상태" aria-live="polite">
          <LockKeyhole size={12} />
          {ready?`화면 도형 ${screenShapes.filter(shape=>shape.page===page).length}개 · ${viewer?"읽기 전용":shapeReadError?"복구 필요":!shapesRestored?"복원 중":materialFailed?"보관 재시도 필요":workspaceMode==="review"?"검토 중":shapeReadOnly?"작성 제한":shapeSaveError?"작성 중 · 보관 실패":"작성 가능"}`:"도면 열기 대기"}
        </span>
        <div className="pdf-page-stepper">
          <button
            onClick={() => goToPage(page - 1)}
            disabled={!pdf || page === 1}
            aria-label="이전 페이지"
          >
            <ChevronLeft size={15} />
          </button>
          <span aria-live="polite">
            {ready ? `${page} / ${pageCount}` : "— / —"}
          </span>
          <button
            onClick={() => goToPage(page + 1)}
            disabled={!pdf || page === pageCount}
            aria-label="다음 페이지"
          >
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="pdf-zoom-controls">
          <button
            disabled={!pdf || zoom <= 0.25}
            onClick={() => setZoom((value) => Math.max(0.25, value - 0.25))}
            aria-label="도면 축소"
          >
            <Minus size={14} />
          </button>
          <span aria-label="맞춤 배율 대비 확대">
            {Math.round(zoom * 100)}%
          </span>
          <button
            disabled={!pdf || zoom >= 4}
            onClick={() => setZoom((value) => Math.min(4, value + 0.25))}
            aria-label="도면 확대"
          >
            <Plus size={14} />
          </button>
          <button
            disabled={!pdf}
            onClick={fit}
            className="pdf-fit-button"
            title="전체 페이지를 화면에 맞춤"
          >
            <Maximize size={14} />
            <span>화면 맞춤</span>
          </button>
        </div>
      </footer>
      <DrawingWorkbenchPreview
        authoringReadOnly={shapeReadOnly||materialFailed}
        onChooseTool={kind=>{if(!ready||shapeReadOnly||materialFailed)return;setWorkbenchOpen(false);setViewMode("2d");showTool(kind);}}
        onChooseBlock={code=>{if(!ready||shapeReadOnly||materialFailed)return;setPendingBlock(code);setWorkbenchOpen(false);setViewMode("2d");showTool("블록");}}
        onApplyProperties={properties=>{if(shapeReadOnly||batchLocked||materialFailed||selectedShapes.length!==1)return;changeShapeStyle({properties});}}
        drawingObjects={screenShapes}
        onLocateObject={id=>{if(materialFailed||!screenShapes.some(shape=>shape.id===id))return;setWorkbenchOpen(false);selectChange(id);}}
        selectedObjects={selectedShapes}
        styleReadOnly={shapeReadOnly||batchLocked||materialFailed}
        onApplyStyle={style=>{if(shapeReadOnly||batchLocked||materialFailed)return;if(selectedShapes.length>1)changeCommonStyle(style);else if(selectedShapes.length===1)changeShapeStyle(style);}}
        reviewLoop={reviewLoop}
        onReview={locateReview}
        key={`workbench:${sourceVersion}`}
        initialSection={workbenchSection}
        documentName={fileName ?? "도면 미선택"}
        page={page}
        ready={ready}
        viewer={viewer||shapeReadError||!shapesRestored}
        open={workbenchOpen}
        onOpenChange={setWorkbenchOpen}
        layers={layers}
        onLayersChange={setLayers}
      />
      <DrawingScreenWorkflow
        approvedRequest={approvedRequest}
        drawingSnapshot={ready?{documentName:fileName??"도면",pageCount:Math.max(1,pageCount),objects:screenShapes,layers,source:requestSnapshotSource}:undefined}
        onClearApprovedRequest={()=>setApprovedRequest(undefined)}
        deliveryDraftKey={documentId&&sourceVersion===0&&changeRoundId===undefined&&new URL(returnHref,"http://preview.local").searchParams.get("project")?`1hk:preview:delivery:${new URL(returnHref,"http://preview.local").searchParams.get("project")}:${documentId}`:undefined}
        reviewLoop={reviewLoop}
        onLocateReview={locateReview}
        reviewContext={reviewLoop.target||reviewLoop.position > 0 ? { revision: reviewLoop.revision, page: reviewLoop.page,targetName:reviewLoop.target?.name } : undefined}
        key={`${documentId??"temporary"}:${sourceVersion}`}
        open={workflowOpen}
        onOpenChange={next => next === "review" ? openReview() : setWorkflowOpen(next)}
        documentName={fileName ?? "아직 도면을 열지 않았습니다"}
        page={page}
        pageCount={pageCount}
        ready={ready}
        viewer={viewer}
        returnHref={returnHref}
        reviewState={reviewState}
        onReviewStateChange={() => {}}
      />
    </div>
  );
}
