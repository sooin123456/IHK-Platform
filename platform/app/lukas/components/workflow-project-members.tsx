import {WorkflowMembers} from './workflow-members';
import {saveProjectMember,type LocalProject} from '../lib/workflow-projects';

export function WorkflowProjectMembers({projects,selectedId,drafts,onDraft,onSelect,onChange,onStart}:{projects:LocalProject[];selectedId?:string;drafts:Record<string,string>;onDraft:(patch:Record<string,string>)=>void;onSelect:(id:string)=>void;onChange:(project:LocalProject)=>void;onStart:()=>void}){
 const project=selectedId?projects.find(project=>project.id===selectedId):projects[0];
 const roleKey=`project:${project?.id??'none'}:members:role`,role=drafts[roleKey]??'admin';
 return <section className="flow-card" aria-label="내 프로젝트 구성원"><h2>내 프로젝트 구성원</h2><p>프로젝트별 담당자·역할을 계획하는 로컬 화면입니다. 예시 구성원은 포함하지 않습니다.</p>
  <label className="flow-input">구성원 프로젝트<select aria-label="구성원 프로젝트" value={project?.id??''} onChange={event=>onSelect(event.target.value)}>{!project&&<option value="">프로젝트를 선택하세요</option>}{projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
  {project?<><label className="flow-input">구성원 설정 체험 역할<select aria-label="구성원 설정 체험 역할" value={role} onChange={event=>onDraft({[roleKey]:event.target.value})}>{!['admin','viewer'].includes(role)&&<option value={role}>알 수 없는 역할</option>}<option value="admin">관리자 체험</option><option value="viewer">열람자 체험</option></select></label>
   <WorkflowMembers key={project.id} state={{members:project.members??[],role:role==='admin'?'author':'viewer'}} projectName={project.name} dispatch={action=>{if(action.type!=='member-plan')return;const next=saveProjectMember(project,role,action);if(next!==project)onChange(next);}}/>
  </>:<><p role="status">{selectedId?'선택한 프로젝트가 없습니다. 다른 프로젝트로 대체하지 않습니다.':'먼저 프로젝트를 만들면 구성원 배치안을 보관할 수 있습니다.'}</p><button onClick={onStart}>프로젝트 목록·만들기</button></>}
 </section>;
}
