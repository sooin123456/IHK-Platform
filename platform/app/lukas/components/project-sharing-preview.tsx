import {useEffect,useRef,useState} from "react";
import {Link,useSearchParams} from "react-router";
import {Button} from "~/core/components/ui/button";
import {parseProjectResources} from "./project-resources-preview";
import {SharedDrawingPreview,freezeSharedDrawingView,type SharedDrawingView} from "./shared-drawing-preview";
import {internalReviewRequests,type ReviewLoopState} from "./drawing-review-loop";

type SharedItem={id:string;kind:"drawing"|"resource";title:string;revision?:number;page?:number;detail:string;view?:SharedDrawingView};
type Invitation={id:string;projectId:string;role:"view"|"request";recipient:string;expiresAt:string;items:SharedItem[];revokedAt?:string;replacesId?:string};
const requestStatuses={pending:"대기",working:"처리 중",resolved:"해결"};
type RequestResponse={id?:string;status:keyof typeof requestStatuses;message:string;at:string};
type ExternalRequest={id:string;projectId:string;invitationId:string;target:SharedItem;author:string;message:string;createdAt:string;status:keyof typeof requestStatuses;history?:RequestResponse[]};
export function respondToExternalRequest(request:ExternalRequest,status:ExternalRequest["status"],message:string,now:number,id?:string):ExternalRequest {
  if(id&&request.history?.some(entry=>entry.id===id))return request;
  if(!Object.hasOwn(requestStatuses,status)||!message.trim()||message.length>1000||!Number.isFinite(now)||(request.history?.length??0)>=100)throw Error("처리 상태와 답변을 확인해 주세요. 이력은 요청당 100개까지 보관합니다.");
  return {...request,status,history:[...(request.history??[]),{id,status,message:message.trim(),at:new Date(now).toISOString()}]};
}

type RequestDraft={id:string;message:string;status:ExternalRequest["status"]};
// Only drafts whose tab-storage write failed live here, so panel switches cannot lose them.
const unpersistedRequestDrafts=new Map<string,RequestDraft>();
const warnUnpersistedDrafts=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
function clearUnpersistedDraft(key:string){
  unpersistedRequestDrafts.delete(key);
  if(!unpersistedRequestDrafts.size)window.removeEventListener("beforeunload",warnUnpersistedDrafts);
}
function useRequestDraft(key:string,status:RequestDraft["status"],consumedIds:string[]) {
  const [draft,setDraft]=useState<RequestDraft|null>(null);
  const [error,setError]=useState("");
  const [failed,setFailed]=useState(false);
  const consumed=JSON.stringify(consumedIds);
  const reset=(nextStatus=status)=>{clearUnpersistedDraft(key);setDraft({id:crypto.randomUUID(),message:"",status:nextStatus});setError("");setFailed(false);};
  useEffect(()=>{
    try{
      const pending=unpersistedRequestDrafts.get(key);
      if(pending){setDraft(pending);setFailed(true);setError("보관하지 못한 입력을 현재 화면에서 복원했습니다. 새로고침하거나 탭을 닫기 전에 초안 보관을 다시 시도해 주세요.");return;}
      const raw=sessionStorage.getItem(key);
      const saved=raw?JSON.parse(raw):null;
      if(raw!==null&&(!saved||typeof saved!=="object"||Array.isArray(saved)||typeof saved.id!=="string"||!saved.id||saved.id.length>100||typeof saved.message!=="string"||saved.message.length>1000||!Object.hasOwn(requestStatuses,saved.status)))throw Error("invalid draft");
      if(saved){setDraft(saved);setError("");setFailed(false);}else reset();
    }catch{setDraft(null);setError("작성 초안을 복원하지 못했습니다. 기존 초안을 덮어쓰지 않았습니다.");}
  },[key]);
  // A submitted draft may remain on disk. Never restore it or reset unrelated input.
  const wasSubmitted=Boolean(draft&&consumedIds.includes(draft.id));
  useEffect(()=>{
    if(wasSubmitted)reset();
  },[wasSubmitted,consumed]);
  const update=(next:RequestDraft)=>{
    setDraft(next);
    try{sessionStorage.setItem(key,JSON.stringify(next));clearUnpersistedDraft(key);setFailed(false);setError("");}
    catch{unpersistedRequestDrafts.set(key,next);window.addEventListener("beforeunload",warnUnpersistedDrafts);setFailed(true);setError("초안을 보관하지 못했습니다. 현재 입력은 유지됩니다. 새로고침하거나 탭을 닫기 전에 다시 시도해 주세요.");}
  };
  return {draft:wasSubmitted?null:draft,error,failed,update,reset};
}

