import {useState} from 'react';
import {useSearchParams} from 'react-router';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {actOnRfi,createRfi,reopenRfi,reassignRfi,selectRfis,rfiDraftKey,saveRfiDraft,type DocumentRfi,type RfiDraft} from '../lib/workflow-document-rfi';
import {commentMatches} from '../lib/workflow-document-comments';
const roleNames={author:'작성자',reviewer:'검토자',approver:'승인자',viewer:'열람자'};
type Props={document:WorkflowBlankDocument;onChange:(document:WorkflowBlankDocument)=>void};
function draftState(document:WorkflowBlankDocument,key:string,onChange:Props['onChange'],defaults:Partial<Pick<RfiDraft,'due'|'assignee'>>={}){
 const saved=document.rfiDrafts?.find(draft=>draft.key===key);
 const draft:RfiDraft=saved??{key,title:'',question:'',due:'',assignee:'reviewer',text:'',...defaults};
 const full=!saved&&(document.rfiDrafts?.length??0)>=200;
 return {draft,full,set:(field:keyof RfiDraft,value:string)=>onChange(saveRfiDraft(document,{...draft,[field]:value}))};
}
export function WorkflowRfiComposer({document,objectId,role,onChange}:Props&{objectId:string;role:string}){
 const {draft,full,set}=draftState(document,rfiDraftKey(document,objectId,role,'compose'),onChange);
 const {title,question,due,assignee}=draft;const setTitle=(value:string)=>set('title',value),setQuestion=(value:string)=>set('question',value),setDue=(value:string)=>set('due',value),setAssignee=(value:string)=>set('assignee',value);
 const [notice,setNotice]=useState('');
 return <section className="flow-card" aria-label="선택 객체 공식 질의"><details><summary>선택 객체 공식 질의 작성</summary>
 <p>담당 역할의 답변과 작성자의 종결을 체험합니다. 실제 사람 지정·전송·공식 발행이 아니며 도면 승인과 별도입니다.</p>
 <p>{full?'초안 200건 한도입니다. 기존 초안은 유지됩니다.':'입력 중인 초안도 이 탭에 보관됩니다. 등록 전에는 질의 목록에 나타나지 않습니다.'}</p>
 <form onSubmit={event=>{event.preventDefault();const next=createRfi(document,role,{objectId,title,question,due,assignee});if(next!==document){onChange(next);setNotice('질의를 이 탭에 등록했습니다. 검토의 질의 목록에서 답변을 이어가세요.');}else setNotice('역할·날짜·입력 내용 또는 도면당 100건 한도를 확인하세요.');}}>
 <fieldset disabled={role!=='author'||full||(document.rfis?.length??0)>=100}>
 <label className="flow-input">제목<input aria-label="질의 제목" required maxLength={120} value={title} onChange={event=>setTitle(event.target.value)}/></label>
 <label className="flow-input">질문<textarea aria-label="질의 내용" required maxLength={1000} value={question} onChange={event=>setQuestion(event.target.value)}/></label>
 <label className="flow-input">답변 담당 역할<select aria-label="질의 답변 담당" value={assignee} onChange={event=>setAssignee(event.target.value)}><option value="reviewer">검토자 체험</option><option value="approver">승인자 체험</option></select></label>
 <label className="flow-input">답변 기한<input aria-label="질의 답변 기한" type="date" required value={due} onChange={event=>setDue(event.target.value)}/></label>
 <button type="submit" disabled={!title.trim()||!question.trim()||!due}>질의 등록 (체험)</button></fieldset></form>
 {role!=='author'&&<p>작성자 체험에서 질의를 등록할 수 있습니다.</p>}{(document.rfis?.length??0)>=100&&<p>도면당 질의 100건 한도입니다.</p>}<p role="status">{notice}</p>
 </details></section>;
}
function RfiCard({document,record,role,onChange,onOpen}:Props&{record:DocumentRfi;role:string;onOpen:()=>void}){
 const {draft,full,set}=draftState(document,rfiDraftKey(document,record.objectId,role,`${record.id}:${record.phase}`),onChange,{due:record.due,assignee:record.assignee});
 const [,setParams]=useSearchParams();const [notice,setNotice]=useState('');
 const followup=document.rfis?.find(row=>row.reopenedFrom===record.id);
 const text=draft.text;const setText=(value:string)=>set('text',value);const matches=commentMatches(document,record);
 const canAct=!full&&matches&&(record.phase==='requested'?role===record.assignee:record.phase==='answered'&&role==='author');
 const phaseNames={requested:'답변 대기',answered:'답변 완료',closed:'종결 완료'};
 return <article className="flow-card" style={{overflowWrap:'anywhere'}}><h3>RFI #{record.id} · {record.title}</h3><p>{document.title} · {record.objectLabel} · {record.page}쪽 · R{record.revision}</p>
 <p>{phaseNames[record.phase]} · 담당 {roleNames[record.assignee]} 체험 · 기한 {record.due}</p><p style={{whiteSpace:'pre-wrap'}}>{record.text}</p>
 <button disabled={!matches} onClick={onOpen}>RFI #{record.id} 도면 위치</button>{!matches&&<p>원본·개정·객체 위치가 달라 재확인이 필요합니다. 이전 질의는 보존하며 현재 근거로 새 질의를 작성하세요.</p>}
 {record.reopenedFrom&&<p>RFI #{record.reopenedFrom}의 후속 질의 · 추가 확인 사유: {record.reopenReason}</p>}{followup&&<p>RFI #{followup.id}로 후속 질의가 등록되었습니다. 기존 답변과 종결 기록은 유지됩니다.</p>}
 {record.answer&&<p style={{whiteSpace:'pre-wrap'}}>답변: {record.answer}</p>}{record.closure&&<p style={{whiteSpace:'pre-wrap'}}>종결 사유: {record.closure}</p>}
 {record.phase!=='closed'&&!(record.phase==='requested'&&role==='author')&&<><p>{full?'초안 보관 한도입니다. 기존 기록은 유지됩니다.':'미제출 의견은 도면·질의·처리 역할별로 이 탭에 보관됩니다.'}</p><label className="flow-input">{record.phase==='requested'?'담당자 답변':'작성자 종결 사유'}<textarea aria-label={`RFI #${record.id} 처리 의견`} maxLength={1000} disabled={!canAct} value={text} onChange={event=>setText(event.target.value)}/></label><button disabled={!canAct||!text.trim()} onClick={()=>{const next=actOnRfi(document,record.id,role,record.phase==='requested'?'answer':'close',text);if(next!==document)onChange(next);}}>RFI #{record.id} {record.phase==='requested'?'답변':'종결'} 보관</button></>}
 {Boolean(record.assignmentHistory?.length)&&<details><summary>담당·기한 변경 이력 {record.assignmentHistory!.length}건</summary><section aria-label={`RFI #${record.id} 배정 이력`}>{record.assignmentHistory!.map(change=><p key={change.id}>#{change.id} · {roleNames[change.fromAssignee]} / {change.fromDue} → {roleNames[change.assignee]} / {change.due}<br/>변경 사유: {change.reason}</p>)}</section></details>}
 {record.phase==='requested'&&role==='author'&&<form aria-label={`RFI #${record.id} 배정 변경`} onSubmit={event=>{event.preventDefault();const next=reassignRfi(document,record.id,role,{reason:text,due:draft.due,assignee:draft.assignee});if(next===document){setNotice('변경할 담당·기한, 사유와 원본 근거를 확인하세요.');return;}onChange(next);setNotice('담당·기한 변경 이력에 보관했습니다.');setParams(previous=>{const params=new URLSearchParams(previous);params.delete('rfiAssignee');return params;},{replace:true});}}>
  <h4>담당 역할·기한 변경</h4><p>답변 전 배정을 변경합니다. 실제 사람 지정·알림 전송이 아닌 역할 체험입니다. 변경 사유를 남겨주세요.</p><fieldset disabled={!matches||full||(record.assignmentHistory?.length??0)>=20}>
  <label className="flow-input">변경 담당 역할<select aria-label={`RFI #${record.id} 변경 담당 역할`} value={draft.assignee} onChange={event=>set('assignee',event.target.value)}><option value="reviewer">검토자 체험</option><option value="approver">승인자 체험</option></select></label>
  <label className="flow-input">변경 답변 기한<input aria-label={`RFI #${record.id} 변경 답변 기한`} type="date" required value={draft.due} onChange={event=>set('due',event.target.value)}/></label>
  <label className="flow-input">변경 사유<textarea aria-label={`RFI #${record.id} 변경 사유`} required maxLength={1000} value={text} onChange={event=>setText(event.target.value)}/></label>
  <button type="submit" disabled={!text.trim()||!draft.due||(draft.assignee===record.assignee&&draft.due===record.due)}>RFI #{record.id} 담당·기한 변경</button></fieldset>{(record.assignmentHistory?.length??0)>=20&&<p>배정 변경 이력 20건 한도입니다. 기존 기록은 유지됩니다.</p>}{notice&&<p role="status">{notice}</p>}
 </form>}
 {record.phase==='closed'&&role==='author'&&!followup&&<form aria-label={`RFI #${record.id} 후속 질의`} onSubmit={event=>{event.preventDefault();const next=reopenRfi(document,record.id,role,{reason:text,due:draft.due,assignee:draft.assignee});if(next===document){setNotice('원본 근거·기한·사유와 질의 한도를 확인하세요.');return;}onChange(next);setParams(previous=>{const params=new URLSearchParams(previous);params.delete('rfiPhase');params.delete('rfiAssignee');return params;},{replace:true});}}>
  <h4>추가 확인이 필요한가요?</h4><p>기존 질의를 보존하고 연결된 새 질의를 등록합니다. 원본이나 객체 위치가 바뀌었다면 작업실에서 새 근거로 질의를 작성하세요.</p><fieldset disabled={!matches||full||(document.rfis?.length??0)>=100}>
  <label className="flow-input">추가 확인 사유<textarea aria-label={`RFI #${record.id} 재질의 사유`} maxLength={1000} required value={text} onChange={event=>setText(event.target.value)}/></label>
  <label className="flow-input">답변 담당 역할<select aria-label={`RFI #${record.id} 재질의 담당`} value={draft.assignee} onChange={event=>set('assignee',event.target.value)}><option value="reviewer">검토자 체험</option><option value="approver">승인자 체험</option></select></label>
  <label className="flow-input">새 답변 기한<input aria-label={`RFI #${record.id} 새 답변 기한`} type="date" required value={draft.due} onChange={event=>set('due',event.target.value)}/></label>
  <button type="submit" disabled={!text.trim()||!draft.due}>RFI #{record.id} 후속 질의 등록</button></fieldset>{notice&&<p role="alert">{notice}</p>}
 </form>}
 </article>;
}
export function WorkflowRfiInbox({documents,onChange,onOpen,queue=false}:{documents:WorkflowBlankDocument[];onChange:Props['onChange'];onOpen:(documentId:string,objectId:string,page:number)=>void;queue?:boolean}){
 const [params,setParams]=useSearchParams();const role=params.get('rfiRole')??'author';
 const search=params.get('rfiSearch')??'',phase=params.get('rfiPhase')??'',assignee=params.get('rfiAssignee')??'',document=params.get('rfiDocument')??'';
 const change=(key:string,value:string)=>setParams(previous=>{const next=new URLSearchParams(previous);if(value)next.set(key,value);else next.delete(key);return next;},{replace:true,preventScrollReset:true});
 const records=selectRfis(documents,{search,phase,assignee,document,queue,role});
 const phases={requested:'답변 대기',answered:'답변 완료',closed:'종결 완료'};
 const unknownRole=!Object.hasOwn(roleNames,role),unknownPhase=Boolean(phase&&!Object.hasOwn(phases,phase));
 return <section className="flow-card" aria-label={queue?'내 질의 할 일':'내 도면 공식 질의'}><h2>{queue?'내 질의 할 일':'공식 질의'} · 역할 체험</h2><p>일반 댓글과 구분된 질의 흐름입니다. 이 탭에만 보관되며 실제 전송·계약상 회신·도면 승인이 아닙니다.</p>
 {queue&&<p>담당 역할에는 답변 대기, 작성자에는 종결할 답변만 표시합니다. 열람자에게는 처리할 업무가 없습니다.</p>}
 <label className="flow-input">처리 역할<select aria-label="질의 처리 역할" value={role} onChange={event=>change('rfiRole',event.target.value)}>{unknownRole&&<option value={role} disabled>알 수 없는 역할 · 처리 불가</option>}{Object.entries(roleNames).map(([value,label])=><option key={value} value={value}>{label} 체험</option>)}</select></label>
 <label className="flow-input">질의 검색<input aria-label="질의 검색" value={search} onChange={event=>change('rfiSearch',event.target.value)}/></label>
 <label className="flow-input">상태<select aria-label="질의 상태 필터" value={phase} onChange={event=>change('rfiPhase',event.target.value)}><option value="">모든 상태</option>{unknownPhase&&<option value={phase} disabled>찾을 수 없는 상태</option>}{Object.entries(phases).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
 <label className="flow-input">답변 담당<select aria-label="질의 담당 필터" value={assignee} onChange={event=>change('rfiAssignee',event.target.value)}><option value="">모든 담당</option>{assignee&&!['reviewer','approver'].includes(assignee)&&<option value={assignee} disabled>찾을 수 없는 담당</option>}<option value="reviewer">검토자 체험</option><option value="approver">승인자 체험</option></select></label>
 <label className="flow-input">도면<select aria-label="질의 도면 필터" value={document} onChange={event=>change('rfiDocument',event.target.value)}><option value="">모든 도면</option>{document&&!documents.some(doc=>doc.id===document)&&<option value={document} disabled>선택 도면 없음</option>}{documents.map(doc=><option key={doc.id} value={doc.id}>{doc.title}</option>)}</select></label>
 {(search||phase||assignee||document)&&<button onClick={()=>setParams(previous=>{const next=new URLSearchParams(previous);for(const key of ['rfiSearch','rfiPhase','rfiAssignee','rfiDocument'])next.delete(key);return next;},{replace:true,preventScrollReset:true})}>질의 필터 초기화</button>}
 <p role="status">표시 {records.length}건</p>{!records.length&&<p>{queue?'현재 역할과 조건에 맞는 질의 할 일이 없습니다.':'조건에 맞는 질의가 없습니다. 필터를 초기화하거나 작업실에서 질의를 작성하세요.'}</p>}
 {records.map(({document,record})=><RfiCard key={`${document.id}:${record.id}:${role}`} document={document} record={record} role={role} onChange={onChange} onOpen={()=>onOpen(document.id,record.objectId,record.page)}/>)}
 </section>;
}
