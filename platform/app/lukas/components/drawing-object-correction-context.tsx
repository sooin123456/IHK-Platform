import type {ChangeRequestPreview} from "./drawing-change-request-preview";
import {useEffect,useRef} from "react";

export function DrawingObjectCorrectionContext({objectId,requests,onOpen,availableIds,onEdit,layerLocked,onLayers}:{objectId:string;requests:ChangeRequestPreview[]|null;onOpen:(round:number)=>void;availableIds?:string[];onEdit?:(id:string)=>void;layerLocked?:boolean;onLayers?:()=>void}){
  const request=requests?.at(-1);
  const decision=request?.decisions[objectId];
  const heading=useRef<HTMLHeadingElement>(null);
  const active=!!request&&!request.approval&&decision?.kind==="changes"&&request.items.some(item=>item.id===objectId);
  useEffect(()=>{
    if(!active)return;
    heading.current?.focus({preventScroll:true});
    heading.current?.closest("section")?.scrollIntoView({block:"start",behavior:"instant"});
    const panel=heading.current?.closest(".pdf-screen-right");
    const tabs=panel?.querySelector(".pdf-panel-tabs");
    panel?.scrollBy({top:-(tabs?.getBoundingClientRect().height??0)-8,behavior:"instant"});
  },[active,objectId,request?.round]);
  if(!active||!request||!decision)return null;
  const corrections=request.items.filter(item=>request.decisions[item.id]?.kind==="changes"&&!item.sample);
  const targets=corrections.filter(item=>availableIds?.includes(item.id));
  const index=targets.findIndex(item=>item.id===objectId);
  const missing=availableIds?corrections.length-targets.length:0;
  const step=(direction:-1|1)=>{const target=targets[index+direction];if(index>=0&&target)onEdit?.(target.id);};
  return <section className="pdf-correction-context" aria-label="선택 도형의 수정 요청">
    <div className="pdf-correction-heading"><h3 ref={heading} tabIndex={-1}>요청 {request.round} · 수정 의견</h3><button type="button" onClick={()=>onOpen(request.round)}>요청 {request.round}로 돌아가기</button></div>
    <p tabIndex={0} aria-label="수정 의견 전문">{decision.note}</p>
    {targets.length>1&&index>=0&&<nav className="pdf-correction-navigation" aria-label="수정 대상 순회">
      <small aria-live="polite">수정 대상 {index+1} / {targets.length} · 완료 표시 아님</small>
      <div className="flex gap-2"><button type="button" className="change-secondary" disabled={!onEdit||index===0} onClick={()=>step(-1)}>이전 수정 대상</button><button type="button" className="change-secondary" disabled={!onEdit||index===targets.length-1} onClick={()=>step(1)}>다음 수정 대상</button></div>
    </nav>}
    {missing>0&&<small>현재 없는 수정 대상 {missing}개는 요청 기록에서 확인하세요.</small>}
    {layerLocked?<small role="status">레이어가 잠겨 있어 편집할 수 없습니다. {onLayers&&<button type="button" className="underline" onClick={onLayers}>레이어 관리 열기</button>}</small>:<small>수정 후 새 검토 요청을 구성하세요. 이전 기록은 유지됩니다.</small>}
  </section>;
}