function ExternalResponseForm({request,onSave}:{request:ExternalRequest;onSave:(status:ExternalRequest["status"],message:string,id:string)=>void}) {
  const editor=useRequestDraft(`1hk:preview:external-reply-draft:${JSON.stringify([request.projectId,request.id])}`,request.status,request.history?.flatMap(entry=>entry.id?[entry.id]:[])??[]);
  const {draft}=editor;
  const [error,setError]=useState("");
  return <form className="mt-3 grid gap-2" onSubmit={e=>{e.preventDefault();if(!draft)return;try{onSave(draft.status,draft.message,draft.id);editor.reset(draft.status);setError("");}catch(e){setError(e instanceof Error?e.message:"답변을 보관하지 못했습니다. 입력은 유지됩니다.");}}}>
    <label className="grid gap-1">처리 상태<select disabled={!draft} className="rounded border p-2" value={draft?.status??request.status} onChange={e=>draft&&editor.update({...draft,status:e.target.value as ExternalRequest["status"]})}>{Object.entries(requestStatuses).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label className="grid gap-1">처리 답변<textarea disabled={!draft} className="min-h-20 rounded border p-2" maxLength={1000} value={draft?.message??""} onChange={e=>draft&&editor.update({...draft,message:e.target.value})} required/></label>
    <Button type="submit" disabled={!draft?.message.trim()}>답변과 상태 보관 · 예시</Button>
    <p className="text-xs">작성 중인 답변과 선택 상태를 요청별로 이 탭에 보관합니다. 실제 발송은 아닙니다.</p>
    {editor.error&&<p role="alert">{editor.error}</p>}
    {editor.failed&&draft&&<Button type="button" variant="outline" onClick={()=>editor.update(draft)}>초안 보관 다시 시도</Button>}
    {error&&<p role="alert">{error}</p>}
  </form>;
}

function ExternalRequestComposer({projectId,invitationId,targetId,author,rows,onSave}:{projectId:string;invitationId:string;targetId:string;author:string;rows:ExternalRequest[];onSave:(rows:ExternalRequest[])=>void}) {
  const editor=useRequestDraft(`1hk:preview:external-request-draft:${JSON.stringify([projectId,invitationId,targetId,author])}`,"pending",rows.map(row=>row.id));
  const {draft}=editor;
  const [error,setError]=useState("");
  return <form className="grid gap-2" onSubmit={e=>{
    e.preventDefault();if(!draft)return;
    try{
      const current=readSharingInvitation(sessionStorage.getItem(`1hk:preview:sharing:${projectId}`)??"[]",projectId,invitationId,Date.now());
      const existing=readExternalRequests(projectId);
      if(!existing.some(row=>row.id===draft.id)){
        if(existing.length>=200)throw Error("이 탭의 수정 요청 예시 한도에 도달했습니다.");
        onSave([...existing,createExternalRequest(current,targetId,author,draft.message,draft.id,Date.now())]);
      }
      editor.reset();setError("");
    }catch(e){setError(e instanceof Error?e.message:"요청을 보관하지 못했습니다. 입력은 유지됩니다.");}
  }}>
    <label className="grid gap-1 text-sm">선택한 항목에 수정 요청<textarea disabled={!draft} className="min-h-24 rounded border p-2" maxLength={1000} value={draft?.message??""} onChange={e=>draft&&editor.update({...draft,message:e.target.value})}/></label>
    <Button type="submit" disabled={!draft?.message.trim()}>수정 요청 보관 · 예시</Button>
    <p className="text-xs">작성 초안은 초대·선택 항목·예시 작성자별로 이 탭에 보관합니다. 같은 이름·소속으로 다시 들어오면 복원됩니다. 실제 인증·발송은 아닙니다.</p>
    {(error||editor.error)&&<p role="alert">{error||editor.error}</p>}
    {editor.failed&&draft&&<Button type="button" variant="outline" onClick={()=>editor.update(draft)}>초안 보관 다시 시도</Button>}
  </form>;
}
export function createExternalRequest(invitation:Invitation,targetId:string,author:string,message:string,id:string,now:number):ExternalRequest {
  if(invitation.revokedAt)throw Error("취소된 초대에는 수정 요청을 남길 수 없습니다.");
  if(invitation.role!=="request"||Date.parse(invitation.expiresAt)<=now||!author.trim()||author.length>200||!message.trim()||message.length>1000||!id)throw Error("수정 요청 역할·내용·초대 만료를 확인해 주세요.");
  const scoped=createSharingPreview(invitation.items,[targetId],invitation);
  return {id,projectId:invitation.projectId,invitationId:invitation.id,target:scoped.items[0],author:author.trim(),message:message.trim(),createdAt:new Date(now).toISOString(),status:"pending"};
}
function readExternalRequests(projectId:string,raw=sessionStorage.getItem(`1hk:preview:external-requests:${projectId}`)??"[]"):ExternalRequest[] {
  const rows=JSON.parse(raw);
  if(!Array.isArray(rows)||rows.length>200)throw Error("수정 요청 목록을 확인할 수 없습니다.");
  const ids=new Set();
  for(const row of rows){
    if(!row||row.projectId!==projectId||typeof row.id!=="string"||!row.id||row.id.length>100||ids.has(row.id)||typeof row.invitationId!=="string"||!row.invitationId||typeof row.author!=="string"||!row.author.trim()||row.author.length>200||typeof row.message!=="string"||!row.message.trim()||row.message.length>1000||!Object.hasOwn(requestStatuses,row.status)||!Number.isFinite(Date.parse(row.createdAt)))throw Error("수정 요청 기록이 올바르지 않습니다.");
    if(row.history!==undefined&&(!Array.isArray(row.history)||row.history.length>100||row.history.some((entry:RequestResponse)=>!entry||!Object.hasOwn(requestStatuses,entry.status)||typeof entry.message!=="string"||!entry.message.trim()||entry.message.length>1000||!Number.isFinite(Date.parse(entry.at)))||(row.history.length&&row.history.at(-1).status!==row.status)))throw Error("수정 요청 답변 이력이 올바르지 않습니다.");
    const responseIds=row.history?.flatMap((entry:RequestResponse)=>entry.id===undefined?[]:[entry.id])??[];
    if(responseIds.some((id:unknown)=>typeof id!=="string"||!id||id.length>100)||new Set(responseIds).size!==responseIds.length)throw Error("수정 요청 답변 ID가 올바르지 않습니다.");
    createSharingPreview([row.target],[row.target?.id],{id:row.invitationId,projectId,role:"view",recipient:row.author.slice(0,100),expiresAt:"2099-01-01T00:00:00Z"});ids.add(row.id);
  }
  return rows;
}

export function readExternalRequestContext(raw:string,projectId:string,documentId:string,requestId:string) {
  const row=readExternalRequests(projectId,raw).find(item=>item.id===requestId&&item.target.kind==="drawing"&&item.target.id===`drawing:${documentId}`);
  if(!row||!row.target.view)throw Error("해당 프로젝트·도면의 요청 당시 화면을 찾을 수 없습니다. 현재 개정이나 다른 도면으로 대신 열지 않았습니다.");
  return {...row,target:{...row.target,view:freezeSharedDrawingView(row.target.view,row.target.revision!,row.target.page!)}};
}

export function externalRequestWorkspaceHref(row:ExternalRequest,viewer:boolean,frozen=true) {
  const query=new URLSearchParams({layout:"pdf",screenDocument:row.target.id.slice("drawing:".length),returnProject:row.projectId,title:row.target.title,startKind:row.target.view?.kind??"pdf",paper:row.target.view?.paper??"A3",workflowPanel:"review"});
  if(frozen)query.set("externalRequest",row.id);
  else query.set("externalFocus",row.id);
  if(viewer)query.set("role","viewer");
  return `/workspace-preview/drawing-workspace?${query}`;
}

type InternalRequestEntry={documentId:string;title:string;state:ReviewLoopState;href?:string;onLocate?:()=>void};
export function ExternalRequestPanel({projectId,viewer,invitationId,targetId,author,documentId,requestId,internalEntries}:{projectId:string;viewer:boolean;invitationId?:string;targetId?:string;author?:string;documentId?:string;requestId?:string;internalEntries?:InternalRequestEntry[]}) {
  const [params]=useSearchParams();
  const focusId=invitationId?null:params.get("externalFocus")??params.get("internalFocus");
  const focusedRequest=useRef<string|null>(null);
  const [rows,setRows]=useState<ExternalRequest[]>([]);
  const [error,setError]=useState("");
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{
    const read=()=>{try{setRows(readExternalRequests(projectId));setError("");}catch{setError("수정 요청 기록을 읽지 못했습니다. 기존 내용을 덮어쓰지 않았습니다.");}setLoaded(true);};
    read();window.addEventListener("external-request-preview",read);window.addEventListener("focus",read);
    return()=>{window.removeEventListener("external-request-preview",read);window.removeEventListener("focus",read);};
  },[projectId]);
  const save=(next:ExternalRequest[])=>{
    sessionStorage.setItem(`1hk:preview:external-requests:${projectId}`,JSON.stringify(next));setRows(next);setError("");window.dispatchEvent(new Event("external-request-preview"));
  };
  const visible=rows.filter(row=>(!invitationId||row.invitationId===invitationId)&&(!documentId||row.target.id===`drawing:${documentId}`)&&(!requestId||row.id===requestId));
  const internal=invitationId?[]:(internalEntries??[]).filter(entry=>!documentId||entry.documentId===documentId).flatMap(entry=>internalReviewRequests(entry.documentId,entry.state).map(issue=>({entry,issue})));
  useEffect(()=>{
    if(!loaded||!focusId||focusedRequest.current===focusId||!visible.some(row=>row.id===focusId)&&!internal.some(row=>row.issue.id===focusId))return;
    const element=document.getElementById(`external-request-${focusId}`)??document.getElementById(`internal-request-${focusId}`);
    if(element){element.focus({preventScroll:true});element.scrollIntoView({block:"nearest"});focusedRequest.current=focusId;}
  },[loaded,focusId,rows,internalEntries]);
  return <section className="grid gap-3 rounded-xl border p-4" aria-label="수정 요청 목록">
    <h3 className="font-semibold">수정 요청 · 로컬 예시</h3><p className="text-xs text-muted-foreground">의견과 처리 결과를 확인하세요. 실제 발송·승인·도면 수정은 아닙니다.</p>
    {error&&<p role="alert">{error}</p>}
    {loaded&&invitationId&&targetId&&author&&!viewer&&<ExternalRequestComposer key={JSON.stringify([projectId,invitationId,targetId,author])} projectId={projectId} invitationId={invitationId} targetId={targetId} author={author} rows={rows} onSave={save}/>}
    {loaded&&!error&&!visible.length&&!internal.length&&<p>아직 연결된 수정 요청이 없습니다.</p>}
    <ul className="grid gap-3" aria-label="수정 요청 항목">{internal.map(({entry,issue})=><li key={issue.id} id={`internal-request-${issue.id}`} tabIndex={-1} className="rounded border p-3 text-sm focus:outline-2 focus:outline-violet-500"><article aria-label="내부 수정 요청" data-request-id={issue.id}>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">내부 검토 · I01</p><p className="rounded-full bg-muted px-2 py-1 text-xs font-medium">처리 상태: {issue.status==="unknown"?"처리 결과 미확인":requestStatuses[issue.status]}</p></div>
      <p className="mt-3 whitespace-pre-wrap break-words font-medium">{issue.message}</p>
      <p className="mt-2 break-words text-xs text-muted-foreground">{entry.title} · R{issue.revision} · {issue.page}쪽</p>
      <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">요청 상세 정보</summary><div className="mt-2 grid gap-1"><p className="break-all">요청 ID · {issue.id}</p><p>R{issue.originRevision}에서 요청 · R{issue.revision} 기록</p><p>검토·재검토·승인 기록에서 읽은 상태입니다. 이 목록에서 별도로 변경하지 않습니다.</p></div></details>
      {entry.onLocate&&issue.revision===entry.state.revision?<Button type="button" variant="outline" className="mt-2" onClick={entry.onLocate}>{entry.state.target?.name||"D01"} · {issue.page}쪽 의견 위치 보기</Button>:entry.href?<Button asChild variant="outline" className="mt-2"><Link to={`${entry.href}&internalFocus=${encodeURIComponent(issue.id)}`}>이 도면의 검토 이력 열기</Link></Button>:<p className="text-xs">이전 개정의 위치는 검토 이력에서 확인하세요.</p>}
    </article></li>)}{visible.map(row=><li className="rounded border p-3 text-sm focus:outline-2 focus:outline-violet-500" key={row.id} id={`external-request-${row.id}`} data-request-id={row.id} tabIndex={-1}>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">외부 참여자</p><p className="rounded-full bg-muted px-2 py-1 text-xs font-medium">처리 상태: {requestStatuses[row.status]}</p></div>
      <p className="mt-3 whitespace-pre-wrap break-words font-medium">{row.message}</p>
      <p className="mt-2 break-words text-xs text-muted-foreground">{row.target.title} · {row.target.kind==="drawing"?`R${row.target.revision} · ${row.target.page}쪽`:"자료"}</p><p className="mt-1 break-words text-xs text-muted-foreground">{row.author}</p>
      <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">요청 상세 정보</summary><div className="mt-2 grid gap-1"><p className="break-all">요청 ID · {row.id}</p><p>요청 시각 · {new Date(row.createdAt).toLocaleString("ko-KR")}</p></div></details>
      {!invitationId&&!requestId&&row.target.kind==="drawing"&&(row.target.view?<Button asChild variant="outline" className="my-2"><Link to={externalRequestWorkspaceHref(row,viewer)}>요청 당시 도면·위치 보기</Link></Button>:<p className="text-xs">이전 요청에는 도면 화면이 보관되지 않았습니다. 참조 정보만 확인할 수 있습니다.</p>)}
      {row.history?.length?<ol className="mt-2 grid gap-2 border-l pl-3" aria-label="처리 답변 이력">{row.history.map((entry,index)=><li key={index}><p className="whitespace-pre-wrap break-words">{entry.message}</p><p className="text-xs">내부 작성자 · 예시 · {requestStatuses[entry.status]} · {new Date(entry.at).toLocaleString("ko-KR")}</p></li>)}</ol>:<p className="text-xs">아직 보관된 처리 답변이 없습니다.</p>}
      {!invitationId&&!viewer&&<ExternalResponseForm request={row} onSave={(status,message,id)=>{
        const current=readExternalRequests(projectId);
        const latest=current.find(item=>item.id===row.id);
        if(!latest||latest.status!==row.status||(latest.history?.length??0)!==(row.history?.length??0))throw Error("다른 화면에서 요청이 변경되었습니다. 화면을 다시 열어 최신 이력을 확인하세요. 입력은 유지됩니다.");
        const next=respondToExternalRequest(latest,status,message,Date.now(),id);save(current.map(item=>item.id===row.id?next:item));
      }}/>}
    </li>)}</ul>
  </section>;
}
export function createSharingPreview(items:SharedItem[],selected:string[],input:Omit<Invitation,"items">):Invitation {
  if(input.revokedAt!==undefined&&!Number.isFinite(Date.parse(input.revokedAt))||input.replacesId!==undefined&&(typeof input.replacesId!=="string"||!input.replacesId||input.replacesId.length>100||input.replacesId===input.id))throw Error("초대 관리 기록을 확인해 주세요.");
  if(!input.id||!input.projectId||!["view","request"].includes(input.role)||typeof input.recipient!=="string"||!input.recipient.trim()||input.recipient.length>100||!Number.isFinite(Date.parse(input.expiresAt))||!selected.length||selected.length>200||new Set(selected).size!==selected.length)throw Error("공유 범위·역할·수신자·만료일을 확인해 주세요.");
  const scope=selected.map(id=>items.find(item=>item.id===id));
  if(scope.some(item=>!item||!["drawing","resource"].includes(item.kind)||typeof item.title!=="string"||!item.title.trim()||item.title.length>180||typeof item.detail!=="string"||item.detail.length>2000||item.kind==="drawing"&&(!Number.isSafeInteger(item.revision)||item.revision!<1||!Number.isSafeInteger(item.page)||item.page!<1)))throw Error("공유 대상의 개정 또는 자료 정보를 확인해 주세요.");
  const frozen=(scope as SharedItem[]).map(item=>{
    if(item.view!==undefined){
      if(item.kind!=="drawing")throw Error("자료에 도면 검토 화면을 연결할 수 없습니다.");
      return {...item,view:freezeSharedDrawingView(item.view,item.revision!,item.page!)};
    }
    return item;
  });
  return {...input,recipient:input.recipient.trim(),items:structuredClone(frozen)};
}

