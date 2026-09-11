import type {ChangeRequestPreview} from "./drawing-change-request-preview";

/** Historical object review evidence, never a quantity or price approval. */
export function DrawingObjectReviewLinks({objectId,requests,onOpen}:{objectId:string;requests:ChangeRequestPreview[]|null;onOpen:(round:number)=>void}){
 const related=requests?.filter(request=>request.items.some(item=>item.id===objectId)).slice().reverse();
 return <section aria-label="물량 도형의 검토 기록" className="grid gap-2 rounded border p-3 text-sm">
  <h3 className="font-semibold">도형 검토 기록</h3>
  <p className="text-xs text-muted-foreground">도형에 대한 요청 당시 기록입니다. 수량·금액 승인이 아닙니다. 현재 도면과의 일치 여부는 요청 화면에서 확인하세요.</p>
  {related===undefined?<p>검토 기록을 아직 확인할 수 없습니다.</p>:!related.length?<p>이 도형이 포함된 검토 요청이 없습니다.</p>:<ul className="grid gap-2">{related.map(request=><li key={request.round} className="flex flex-wrap items-center justify-between gap-2">
   <span>요청 {request.round} · {request.approval?"요청 승인 확인 · 예시":request.decisions[objectId]?.kind==="checked"?"항목 확인":request.decisions[objectId]?.kind==="changes"?"수정 요청":"확인 대기"}</span>
   <button type="button" className="min-h-9 rounded border px-2" aria-label={`도형 검토 요청 ${request.round} 열기`} onClick={()=>onOpen(request.round)}>기록 보기</button>
  </li>)}</ul>}
 </section>;
}
