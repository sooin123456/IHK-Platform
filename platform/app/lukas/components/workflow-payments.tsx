import {useEffect,useRef,useState} from 'react';
import {useSearchParams} from 'react-router';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {saveContract,submitPayment,decidePayment,confirmedPayments,paymentEvidenceMatches,quantityAmount,type PaymentClaim} from '../lib/workflow-payments';
const money=(amount:number)=>amount.toLocaleString('ko-KR')+'원';
export function WorkflowPayments({documents,drafts,onDraft,onChange,onEvidence}:{documents:WorkflowBlankDocument[];drafts:Record<string,string>;onDraft:(patch:Record<string,string>)=>void;onChange:(doc:WorkflowBlankDocument)=>void;onEvidence:(id:string,item:PaymentClaim,kind:'quantity'|'daily')=>void}){
 const [params,setParams]=useSearchParams(),[error,setError]=useState('');
 const pending=useRef(params.toString());useEffect(()=>{pending.current=params.toString();},[params]);
 const change=(name:string,value:string)=>{const next=new URLSearchParams(pending.current);next.set(name,value);pending.current=next.toString();setParams(next,{replace:true});setError('');};
 const doc=documents.find(doc=>doc.id===(params.get('paymentDocument')??documents[0]?.id)),role=params.get('paymentRole')??'author';
 const key=`payment:${doc?.id??'none'}:`,value=(field:string,fallback='')=>drafts[key+field]??fallback,edit=(field:string,text:string)=>onDraft({[key+field]:text});
 const rounds=doc?.quantityReviews?.filter(row=>row.phase==='approved')??[];
 const round=rounds.find(row=>String(row.sequence)===value('quantity',String(rounds.at(-1)?.sequence??'')));
 const reports=round?doc?.dailyReports?.filter(row=>paymentEvidenceMatches(round,row))??[]:[];
 const report=reports.find(row=>String(row.id)===value('daily',String(reports.at(-1)?.id??'')));
 const claims=doc?.paymentClaims??[],confirmed=doc?confirmedPayments(doc):0,previous=value('previous')?Number(value('previous')):undefined;
 return <section aria-label="계약·기성 검토">
  <header className="flow-card"><h2>계약·기성 검토</h2><p>이 도면 범위의 계약 기준과 기성 요청액을 검토하는 로컬 체험입니다. 실제 계약 체결·기성 인증·세금계산서·청구·지급이 아닙니다. 세금·유보금·선급금·복수 계약은 포함하지 않습니다.</p>
   <label className="flow-input">계약 대상 도면<select aria-label="계약 대상 도면" value={doc?.id??''} onChange={event=>change('paymentDocument',event.target.value)}>{!doc&&<option value="">도면 선택</option>}{documents.map(row=><option key={row.id} value={row.id}>{row.title}</option>)}</select></label>
   <label className="flow-input">기성 처리 역할<select aria-label="기성 처리 역할" value={role} onChange={event=>change('paymentRole',event.target.value)}><option value="author">요청자 체험</option><option value="reviewer">검토자 체험</option><option value="viewer">열람 체험</option></select></label>
  </header>
  {!doc?<p>선택한 로컬 도면이 없습니다. 도면·수량 검산·현장 점검·일일 보고를 먼저 준비하세요.</p>:<>
   {doc.contract&&<section className="flow-card" aria-label="계약 기준 요약"><h3>현재 계약 V{doc.contract.version} · {doc.contract.name}</h3><p>{doc.contract.partner} · 계약 한도 {money(doc.contract.amount)}</p><p>누적 확인액 {money(confirmed)} · 계약 잔여 {money(doc.contract.amount-confirmed)}</p><p>확인액은 이 화면의 검토 기록이며 지급 완료 금액이 아닙니다.</p></section>}
   {role==='author'&&<>
    <section className="flow-card" aria-label="계약 기준 작성"><h3>계약 기준 {doc.contract?'변경':'등록'}</h3>
     <label className="flow-input">계약명<input aria-label="계약명" maxLength={120} value={value('name',doc.contract?.name)} onChange={event=>edit('name',event.target.value)}/></label>
     <label className="flow-input">계약 상대방<input aria-label="계약 상대방" maxLength={120} value={value('partner',doc.contract?.partner)} onChange={event=>edit('partner',event.target.value)}/></label>
     <label className="flow-input">계약 한도 원<input type="number" min={1} step={1} aria-label="계약 한도 원" value={value('contractAmount',String(doc.contract?.amount??''))} onChange={event=>edit('contractAmount',event.target.value)}/></label>
     <button onClick={()=>{const updated=saveContract(doc,role,{name:value('name',doc.contract?.name),partner:value('partner',doc.contract?.partner),amount:Number(value('contractAmount',String(doc.contract?.amount??'')))});if(updated===doc){setError('계약명·상대방·양의 정수 한도를 확인하세요. 누적 확인액보다 낮출 수 없습니다.');return;}onChange(updated);setError('');}}>계약 기준 보관</button><p>변경하면 새 버전이 됩니다. 이전 요청의 계약 기준은 보존되며, 미처리 요청은 보완 후 다시 제출해야 합니다.</p>
    </section>
    <section className="flow-card" aria-label="기성 요청 작성"><h3>{previous?`요청 #${previous} 보완 작성`:'새 기성 요청'}</h3>
     <label className="flow-input">승인 수량 근거<select aria-label="기성 승인 수량 근거" value={round?.sequence??''} onChange={event=>onDraft({[key+'quantity']:event.target.value,[key+'daily']:''})}>{!round&&<option value="">승인 검산 선택</option>}{rounds.map(row=><option key={row.sequence} value={row.sequence}>검산 #{row.sequence} · R{row.revision}</option>)}</select></label>
     <label className="flow-input">확인된 일일 보고<select aria-label="기성 일일 보고" value={report?.id??''} onChange={event=>edit('daily',event.target.value)}>{!report&&<option value="">보고 선택</option>}{reports.map(row=><option key={row.id} value={row.id}>보고 #{row.id} · {row.date} · {row.evidence.location}</option>)}</select></label>
     {!reports.length&&<p>동일 원본·개정·객체의 점검 종결 근거가 포함된 확인 보고가 필요합니다. 일일 작업 보고에서 준비하세요.</p>}
     {round&&<p>승인 내역 {money(quantityAmount(round))} · 이 체험의 추가 요청 가능액 {money(Math.max(0,Math.min(doc.contract?.amount??0,quantityAmount(round))-confirmed))}</p>}
     <label className="flow-input">요청 기간<input type="month" aria-label="요청 기간" value={value('period')} onChange={event=>edit('period',event.target.value)}/></label>
     <label className="flow-input">이번 요청액 원<input type="number" min={1} step={1} aria-label="이번 요청액 원" value={value('amount')} onChange={event=>edit('amount',event.target.value)}/></label>
     <label className="flow-input">요청 근거 설명<textarea aria-label="요청 근거 설명" maxLength={500} value={value('note')} onChange={event=>edit('note',event.target.value)}/></label>
     <p>요청액은 직접 입력하는 검토값입니다. 보고 진행률·작업 인원에서 자동 계산하지 않습니다. 도면 범위의 계약 한도와 선택 승인 내역에서 누적 확인액을 뺀 범위를 넘을 수 없습니다.</p>
     <button disabled={!doc.contract||!round||!report||claims.some(item=>item.phase==='submitted')||claims.length>=30} onClick={()=>{const updated=submitPayment(doc,role,{period:value('period'),amount:Number(value('amount')),note:value('note'),quantitySequence:round?.sequence,dailyId:report?.id},previous);if(updated===doc){setError('기간·요청액·설명과 근거를 확인하세요. 계약·승인 내역의 잔여 한도를 초과할 수 없습니다.');return;}onChange(updated);onDraft({[key+'previous']:'',[key+'note']:'',[key+'amount']:''});setError('');}}>{previous?'보완 기성 검토 요청':'기성 검토 요청'}</button>{previous&&<button onClick={()=>edit('previous','')}>보완 연결 해제</button>}
     {claims.some(item=>item.phase==='submitted')&&<p>처리 중인 요청이 있습니다. 확인 또는 보완 결정 후 다음 요청을 작성하세요.</p>}{claims.length>=30&&<p>도면당 30건 한도입니다. 기존 요청을 덮어쓰지 않습니다.</p>}
    </section>
   </>}
   {error&&<p role="alert">{error}</p>}
   <section aria-label="기성 요청 이력"><h3>기성 요청 이력 · {claims.length}건</h3>{!claims.length&&<p>아직 기성 검토 요청이 없습니다.</p>}
    {[...claims].reverse().map(item=>{const next=claims.find(row=>row.previous===item.id),changed=doc.contract?.version!==item.contract.version;return <article className="flow-card" key={item.id}>
     <h3>#{item.id} · {item.period}</h3><p><strong>{{submitted:'검토 대기',changes:'보완 요청',accepted:'검토 확인'}[item.phase]}</strong> · 요청액 {money(item.amount)}</p><p>{item.note}</p><p>당시 계약 V{item.contract.version} · {item.contract.name} · {item.contract.partner}</p><p>당시 이전 확인액 {money(item.previousConfirmed)} · 이번 요청액 {money(item.amount)}</p>
     {item.previous&&<p>요청 #{item.previous}의 보완 제출</p>}{next&&<p>요청 #{next.id}로 보완됨</p>}{item.decision&&<p>검토 의견: {item.decision}</p>}
     <details><summary>요청 당시 근거</summary><p>승인 검산 #{item.quantitySequence} · R{item.quantity.revision} · {money(quantityAmount(item.quantity))}</p><p>보고 #{item.dailyId} · {item.report.date} · {item.report.evidence.location}</p><p>{item.report.work} · {item.report.decision}</p><p>점검 종결 근거 포함 · 진행률 {item.report.progress}%는 금액 산식이 아닙니다.</p></details>
     <div className="flow-actions"><button aria-label={`요청 #${item.id} 수량 근거`} onClick={()=>onEvidence(doc.id,item,'quantity')}>수량 근거</button><button aria-label={`요청 #${item.id} 일일 보고`} onClick={()=>onEvidence(doc.id,item,'daily')}>일일 보고</button></div>
     {changed&&item.phase==='submitted'&&<p role="status">계약 기준이 변경됐습니다. 이 요청은 보완 결정 후 현재 계약으로 재제출하세요.</p>}
     {role==='reviewer'&&item.phase==='submitted'&&<><label className="flow-input">검토 의견<textarea aria-label={`요청 #${item.id} 검토 의견`} maxLength={500} value={value(`decision:${item.id}`)} onChange={event=>edit(`decision:${item.id}`,event.target.value)}/></label><div className="flow-actions">{(['changes','accepted'] as const).map(phase=><button key={phase} disabled={phase==='accepted'&&changed} aria-label={`요청 #${item.id} ${phase==='changes'?'보완 요청':'확인'}`} onClick={()=>{const updated=decidePayment(doc,item.id,role,phase,value(`decision:${item.id}`));if(updated===doc){setError('검토 의견과 계약 기준을 확인하세요.');return;}onChange(updated);edit(`decision:${item.id}`,'');setError('');}}>{phase==='changes'?'보완 요청':'검토 확인'}</button>)}</div></>}
     {role==='author'&&item.phase==='changes'&&!next&&<button aria-label={`요청 #${item.id} 보완 작성`} onClick={()=>{onDraft(Object.fromEntries(Object.entries({previous:item.id,quantity:item.quantitySequence,daily:item.dailyId,period:item.period,amount:item.amount,note:item.note}).map(([name,value])=>[key+name,String(value)])));setError('');}}>보완 작성</button>}
    </article>;})}
   </section>
  </>}
 </section>;
}
