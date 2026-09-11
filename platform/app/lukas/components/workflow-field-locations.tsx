import {useSearchParams} from 'react-router';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {indexFieldLocations} from '../lib/workflow-field-locations';
import {fieldNoteMatches} from '../lib/workflow-document-field';
export function WorkflowFieldLocations({documents,onOpen}:{documents:WorkflowBlankDocument[];onOpen:(id:string,target:string,page:number)=>void}){
 const [params,setParams]=useSearchParams();const value=params.get('fieldLocation')??'';const groups=indexFieldLocations(documents);
 const all=documents.flatMap(document=>(document.fieldNotes??[]).map(record=>({document,record}))),selected=groups.find(group=>group.key===value);
 const records=value?selected?.records??[]:all;
 return <section className="flow-card" aria-label="전체 도면 위치별 기록"><h3>위치별 현장 기록</h3><p>이 탭의 모든 도면에 보관한 관찰 기록입니다. 실제 프로젝트 통합·지도 좌표·검측 승인 결과가 아닙니다.</p>
 <label className="flow-input">전체 기록 위치<select aria-label="전체 기록 위치" value={value} onChange={event=>setParams(previous=>{const next=new URLSearchParams(previous);if(event.target.value)next.set('fieldLocation',event.target.value);else next.delete('fieldLocation');return next;},{replace:true,preventScrollReset:true})}><option value="">전체 위치 · {all.length}건</option>{value&&!selected&&<option value={value}>선택한 위치 없음</option>}{groups.map(group=><option key={group.key} value={group.key}>{group.label} · {group.records.length}건</option>)}</select></label>
 <p role="status">표시 {records.length} / 전체 {all.length}건 · {new Set(records.map(item=>item.document.id)).size}개 도면</p>
 {!records.length&&<p>{value?'선택한 위치의 기록이 없습니다. 전체 위치를 선택해 다시 확인하세요.':'아직 보관한 현장 기록이 없습니다. 아래에서 도면과 객체를 선택해 기록하세요.'}</p>}
 {value&&!records.length&&<button onClick={()=>setParams(previous=>{const next=new URLSearchParams(previous);next.delete('fieldLocation');return next;},{replace:true,preventScrollReset:true})}>전체 위치로 돌아가기</button>}
 {records.map(({document,record})=>{const matches=fieldNoteMatches(document,record);return <article className="flow-card" key={`${document.id}:${record.id}`} style={{overflowWrap:'anywhere'}}><h4>{record.title}</h4><p>{document.title} · {record.location}</p><p>{record.source.name} · R{record.revision} · {record.page}쪽 · {record.objectLabel}</p><p>{record.note}</p>{!matches&&<p role="status">원본·개정·객체 위치 재확인 필요 · 현재 위치로 대체하지 않습니다.</p>}<button disabled={!matches} onClick={()=>onOpen(document.id,record.objectId,record.page)}>{document.title} · 기록 #{record.id} 근거 열기</button></article>;})}
 </section>;
}
