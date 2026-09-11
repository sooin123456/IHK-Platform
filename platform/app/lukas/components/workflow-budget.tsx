import {useState} from 'react';import {useSearchParams} from 'react-router';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {readBudgetPlan,budgetComparison} from '../lib/workflow-budget';
const won=(amount:number)=>amount.toLocaleString('ko-KR');
export function WorkflowBudget({documents,drafts,onDraft,onOpen,onStart}:{documents:WorkflowBlankDocument[];drafts:Record<string,string>;onDraft:(patch:Record<string,string>)=>void;onOpen:(id:string,sequence:number)=>void;onStart:()=>void}){
 const [params,setParams]=useSearchParams(),[error,setError]=useState('');
 const document=documents.find(doc=>doc.id===(params.get('budgetDocument')??documents[0]?.id));
 const key=`budget:${document?.id??'none'}`,plan=readBudgetPlan(drafts[key]);
 const rounds=document?.quantityReviews?.filter(round=>round.phase==='approved')??[];
 const sequence=Number(params.get('budgetSequence')??plan?.sequence??rounds.at(-1)?.sequence);
 const round=rounds.find(round=>round.sequence===sequence);
 const input=(name:string,fallback:string)=>drafts[`${key}:input:${name}`]??fallback;
 const edit=(name:string,value:string)=>onDraft({[`${key}:input:${name}`]:value});
 const result=document&&plan&&plan.sequence===sequence?budgetComparison(document,plan):null;
 return <section aria-label="예산·승인금액 비교"><header className="flow-card"><h2>예산·승인금액 비교</h2><p>같은 도면의 승인 검산 회차를 선택해 예산 가정과 비교합니다. 전체 공사비·계약 체결·실제 지출·이익률이 아니며 부가세와 제경비는 포함하지 않습니다. 도면별 범위와 예산 포함 항목을 맞춰 검토하세요.</p>
  <label className="flow-input">예산 대상 도면<select aria-label="예산 대상 도면" value={document?.id??''} onChange={event=>{setParams({page:'budget',budgetDocument:event.target.value});setError('');}}>{!document&&<option value="">도면을 선택하세요</option>}{documents.map(doc=><option value={doc.id} key={doc.id}>{doc.title}</option>)}</select></label>
 </header>
 {!document?<div className="flow-card"><p>선택한 로컬 도면이 없습니다. 예시 금액으로 대체하지 않습니다.</p><button onClick={onStart}>도면 준비하기</button></div>:<>
  <section className="flow-card"><label className="flow-input">비교할 승인 검산<select aria-label="비교할 승인 검산" value={round?String(sequence):''} onChange={event=>{setParams({page:'budget',budgetDocument:document.id,budgetSequence:event.target.value});setError('');}}>{!round&&<option value="">승인 검산을 선택하세요</option>}{rounds.map(round=><option key={round.sequence} value={round.sequence}>검산 #{round.sequence} · R{round.revision} · {round.source.name}</option>)}</select></label><p>미승인 검산과 현재 편집 중인 금액은 제외합니다. 저장된 예산 기준이 있으면 그 회차를 유지합니다.</p>
   {!round?<p>선택한 승인 검산을 찾을 수 없습니다. 다른 개정으로 대체하지 않습니다. 수량 검토에서 승인을 완료하거나 위 목록에서 승인본을 선택하세요.</p>:<>
    <p>검산 #{round.sequence} · 승인 R{round.revision} · {round.items.length}개 산출 항목 · 미등록 객체 {round.excludedCount}개 제외</p>
    <details><summary>승인 당시 금액·검토 근거</summary><p>검산 의견: {round.reviewNote??'기록 없음'} · 승인 의견: {round.approvalNote??'기록 없음'}</p><ul>{round.items.map(item=><li key={item.id}>{item.page}쪽 · {item.label} · {item.quantity.raw+item.quantity.correction}{item.quantity.unit} × {won(item.quantity.rate)}원 = {won(Math.round((item.quantity.raw+item.quantity.correction)*item.quantity.rate))}원</li>)}</ul></details>
    <button onClick={()=>onOpen(document.id,sequence)}>수량 검산 근거 보기</button>
   </>}
  </section>
  {drafts[key]&&!plan&&<p role="alert">저장된 예산 기준을 읽을 수 없습니다. 기존 값으로 계산하지 않으며 다시 입력해 보관할 수 있습니다.</p>}
  {plan&&plan.sequence!==sequence&&<p>보관한 예산은 검산 #{plan.sequence} 기준입니다. 다른 승인본과 자동 비교하지 않습니다.</p>}
  {round&&<section className="flow-card" aria-label="예산 기준 입력"><h3>예산 기준</h3>
   <label className="flow-input">예산 한도 원<input type="number" min="0" step="1" aria-label="예산 한도 원" value={input('budget',plan?String(plan.budget):'')} onChange={event=>edit('budget',event.target.value)}/></label>
   <label className="flow-input">예비비 원<input type="number" min="0" step="1" aria-label="예비비 원" value={input('reserve',String(plan?.reserve??0))} onChange={event=>edit('reserve',event.target.value)}/></label>
   <label className="flow-input">예산 검토 근거<textarea maxLength={200} aria-label="예산 검토 근거" value={input('note',plan?.note??'')} onChange={event=>edit('note',event.target.value)}/></label>
   <p>예비비는 예산 한도에 포함된 금액입니다. 입력만으로는 아래 보관 결과를 변경하지 않습니다.</p>
   <button onClick={()=>{const budget=input('budget',plan?String(plan.budget):''),reserve=input('reserve',String(plan?.reserve??0));const next=budget.trim()&&reserve.trim()?readBudgetPlan(JSON.stringify({sequence,budget:Number(budget),reserve:Number(reserve),note:input('note',plan?.note??'')})):null;if(!next){setError('예산과 예비비는 0~1조 원의 정수로 입력하세요. 예비비는 예산 이하여야 하고 검토 근거가 필요합니다.');return;}onDraft({[key]:JSON.stringify(next)});setError('');}}>선택 승인본에 예산 기준 보관</button>
   {error&&<p role="alert">{error}</p>}
  </section>}
  {result&&plan&&<section className="flow-card" aria-label="보관한 예산 비교 결과"><h3>보관 결과 · 검산 #{plan.sequence}</h3><p>예산 한도 {won(plan.budget)}원 · 예비비 {won(plan.reserve)}원</p><p>비교 가능 예산 {won(result.available)}원</p><p>승인 금액 {won(result.amount)}원</p><p><strong>{result.balance>=0?'잔여':'초과'} {won(Math.abs(result.balance))}원</strong></p><p>{plan.note}</p><p>잔여는 이익이나 현금 잔액이 아닙니다. 객체별 원 단위 반올림 금액을 합산한 화면 비교입니다.</p></section>}
  {plan&&plan.sequence===sequence&&!result&&<p role="alert">보관 기준의 승인 근거 또는 안전한 계산 범위를 확인할 수 없습니다. 금액 비교를 표시하지 않습니다.</p>}
 </>}
 </section>;
}
