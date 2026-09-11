import {useSearchParams} from 'react-router';
import type {LocalProject} from '../lib/workflow-projects';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {submittalQueue,submittalMatches} from '../lib/workflow-submittals';
export function WorkflowSubmittalQueue({documents,projects=[],loading,onOpen}:{projects?:LocalProject[];documents:WorkflowBlankDocument[];loading:boolean;onOpen:(id:string,item:number,role:string,actor?:string)=>void}){
 const [params,setParams]=useSearchParams(),role=params.get('submissionQueueRole')??'author';
 const actor=params.get('submissionActor')??'';
 const members=[...new Map(projects.filter(project=>documents.some(doc=>doc.projectId===project.id)).flatMap(project=>project.members??[]).filter(member=>member.role===role).map(member=>[member.email,member])).values()];
 const rows=submittalQueue(documents,role,actor||undefined);
 return <section className="flow-card" aria-label="내 제출물 할 일"><h2>제출물 · 처리할 일 {rows.length}건</h2>
  <p>이 탭의 도면에서 담당 검토 대기와 아직 재제출하지 않은 보완 요청을 모았습니다. 실제 사용자 배정이 아닌 역할 체험이며 기한순으로 표시합니다.</p>
  <label className="flow-input">제출물 할 일 역할<select disabled={loading} aria-label="제출물 할 일 역할" value={role} onChange={event=>setParams(previous=>{const next=new URLSearchParams(previous);next.set('submissionQueueRole',event.target.value);return next;},{replace:true})}>{!['author','reviewer','approver','viewer'].includes(role)&&<option value={role}>알 수 없는 역할</option>}<option value="author">작성자</option><option value="reviewer">검토자</option><option value="approver">승인 담당자</option><option value="viewer">열람자</option></select></label>
  {(role==='reviewer'||role==='approver')&&<label className="flow-input">제출물 할 일 담당자<select aria-label="제출물 할 일 담당자" value={actor} onChange={event=>setParams(previous=>{const next=new URLSearchParams(previous);next.set('submissionActor',event.target.value);return next;},{replace:true})}><option value="">전체 담당자</option>{members.map(member=><option key={member.email} value={member.email}>{member.name} · {member.email}</option>)}{actor&&!members.some(member=>member.email===actor)&&<option value={actor}>현재 목록에 없는 담당자</option>}</select></label>}
  {loading?<p role="status">탭의 제출물을 복원하고 있습니다.</p>:!rows.length?<p>이 역할이 처리할 제출물이 없습니다.</p>:rows.map(({document,item})=><article className="flow-card" key={`${document.id}:${item.id}`}><h3>{item.title}</h3><p>{document.title} · 제출 #{item.id} · 기한 {item.due}</p><p>{item.reviewerName?`담당자 ${item.reviewerName} · `:''}관련 도면 {item.attachments?.length??0}개</p><p>{item.phase==='changes'?'보완 후 재제출 필요':'제출물 검토 필요'}</p>{!submittalMatches(document,item,documents)&&<p>제출 이후 도면 변경 · 그대로 수락할 수 없습니다.</p>}<button aria-label={`${item.title} 처리하기`} onClick={()=>onOpen(document.id,item.id,role,actor||item.reviewerEmail)}>처리하기</button></article>)}
 </section>;
}
