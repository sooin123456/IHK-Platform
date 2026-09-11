import {useState} from 'react';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {fieldNoteMatches,type DocumentFieldNote} from '../lib/workflow-document-field';
import {inspectionChecks,inspectionPhase,recordInspection} from '../lib/workflow-inspections';

const phases={new:'점검 전',correction:'시정 필요',reinspection:'재검측 대기',closed:'점검 종결'};
const results={pass:'적합',fail:'부적합',na:'해당 없음'};
export function WorkflowInspection({document,record,drafts,onDraft,onChange}:{document:WorkflowBlankDocument;record:DocumentFieldNote;drafts:Record<string,string>;onDraft:(patch:Record<string,string>)=>void;onChange:(doc:WorkflowBlankDocument)=>void}){
 const key=`inspection:${document.id}:${record.id}:`;
 const value=(name:string,fallback='')=>drafts[key+name]??fallback;
 const edit=(name:string,text:string)=>onDraft({[key+name]:text});
 const role=value('role','reviewer'),item=document.inspections?.find(row=>row.fieldNoteId===record.id),phase=inspectionPhase(item);
 const action=phase==='new'?'inspect':phase==='correction'?'rectify':'reinspect';
 const permitted=phase!=='closed'&&role===(phase==='correction'?'author':'reviewer');
 const current=fieldNoteMatches(document,record);
 const [error,setError]=useState('');
 const draftKey=`${item?.events.length??0}:${role}:`;
 return <section aria-label={`기록 #${record.id} 점검·시정`}>
  <details open={value('open')==='1'} onToggle={event=>edit('open',event.currentTarget.open?'1':'0')}>
   <summary>점검·시정 관리 · {phases[phase]}</summary>
   <p>현장 기록 #{record.id} · {record.location} · {record.objectLabel}</p>
   <p>로컬 점검 흐름 체험입니다. 아래 세 항목은 예시 체크리스트이며 법정 안전검사·검측 승인·기성 확정이 아닙니다.</p>
   <label className="flow-input">점검 처리 역할<select aria-label="점검 처리 역할" value={role} onChange={event=>{edit('role',event.target.value);setError('');}}><option value="reviewer">검측 담당 체험</option><option value="author">시정 담당 체험</option><option value="viewer">열람 체험</option></select></label>
   <p role="status">{phases[phase]}{phase==='correction'?' · 시정 담당자가 조치 내용을 제출하세요.':phase==='reinspection'?' · 검측 담당자가 항목을 다시 확인하세요.':phase==='closed'?' · 이력을 보존합니다. 추가 점검은 새 현장 기록에서 시작하세요.':''}</p>
   {!current&&<p role="alert">도면 원본·개정·객체 위치가 달라졌습니다. 기존 이력은 유지되며 처리는 중지됩니다. 현재 근거로 새 현장 기록을 작성하세요.</p>}
   {permitted&&<fieldset disabled={!current||(item?.events.length??0)>=30}>
    {phase!=='correction'&&inspectionChecks.map((label,index)=><label className="flow-input" key={label}>{label}<select aria-label={label} value={value(draftKey+index)} onChange={event=>edit(draftKey+index,event.target.value)}><option value="">확인 결과 선택</option>{Object.entries(results).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>)}
    <label className="flow-input">처리 의견<textarea aria-label="처리 의견" maxLength={500} value={value(draftKey+'note')} onChange={event=>edit(draftKey+'note',event.target.value)}/></label>
    <button onClick={()=>{
     const updated=recordInspection(document,record.id,role,action,{note:value(draftKey+'note'),checks:inspectionChecks.map((_,index)=>value(draftKey+index))});
     if(updated===document){setError('처리 의견과 모든 점검 결과를 확인하세요. 최소 한 항목은 실제 확인 결과가 필요합니다.');return;}
     onChange(updated);onDraft(Object.fromEntries(['note','0','1','2'].map(name=>[key+draftKey+name,''])));setError('');
    }}>{phase==='new'?'점검 결과 보관':phase==='correction'?'시정 조치 제출':'재검측 결과 보관'}</button>
   </fieldset>}
   {(item?.events.length??0)>=30&&<p>이 기록의 처리 한도 30건에 도달했습니다. 기존 이력을 보존하고 새 현장 기록에서 이어가세요.</p>}
   {error&&<p role="alert">{error}</p>}
   {!!item&&<ol aria-label="점검 처리 이력">{item.events.map((event,index)=><li key={index}>
    <strong>{index+1}. {event.action==='inspect'?'최초 점검':event.action==='rectify'?'시정 조치 제출':'재검측'} · {event.action==='rectify'?'시정 담당':'검측 담당'}</strong>
    <p>{event.note}</p>
    {event.action!=='rectify'&&<ul>{event.checks.map((result,index)=><li key={index}>{inspectionChecks[index]}: {results[result]}</li>)}</ul>}
   </li>)}</ol>}
  </details>
 </section>;
}
