import {useState,useRef,useEffect} from 'react';
import {useSearchParams} from 'react-router';
import {WorkflowScheduleDrawing} from './workflow-schedule-drawing';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {makeObjectSchedule,readObjectSchedule,scheduleKey,scheduleMatches,scheduleProgress,scheduleCalendarKey,scheduleDate,scheduleDay,scheduleDependencyIssue,type ObjectSchedule} from '../lib/workflow-schedule';

export function WorkflowSchedule({documents,drafts,onSave,onOpen,onStart}:{documents:WorkflowBlankDocument[];drafts:Record<string,string>;onSave:(key:string,value:string)=>void;onOpen:(id:string,objectId:string,page:number)=>void;onStart:()=>void}){
 const [params,setParams]=useSearchParams();const doc=params.has('scheduleDocument')?documents.find(doc=>doc.id===params.get('scheduleDocument')):documents[0];
 const selected=params.has('scheduleObject')?doc?.shapes.find(shape=>shape.id===params.get('scheduleObject')):doc?.shapes[0];
 const day=Number(params.get('scheduleDay')??'1'),validDay=Number.isInteger(day)&&day>=1&&day<=30;
 const calendar=doc?drafts[scheduleCalendarKey(doc.id)]??'':'';const validCalendar=Boolean(scheduleDate(calendar,30));
 const rows=doc?.shapes.map(shape=>({shape,plan:readObjectSchedule(drafts[scheduleKey(doc.id,shape.id)]),raw:drafts[scheduleKey(doc.id,shape.id)]}))??[];
 const plans=rows.flatMap(row=>row.plan?[row.plan]:[]);
 const view=params.get('scheduleView')??'list';
 const query=params.toString();const pendingQuery=useRef(query);useEffect(()=>{pendingQuery.current=query;},[query]);
 const update=(patch:Record<string,string>)=>{const next=new URLSearchParams(pendingQuery.current);for(const [key,value] of Object.entries(patch))value?next.set(key,value):next.delete(key);pendingQuery.current=next.toString();setParams(next,{replace:true,preventScrollReset:true});};
 return <section className="flow-card" aria-label="도면 객체 공정표">
  <h2>공정·작업 구간</h2><p>이 탭의 도면 객체에 연결하는 30일 구간 계획 체험입니다. D1에 날짜를 지정할 수 있으며 계약 공정표·4D 모델은 아닙니다.</p>
  {!documents.length?<><p>먼저 작업 도면을 만드세요. 예시 공정으로 자동 대체하지 않습니다.</p><button onClick={onStart}>작업 도면 만들기</button></>:<>
   <label className="flow-input">공정 도면<select aria-label="공정 도면" value={doc?.id??''} onChange={event=>update({scheduleDocument:event.target.value,scheduleObject:''})}>{!doc&&<option value="">선택한 도면 없음</option>}{documents.map(doc=><option value={doc.id} key={doc.id}>{doc.title}</option>)}</select></label>
   {!doc?<p role="alert">선택한 도면을 찾을 수 없습니다. 위에서 다시 선택하세요.</p>:<>
    <p>{doc.source?`${doc.source.name} · 원본 연결 기록 있음`:'원본 없는 구상 도면'} · R{doc.revision??1} · 계획 등록 {rows.filter(row=>row.plan).length}/{rows.length}개 객체</p>
    <ScheduleCalendar key={`${doc.id}:${calendar}`} value={calendar} count={rows.filter(row=>row.plan).length} onApply={value=>onSave(scheduleCalendarKey(doc.id),value)}/>
    <label className="flow-input">계획 확인 일차<input aria-label="계획 확인 일차" type="number" min="1" max="30" value={params.get('scheduleDay')??'1'} onChange={event=>update({scheduleDay:event.target.value||'0'})}/></label>
    {validCalendar&&<label className="flow-input">계획 확인 날짜<input aria-label="계획 확인 날짜" type="date" min={calendar} max={scheduleDate(calendar,30)!} value={scheduleDate(calendar,day)??''} onChange={event=>update({scheduleDay:String(scheduleDay(calendar,event.target.value)??0)})}/></label>}
    {!validDay&&<p role="alert">확인 일차는 1–30 사이 정수로 입력하세요.</p>}
    <details><summary>계획·진행률 표시 기준</summary><p>계획률은 작업 기간을 균등 배분한 예시입니다. 보고 진행률은 입력한 현재 값이며, 과거 일자의 실적이나 수량·금액·기성률로 환산하지 않습니다.</p></details>
    <div className="flow-actions" role="group" aria-label="공정 보기 전환"><button aria-pressed={view==='list'} onClick={()=>update({scheduleView:'list'})}>작업 목록 보기</button><button aria-pressed={view==='drawing'} onClick={()=>update({scheduleView:'drawing'})}>도면 위치 보기</button></div>
    <div className={`flow-grid-two flow-schedule-grid${view==='drawing'?' flow-schedule-drawing':''}`}>
     {view==='drawing'?<WorkflowScheduleDrawing document={doc} plans={plans} day={day} page={Number(params.get('schedulePage')??'1')} selected={selected?.id} onPage={page=>update({schedulePage:String(page)})} onSelect={id=>update({scheduleDocument:doc.id,scheduleObject:id})}/>:view!=='list'?<p role="alert">선택한 보기가 없습니다. 위에서 작업 목록 또는 도면 위치를 선택하세요.</p>:<section className="flow-card" aria-label="객체별 계획 현황"><h3>작업 목록 · 계획과 보고</h3>
      {!rows.length&&<p>도면에 객체를 먼저 작성하세요.</p>}
      {rows.map(({shape,plan,raw})=>{const matches=plan&&scheduleMatches(doc,plan);const planned=plan&&validDay?scheduleProgress(plan,day):null;const dependency=plan?scheduleDependencyIssue(doc,plan,plans):null;return <article key={shape.id} style={{marginBlock:16,overflowWrap:'anywhere'}}>
       <button aria-pressed={selected?.id===shape.id} onClick={()=>update({scheduleDocument:doc.id,scheduleObject:shape.id})}>{shape.label} · {shape.page??1}쪽 공정 선택</button>
       {!plan?<p>{raw?'보관된 공정 형식을 확인하세요. 재입력 전 다른 값으로 대체하지 않습니다.':'기간·진행률 미등록'}</p>:<>
        <p>D{plan.start}–D{plan.end} · R{plan.revision} · {plan.page}쪽</p>
        {plan.predecessorId&&<p>선행: {doc.shapes.find(shape=>shape.id===plan.predecessorId)?.label??'찾을 수 없는 객체'} → 이 작업</p>}
        {validCalendar&&<p>{scheduleDate(calendar,plan.start)} → {scheduleDate(calendar,plan.end)}</p>}
        <div aria-label={`${shape.label} 계획 기간 D${plan.start}–D${plan.end}`} style={{height:12,background:'#e2e8f0',borderRadius:6,overflow:'hidden'}}><div style={{height:'100%',background:'#6654d8',marginLeft:`${(plan.start-1)/30*100}%`,width:`${(plan.end-plan.start+1)/30*100}%`}}/></div>
        {!matches?<p role="status">도면 개정·위치 변경: 공정 연결을 재확인하세요. 현재 위치로 대체하지 않습니다.</p>:dependency?<p role="status">{dependency}</p>:planned!==null&&<><p>계획 {planned}% · 보고 {plan.progress}%</p><p>{planned>plan.progress?`계획 대비 ${Math.round((planned-plan.progress)*100)/100}%p 부족`:'보고값이 계획 이상'}</p></>}
       </>}
      </article>;})}
     </section>}
     <section className="flow-card" aria-label="공정 연결 편집"><h3>도면 객체에 작업 연결</h3>
      <label className="flow-input">공정 객체<select aria-label="공정 객체" value={selected?.id??''} onChange={event=>update({scheduleDocument:doc.id,scheduleObject:event.target.value})}><option value="" disabled>객체 선택</option>{doc.shapes.map(shape=><option key={shape.id} value={shape.id}>{shape.label} · {shape.page??1}쪽</option>)}</select></label>
      {selected?<ScheduleEditor key={`${doc.id}:${selected.id}:${drafts[scheduleKey(doc.id,selected.id)]??''}`} document={doc} objectId={selected.id} raw={drafts[scheduleKey(doc.id,selected.id)]} plans={plans} onSave={onSave} onOpen={()=>onOpen(doc.id,selected.id,selected.page??1)}/>:<p>선택한 객체가 없습니다. 도면에서 작성하거나 목록에서 다시 선택하세요.</p>}
     </section>
    </div>
   </>}
  </>}
 </section>;
}
function ScheduleCalendar({value,count,onApply}:{value:string;count:number;onApply:(value:string)=>void}){
 const [input,setInput]=useState(scheduleDate(value,30)?value:''),[error,setError]=useState('');
 return <section className="flow-card flow-schedule-calendar" aria-label="도면 공정 달력">
 {value&&!scheduleDate(value,30)&&<p role="alert">보관된 시작 날짜가 올바르지 않습니다. 임의 날짜로 대체하지 않습니다.</p>}
 <details><summary>날짜 기준 설정 · {scheduleDate(value,30)?value:'상대 일차'}</summary><p>이 도면의 D1 날짜입니다. 변경하면 등록된 {count}개 작업의 표시 날짜가 함께 이동합니다. 기간·보고 진행률·도면은 변경하지 않으며 휴일도 일수에 포함합니다.</p>
 <label className="flow-input">공정 시작 날짜<input aria-label="공정 시작 날짜" type="date" value={input} onChange={event=>setInput(event.target.value)}/></label>
 {error&&<p role="alert">{error}</p>}
 <div className="flow-actions"><button onClick={()=>{if(!scheduleDate(input,30)){setError('30일 구간을 표시할 수 있는 유효한 시작 날짜를 입력하세요.');return;}onApply(input);setError('');}}>시작 날짜 적용</button>{value&&<button onClick={()=>onApply('')}>상대 일차만 보기</button>}</div></details></section>;
}
function ScheduleEditor({document,objectId,raw,plans,onSave,onOpen}:{document:WorkflowBlankDocument;objectId:string;raw?:string;plans:ObjectSchedule[];onSave:(key:string,value:string)=>void;onOpen:()=>void}){
 const plan=readObjectSchedule(raw);const [start,setStart]=useState(String(plan?.start??1)),[end,setEnd]=useState(String(plan?.end??10)),[progress,setProgress]=useState(String(plan?.progress??0)),[error,setError]=useState('');
 const [predecessor,setPredecessor]=useState(plan?.predecessorId??'');
 return <><label className="flow-input">시작일차<input aria-label="시작일차" type="number" min="1" max="30" value={start} onChange={e=>setStart(e.target.value)}/></label><label className="flow-input">종료일차<input aria-label="종료일차" type="number" min="1" max="30" value={end} onChange={e=>setEnd(e.target.value)}/></label><label className="flow-input">보고 진행률<input aria-label="보고 진행률" type="number" min="0" max="100" value={progress} onChange={e=>setProgress(e.target.value)}/></label>
 <p>보관 시 현재 객체 위치와 개정을 연결합니다. 기존 계획을 다시 보관하면 이 체험의 보고값을 교체하며 승인·기성 기록은 바꾸지 않습니다.</p>
 <label className="flow-input">선행 작업<select aria-label="선행 작업" value={predecessor} onChange={event=>setPredecessor(event.target.value)}><option value="">선행 작업 없음</option>{predecessor&&!document.shapes.some(shape=>shape.id===predecessor&&shape.id!==objectId)&&<option value={predecessor}>보관된 선행 객체 확인 필요</option>}{document.shapes.filter(shape=>shape.id!==objectId).map(shape=><option key={shape.id} value={shape.id} disabled={!plans.some(plan=>plan.objectId===shape.id)}>{shape.label}{plans.some(plan=>plan.objectId===shape.id)?'':' · 기간 미등록'}</option>)}</select></label>
 <p>같은 도면에서 선행 작업 한 개가 끝난 뒤 시작하는 관계만 지원합니다. 선행 기간을 바꿔도 후속 일정은 자동 이동하지 않습니다.</p>
 {error&&<p role="alert">{error}</p>}
 <div className="flow-actions"><button onClick={()=>{const next=start&&end&&progress?makeObjectSchedule(document,objectId,{start:Number(start),end:Number(end),progress:Number(progress),...(predecessor?{predecessorId:predecessor}:{})}):null;if(!next){setError('시작·종료는 1–30일, 종료는 시작 이후, 진행률은 0–100%로 입력하세요.');return;}const issue=scheduleDependencyIssue(document,next,plans);if(issue){setError(issue);return;}onSave(scheduleKey(document.id,objectId),JSON.stringify(next));}}>객체 공정 보관</button><button disabled={Boolean(plan&&!scheduleMatches(document,plan))} onClick={onOpen}>연결 도면 위치 열기</button></div></>;
}
