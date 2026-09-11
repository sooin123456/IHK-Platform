import {useState,useRef,useEffect} from 'react';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {compareDocumentQuantities} from '../lib/workflow-quantity-comparison';
import {deliveryQuantityReview} from '../lib/workflow-document-delivery';
export type QuantityComparisonOpen = (documentId:string, objectId:string, page:number, snapshot?:number, comparisonSequence?:number, comparisonTarget?:string)=>void;
const money=(value:number)=>`${value.toLocaleString('ko-KR')}원`;
const signed=(value:number)=>`${value>0?'+':''}${money(value)}`;
export function WorkflowQuantityComparison({document,onOpen,comparisonSequence,comparisonTarget,onSelect}:{document:WorkflowBlankDocument;onOpen?:QuantityComparisonOpen;comparisonSequence?:string;comparisonTarget?:string;onSelect?:(documentId:string,sequence:number,target?:string)=>void}) {
 const approved=(document.quantityReviews??[]).filter(round=>round.phase==='approved');
 const [sequence,setSequence]=useState<number|null>(null);
 const selected=comparisonSequence!==undefined?Number(comparisonSequence):sequence??approved.at(-1)?.sequence;
 const [localTarget,setLocalTarget]=useState('current');
 const targetValue=comparisonTarget??localTarget;
 const selectionRef=useRef({selected,targetValue});
 useEffect(()=>{selectionRef.current={selected,targetValue};},[selected,targetValue]);
 const result=selected?compareDocumentQuantities(document,selected,targetValue==='current'?undefined:Number(targetValue)):null;
 const targetLabel=result?.target?`승인 #${result.target.sequence}`:'현재';
 const priorDrawing=result&&deliveryQuantityReview(document,result.approved.revision,result.approved.sequence)?document.reviewRounds?.find(round=>round.revision===result.approved.revision&&round.phase==='approved'):undefined;
 const targetDrawing=result?.target&&deliveryQuantityReview(document,result.target.revision,result.target.sequence)?document.reviewRounds?.find(round=>round.revision===result.target!.revision&&round.phase==='approved'):undefined;
 return <section className="flow-card" aria-label="승인 수량과 현재 비교">
  <h3>승인 수량과 현재 비교</h3>
  {!approved.length?<p>비교할 수량 승인 기록이 없습니다. 도면 승인과 수량 승인은 별개입니다.</p>:<>
   <label className="flow-input">비교 기준 검산<select aria-label="비교 기준 검산" value={approved.some(round=>round.sequence===selected)?selected:''} onChange={event=>{const value=Number(event.target.value);selectionRef.current.selected=value;setSequence(value);onSelect?.(document.id,value,selectionRef.current.targetValue);}}>{!approved.some(round=>round.sequence===selected)&&<option value="" disabled>선택한 승인 기록 없음</option>}{approved.map(round=><option key={round.sequence} value={round.sequence}>검산 #{round.sequence} · R{round.revision}</option>)}</select></label>
   <label className="flow-input">비교 대상 검산<select aria-label="비교 대상 검산" value={targetValue} onChange={event=>{selectionRef.current.targetValue=event.target.value;setLocalTarget(event.target.value);if(selectionRef.current.selected)onSelect?.(document.id,selectionRef.current.selected,event.target.value);}}><option value="current">현재 작업</option>{targetValue!=='current'&&!approved.some(round=>String(round.sequence)===targetValue)&&<option value={targetValue} disabled>선택한 대상 기록 없음</option>}{approved.map(round=><option key={round.sequence} value={round.sequence}>승인 #{round.sequence} · R{round.revision}</option>)}</select></label>
   {result?<>
    <p>기준 #{result.approved.sequence} · R{result.approved.revision} → {targetLabel} R{result.target?.revision??document.revision??1} · 승인 기록은 변경하지 않습니다.</p>
    <p>승인 당시 {money(result.beforeTotal)} · {targetLabel} {result.afterTotal===null?'비교 보류':money(result.afterTotal)} · 증감 {result.delta===null?'계산 보류':signed(result.delta)}</p>
    <p>등록 수량만 비교한 미확정 금액입니다. 수량 미등록 객체·부가세·제경비는 포함하지 않습니다.</p>
    {!result.compatible&&<p role="alert">원본이 달라 직접 비교할 수 없습니다. 원본 연결과 개정 대응을 확인하세요.</p>}
    {result.rows.some(row=>row.stale)&&<p role="status">오래된 수량 근거가 있어 전체 증감 계산을 보류했습니다.</p>}
    <details><summary>항목별 변경 근거 · {result.rows.filter(row=>row.kind!=='same').length}건 변경</summary>
     <ul>{result.rows.map(row=>{const current=(result.target?targetDrawing?.objects:document.shapes)?.find(shape=>shape.id===row.id);const prior=priorDrawing?.objects.find(shape=>shape.id===row.id);return <li key={row.id}>
      <strong>{{added:'추가',removed:'삭제·수량 연결 해제',changed:'변경',same:'동일'}[row.kind]} · {row.label}</strong>
      <p>객체 {row.id} · {row.page}쪽</p>
      <p>이전 {row.before?`${row.before.raw+row.before.correction}${row.before.unit} × ${money(row.before.rate)}`:'미등록'} → {targetLabel} {row.after?`${row.after.raw+row.after.correction}${row.after.unit} × ${money(row.after.rate)}`:'미등록'}</p>
      <p>금액 증감 {row.delta===null?'보류':signed(row.delta)}{row.unitChanged?' · 단위 변경: 수량끼리 직접 차감하지 않습니다.':''}{row.stale?' · 근거 재확인 필요':''}</p>
      {current?<button disabled={!onOpen} onClick={()=>onOpen?.(document.id,current.id,current.page??1,result.target?targetDrawing!.revision:undefined,selected,targetValue)}>{result.target?'대상 승인 도면 근거 열기':'현재 도면 근거 열기'}</button>:<p>{result.target?'일치하는 대상 승인 도면 없음':'현재 객체 없음'} · 다른 객체로 대체하지 않습니다.</p>}
      {prior&&row.before?<button disabled={!onOpen} onClick={()=>onOpen?.(document.id,prior.id,prior.page??1,priorDrawing!.revision,selected,targetValue)}>이전 승인 도면 근거 열기</button>:row.before?<p>검산 결과와 일치하는 승인 도면 기록이 없어 이전 위치를 열 수 없습니다.</p>:null}
     </li>})}</ul>
    </details>
   </>:<p>선택한 승인 기록을 찾을 수 없습니다.</p>}
  </>}
 </section>;
}
