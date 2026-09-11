import {WorkflowDistributionManifest} from './workflow-distribution-manifest';
import {useEffect,useRef} from 'react';
import {useSearchParams} from 'react-router';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {transmittalRows,filterTransmittals} from '../lib/workflow-transmittals';
export function WorkflowTransmittals({documents,loading,onPrepare,onRecipient}:{documents:WorkflowBlankDocument[];loading:boolean;onPrepare:()=>void;onRecipient:(id:string,sequence:number)=>void}){
 const [params,setParams]=useSearchParams(),query=params.get('transmittalSearch')??'',status=params.get('transmittalStatus')??'all';
 const pending=useRef(params.toString());useEffect(()=>{pending.current=params.toString();},[params]);
 const change=(values:Record<string,string>)=>{const next=new URLSearchParams(pending.current);for(const [key,value]of Object.entries(values)){if(value)next.set(key,value);else next.delete(key);}pending.current=next.toString();setParams(next,{replace:true});};
 const rows=transmittalRows(documents),visible=filterTransmittals(rows,query,status);
 const batches=[...new Set(rows.map(row=>row.delivery.batchId).filter((id):id is string=>Boolean(id)))].map(id=>({id,items:rows.filter(row=>row.delivery.batchId===id)}));
 return <section aria-label="배포·수신 대장">
  <header className="flow-card"><h2>배포·수신 대장</h2><p>이 탭에서 준비한 도면별 납품 구성과 수신 의견을 모아 봅니다. 준비 상태는 실제 발송을 의미하지 않으며, 수신 확인은 로컬 체험 기록입니다.</p><button onClick={onPrepare}>납품 구성 준비로</button></header>
  {Boolean(batches.length)&&<section className="flow-card" aria-label="배포 묶음 요약"><h3>배포 묶음</h3><p>현재 프로젝트 목록에 있는 묶음 전체의 진행 상태입니다. 아래 개별 기록 필터와 별도로 표시합니다.</p>{batches.map(batch=><article key={batch.id}><h4>{batch.items[0].delivery.reference} · {batch.items[0].delivery.recipient}</h4><p>{batch.items[0].delivery.issuedOn} · 수신 확인 {batch.items.filter(row=>row.delivery.status==='received').length}/{batch.items.length} · 보완 요청 {batch.items.filter(row=>row.delivery.status==='correction').length} · 이전 구성 {batch.items.filter(row=>!row.current).length}</p><p>{batch.items.map(row=>`${row.document.title} R${row.delivery.revision}`).join(' / ')}</p><button onClick={()=>change({transmittalSearch:batch.items[0].delivery.reference??'',transmittalStatus:''})}>이 문서번호 기록 보기</button><WorkflowDistributionManifest rows={batch.items} batchId={batch.id} onRecipient={onRecipient}/></article>)}</section>}
  <section className="flow-card" aria-label="배포 기록 필터"><label className="flow-input">배포 기록 검색<input disabled={loading} aria-label="배포 기록 검색" value={query} onChange={event=>change({transmittalSearch:event.target.value})} placeholder="도면·수신 대상·원본 이름"/></label><label className="flow-input">배포 기록 상태<select disabled={loading} aria-label="배포 기록 상태" value={status} onChange={event=>change({transmittalStatus:event.target.value})}>{!['all','waiting','received','correction','history','unavailable'].includes(status)&&<option value={status}>알 수 없는 상태</option>}<option value="all">전체 기록</option><option value="waiting">수신 확인 대기</option><option value="received">수신 확인됨</option><option value="correction">보완 요청</option><option value="history">이전 구성</option><option value="unavailable">만료·근거 확인 필요</option></select></label><button onClick={()=>change({transmittalSearch:'',transmittalStatus:''})}>검색·상태 초기화</button></section>
  {loading?<p role="status">배포 기록 복원 중…</p>:<><p>전체 기록 {rows.length}건 · 표시 {visible.length}건</p>
   {!rows.length?<p>아직 준비한 납품 구성이 없습니다. 승인된 도면에서 먼저 구성을 준비하세요.</p>:!visible.length?<p>조건에 맞는 배포 기록이 없습니다. 검색·상태를 바꿔 확인하세요.</p>:visible.map(row=><article className="flow-card" key={row.key}>
    <h3>{row.document.title} · 구성 #{row.delivery.sequence??0}</h3><p>{row.current?'현재 구성':'이전 구성 · 읽기 전용'} · 승인 R{row.delivery.revision}</p><p>수신 대상: {row.delivery.recipient}</p><p>{row.delivery.status==='prepared'?'준비됨 · 수신 확인 대기':row.delivery.status==='received'?'수신 확인됨 (체험)':'보완 요청됨 (체험)'}</p>
    {row.delivery.reference&&<p>문서번호 {row.delivery.reference} · 발행일 {row.delivery.issuedOn}</p>}
    {row.round?<p>승인 원본: {row.round.source.name} · {row.round.objects.length}개 객체</p>:<p role="status">연결된 승인 근거를 찾을 수 없습니다.</p>}
    {row.delivery.quantityReviewSequence!==undefined&&<p>포함 검산 #{row.delivery.quantityReviewSequence}</p>}
    {row.delivery.feedback&&<p>수신 의견: {row.delivery.feedback}</p>}
    {row.delivery.linkStatus==='expired'&&<p>이 구성의 수신 화면은 만료되었습니다.</p>}
    {!row.current&&<p>새 구성으로 교체된 기록입니다. 현재 구성으로 자동 대체하지 않습니다.</p>}
    <button disabled={!row.available} aria-label={`${row.document.title} 구성 ${row.delivery.sequence??0} 수신 화면`} onClick={()=>onRecipient(row.document.id,row.delivery.sequence??0)}>수신 화면 확인</button>
   </article>)}
  </>}
 </section>;
}
