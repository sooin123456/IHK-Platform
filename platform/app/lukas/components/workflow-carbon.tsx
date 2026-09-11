import {useEffect,useRef,useState} from 'react';
import {useSearchParams} from 'react-router';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {carbonStages,carbonPreview,saveCarbon,compareCarbon} from '../lib/workflow-carbon';
const number=(value:number)=>value.toLocaleString('ko-KR',{maximumFractionDigits:3});
export function WorkflowCarbon({documents,drafts,onDraft,onChange,onOpen}:{documents:WorkflowBlankDocument[];drafts:Record<string,string>;onDraft:(patch:Record<string,string>)=>void;onChange:(doc:WorkflowBlankDocument)=>void;onOpen:(id:string,sequence:number)=>void}){
 const [params,setParams]=useSearchParams(),[error,setError]=useState('');const pending=useRef(params.toString());useEffect(()=>{pending.current=params.toString();},[params]);
 const change=(values:Record<string,string>)=>{const next=new URLSearchParams(pending.current);for(const [key,value]of Object.entries(values)){if(value)next.set(key,value);else next.delete(key);}pending.current=next.toString();setParams(next,{replace:true});setError('');};
 const doc=documents.find(row=>row.id===(params.get('carbonDocument')??documents[0]?.id));
 const rounds=doc?.quantityReviews?.filter(row=>row.phase==='approved')??[],round=rounds.find(row=>row.sequence===Number(params.get('carbonSequence')??rounds.at(-1)?.sequence));
 const stage=params.get('carbonStage')??'A1-A3',role=params.get('carbonRole')??'author',key=`carbon:${doc?.id??'none'}:${round?.sequence??0}:${stage}:`;
 const value=(field:string)=>drafts[key+field]??'',edit=(field:string,text:string)=>onDraft({[key+field]:text});
 const factors=Object.fromEntries((round?.items??[]).map(item=>[item.id,{value:value(`${item.id}:value`).trim()?Number(value(`${item.id}:value`)):undefined,unit:value(`${item.id}:unit`),source:value(`${item.id}:source`),version:value(`${item.id}:version`)}]));
 const result=round?carbonPreview(round,factors):null,assessments=doc?.carbonAssessments??[];
 const before=assessments.find(row=>row.id===Number(params.get('carbonBefore')??assessments[0]?.id)),after=assessments.find(row=>row.id===Number(params.get('carbonAfter')??assessments.at(-1)?.id));
 const delta=before&&after?compareCarbon(before,after):null;
 return <section aria-label="탄소 근거">
  <header className="flow-card"><h2>탄소 근거</h2><p>승인 수량 × 사용자 입력 배출계수의 브라우저 미리보기입니다. 인증 LCA·검증된 EPD 데이터베이스·탄소배출권·AI 추정 결과가 아닙니다. 계수 출처와 적용 범위를 사용자가 확인해야 합니다.</p>
   <label className="flow-input">탄소 대상 도면<select aria-label="탄소 대상 도면" value={doc?.id??''} onChange={event=>change({carbonDocument:event.target.value,carbonSequence:'',carbonBefore:'',carbonAfter:''})}>{!doc&&<option value="">도면 선택</option>}{documents.map(row=><option key={row.id} value={row.id}>{row.title}</option>)}</select></label>
   <label className="flow-input">탄소 체험 역할<select aria-label="탄소 체험 역할" value={role} onChange={event=>change({carbonRole:event.target.value})}><option value="author">작성 체험</option><option value="viewer">열람 체험</option></select></label>
  </header>
  {!doc?<p>선택한 로컬 도면이 없습니다. 승인 수량을 먼저 준비하세요.</p>:<>
   <section className="flow-card"><h3>산정 범위와 계수</h3>
    <label className="flow-input">승인 검산<select aria-label="탄소 승인 검산" value={round?.sequence??''} onChange={event=>change({carbonSequence:event.target.value})}>{!round&&<option value="">승인 검산 선택</option>}{rounds.map(row=><option key={row.sequence} value={row.sequence}>검산 #{row.sequence} · R{row.revision}</option>)}</select></label>
    <label className="flow-input">탄소 산정 단계<select aria-label="탄소 산정 단계" value={stage} onChange={event=>change({carbonStage:event.target.value})}>{!carbonStages.includes(stage as typeof carbonStages[number])&&<option value={stage}>알 수 없는 단계</option>}{carbonStages.map(stage=><option key={stage} value={stage}>{stage}</option>)}</select></label>
    <p>선택한 단계에 맞는 kgCO₂e/수량단위 계수를 직접 입력하세요. 단계 간 계수 복사, 단위 환산, 운송 거리 계산은 자동으로 수행하지 않습니다.</p>
    {!round?<p>선택한 승인 검산이 없습니다. 미승인 수량을 대신 사용하지 않습니다.</p>:<>
     <p>승인 항목 {round.items.length}개 · 미등록 객체 {round.excludedCount}개는 산정 범위 밖입니다.</p><button onClick={()=>onOpen(doc.id,round.sequence)}>선택 승인 수량 근거</button>
     {result?.rows.map(row=><fieldset className="flow-card" key={row.id} disabled={role!=='author'}><legend>{row.label} · {number(row.quantity)} {row.unit}</legend>
      <label className="flow-input">배출계수 (kgCO₂e/단위)<input type="number" min={0} step="any" aria-label={`${row.label} 배출계수`} value={value(`${row.id}:value`)} onChange={event=>edit(`${row.id}:value`,event.target.value)}/></label>
      <label className="flow-input">계수 분모 단위<input aria-label={`${row.label} 계수 분모 단위`} maxLength={20} placeholder={row.unit} value={value(`${row.id}:unit`)} onChange={event=>edit(`${row.id}:unit`,event.target.value)}/></label>
      <label className="flow-input">계수 출처<input aria-label={`${row.label} 계수 출처`} maxLength={500} value={value(`${row.id}:source`)} onChange={event=>edit(`${row.id}:source`,event.target.value)}/></label>
      <label className="flow-input">계수 버전<input aria-label={`${row.label} 계수 버전`} maxLength={120} value={value(`${row.id}:version`)} onChange={event=>edit(`${row.id}:version`,event.target.value)}/></label>
      <p>{row.amount===null?'근거 미완료 · 계수·일치하는 단위·출처·버전을 확인하세요.':`${number(row.quantity)} × ${row.factor?.value} = ${number(row.amount)} kgCO₂e`}</p>
     </fieldset>)}
     <p role="status">{result?.complete?`계산 미리보기 ${number(result.total)} kgCO₂e`:`근거 미완료 ${result?.rows.filter(row=>row.amount===null).length??0}건 · 확인된 항목 소계 ${number(result?.total??0)} kgCO₂e (전체 합계 아님)`}</p>
     <label className="flow-input">탄소 검토 메모<textarea disabled={role!=='author'} aria-label="탄소 검토 메모" maxLength={500} value={value('note')} onChange={event=>edit('note',event.target.value)}/></label>
     <button disabled={role!=='author'||!result?.complete||assessments.length>=20} onClick={()=>{const updated=saveCarbon(doc,role,round.sequence,stage,factors,value('note'));if(updated===doc){setError('검토 메모·산정 단계와 모든 계수 근거를 확인하세요.');return;}onChange(updated);setError('');}}>탄소 검토 결과 보관</button>
     <p>보관은 승인이나 인증이 아닙니다. 각 결과는 당시 수량·계수·단계·출처·버전을 보존합니다. 최대 20건입니다.</p>
    </>}
   </section>
   {error&&<p role="alert">{error}</p>}
   <section className="flow-card" aria-label="탄소 결과 비교"><h3>보관 결과 비교</h3>{!assessments.length?<p>아직 보관한 결과가 없습니다.</p>:<>
    <div className="flow-grid-two">{[['carbonBefore','비교 기준 결과',before],['carbonAfter','비교 대상 결과',after]] .map(([key,label,selected])=><label className="flow-input" key={String(key)}>{String(label)}<select aria-label={String(label)} value={typeof selected==='object'?selected?.id??'':''} onChange={event=>change({[String(key)]:event.target.value})}>{!selected&&<option value="">결과 선택</option>}{assessments.map(row=><option key={row.id} value={row.id}>결과 #{row.id} · {row.stage} · 검산 #{row.quantity.sequence}</option>)}</select></label>)}</div>
    {before&&after?<p>{delta===null?'산정 단계 또는 객체·단위 범위가 달라 단순 증감 비교를 제공하지 않습니다.':`차이 ${delta>0?'+':''}${number(delta)} kgCO₂e`}</p>:<p>선택한 결과를 찾을 수 없습니다. 다른 결과로 대체하지 않습니다.</p>}
    <p>차이는 수량과 계수 변경을 함께 반영합니다. 감축 실적이나 인증된 절감량이 아닙니다.</p>
    {[...assessments].reverse().map(item=><details key={item.id}><summary>보관 결과 #{item.id} · {item.stage} · {number(carbonPreview(item.quantity,item.factors).total)} kgCO₂e</summary><p>검산 #{item.quantity.sequence} · R{item.quantity.revision} · {item.quantity.source.name}</p><p>{item.note}</p>{carbonPreview(item.quantity,item.factors).rows.map(row=><p key={row.id}>{row.label}: {number(row.quantity)} {row.unit} × {row.factor?.value} · {row.factor?.source} · {row.factor?.version}</p>)}</details>)}
   </>}</section>
  </>}
 </section>;
}