export function readSharingInvitation(raw:string,projectId:string,id:string,now:number):Invitation {
  const records=JSON.parse(raw);
  if(!Array.isArray(records)||records.length>50)throw Error("공유 기록을 확인할 수 없습니다.");
  const matches=records.filter(record=>record?.id===id&&record.projectId===projectId);
  if(matches.length!==1)throw Error("이 탭에서 해당 초대 구성을 찾을 수 없습니다.");
  const record=matches[0];
  if(!Array.isArray(record.items))throw Error("공유 범위를 확인할 수 없습니다.");
  const parsed=createSharingPreview(record.items,record.items.map((item:SharedItem)=>item.id),record);
  if(parsed.revokedAt)throw Error("취소된 초대입니다. 작성자에게 새 링크를 요청하세요.");
  if(Date.parse(parsed.expiresAt)<=now)throw Error("초대가 만료되었습니다. 작성자에게 새 구성을 요청하세요.");
  return parsed;
}

type InvitationAction={kind:"cancel"}|{kind:"reissue";id:string;expiresAt:string};
export function manageSharingInvitation(records:Invitation[],id:string,action:InvitationAction,now:number):Invitation[] {
  const target=records.find(record=>record.id===id);
  if(!target||records.filter(record=>record.id===id).length!==1||!Number.isFinite(now))throw Error("관리할 초대 기록을 확인할 수 없습니다.");
  const original=createSharingPreview(target.items,target.items.map(item=>item.id),target);
  const cancelled={...original,revokedAt:original.revokedAt??new Date(now).toISOString()};
  const next=records.map(record=>record.id===id?cancelled:record);
  if(action.kind==="cancel")return next;
  if(records.length>=50||records.some(record=>record.id===action.id)||!action.id||!Number.isFinite(Date.parse(action.expiresAt))||Date.parse(action.expiresAt)<=now)throw Error("새 링크 ID·미래 만료일·50개 보관 한도를 확인해 주세요.");
  const replacement=createSharingPreview(original.items,original.items.map(item=>item.id),{id:action.id,projectId:original.projectId,recipient:original.recipient,role:original.role,expiresAt:action.expiresAt,replacesId:id});
  return [...next,replacement];
}

