import {useState} from "react";
import {Button} from "~/core/components/ui/button";
import {DrawingReviewMarker,parseReviewLoopSession,type ReviewLoopState} from "./drawing-review-loop";
import {ProjectResourceReader} from "./project-resource-reader";
import {DrawingScreenObjectPreview} from "./drawing-screen-object-preview";
import "./drawing-review-loop.css";

export type SharedDrawingView={kind:"pdf"|"office"|"house"|"blank";paper:"A2"|"A3"|"A4";review:ReviewLoopState;fingerprint?:string};

export function freezeSharedDrawingView(value:SharedDrawingView,revision:number,page:number):SharedDrawingView {
  if(!value||!["pdf","office","house","blank"].includes(value.kind)||!["A2","A3","A4"].includes(value.paper)||value.fingerprint!==undefined&&(typeof value.fingerprint!=="string"||!/^[a-f0-9]{64}$/.test(value.fingerprint)))throw Error("공유 도면의 원본 식별 정보를 확인해 주세요.");
  const state=parseReviewLoopSession(JSON.stringify({...value.review,history:[]}));
  if(!state||state.revision!==revision||state.page!==page||value.kind!=="pdf"&&page!==1)throw Error("공유 도면과 검토 대상 개정·페이지가 일치하지 않습니다.");
  const {phase,position,before,issue,message}=state;
  return {kind:value.kind,paper:value.paper,...(value.kind==="pdf"&&value.fingerprint?{fingerprint:value.fingerprint}:{}),review:{revision,page,phase,position,before,issue,message,...(state.target?{target:{...state.target}}:{}),...(state.beforeTarget?{beforeTarget:{...state.beforeTarget}}:{}),role:"author",focused:false,compared:false,history:[]}};
}

export function SharedDrawingPreview({view,title}:{view:SharedDrawingView;title:string}) {
  const [compared,setCompared]=useState(false);
  const [focused,setFocused]=useState(false);
  const state={...view.review,compared,focused};
  const overlay=state.target?<DrawingScreenObjectPreview objects={[state.target]} selected={focused?state.target.id:null} tool="" onCreate={()=>{}} onSelect={()=>setFocused(true)}/>:<DrawingReviewMarker state={state} onLocate={()=>setFocused(true)}/>;
  return <section className="grid min-w-0 gap-3" aria-label="공유된 도면 읽기 전용">
    <p className="text-sm">R{state.revision} · {state.page}쪽 · 공유 당시 검토 오버레이 · 읽기 전용</p>
    <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={()=>setFocused(true)}>공유된 변경 위치 강조</Button><Button variant="outline" aria-pressed={compared} onClick={()=>setCompared(value=>!value)}>검토 오버레이 변경 전후</Button></div>
    {state.target?<p className="text-xs">{compared&&state.beforeTarget?`${state.beforeTarget.name} (${state.beforeTarget.color}) → `:""}{state.target.name} ({state.target.color}) · 공유 시 고정한 화면 도형 1개 · 원본 CAD 객체가 아닙니다.</p>:<p className="text-xs">D01 위치 {state.before+1} → 위치 {state.position+1} · 예시 도형이며 원본 CAD 객체 변경이 아닙니다.</p>}
    {view.kind==="pdf"?view.fingerprint?<ProjectResourceReader fixed={{fingerprint:view.fingerprint,page:state.page,overlay}}/>:<p role="status">공유 당시 PDF 식별 정보가 없습니다. 작성자가 원본을 확인한 뒤 새 공유 구성을 만들어야 도면을 열 수 있습니다. 임의의 PDF로 대신 열지 않습니다.</p>:<>
      <div className="relative overflow-hidden rounded border bg-white" style={{aspectRatio:"1.414"}}>
        {view.kind==="blank"?<p className="p-6 text-sm text-muted-foreground">빈 도면 · {view.paper}</p>:<img className="h-full w-full object-contain" src={`/images/workspace-start/${view.kind}-plan.png`} alt={`${title} · ${view.kind==="office"?"사무실":"주택"} 템플릿 이미지 예시`}/>}
        {overlay}
      </div><p className="text-xs text-muted-foreground">템플릿 배경과 공유 당시 예시 검토 상태입니다. 실제 업로드 도면이나 CAD 편집 결과가 아닙니다.</p>
    </>}
  </section>;
}
