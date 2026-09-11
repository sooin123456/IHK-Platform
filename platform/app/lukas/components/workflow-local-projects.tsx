import {useState} from 'react';
import type {LocalProject} from '../lib/workflow-projects';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';

const kinds={architecture:'건축',civil:'토목',both:'건축·토목'};
export function WorkflowLocalProjects({projects,documents,drafts,disabled,onDraft,onCreate,onStart,onOpen,onAssign,onOverview,onUpdate,onMembers}:{
 projects:LocalProject[];documents:WorkflowBlankDocument[];drafts:Record<string,string>;disabled:boolean;
 onDraft:(patch:Record<string,string>)=>void;onCreate:(name:string,kind:LocalProject['kind'])=>void;
 onStart:(id:string)=>void;onOpen:(id:string)=>void;onAssign:(id:string,projectId:string)=>void;onOverview:(id:string)=>void;
 onUpdate:(id:string,patch:Partial<Pick<LocalProject,'name'|'kind'|'archived'>>)=>void;
 onMembers:(id:string)=>void;
}){
 const [archiveId,setArchiveId]=useState<string|null>(null);
 const filter=drafts['projects:filter']??'active';
 const query=drafts['projects:search']??'',name=drafts['projects:name']??'';
 const kind=(drafts['projects:kind']??'architecture') as LocalProject['kind'];
 const matches=(text:string)=>text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
 const filtered=projects.filter(project=>(filter==='all'||(filter==='archived'?Boolean(project.archived):!project.archived))&&matches(`${project.name} ${documents.filter(doc=>doc.projectId===project.id).map(doc=>doc.title).join(' ')}`));
 const unassigned=documents.filter(doc=>!doc.projectId&&matches(doc.title));
 const drawing=(doc:WorkflowBlankDocument)=><article className="flow-project-work" key={doc.id} style={{overflowWrap:'anywhere'}}><div><h3>{doc.title}</h3><p>{doc.source?.name??'원본 없는 빈 도면'} · R{doc.revision??1} · 객체 {doc.shapes.length}개</p></div><button onClick={()=>onOpen(doc.id)}>{doc.title} 열기</button>{!doc.projectId&&projects.length>0&&<label className="flow-input">프로젝트에 묶기<select aria-label={`${doc.title} 프로젝트 지정`} value="" disabled={disabled} onChange={event=>onAssign(doc.id,event.target.value)}><option value="">프로젝트 선택</option>{projects.map(project=><option key={project.id} value={project.id} disabled={project.archived}>{project.name}</option>)}</select></label>}</article>;
 return <section className="flow-card" aria-label="내 프로젝트">
  <h2>내 프로젝트 · {projects.length}개</h2><p>프로젝트 하나에 여러 도면을 모읍니다. 파일 없이 프로젝트부터 만들 수 있습니다. 이 탭에 저장되며 다른 기기로 옮길 때는 작업 백업을 사용하세요.</p>
  <form onSubmit={event=>{event.preventDefault();if(!disabled&&name.trim()&&name.length<=120&&projects.length<30&&kind in kinds)onCreate(name.trim(),kind);}}>
   <label className="flow-input">새 프로젝트 이름<input aria-label="새 프로젝트 이름" maxLength={120} value={name} onChange={event=>onDraft({'projects:name':event.target.value})}/></label>
   <label className="flow-input">프로젝트 분야<select aria-label="프로젝트 분야" value={kind} onChange={event=>onDraft({'projects:kind':event.target.value})}>{Object.entries(kinds).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
   <button disabled={disabled||!name.trim()||projects.length>=30}>프로젝트 만들기</button>
  </form>
  <label className="flow-input">내 프로젝트 검색<input aria-label="내 프로젝트 검색" value={query} onChange={event=>onDraft({'projects:search':event.target.value})}/></label>
  {query&&<button onClick={()=>onDraft({'projects:search':''})}>내 프로젝트 검색 초기화</button>}
  <label className="flow-input">프로젝트 보관 상태<select aria-label="프로젝트 보관 상태" value={filter} onChange={event=>{setArchiveId(null);onDraft({'projects:filter':event.target.value});}}><option value="active">사용 중</option><option value="archived">보관함</option><option value="all">전체</option></select></label>
  {projects.length>0&&!filtered.length&&!query&&<p role="status">이 상태에 해당하는 프로젝트가 없습니다. 보관 상태를 변경해 확인하세요.</p>}
  {!projects.length&&!documents.length&&<p role="status">아직 프로젝트가 없습니다. 이름과 분야를 정하면 도면 없이 시작할 수 있습니다.</p>}
  {query&&!filtered.length&&!unassigned.length&&<p role="status">검색 결과가 없습니다. 검색어를 바꾸거나 초기화하세요.</p>}
  {filtered.map(project=>{
   const projectName=drafts[`project:${project.id}:name`]??project.name;
   const projectKind=(drafts[`project:${project.id}:kind`]??project.kind) as LocalProject['kind'];
   return <section className="flow-card" data-local-project={project.id} key={project.id} style={{overflowWrap:'anywhere'}}>
    <h3>{project.name}</h3><p>{kinds[project.kind]} · 도면 {documents.filter(doc=>doc.projectId===project.id).length}개{project.archived?' · 보관됨':''}</p>
    <button onClick={()=>onOverview(project.id)}>프로젝트 개요 열기</button>
    <button onClick={()=>onMembers(project.id)}>구성원 관리</button>
    <button disabled={disabled||project.archived} onClick={()=>onStart(project.id)}>이 프로젝트에 도면 추가</button>
    {project.archived?<><p>보관은 목록 정리입니다. 도면과 검토 기록은 삭제하지 않으며 기존 작업 권한을 잠그지 않습니다. 새 도면은 프로젝트 복원 후 추가하세요.</p><button disabled={disabled} onClick={()=>onUpdate(project.id,{archived:false})}>프로젝트 복원</button></>:<details>
     <summary>프로젝트 관리</summary>
     <label className="flow-input">프로젝트 이름 수정<input aria-label="프로젝트 이름 수정" maxLength={120} value={projectName} onChange={event=>onDraft({[`project:${project.id}:name`]:event.target.value})}/></label>
     <label className="flow-input">프로젝트 분야 수정<select aria-label="프로젝트 분야 수정" value={projectKind} onChange={event=>onDraft({[`project:${project.id}:kind`]:event.target.value})}>{Object.entries(kinds).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
     <button disabled={disabled||!projectName.trim()||!Object.hasOwn(kinds,projectKind)} onClick={()=>onUpdate(project.id,{name:projectName.trim(),kind:projectKind})}>프로젝트 정보 저장</button>
     <button disabled={disabled} onClick={()=>setArchiveId(project.id)}>프로젝트 보관</button>
     {archiveId===project.id&&<div role="group" aria-label="프로젝트 보관 확인"><p>{project.name}을 사용 중 목록에서 보관함으로 옮깁니다. 도면·검토·수량 기록은 유지되며 언제든 복원할 수 있습니다.</p><button disabled={disabled} onClick={()=>{onUpdate(project.id,{archived:true});setArchiveId(null);}}>프로젝트 보관 확인</button><button onClick={()=>setArchiveId(null)}>보관 취소</button></div>}
    </details>}
    {documents.filter(doc=>doc.projectId===project.id).map(drawing)}
    {!documents.some(doc=>doc.projectId===project.id)&&<p>아직 도면이 없습니다. 빈 도면, PDF 또는 템플릿으로 시작하세요.</p>}
   </section>;
  })}
  {unassigned.length>0&&<section aria-label="미분류 도면"><h3>미분류 도면 · {unassigned.length}개</h3><p>기존 도면은 그대로 보관했습니다. 원하는 프로젝트를 선택해 묶을 수 있습니다.</p>{unassigned.map(drawing)}</section>}
 </section>;
}
