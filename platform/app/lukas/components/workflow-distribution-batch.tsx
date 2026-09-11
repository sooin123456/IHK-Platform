import {useState} from 'react';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import type {LocalProject} from '../lib/workflow-projects';
import {prepareDistributionBatch} from '../lib/workflow-document-delivery';
export function WorkflowDistributionBatch({documents,projects,selectedProjectId,drafts,onDraft,onChange}:{documents:WorkflowBlankDocument[];projects:LocalProject[];selectedProjectId?:string;drafts:Record<string,string>;onDraft:(patch:Record<string,string>)=>void;onChange:(documents:WorkflowBlankDocument[])=>void}){
 const [result,setResult]=useState('');
 const projectId=selectedProjectId??drafts['distribution:project']??projects[0]?.id??'';
 const prefix=`distribution:${projectId}:`,value=(field:string)=>drafts[prefix+field]??'';
 const edit=(field:string,text:string)=>{onDraft({[prefix+field]:text});setResult('');};
 const candidates=documents.filter(doc=>doc.projectId===projectId&&doc.reviewRounds?.some(round=>round.phase==='approved'));
 const selectionPrefix=prefix+'document:';
 const items=Object.entries(drafts).filter(([key,text])=>key.startsWith(selectionPrefix)&&text!=='').map(([key,text])=>({id:key.slice(selectionPrefix.length),revision:Number(text)}));
 return <section className="flow-card" aria-label="여러 도면 배포"><h2>여러 도면 배포</h2><p>같은 프로젝트의 승인 도면 2~20개를 하나의 문서번호로 준비합니다. 실제 파일 전송은 하지 않으며, 수신 확인은 각 도면에서 따로 기록합니다. 검산 결과는 포함하지 않는 도면 배포 묶음입니다.</p>
  <label className="flow-input">배포 프로젝트<select aria-label="배포 프로젝트" value={projectId} disabled={Boolean(selectedProjectId)} onChange={event=>{onDraft({'distribution:project':event.target.value});setResult('');}}>{!projects.some(project=>project.id===projectId)&&<option value={projectId}>프로젝트를 선택하세요</option>}{projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
  {!candidates.length&&<p>이 프로젝트에 승인된 도면이 없습니다. 도면의 검토·승인을 먼저 완료하세요.</p>}
  <fieldset><legend>승인 도면 선택 · {items.length}/20</legend>{candidates.map(doc=>{const approved=doc.reviewRounds!.filter(round=>round.phase==='approved'),selected=items.find(item=>item.id===doc.id);return <div key={doc.id}><label><input type="checkbox" aria-label={`${doc.title} 묶음 선택`} checked={Boolean(selected)} disabled={!selected&&items.length>=20} onChange={event=>edit('document:'+doc.id,event.target.checked?String(approved.at(-1)!.revision):'')}/>{doc.title}</label>{selected&&<label className="flow-input">승인 개정<select aria-label={`${doc.title} 묶음 승인 개정`} value={selected.revision} onChange={event=>edit('document:'+doc.id,event.target.value)}>{!approved.some(round=>round.revision===selected.revision)&&<option value={selected.revision}>선택했던 개정 없음</option>}{approved.map(round=><option key={round.revision} value={round.revision}>R{round.revision} · {round.source.name}</option>)}</select></label>}</div>;})}{items.filter(item=>!candidates.some(doc=>doc.id===item.id)).map(item=><p role="alert" key={item.id}>선택했던 도면이 현재 프로젝트에 없습니다. <button onClick={()=>edit('document:'+item.id,'')}>누락 선택 해제</button></p>)}</fieldset>
  <label className="flow-input">수신 대상<input aria-label="묶음 수신 대상" maxLength={120} value={value('recipient')} onChange={event=>edit('recipient',event.target.value)}/></label>
  <label className="flow-input">문서번호<input aria-label="묶음 문서번호" maxLength={80} value={value('reference')} onChange={event=>edit('reference',event.target.value)}/></label>
  <label className="flow-input">발행일<input aria-label="묶음 발행일" type="date" value={value('issuedOn')} onChange={event=>edit('issuedOn',event.target.value)}/></label>
  <button disabled={items.length<2||items.length>20} onClick={()=>{const next=prepareDistributionBatch(documents,{id:crypto.randomUUID(),recipient:value('recipient'),reference:value('reference'),issuedOn:value('issuedOn'),items});if(next===documents){setResult('준비하지 않았습니다. 수신 대상·문서번호·발행일·승인 개정과 이력 한도를 확인하세요.');return;}onChange(next);onDraft(Object.fromEntries(items.map(item=>[selectionPrefix+item.id,''])));setResult(`${items.length}개 도면을 배포 묶음으로 준비했습니다. 배포·수신 대장에서 확인하세요.`);}}>선택한 도면 배포 묶음 준비</button>
  {result&&<p role="status">{result}</p>}
 </section>;
}