function InvitationManagement({record,onManage}:{record:Invitation;onManage:(action:InvitationAction)=>void}) {
  const [confirm,setConfirm]=useState(false);
  const [expires,setExpires]=useState("");
  const [error,setError]=useState("");
  const commit=(action:InvitationAction)=>{try{onManage(action);setConfirm(false);setExpires("");setError("");}catch(e){setError(e instanceof Error?e.message:"초대 변경을 보관하지 못했습니다. 이전 링크 상태는 유지됩니다.");}};
  return <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">초대 관리 · 로컬 예시</summary><div className="mt-3 grid gap-3">
    <p className="text-sm">재발급하면 이전 링크는 취소됩니다. 수신자·역할·공유 당시 범위는 유지하며 최신 도면으로 바꾸지 않습니다.</p>
    {!record.revokedAt&&(confirm?<div className="flex flex-wrap gap-2"><Button type="button" variant="destructive" onClick={()=>commit({kind:"cancel"})}>초대 취소 확인</Button><Button type="button" variant="outline" onClick={()=>setConfirm(false)}>계속 유지</Button></div>:<Button type="button" variant="outline" onClick={()=>setConfirm(true)}>초대 취소</Button>)}
    <label className="grid gap-1 text-sm">재발급 만료일<input type="date" className="rounded border p-2" value={expires} onChange={e=>setExpires(e.target.value)}/></label>
    <Button type="button" disabled={!expires} onClick={()=>{try{commit({kind:"reissue",id:crypto.randomUUID(),expiresAt:new Date(`${expires}T23:59:59`).toISOString()});}catch{setError("재발급 만료일을 확인해 주세요.");}}}>새 링크로 재발급</Button>
    {error&&<p role="alert">{error}</p>}
  </div></details>;
}

