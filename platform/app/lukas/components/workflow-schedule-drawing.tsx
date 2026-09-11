import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {scheduleVisualState,type ObjectSchedule} from '../lib/workflow-schedule';
import {WorkflowDraftShape} from './workflow-draft-shape';
import {WorkflowPdfBackground} from './workflow-prototype-pdf';
const states={unplanned:['기간 미등록','#94a3b8'],waiting:['계획 시작 전','#64748b'],active:['계획 진행 구간','#6654d8'],complete:['계획 기간 완료','#16804a'],stale:['도면 연결 확인','#c2413b'],conflict:['선행 연결 확인','#b45309'],unavailable:['확인 일차 오류','#64748b']} as const;
export function WorkflowScheduleDrawing({document,plans,day,page,selected,onPage,onSelect}:{document:WorkflowBlankDocument;plans:ObjectSchedule[];day:number;page:number;selected?:string;onPage:(page:number)=>void;onSelect:(id:string)=>void}){
 const pages=document.source?.pages??Math.max(1,...document.shapes.map(shape=>shape.page??1));const valid=Number.isInteger(page)&&page>=1&&page<=pages;
 const overlay=<svg className="flow-blank-canvas" viewBox="0 0 800 520" preserveAspectRatio="none" role="group" aria-label="날짜별 공정 도면">
  {document.shapes.filter(shape=>(shape.page??1)===page).map(shape=>{const [label,color]=states[scheduleVisualState(document,shape.id,plans,day)];return <g key={shape.id} role="button" tabIndex={0} aria-label={`${shape.label} · ${label}`} aria-pressed={selected===shape.id} onClick={()=>onSelect(shape.id)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelect(shape.id);}}} style={{cursor:'pointer'}}><WorkflowDraftShape shape={{...shape,stroke:color,fill:`${color}22`}} selected={selected===shape.id}/></g>;})}
 </svg>;
 return <section className="flow-card" aria-label="공정 도면 위치"><h3>도면 위 계획 상태 · D{day}</h3>
  <p>현재 저장된 2D 객체에 계획 기간을 표시합니다. 초록은 계획상 종료일이 지났다는 뜻이며 실제 시공 완료가 아닙니다. 3D·4D 시뮬레이션이나 과거 형상 재현이 아닙니다.</p>
  <details><summary>상태 범례·표시 기준</summary><ul>{Object.entries(states).map(([key,[label,color]])=><li key={key}><span style={{color}} aria-hidden="true">● </span>{label}</li>)}</ul><p>검토를 위해 숨김 레이어 객체도 표시합니다. 원본과 도면 스타일은 바꾸지 않습니다.</p></details>
  <label className="flow-input">공정 도면 페이지<select aria-label="공정 도면 페이지" value={page} onChange={event=>onPage(Number(event.target.value))}>{!valid&&<option value={page} disabled>선택한 페이지 없음</option>}{Array.from({length:pages},(_,index)=><option key={index+1} value={index+1}>{index+1}쪽</option>)}</select></label>
  {!valid?<p role="alert">선택한 도면 페이지가 없습니다. 페이지를 다시 선택하세요.</p>:document.source?<WorkflowPdfBackground key={document.id} source={document.source} page={page} onPage={onPage} onSource={()=>{}} onReady={()=>{}}>{overlay}</WorkflowPdfBackground>:<><p>원본 없는 구상 객체 · 실측 도면 아님</p>{overlay}</>}
  {valid&&!document.shapes.some(shape=>(shape.page??1)===page)&&<p>이 페이지에 작성한 객체가 없습니다.</p>}
  <p>객체를 선택하면 옆의 공정 연결 편집에서 같은 작업을 확인합니다.</p>
 </section>;
}
