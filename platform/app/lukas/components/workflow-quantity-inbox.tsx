import {useState} from 'react';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {quantityReviewMatches} from '../lib/workflow-quantity-review';
const labels={requested:'검산 대기',changes:'수량 보완 요청',reviewed:'금액 승인 대기',approved:'금액 승인 완료'};
export function WorkflowQuantityInbox({documents,mode,onOpen}:{documents:WorkflowBlankDocument[];mode:'tasks'|'reviews';onOpen:(id:string)=>void}) {
 const [query,setQuery]=useState('');
 const entries=documents.flatMap(document=>{
  const round=document.quantityReviews?.at(-1);
  return round&&(mode==='reviews'||round.phase!=='approved')?[{document,round}]:[];
 });
 const visible=entries.filter(({document,round})=>`${document.title} ${round.source.name} ${round.requestNote}`.toLowerCase().includes(query.trim().toLowerCase()));
 return <section className="flow-card" aria-label="내 수량 검산 목록">
  <h2>수량 검산·금액 승인 {mode==='tasks'?'대기':'기록'}</h2>
  <p>도면 검토와 별개인 최근 수량 요청입니다. 담당자 배정·알림·금액 승인은 로컬 체험이며 실제 업무 효력은 없습니다.</p>
  <label className="flow-input">검산 요청 검색<input aria-label="검산 요청 검색" value={query} onChange={event=>setQuery(event.target.value)} placeholder="도면·원본·요청 내용"/></label>
  {!entries.length?<p>표시할 수량 검산 요청이 없습니다.</p>:!visible.length?<p>검색 조건에 맞는 요청이 없습니다. <button onClick={()=>setQuery('')}>검산 검색 초기화</button></p>:visible.map(({document,round})=><article className="flow-card" key={document.id}>
    <h3>{document.title} · 검산 #{round.sequence}</h3>
    <p>{labels[round.phase]} · R{round.revision} · {round.source.name}</p>
    <p>{round.requestNote}</p>
    <p>요청 당시 {round.items.length}개 항목 · {round.items.reduce((sum,item)=>sum+Math.round((item.quantity.raw+item.quantity.correction)*item.quantity.rate),0).toLocaleString('ko-KR')}원</p>
    {!quantityReviewMatches(document,round)&&<p role="status">요청 후 근거 변경 · 이전 요청은 보존되며 현재 값의 재검산이 필요합니다.</p>}
    <p>다음 확인: {round.phase==='requested'?'검토자':round.phase==='reviewed'?'승인자':round.phase==='changes'?'작성자':'승인 기록 열람'} · 검산 화면에서 체험 역할을 선택하세요.</p>
    <button onClick={()=>onOpen(document.id)}>검산 대상 열기</button>
   </article>)}
 </section>;
}
