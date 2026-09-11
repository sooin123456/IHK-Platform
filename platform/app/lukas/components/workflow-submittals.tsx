import {useState} from 'react';
import {useSearchParams} from 'react-router';
import {SupportingFileInput,SupportingFileRow} from './workflow-supporting-files';
import {readSupportingFileDraft,supportingFileDraftPatch,recallSupportingFile} from '../lib/workflow-supporting-files';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import type {LocalProject} from '../lib/workflow-projects';
import {submitDrawing,decideSubmittal,submittalMatches,submittalAttachmentMatches} from '../lib/workflow-submittals';

export function WorkflowSubmittals({documents,projects=[],drafts,onDraft,onChange,onOpen,onStart}:{
 projects?:LocalProject[];
 documents:WorkflowBlankDocument[];drafts:Record<string,string>;
 onDraft:(patch:Record<string,string>)=>void;onChange:(doc:WorkflowBlankDocument)=>void;
 onOpen:(id:string,submissionDocument?:string)=>void;onStart:()=>void;
}){
 const [params,setParams]=useSearchParams();const [error,setError]=useState('');
 const [fileBusy,setFileBusy]=useState(false),[,refreshFiles]=useState(0);
 const verified=()=>refreshFiles(value=>value+1);
 const document=documents.find(doc=>doc.id===(params.get('submissionDocument')??documents[0]?.id));
 const role=params.get('submissionRole')??'author';
 const key=`submission:${document?.id??'none'}:`;
 const value=(field:string,fallback='')=>drafts[key+field]??fallback;
 const edit=(field:string,text:string)=>onDraft({[key+field]:text});
 const members=projects.find(project=>project.id===document?.projectId)?.members??[];
 const reviewers=members.filter(member=>member.role===value('assignee','reviewer'));
 const actorEmail=params.get('submissionActor')??'';
 const actor=members.find(member=>member.email===actorEmail&&member.role===role);
 const reviewer=reviewers.find(member=>member.email===value('reviewerEmail'));
 const filePrefix=key+'files';const supportingFiles=readSupportingFileDraft(drafts,filePrefix);
 const attachmentPrefix=key+'attachment:';
 const attachmentIds=Object.keys(drafts).filter(name=>name.startsWith(attachmentPrefix)&&drafts[name]==='1').map(name=>name.slice(attachmentPrefix.length));
 const candidates=documents.filter(doc=>doc.id!==document?.id&&doc.projectId===document?.projectId);
 const previous=value('previous')?Number(value('previous')):undefined;
 const changeParam=(name:string,value:string)=>setParams(previous=>{const next=new URLSearchParams(previous);next.set(name,value);return next;},{replace:true});
 const phases={submitted:'검토 대기',changes:'보완 요청',accepted:'수락'};
 const selected=params.get('submissionItem');
 const items=[...(document?.submittals??[])].reverse().filter(item=>!selected||String(item.id)===selected);
 return <section aria-label="제출물 검토">
  <header className="flow-card"><h2>제출물 검토</h2><p>시공도 등 도면 제출을 등록하고 검토 의견과 재제출 이력을 이어갑니다. 이 탭의 역할 체험이며 실제 발송·전자결재가 아닙니다. 수락은 도면·수량의 최종 승인이 아닙니다.</p>
   {params.get('submissionQueueReturn')==='1'&&<button onClick={()=>setParams({page:'tasks',scope:'local',submissionQueueRole:params.get('submissionQueueRole')??role,submissionActor:actorEmail,...(document?.projectId?{project:document.projectId}:{})})}>제출물 할 일로 돌아가기</button>}
   <label className="flow-input">제출물 역할 체험<select aria-label="제출물 역할 체험" value={role} onChange={event=>changeParam('submissionRole',event.target.value)}>{!['author','reviewer','approver','viewer'].includes(role)&&<option value={role}>알 수 없는 역할</option>}<option value="author">작성자</option><option value="reviewer">검토자</option><option value="approver">승인 담당자</option><option value="viewer">열람자</option></select></label>
   {(role==='reviewer'||role==='approver')&&<label className="flow-input">검토 중인 구성원<select aria-label="검토 중인 구성원" value={actorEmail} onChange={event=>changeParam('submissionActor',event.target.value)}><option value="">역할만 체험 · 미지정 제출물</option>{members.filter(member=>member.role===role).map(member=><option key={member.email} value={member.email}>{member.name} · {member.email}</option>)}{actorEmail&&!actor&&<option value={actorEmail}>현재 프로젝트·역할에 없는 구성원</option>}</select></label>}
   <label className="flow-input">제출 대상 도면<select aria-label="제출 대상 도면" value={document?.id??''} onChange={event=>{
    const id=event.target.value;
    setParams(previous=>{const next=new URLSearchParams(previous);next.set('submissionDocument',id);next.delete('submissionItem');return next;},{replace:true});
    setError('');
   }}>{!document&&<option value="">도면을 선택하세요</option>}{documents.map(doc=><option key={doc.id} value={doc.id}>{doc.title}</option>)}</select></label>
  </header>
  {!document?<div className="flow-card"><p>선택한 로컬 도면이 없습니다. 예시 도면으로 대체하지 않습니다.</p><button onClick={onStart}>도면 준비하기</button></div>:<>
   {role==='author'&&<section className="flow-card" aria-label="제출물 작성"><h3>{previous?`#${previous} 보완 후 재제출`:'새 제출물'}</h3>
    <label className="flow-input">제출 제목<input aria-label="제출 제목" maxLength={120} value={value('title')} onChange={event=>edit('title',event.target.value)}/></label>
    <label className="flow-input">검토 담당 역할<select aria-label="검토 담당 역할" value={value('assignee','reviewer')} onChange={event=>onDraft({[key+'assignee']:event.target.value,[key+'reviewerEmail']:''})}><option value="reviewer">검토자</option><option value="approver">승인 담당자</option></select></label>
    <label className="flow-input">프로젝트 검토 담당자<select aria-label="프로젝트 검토 담당자" value={value('reviewerEmail')} onChange={event=>edit('reviewerEmail',event.target.value)}><option value="">담당자 미지정 · 이름 직접 입력</option>{reviewers.map(member=><option key={member.email} value={member.email}>{member.name} · {member.email}</option>)}{value('reviewerEmail')&&!reviewer&&<option value={value('reviewerEmail')}>이전 담당자 · 현재 역할에 없음</option>}</select></label>
    {!reviewers.length&&<p>이 프로젝트에 해당 역할의 구성원이 없습니다. 프로젝트 목록의 구성원 관리에서 배치할 수 있습니다.</p>}
    {value('reviewerEmail')&&!reviewer&&<p role="alert">담당자가 삭제되었거나 역할이 변경되었습니다. 제출 전에 다시 선택하세요.</p>}
    <label className="flow-input">검토 담당자 이름 (선택)<input aria-label="검토 담당자 이름" maxLength={80} value={value('reviewerName')} onChange={event=>edit('reviewerName',event.target.value)}/></label><p>담당자 표기용입니다. 실제 계정 배정·알림·권한 인증은 수행하지 않습니다.</p>
    <fieldset><legend>함께 제출할 관련 도면 · {attachmentIds.length}/9</legend><p>같은 프로젝트의 도면을 묶습니다. 주 도면을 포함해 최대 10개이며, 각 도면의 제출 당시 데이터 기준을 기록합니다.</p>{candidates.map(doc=><label key={doc.id}><input type="checkbox" aria-label={`${doc.title} 함께 제출`} checked={attachmentIds.includes(doc.id)} disabled={attachmentIds.length>=9&&!attachmentIds.includes(doc.id)} onChange={event=>edit(`attachment:${doc.id}`,event.target.checked?'1':'')}/>{doc.title} · R{doc.revision??1}<br/></label>)}{!candidates.length&&<p>함께 제출할 다른 도면이 없습니다.</p>}{attachmentIds.filter(id=>!candidates.some(doc=>doc.id===id)).map(id=><p role="alert" key={id}>선택했던 관련 도면을 찾을 수 없습니다. <button onClick={()=>edit(`attachment:${id}`,'')}>누락된 도면 선택 해제</button></p>)}</fieldset>
    <label className="flow-input">검토 기한<input type="date" aria-label="검토 기한" value={value('due')} onChange={event=>edit('due',event.target.value)}/></label>
    <label className="flow-input">제출 설명<textarea aria-label="제출 설명" maxLength={500} value={value('message')} onChange={event=>edit('message',event.target.value)}/></label>
    <SupportingFileInput key={key} files={supportingFiles} onChange={files=>onDraft(supportingFileDraftPatch(files,filePrefix))} onBusy={setFileBusy} onVerified={verified}/>
    <p>현재 도면의 제목·개정·원본 정보와 객체 데이터 기준을 보관합니다. 원본 파일을 별도로 전송하거나 과거 도면을 복원하는 기능은 아닙니다.</p>
    <div className="flow-actions"><button disabled={fileBusy||(document.submittals?.length??0)>=100} onClick={()=>{
     if(value('reviewerEmail')&&!reviewer){setError('현재 프로젝트의 검토 담당자를 다시 선택하세요.');return;}
     const next=submitDrawing(document,role,{title:value('title'),due:value('due'),assignee:value('assignee','reviewer'),message:value('message'),...(reviewer?{reviewerName:reviewer.name,reviewerEmail:reviewer.email}:value('reviewerName').trim()?{reviewerName:value('reviewerName')}:{}),attachmentIds,...(supportingFiles.length?{supportingFiles}:{})},previous,documents);
     if(next===document){setError('제목·기한·설명과 관련 도면 선택을 확인하세요. 이미 재제출한 요청은 다시 사용할 수 없습니다.');return;}
     onChange(next);onDraft({[key+'previous']:'',[key+'message']:''});if(selected)changeParam('submissionItem',String(next.submittals!.at(-1)!.id));setError('');
    }}>{previous?'현재 도면 재제출':'현재 도면 제출'}</button>{previous&&<button onClick={()=>edit('previous','')}>재제출 연결 해제</button>}</div>
    {(document.submittals?.length??0)>=100&&<p>도면당 제출 100건 한도에 도달했습니다. 기존 기록은 유지됩니다.</p>}
   </section>}
   {error&&<p role="alert">{error}</p>}
   <section aria-label="제출 이력"><h3>제출 이력 · {document.submittals?.length??0}건</h3>
    {selected&&<p>{items.length?`선택한 제출 #${selected}을 보고 있습니다.`:'선택한 제출 기록을 찾을 수 없습니다. 다른 기록으로 대체하지 않습니다.'} <button onClick={()=>changeParam('submissionItem','')}>전체 제출 이력 보기</button></p>}
    {!document.submittals?.length&&<p>아직 제출한 자료가 없습니다. 작성자 역할에서 현재 도면을 제출하세요.</p>}
    {items.map(item=>{
     const matches=submittalMatches(document,item,documents),next=document.submittals?.find(row=>row.previous===item.id);
     const filesReady=(item.supportingFiles??[]).every(file=>recallSupportingFile(file.sha256));
     const noteKey=`decision:${item.id}:${role}`;
     return <article className="flow-card" key={`${document.id}:${item.id}`}><h3>#{item.id} · {item.title}</h3><p><strong>{phases[item.phase]}</strong> · 담당 {item.assignee==='reviewer'?'검토자':'승인 담당자'} · 기한 {item.due}</p>
      <p>{item.documentTitle} · 개정 {item.revision} · {item.sourceName}</p><p>{item.message}</p>
      {item.reviewerName&&<p>검토 담당자: {item.reviewerName}{item.reviewerEmail&&<> · {item.reviewerEmail}</>}</p>}
      {Boolean(item.supportingFiles?.length)&&<section aria-label={`제출 보조 자료 ${item.id}`}><h4>제출 당시 보조 자료 · {item.supportingFiles!.length}개</h4><p>원본 바이트는 서버·백업에 포함하지 않습니다. 수락 전에 동일 해시의 원본을 연결해 확인하세요.</p>{item.supportingFiles!.map(file=><SupportingFileRow key={file.sha256} file={file} onVerified={verified}/>)}</section>}
      {Boolean(item.attachments?.length)&&<section aria-label={`제출 묶음 ${item.id}`}><h4>관련 도면 · {item.attachments!.length}개</h4>{item.attachments!.map(attachment=>{const related=documents.find(doc=>doc.id===attachment.documentId),current=related&&submittalAttachmentMatches(related,attachment);return <div key={attachment.documentId}><p>{attachment.documentTitle} · R{attachment.revision} · {attachment.sourceName}</p><p>{current?'제출 당시 기준과 일치':'관련 도면이 변경되었거나 현재 목록에 없습니다'}</p><button aria-label={`관련 도면 확인 ${item.id} ${attachment.documentId}`} disabled={!current} onClick={()=>onOpen(attachment.documentId,document.id)}>관련 도면 확인</button></div>;})}</section>}
      {item.previous&&<p>이전 제출 #{item.previous}의 보완 건입니다.</p>}{item.decision&&<p>검토 의견: {item.decision}</p>}{next&&<p>#{next.id}로 재제출됨 · {phases[next.phase]}</p>}
      {!matches&&<p role="status">제출 이후 도면 데이터가 달라졌습니다. 현재 도면을 제출 당시 자료로 간주하지 않습니다. {next?'연결된 재제출 기록을 확인하세요.':item.phase==='accepted'?'수락 이력은 유지됩니다. 변경된 도면은 새 제출물로 등록하세요.':item.phase==='changes'?'작성자가 현재 도면으로 재제출할 수 있습니다.':'보완 요청 후 재제출하세요.'}</p>}
      <button disabled={!matches} onClick={()=>onOpen(document.id)} aria-label={`현재 도면 확인 ${item.id}`}>현재 도면 확인</button>
      {item.phase==='submitted'&&item.reviewerEmail&&(!actor||actor.email!==item.reviewerEmail)&&<p role="status">지정된 담당자로 전환하면 검토할 수 있습니다.</p>}
      {item.decisionBy&&<p>검토 처리자: {item.decisionBy} · 화면 체험 기록</p>}
      {item.phase==='submitted'&&role===item.assignee&&(!item.reviewerEmail||actor?.email===item.reviewerEmail)&&<div>
       <label className="flow-input">검토 의견<textarea aria-label={`검토 의견 ${item.id}`} maxLength={500} value={value(noteKey)} onChange={event=>edit(noteKey,event.target.value)}/></label>
       {!filesReady&&<p role="status">보조 자료 원본을 다시 연결한 뒤 수락할 수 있습니다. 보완 요청은 계속 가능합니다.</p>}
       <div className="flow-actions">{(['changes','accepted'] as const).map(phase=><button key={phase} disabled={phase==='accepted'&&(!matches||!filesReady)} aria-label={`${phase==='changes'?'보완 요청':'제출물 수락'} ${item.id}`} onClick={()=>{
        const updated=decideSubmittal(document,item.id,role,phase,value(noteKey),documents,(item.supportingFiles??[]).filter(file=>recallSupportingFile(file.sha256)).map(file=>file.sha256),actor?.email);
        if(updated===document){setError('검토 의견과 담당 역할, 제출 당시 도면 상태를 확인하세요.');return;}
        onChange(updated);edit(noteKey,'');setError('');
       }}>{phase==='changes'?'보완 요청':'제출물 수락'}</button>)}</div>
      </div>}
      {item.phase==='changes'&&!next&&role==='author'&&<button aria-label={`재제출 준비 ${item.id}`} onClick={()=>{onDraft({...supportingFileDraftPatch(item.supportingFiles??[],filePrefix),...Object.fromEntries(attachmentIds.map(id=>[attachmentPrefix+id,''])),...Object.fromEntries((item.attachments??[]).map(attachment=>[attachmentPrefix+attachment.documentId,'1'])),[key+'reviewerEmail']:item.reviewerEmail??'',[key+'reviewerName']:item.reviewerName??'',[key+'previous']:String(item.id),[key+'title']:item.title,[key+'due']:item.due,[key+'assignee']:item.assignee,[key+'message']:''});setError('');}}>재제출 준비</button>}
     </article>;
    })}
   </section>
  </>}
 </section>;
}
