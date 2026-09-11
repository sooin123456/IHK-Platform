import {useEffect,useRef,useState} from 'react';
import {useSearchParams} from 'react-router';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {submitDailyReport,decideDailyReport,type DailyReport} from '../lib/workflow-daily-reports';
import {fieldNoteMatches} from '../lib/workflow-document-field';
import {inspectionPhase} from '../lib/workflow-inspections';
import {FieldPhotoPreview} from './workflow-field-photos';

export function WorkflowDailyReports({documents,drafts,onDraft,onChange,onOpen,onField}:{documents:WorkflowBlankDocument[];drafts:Record<string,string>;onDraft:(patch:Record<string,string>)=>void;onChange:(doc:WorkflowBlankDocument)=>void;onOpen:(doc:WorkflowBlankDocument,report:DailyReport)=>void;onField:(id?:string)=>void}){
 const [params,setParams]=useSearchParams();const [error,setError]=useState('');
 const doc=documents.find(doc=>doc.id===(params.get('dailyDocument')??documents[0]?.id));
 const role=params.get('dailyRole')??'author',date=params.get('dailyDate')??'';
 const pending=useRef(params.toString());useEffect(()=>{pending.current=params.toString();},[params]);
 const setParam=(key:string,value:string)=>{const next=new URLSearchParams(pending.current);if(value)next.set(key,value);else next.delete(key);if(key==='dailyDocument'||key==='dailyDate')next.delete('dailyReport');pending.current=next.toString();setParams(next,{replace:true});};
 const key=`daily:${doc?.id??'none'}:`,value=(field:string,fallback='')=>drafts[key+field]??fallback;
 const edit=(field:string,text:string)=>onDraft({[key+field]:text});
 const evidence=doc?.fieldNotes?.find(row=>String(row.id)===value('field',String(doc.fieldNotes?.[0]?.id??'')));
 const previous=value('previous')?Number(value('previous')):undefined;
 const reportId=params.get('dailyReport');
 const reports=doc?.dailyReports??[],visible=reports.filter(row=>(!reportId||String(row.id)===reportId)&&(!date||row.date===date));
 return <section aria-label="일일 작업 보고">
  <header className="flow-card"><h2>일일 작업 보고</h2><p>날짜별 작업 내용과 현장 근거를 제출하고 확인합니다. 이 탭에만 보관되는 역할 체험이며 실제 보고 발송·전자결재·기성 청구는 아닙니다.</p>
   <label className="flow-input">보고 도면<select aria-label="보고 도면" value={doc?.id??''} onChange={event=>{setParam('dailyDocument',event.target.value);setError('');}}>{!doc&&<option value="">도면 선택</option>}{documents.map(row=><option key={row.id} value={row.id}>{row.title}</option>)}</select></label>
   <label className="flow-input">보고 처리 역할<select aria-label="보고 처리 역할" value={role} onChange={event=>{setParam('dailyRole',event.target.value);setError('');}}><option value="author">작성자 체험</option><option value="reviewer">검토자 체험</option><option value="viewer">열람 체험</option></select></label>
  </header>
  {!doc?<div className="flow-card"><p>선택한 로컬 도면이 없습니다. 예시 자료를 보고 근거로 대체하지 않습니다.</p><button onClick={()=>onField()}>현장 기록 준비</button></div>:<>
   {role==='author'&&<section className="flow-card" aria-label="일일 보고 작성"><h3>{previous?`보고 #${previous} 보완 작성`:'새 일일 보고'}</h3>
    <label className="flow-input">현장 근거<select aria-label="보고 현장 근거" value={evidence?String(evidence.id):''} onChange={event=>edit('field',event.target.value)}>{!evidence&&<option value="">현장 기록을 선택하세요</option>}{doc.fieldNotes?.map(row=><option key={row.id} value={row.id}>#{row.id} · {row.location} · {row.title}</option>)}</select></label>
    {!evidence&&<p>보고할 현장 기록이 필요합니다. <button onClick={()=>onField(doc.id)}>현장 기록 작성으로</button></p>}
    {evidence&&!fieldNoteMatches(doc,evidence)&&<p role="alert">선택한 근거의 원본·개정·객체 위치가 달라졌습니다. 현재 근거로 현장 기록을 다시 작성하세요.</p>}
    <label className="flow-input">보고 날짜<input type="date" aria-label="보고 날짜" value={value('date')} onChange={event=>edit('date',event.target.value)}/></label>
    <div className="flow-grid-two">
     <label className="flow-input">날씨<input aria-label="날씨" maxLength={50} value={value('weather')} onChange={event=>edit('weather',event.target.value)}/></label>
     <label className="flow-input">투입 인원<input type="number" min={0} max={10000} step={1} aria-label="투입 인원" value={value('workers')} onChange={event=>edit('workers',event.target.value)}/></label>
    </div>
    <label className="flow-input">작업 내용<textarea aria-label="작업 내용" maxLength={500} value={value('work')} onChange={event=>edit('work',event.target.value)}/></label>
    <label className="flow-input">해당 작업의 보고 진행률 (%)<input type="number" min={0} max={100} aria-label="보고 진행률" value={value('progress')} onChange={event=>edit('progress',event.target.value)}/></label>
    <p>진행률은 선택한 작업의 누적 보고값입니다. 날짜별 값을 합산하지 않으며 승인 수량·공정률·기성 금액으로 환산하지 않습니다.</p>
    <label className="flow-input">다음 작업·주의사항<textarea aria-label="다음 작업·주의사항" maxLength={500} value={value('next')} onChange={event=>edit('next',event.target.value)}/></label>
    <div className="flow-actions"><button disabled={!evidence||!fieldNoteMatches(doc,evidence)||reports.length>=100} onClick={()=>{
     const updated=value('workers').trim()&&value('progress').trim()?submitDailyReport(doc,role,{fieldNoteId:evidence?.id,date:value('date'),weather:value('weather'),workers:Number(value('workers')),progress:Number(value('progress')),work:value('work'),next:value('next')},previous):doc;
     if(updated===doc){setError('날짜·작업·날씨·인원·진행률·다음 작업과 보완 연결을 확인하세요.');return;}
     onChange(updated);onDraft({[key+'previous']:'',[key+'work']:'',[key+'next']:''});setError('');
    }}>{previous?'보완 보고 제출':'일일 보고 제출'}</button>{previous&&<button onClick={()=>edit('previous','')}>보완 연결 해제</button>}</div>
    {reports.length>=100&&<p>도면당 보고 100건 한도입니다. 기존 보고는 유지됩니다.</p>}
   </section>}
   {error&&<p role="alert">{error}</p>}
   <section className="flow-card" aria-label="일일 보고 이력"><h3>일일 보고 이력 · {reports.length}건</h3>
    {reportId&&<p>연결된 보고 #{reportId} 확인 중 <button onClick={()=>setParam('dailyReport','')}>보고 선택 해제</button></p>}
    {reportId&&!reports.some(row=>String(row.id)===reportId)&&<p role="alert">연결된 보고서를 찾을 수 없습니다. 다른 보고서로 대체하지 않습니다.</p>}
    <label className="flow-input">보고 날짜 필터<input type="date" aria-label="보고 날짜 필터" value={date} onChange={event=>setParam('dailyDate',event.target.value)}/></label>{date&&<button onClick={()=>setParam('dailyDate','')}>모든 날짜 보기</button>}
    {!visible.length&&<p>{date?'해당 날짜의 보고가 없습니다.':'아직 제출된 일일 보고가 없습니다.'}</p>}
    {[...visible].reverse().map(report=>{
     const next=reports.find(row=>row.previous===report.id),matches=fieldNoteMatches(doc,report.evidence),decisionKey=`decision:${report.id}`;
     return <article className="flow-card" key={report.id}><h3>#{report.id} · {report.date}</h3>
      <p><strong>{{submitted:'검토 대기',changes:'보완 요청',accepted:'보고 확인'}[report.phase]}</strong> · {report.evidence.location} · {report.evidence.objectLabel}</p>
      <p>{report.work}</p><p>날씨 {report.weather} · 투입 {report.workers}명 · 해당 작업 보고 진행률 {report.progress}%</p><p>다음 작업·주의: {report.next}</p>
      {report.previous&&<p>보고 #{report.previous} 보완 제출</p>}{next&&<p>보고 #{next.id}로 보완됨</p>}{report.decision&&<p>검토 의견: {report.decision}</p>}
      <details><summary>제출 당시 현장·점검 근거</summary><p>{report.evidence.source.name} · {report.evidence.page}쪽 · R{report.evidence.revision}</p><p>{report.evidence.note}</p>
       <p>제출 당시 점검: {{new:'점검 전',correction:'시정 필요',reinspection:'재검측 대기',closed:'점검 종결'}[inspectionPhase(report.inspection)]}</p>
       {report.inspection?.events.map((event,index)=><p key={index}>{index+1}. {event.note}</p>)}
       {report.evidence.photos?.map(photo=><FieldPhotoPreview key={photo.sha256} photo={photo}/>)}
      </details>
      {!matches&&<p>현재 도면 근거가 달라져 위치 이동은 중지됩니다. 보고 확인은 제출 당시 기록에 대한 확인이며 현재 시공 적합 판정이 아닙니다.</p>}
      <button disabled={!matches} aria-label={`보고 #${report.id} 도면 근거 확인`} onClick={()=>onOpen(doc,report)}>도면 근거 확인</button>
      {report.phase==='submitted'&&role==='reviewer'&&<><label className="flow-input">검토 의견<textarea aria-label={`보고 #${report.id} 검토 의견`} maxLength={500} value={value(decisionKey)} onChange={event=>edit(decisionKey,event.target.value)}/></label><div className="flow-actions">{(['changes','accepted'] as const).map(phase=><button key={phase} aria-label={`보고 #${report.id} ${phase==='changes'?'보완 요청':'확인'}`} onClick={()=>{const updated=decideDailyReport(doc,report.id,role,phase,value(decisionKey));if(updated===doc){setError('검토 의견을 입력하세요.');return;}onChange(updated);edit(decisionKey,'');setError('');}}>{phase==='changes'?'보완 요청':'보고 확인'}</button>)}</div></>}
      {report.phase==='changes'&&!next&&role==='author'&&<button aria-label={`보고 #${report.id} 보완 작성`} onClick={()=>{onDraft(Object.fromEntries(Object.entries({previous:report.id,field:report.fieldNoteId,date:report.date,weather:report.weather,workers:report.workers,progress:report.progress,work:report.work,next:report.next}).map(([name,value])=>[key+name,String(value)])));setError('');}}>보완 작성</button>}
     </article>;
    })}
   </section>
  </>}
 </section>;
}