export function ProjectGuestPreview({projectId,invitationId}:{projectId:string;invitationId:string}) {
  const [invitation,setInvitation]=useState<Invitation|null>(null);
  const [error,setError]=useState("");
  const [name,setName]=useState("");
  const [organization,setOrganization]=useState("");
  const [entered,setEntered]=useState(false);
  const [selected,setSelected]=useState("");
  useEffect(()=>{
    const refresh=()=>{
      try{setInvitation(readSharingInvitation(sessionStorage.getItem(`1hk:preview:sharing:${projectId}`)??"[]",projectId,invitationId,Date.now()));setError("");}
      catch(e){setInvitation(null);setEntered(false);setError(e instanceof Error?e.message:"공유 정보를 읽지 못했습니다.");}
    };
    refresh();
    const timer=window.setInterval(refresh,30000);
    window.addEventListener("focus",refresh);
    return()=>{window.clearInterval(timer);window.removeEventListener("focus",refresh);};
  },[projectId,invitationId]);
  const active=invitation?.items.find(item=>item.id===selected);
  return <main className="mx-auto grid min-h-screen max-w-4xl content-start gap-5 p-5 sm:p-10" aria-label="외부 참여자 체험">
    <header><p className="text-sm font-semibold">1HK · 공유 검토</p><h1 className="mt-2 text-2xl font-semibold">외부 참여자 화면</h1></header>
    <p className="rounded border bg-muted p-3 text-sm">로컬 화면 체험입니다. 실제 외부 링크·본인 인증·서버 권한 검증이 아닙니다. 초대 구성을 만든 같은 브라우저 탭에서만 확인할 수 있습니다.</p>
    {error?<section role="alert" className="rounded border p-5"><h2 className="font-semibold">공유 내용을 열 수 없습니다</h2><p className="mt-2">{error}</p><p className="mt-2 text-sm">다른 프로젝트나 현재 개정으로 대신 열지 않았습니다.</p></section>:!invitation?<p role="status">초대 범위를 확인하고 있습니다.</p>:!entered?<form className="grid gap-4 rounded-xl border p-5" onSubmit={e=>{
      e.preventDefault();if(!name.trim()||!organization.trim())return;
      try{const current=readSharingInvitation(sessionStorage.getItem(`1hk:preview:sharing:${projectId}`)??"[]",projectId,invitationId,Date.now());setInvitation(current);setEntered(true);setSelected(current.items[0].id);}catch(e){setError(e instanceof Error?e.message:"초대를 확인하지 못했습니다.");}
    }}>
      <h2 className="font-semibold">참여자 정보 입력 · 인증 아님</h2><p className="text-sm">실제 개인정보 대신 예시 이름·소속을 입력하세요. 입력은 현재 화면에서만 유지됩니다.</p>
      <label className="grid gap-1 text-sm">이름 예시<input className="rounded border p-2" value={name} maxLength={80} required onChange={e=>setName(e.target.value)}/></label>
      <label className="grid gap-1 text-sm">소속 예시<input className="rounded border p-2" value={organization} maxLength={100} required onChange={e=>setOrganization(e.target.value)}/></label>
      <p className="text-sm">부여된 역할: {invitation.role==="view"?"열람만":"열람·수정 요청"} · 선택 범위 {invitation.items.length}개</p>
      <Button type="submit" disabled={!name.trim()||!organization.trim()}>공유된 범위 열기</Button>
    </form>:<>
      <p className="text-sm break-words">{name} · {organization} · {invitation.role==="view"?"열람만":"열람·수정 요청"}</p>
      <nav aria-label="공유된 항목" className="grid gap-2">{invitation.items.map(item=><Button key={item.id} className="h-auto justify-start whitespace-normal text-left" variant={selected===item.id?"secondary":"outline"} onClick={()=>setSelected(item.id)}>{item.title} · {item.kind==="drawing"?`R${item.revision} · ${item.page}쪽`:"자료 설명"}</Button>)}</nav>
      {active&&<article className="grid min-w-0 gap-3 rounded-xl border p-5"><h2 className="break-words text-lg font-semibold">{active.title}</h2><p>{active.kind==="drawing"?`고정된 참조: R${active.revision} · ${active.page}쪽`:"공유 구성 당시의 자료 설명"}</p><p className="whitespace-pre-wrap break-words">{active.detail||"설명 없음"}</p>{active.kind==="drawing"&&active.view?<SharedDrawingPreview key={active.id} title={active.title} view={active.view}/>:<p className="text-xs text-muted-foreground">이 구성에는 원본 파일·도면 화면이 포함되지 않았습니다. 선택 당시 참조와 설명만 표시하며 최신 원본이나 다른 샘플로 대신 열지 않습니다.</p>}</article>}
      <ExternalRequestPanel projectId={projectId} invitationId={invitationId} targetId={active?.id} author={`${name} · ${organization}`} viewer={invitation.role!=="request"}/>
    </>}
  </main>;
}

