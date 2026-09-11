import { useEffect, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "react-router";
import { ArrowRight, LocateFixed, Link2, LockKeyhole, X } from "lucide-react";
import { Button } from "~/core/components/ui/button";
import { DrawingMaterialPreview, type MaterialSourceReference } from "./drawing-material-preview";
import {DrawingSelectedTakeoff} from "./drawing-selected-takeoff";
import type {ScreenShape} from "./drawing-screen-object-preview";

export type TakeoffStep = "area" | "quantity" | "estimate";
type Props = {
  reviewEvidence?:ReactNode;
  documentName: string;
  sourceLabel: string;
  page: number;
  ready: boolean;
  viewer: boolean;
  materialDraftKey?: string;
  materialSourceCandidate?: MaterialSourceReference;
  onMaterialSaveFailure?: (failed: boolean) => void;
  reviewContext?: { revision: number; page: number;targetName?:string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReturnToAnchor: () => void;
  onExampleOpen?:()=>void;
  onExampleExit?:()=>void;
  selectedObject?:ScreenShape;
  availableObjects?:ScreenShape[];
  onChooseObject?:(id:string)=>void;
  onShowObjectList?:()=>void;
  selectedDraftKey?:string;
  previousSource?:{draftKey:string;documentName:string};
  selectedObjectMissing?:boolean;
  onReturnToObject?:(id:string)=>void;
};
const steps = [["area", "1 영역"], ["quantity", "2 물량"], ["estimate", "3 내역"]] as const;

export function TakeoffPreviewBody({ documentName, sourceLabel, page, ready, viewer, materialDraftKey, materialSourceCandidate, materialFailed, onMaterialSaveFailure, reviewContext, step, name, trade, onStep, onName, onTrade, onReturn }: Omit<Props, "open" | "onOpenChange" | "onReturnToAnchor"> & {
  materialFailed?: boolean; onMaterialSaveFailure?: (failed: boolean) => void;
  step: TakeoffStep; name: string; trade: string;
  onStep: (step: TakeoffStep) => void; onName: (name: string) => void;
  onTrade: (trade: string) => void; onReturn: () => void;
}) {
  const [materialsOpen, setMaterialsOpen] = useState(false);
  if (materialsOpen && ready) return <div className="grid gap-4"><DrawingMaterialPreview key={materialDraftKey} draftKey={materialDraftKey} sourceCandidate={materialSourceCandidate} onSaveFailure={onMaterialSaveFailure} documentName={documentName} page={page} ready={ready} viewer={viewer} onReturn={onReturn}/><Button type="button" variant="outline" disabled={materialFailed} onClick={() => setMaterialsOpen(false)}>B01 내역으로 돌아가기</Button></div>;
  return <div className="grid min-w-0 gap-5">
    <p className="rounded-lg bg-violet-50 px-3 py-2 text-xs leading-5 text-violet-800">화면 예시 · 실제 측정·계산·저장 없음<br/>영역 위치와 수량·단가는 설명용 예시이며 도면에서 추출한 값이 아닙니다.</p>
    {!ready ? <section className="rounded-xl border border-dashed p-6 text-center">
      <h3 className="font-semibold">도면을 먼저 열어 주세요</h3>
      <p className="mt-2 text-sm text-muted-foreground">PDF 또는 빈 도면·템플릿에서 연결 흐름을 확인할 수 있습니다.</p>
    </section> : <>
      <nav aria-label="물량·내역 단계" className="grid grid-cols-3 gap-2">
        {steps.map(([value, label]) => <button key={value} type="button" aria-current={step === value ? "step" : undefined} onClick={() => onStep(value)} className={`min-h-10 rounded-lg border text-sm font-medium ${step === value ? "border-violet-400 bg-violet-50 text-violet-800" : "hover:bg-muted"}`}>{label}</button>)}
      </nav>
      <div className="flex min-w-0 items-start gap-3 rounded-xl border bg-muted/30 p-4 text-sm">
        <LockKeyhole className="mt-1 size-4 shrink-0"/>
        <div className="min-w-0"><p className="break-words font-medium">{documentName}</p><p className="mt-1 text-xs text-muted-foreground">{sourceLabel} · {page}쪽 · 개정 미등록</p><p className="mt-1 text-xs text-violet-700">A01 영역 → Q01 물량 → B01 내역 · 연결 예시</p></div>
      </div>
      {reviewContext && <p className="rounded-lg border p-3 text-xs">도면 검토 연결: {`R${reviewContext.revision} · ${reviewContext.page}쪽 · ${reviewContext.targetName||"D01"}`} · 화면 예시. A01 물량·금액 승인은 별도입니다.</p>}
      {step === "area" ? <section className="grid gap-4">
        <h3 className="text-lg font-semibold">A01 영역 속성</h3>
        <label className="grid gap-2 text-sm">영역 이름<input maxLength={80} value={name} disabled={viewer} onChange={e => onName(e.currentTarget.value)} className="h-10 min-w-0 rounded-lg border px-3 disabled:bg-muted"/></label>
        <label className="grid gap-2 text-sm">공종<select value={trade} disabled={viewer} onChange={e => onTrade(e.currentTarget.value)} className="h-10 rounded-lg border px-3 disabled:bg-muted"><option>미분류</option><option>건축 마감</option><option>구조</option><option>기계 설비</option></select></label>
        <dl className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 p-4 text-sm"><dt>측정 기준</dt><dd>설정 전 · 미확정</dd><dt>영역 위치</dt><dd>{page}쪽 A01 · 예시</dd></dl>
        <p className="text-xs leading-5 text-muted-foreground">이 사각형은 연결 방식을 설명하는 표시입니다. 실제 건축 요소나 산출 경계로 사용하지 않습니다.</p>
        <Button onClick={() => onStep("quantity")}>물량 행 보기 <ArrowRight className="size-4"/></Button>
      </section> : <section className="grid min-w-0 gap-4">
        <div className="flex items-center justify-between gap-2"><h3 className="text-lg font-semibold">{step === "quantity" ? "물량표" : "내역·견적"}</h3><span className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-800">예시 · 미확정</span></div>
        <section aria-label="확정 전 확인 사항" className="grid gap-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <h4 className="font-semibold">확정 전 확인 사항</h4>
          {trade === "미분류" && <div className="grid gap-2"><p role="status" className="text-sm">공종 연결 필요 · Q01이 아직 공종에 분류되지 않았습니다.</p><Button variant="outline" onClick={() => onStep("area")}>{viewer ? "영역 속성의 공종 확인" : "영역 속성에서 공종 선택"}</Button></div>}
          <div className="grid gap-2"><p className="text-sm">축척·보정 근거 미등록 · A01 위치 표시는 있으나 측정 기준과 +0.50 m² 보정 사유가 확인되지 않았습니다.</p><Button variant="outline" onClick={onReturn}>근거 위치 확인</Button></div>
          {step === "estimate" && <p className="text-sm">단가 출처 미등록 · 10,000원/m²는 설명용 값이며 견적에 사용할 수 없습니다.</p>}
          <p className="text-xs text-muted-foreground">공종을 선택해도 실제 측정 근거가 채워지거나 물량·금액이 승인되는 것은 아닙니다.</p>
        </section>
        <div className="overflow-x-auto rounded-xl border" role="region" aria-label={step === "quantity" ? "물량표 가로 스크롤" : "내역표 가로 스크롤"} tabIndex={0}>
          <table className="w-full min-w-[530px] text-left text-sm">
            <caption className="sr-only">{step === "quantity" ? "A01에 연결된 예시 물량" : "Q01에 연결된 예시 내역"}</caption>
            <thead className="bg-muted/60"><tr>{(step === "quantity" ? ["항목 / 근거", "공종", "원수량", "보정", "최종수량"] : ["항목 / 물량", "수량", "예시 단가", "예시 금액"]).map(label => <th key={label} className="whitespace-nowrap p-3 font-medium">{label}</th>)}</tr></thead>
            <tbody><tr className="bg-violet-50/40"><td className="p-3"><button type="button" onClick={onReturn} className="max-w-48 break-words text-left font-semibold text-violet-800 underline underline-offset-4" aria-label={`${step === "quantity" ? "Q01" : "B01"} 행의 A01 도면 근거 보기`}>{name.trim() || "이름 없는 영역"}</button><p className="mt-1 text-xs text-muted-foreground">{step === "quantity" ? "Q01 · A01" : "B01 · Q01"}</p></td>{step === "quantity" ? <><td className="p-3">{trade}</td><td className="p-3">12.50 m²</td><td className="p-3">+0.50 m²</td><td className="p-3 font-semibold">13.00 m²</td></> : <><td className="p-3">13.00 m²</td><td className="p-3">10,000원/m²</td><td className="p-3 font-semibold">130,000원</td></>}</tr></tbody>
          </table>
        </div>
        {step === "quantity" ? <><p className="text-xs text-muted-foreground">고정 예시값입니다. 축척과 보정 근거를 검토하기 전에는 수량을 확정할 수 없습니다.</p><Button onClick={() => onStep("estimate")}>이 물량의 내역 행 보기 <ArrowRight className="size-4"/></Button></> : <>
          <div className="flex items-center justify-between rounded-xl border p-4"><span className="text-sm">예시 합계</span><strong>130,000원</strong></div>
          <p className="text-xs leading-5 text-muted-foreground">실제 견적이나 시세가 아닙니다. 도면 승인과 물량·금액 확정은 별도입니다. 이 화면에서는 승인·발주·파일 생성을 하지 않습니다.</p>
          <Button variant="outline" onClick={() => onStep("quantity")}><Link2 className="size-4"/> 연결된 Q01 물량 보기</Button>
          <Button type="button" onClick={() => setMaterialsOpen(true)}>자재·발주·입고 화면 보기 <ArrowRight className="size-4"/></Button>
        </>}
      </section>}
      {viewer && <p className="text-xs text-muted-foreground">보기 전용 · 속성 변경 없이 예시 연결을 확인합니다.</p>}
      {step !== "area" && <details className="rounded-xl border p-4">
        <summary className="cursor-pointer font-semibold">수량·금액 변경 비교</summary>
        <div className="mt-4 grid gap-3">
          <p className="text-xs text-amber-800">{reviewContext ? `실제 R${reviewContext.revision} 개정에서 산출한 비교가 아닙니다` : "실제 도면 개정에서 산출한 비교가 아닙니다"}. 기준·변경 예시는 화면 설명용이며 두 값 모두 미확정입니다.</p>
          <div className="overflow-x-auto" role="region" aria-label="수량 변경 비교표" tabIndex={0}>
            <table className="w-full min-w-[440px] text-left text-sm">
              <caption className="sr-only">Q01 물량과 B01 금액의 독립 비교 예시</caption>
              <thead><tr>{["항목", "기준 예시", "변경 예시", "차이"].map(label=><th key={label} className="border-b p-2">{label}</th>)}</tr></thead>
              <tbody>{[
                ["원수량", "12.00 m²", "12.50 m²", "+0.50 m²"],
                ["보정수량", "0.00 m²", "+0.50 m²", "+0.50 m²"],
                ["최종수량", "12.00 m²", "13.00 m²", "+1.00 m²"],
                ["단가", "10,000원/m²", "10,000원/m²", "변경 없음"],
                ["금액", "120,000원", "130,000원", "+10,000원"],
              ].map(([label,...values])=><tr key={label}><th className="border-b p-2 font-medium">{label}</th>{values.map((value,index)=><td key={index} className="border-b p-2 whitespace-nowrap">{value}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">변경 사유 예시: 영역 경계 조정 +0.50 m²와 별도 보정 +0.50 m². 현재 도면에서 확인된 변경이 아니며, 실제 비교에는 양쪽 개정의 산출 규칙·축척·보정 근거를 고정해야 합니다.</p>
          <Button variant="outline" onClick={onReturn}>변경 수량의 A01 근거 확인</Button>
        </div>
      </details>}
      <Button variant="outline" onClick={onReturn}><LocateFixed className="size-4"/> 도면의 A01 위치로 돌아가기</Button>
    </>}
  </div>;
}

function MaterialDraftExitGuard({ failed }: { failed: boolean }) {
  const blocker = useBlocker(failed);
  useEffect(() => { if (blocker.state === "blocked") blocker.reset(); }, [blocker]);
  useEffect(() => {
    if (!failed) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [failed]);
  return null;
}

export function DrawingTakeoffPreview(props: Props) {
  const [materialFailed, setMaterialFailed] = useState(false);
  const [selectedFailed,setSelectedFailed]=useState(false);
  const [showExample,setShowExample]=useState(false);
  const objectFlow=props.availableObjects!==undefined&&props.ready;
  const [step, setStep] = useState<TakeoffStep>("area");
  const [name, setName] = useState("검토 영역 A01");
  const [trade, setTrade] = useState("미분류");
  const opener = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const [visited, setVisited] = useState(props.open);
  useEffect(() => { props.onMaterialSaveFailure?.(materialFailed||selectedFailed); }, [materialFailed,selectedFailed, props.onMaterialSaveFailure]);
  useEffect(() => {
    if (!props.open) return;
    setShowExample(false);
    setVisited(true);
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    heading.current?.focus();
  }, [props.open]);
  const close = () => {
    if (materialFailed||selectedFailed) return;
    props.onOpenChange(false);
    if (opener.current?.isConnected) opener.current.focus();
  };
  return <section className="pdf-screen-right pdf-review-dock pdf-takeoff-dock" aria-label="물량·내역 작업 패널" style={props.open ? undefined : { display: "none" }}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
    {(props.materialDraftKey||props.selectedDraftKey) && <MaterialDraftExitGuard failed={materialFailed||selectedFailed}/>}
    <header className="pdf-takeoff-heading"><div><h2 ref={heading} tabIndex={-1}>물량·내역</h2><p>{showExample?"설명용 A01 예시":props.selectedObject?"선택 도형과 연결된 미산출 항목":objectFlow?"이 도면에 연결한 미산출 항목":"도면의 A01 근거와 연결된 작업"}</p></div><Button type="button" size="icon" variant="ghost" aria-label="물량·내역 패널 닫기" onClick={close}><X className="size-4"/></Button></header>
    <div className="p-4 min-w-0 grid gap-4">
      {!showExample&&props.selectedObject&&props.reviewEvidence}
      {materialFailed && <p role="status" className="text-sm text-amber-800">자재 초안 보관에 실패해 닫기와 화면 이동을 멈췄습니다. 입력을 유지한 채 보관을 다시 시도해 주세요.</p>}
      {props.previousSource&&<details className="rounded border border-amber-200 bg-amber-50/40 p-3 text-sm"><summary className="cursor-pointer font-medium">이전 원본의 물량 기록 보기</summary><section aria-label="이전 원본 물량 기록" className="mt-3 grid min-w-0 gap-3"><p className="break-words"><strong>{props.previousSource.documentName}</strong><br/>다른 원본을 열었습니다. 아래 기록은 이전 원본의 보관 자료이며 현재 도면에 연결하지 않습니다. 읽기 전용으로 확인할 수 있습니다.</p><DrawingSelectedTakeoff key={props.previousSource.draftKey} draftKey={props.previousSource.draftKey} objects={[]} missing={false} viewer onReturn={()=>{}}/></section></details>}
      {objectFlow&&showExample&&<Button variant="outline" disabled={materialFailed||selectedFailed} onClick={()=>{props.onExampleExit?.();setShowExample(false);}}>실제 연결 항목으로 돌아가기</Button>}
      {!showExample&&props.selectedObject&&props.onShowObjectList&&<Button variant="outline" disabled={materialFailed||selectedFailed} onClick={props.onShowObjectList}>전체 물량 목록</Button>}
      {visited&&(props.selectedObject||objectFlow)&&<div hidden={showExample}><DrawingSelectedTakeoff objects={props.availableObjects} onChooseObject={props.onChooseObject} key={props.selectedDraftKey??"temporary"} draftKey={props.selectedDraftKey} onSaveFailure={setSelectedFailed} object={props.selectedObject} missing={Boolean(props.selectedObjectMissing)} viewer={props.viewer} onReturn={()=>{if(materialFailed||selectedFailed||props.selectedObjectMissing||!props.selectedObject)return;props.onOpenChange(false);props.onReturnToObject?.(props.selectedObject.id);}}/></div>}
      {visited && (showExample||(!objectFlow&&!props.selectedObject)) && <TakeoffPreviewBody {...props} materialFailed={materialFailed} onMaterialSaveFailure={setMaterialFailed} step={step} name={name} trade={trade} onStep={setStep} onName={setName} onTrade={setTrade} onReturn={() => { if (materialFailed) return; props.onOpenChange(false); props.onReturnToAnchor(); }}/>}
      {objectFlow&&!showExample&&<Button variant="ghost" disabled={materialFailed||selectedFailed} onClick={()=>{props.onExampleOpen?.();setShowExample(true);}}>설명용 A01 예시 보기</Button>}
    </div>
  </section>;
}