type SharingDraft={id:string;recipient:string;role:Invitation["role"];expires:string;selection:{id:string;content:string}[]};
const unsavedSharingDrafts=new Map<string,SharingDraft>();
const warnSharingDraft=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
function clearSharingDraftMemory(key:string){unsavedSharingDrafts.delete(key);if(!unsavedSharingDrafts.size)window.removeEventListener("beforeunload",warnSharingDraft);}
export function parseSharingDraft(raw:string):SharingDraft {
  const value=JSON.parse(raw);
  if(!value||typeof value!=="object"||typeof value.id!=="string"||!value.id||value.id.length>100||typeof value.recipient!=="string"||value.recipient.length>100||!["view","request"].includes(value.role)||typeof value.expires!=="string"||value.expires!==""&&!/^\d{4}-\d{2}-\d{2}$/.test(value.expires)||!Array.isArray(value.selection)||value.selection.length>100||value.selection.some((item:{id:string;content:string})=>!item||typeof item.id!=="string"||!item.id||item.id.length>200||typeof item.content!=="string"||item.content.length>200000)||new Set(value.selection.map((item:{id:string})=>item.id)).size!==value.selection.length)throw Error("초대 초안 형식 오류");
  return value;
}
export function ProjectSharingPreview({projectId,viewer,drawings,readError}:{projectId:string;viewer:boolean;drawings:SharedItem[];readError:boolean}) {
  const key=`1hk:preview:sharing:${projectId}`;
  const [resources,setResources]=useState<SharedItem[]>([]);
  const [records,setRecords]=useState<Invitation[]>([]);
  const draftKey=`1hk:preview:sharing-draft:${projectId}`;
  const [draft,setDraft]=useState<SharingDraft|null>(null);
  const [draftError,setDraftError]=useState("");
  const [draftFailed,setDraftFailed]=useState(false);
  const blankDraft=():SharingDraft=>({id:crypto.randomUUID(),recipient:"",role:"view",expires:"",selection:[]});
  const saveDraft=(next:SharingDraft)=>{
    setDraft(next);
    try{sessionStorage.setItem(draftKey,JSON.stringify(next));clearSharingDraftMemory(draftKey);setDraftFailed(false);setDraftError("");}
    catch{unsavedSharingDrafts.set(draftKey,next);window.addEventListener("beforeunload",warnSharingDraft);setDraftFailed(true);setDraftError("초대 초안을 보관하지 못했습니다. 현재 입력은 유지됩니다. 새로고침 전에 다시 시도해 주세요.");}
  };
  const selected=draft?.selection.map(item=>item.id)??[];
  const role=draft?.role??"view",recipient=draft?.recipient??"",expires=draft?.expires??"";
  const [loaded,setLoaded]=useState(false);
  const [blocked,setBlocked]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{
    try{
      const rows=parseProjectResources(sessionStorage.getItem(`1hk:preview:resources:${projectId}`)??"[]",projectId);
      if(!rows)throw Error("resources");
      setResources(rows.map(row=>({id:`resource:${row.id}`,kind:"resource",title:row.name,detail:row.note})));
      const saved=JSON.parse(sessionStorage.getItem(key)??"[]");
      if(!Array.isArray(saved)||saved.length>50)throw Error("records");
      const ids=new Set();
      for(const record of saved){
        if(!record||record.projectId!==projectId||!Array.isArray(record.items)||ids.has(record.id))throw Error("scope");
        createSharingPreview(record.items,record.items.map((item:SharedItem)=>item.id),record);ids.add(record.id);
      }
      setRecords(saved);
      if(!viewer){
        try{
          const pending=unsavedSharingDrafts.get(draftKey);
          const raw=sessionStorage.getItem(draftKey);
          const restored=pending??(raw===null?blankDraft():parseSharingDraft(raw));
          if(saved.some(record=>record.id===restored.id)){clearSharingDraftMemory(draftKey);setDraft(blankDraft());}
          else {setDraft(restored);if(pending){setDraftFailed(true);setDraftError("보관하지 못한 초대 입력을 복원했습니다. 새로고침 전에 다시 시도해 주세요.");}}
        }catch{setDraftError("초대 초안을 복원하지 못했습니다. 기존 초안을 덮어쓰지 않았습니다.");}
      }
    }catch{setBlocked(true);setError("공유 범위 기록을 복원하지 못했습니다. 기존 기록 보호를 위해 구성을 중지했습니다.");}
    setLoaded(true);
  },[projectId,key]);
  const items=[...drawings,...resources];
  const scopeChanged=Boolean(draft?.selection.some(chosen=>JSON.stringify(items.find(item=>item.id===chosen.id))!==chosen.content));
  return <section className="grid gap-4" aria-label="외부 공유 범위">
    <p className="text-sm text-muted-foreground">선택한 개정·페이지·검토 오버레이·자료 설명을 고정합니다. PDF는 공유 당시 식별 정보와 일치하는 로컬 원본을 다시 선택해 열람합니다. 실제 초대 발송·원본 파일 전송은 하지 않습니다.</p>
    {!loaded&&<p role="status">공유 범위를 확인하고 있습니다.</p>}
    {(error||readError)&&<p role="alert">{error||"도면 검토 정보를 읽지 못했습니다. 공유 범위를 확정하지 않았습니다."}</p>}
    {viewer?<p>보기 전용 · 외부 공유 구성을 만들 수 없습니다.</p>:<form onSubmit={e=>{
      e.preventDefault();if(!loaded||blocked||readError||!draft||scopeChanged)return;
      try{
        const expiresAt=new Date(`${expires}T23:59:59`).toISOString();
        if(Date.parse(expiresAt)<=Date.now())throw Error("미래의 만료일을 선택해 주세요.");
        const sources=items.map(item=>item.view?.kind==="pdf"&&selected.includes(item.id)?{...item,view:{...item.view,fingerprint:sessionStorage.getItem(`1hk:preview:pdf-source:${item.id.slice("drawing:".length)}`)??undefined}}:item);
        const record=createSharingPreview(sources,selected,{id:draft.id,projectId,role,recipient,expiresAt});
        const next=[...records,record];sessionStorage.setItem(key,JSON.stringify(next));setRecords(next);setError("");
        clearSharingDraftMemory(draftKey);setDraft(blankDraft());setDraftFailed(false);setDraftError("");
      }catch(e){setError(e instanceof Error?e.message:"구성을 보관하지 못했습니다. 입력은 유지됩니다.");}
    }}><fieldset disabled={!loaded||blocked||readError||!draft||records.length>=50} className="grid gap-3 rounded-xl border p-4">
      <legend className="font-semibold">초대 범위 구성 · 예시</legend>
      <label className="grid gap-1 text-sm">수신자 표시 이름<input maxLength={100} required className="rounded border p-2" value={recipient} onChange={e=>draft&&saveDraft({...draft,recipient:e.target.value})} placeholder="예: 감리 담당 · 예시"/></label>
      <label className="grid gap-1 text-sm">외부 역할<select className="rounded border p-2" value={role} onChange={e=>draft&&saveDraft({...draft,role:e.target.value as Invitation["role"]})}><option value="view">열람만</option><option value="request">열람·수정 요청</option></select></label>
      <label className="grid gap-1 text-sm">만료일<input type="date" required className="rounded border p-2" value={expires} onChange={e=>draft&&saveDraft({...draft,expires:e.target.value})}/></label>
      <fieldset className="grid gap-2"><legend className="text-sm font-medium">포함할 도면 개정·자료</legend>{items.map(item=><label key={item.id} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={selected.includes(item.id)} onChange={e=>draft&&saveDraft({...draft,selection:e.target.checked?[...draft.selection,{id:item.id,content:JSON.stringify(item)}]:draft.selection.filter(chosen=>chosen.id!==item.id)})}/><span className="break-all">{item.title} · {item.kind==="drawing"?`R${item.revision} · ${item.page}쪽`:"자료 설명 · 파일 미포함"}</span></label>)}</fieldset>
      {!items.length&&<p>공유할 검토 개정 또는 자료가 없습니다. 도면에서 검토를 요청하거나 프로젝트 자료를 먼저 준비하세요.</p>}
      <Button type="submit" disabled={!selected.length||!recipient.trim()||!expires||scopeChanged}>공유 범위 고정 · 이 탭에 보관</Button>
      <p className="text-xs">작성 중 구성은 프로젝트별로 이 탭에 보관합니다. 보관된 구성은 이후 도면·자료 변경을 자동 반영하지 않습니다.</p>
      {scopeChanged&&<p role="alert">선택했던 도면 개정 또는 자료가 변경되거나 없어졌습니다. 범위를 다시 확인해 주세요.<Button type="button" variant="outline" onClick={()=>draft&&saveDraft({...draft,selection:[]})}>선택 범위 다시 지정</Button></p>}
    </fieldset></form>}
    {!viewer&&draftError&&<p role="alert">{draftError}</p>}
    {!viewer&&draftFailed&&draft&&<Button type="button" variant="outline" onClick={()=>saveDraft(draft)}>초대 초안 보관 다시 시도</Button>}
    {loaded&&!blocked&&!records.length&&<p>아직 보관한 공유 구성이 없습니다.</p>}
    <ExternalRequestPanel projectId={projectId} viewer={viewer} internalEntries={drawings.filter(item=>item.view).map(item=>({documentId:item.id.slice("drawing:".length),title:item.title,state:item.view!.review,href:`/workspace-preview/drawing-workspace?${new URLSearchParams({layout:"pdf",screenDocument:item.id.slice("drawing:".length),returnProject:projectId,startKind:item.view!.kind,title:item.title,paper:item.view!.paper,workflowPanel:"review",...(viewer?{role:"viewer"}:{})})}`}))}/>
    <ul className="grid gap-3">{[...records].reverse().map(record=><li key={record.id} className="grid gap-2 rounded-xl border p-4">
      <h3 className="font-semibold break-words">{record.recipient} · 미발송 예시</h3>
      <p className="text-sm">{record.role==="view"?"열람만":"열람·수정 요청"} · 만료 {new Date(record.expiresAt).toLocaleString("ko-KR")}</p>
      <p className="text-sm">상태: {record.revokedAt?"취소됨":Date.parse(record.expiresAt)<=Date.now()?"만료됨":"사용 가능 · 로컬 예시"}{record.replacesId?" · 재발급된 초대":""}</p>
      <ul className="text-sm">{record.items.map(item=><li key={item.id} className="break-words">{item.title} · {item.kind==="drawing"?`R${item.revision} · ${item.page}쪽`:"자료 설명"}<p>{item.detail||"설명 없음"}</p></li>)}</ul>
      <p className="text-xs text-muted-foreground">선택 당시 참조 및 설명 보관 · 실제 파일·외부 접근 권한 없음.</p>
      <Button asChild variant="outline"><Link to={`/workspace-preview?${new URLSearchParams({project:projectId,guest:record.id})}`}>외부 참여자 화면 체험</Link></Button>
      {!viewer&&!blocked&&<InvitationManagement record={record} onManage={action=>{
        const next=manageSharingInvitation(records,record.id,action,Date.now());
        sessionStorage.setItem(key,JSON.stringify(next));setRecords(next);
      }}/>}
    </li>)}</ul>
  </section>;
}
