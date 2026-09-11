import {useEffect, useRef, useState} from "react";
import {ArrowLeft, ArrowRight, Check, ChevronRight, Eye, MapPin, MessageSquare, Pencil, Plus, Send, SlidersHorizontal} from "lucide-react";
import type {ScreenShape} from "./drawing-screen-object-preview";
import type {DrawingRequestSnapshot} from "./drawing-request-snapshot";
import {DrawingChangeRequestPreview,canApproveChangeRequest,type ChangeRequestPreview} from "./drawing-change-request-preview";
import {parseChangeRequestStorage} from "../lib/drawing-change-request-storage";
import {parseChangeConversation,type ChangeConversation} from "../lib/drawing-change-conversation-storage";
import "./drawing-change-preview.css";

export type DrawingChangeItem = {
  id:string; title:string; kind:"added"|"modified"|"removed"; page:number;
  x:number; y:number; width:number; height:number; author:string;
  summary:string; before:string; after:string; sample:boolean;
  sourceState?:string;
  rotation?:number;
};
const labels={added:"추가",modified:"수정",removed:"삭제"};
const symbols={added:"+",modified:"↔",removed:"−"};
export function DrawingChangeLegend({items,page}:{items:DrawingChangeItem[];page:number}){
  const visible=items.filter(item=>item.page===page);
  return <div className="change-legend" aria-label="현재 페이지 변경 범례">
    {visible.length?(["added","modified","removed"] as const).map(kind=>{
      const count=visible.filter(item=>item.kind===kind).length;
      return count?<span key={kind} data-kind={kind}><b aria-hidden="true">{symbols[kind]}</b>{`${labels[kind]} ${count}`}</span>:null;
    }):<span>이 페이지에 표시된 변경이 없습니다.</span>}
  </div>;
}
const sampleChanges:DrawingChangeItem[]=[
  {id:"sample-entrance",title:"출입문 위치 조정",kind:"modified",page:1,x:590,y:530,width:160,height:95,author:"김설계",summary:"출입 동선이 겹치지 않도록 출입문 위치를 조정하는 예시입니다.",before:"기존 출입문 위치",after:"출입 동선을 고려한 위치",sample:true},
  {id:"sample-meeting",title:"회의실 검토 영역 추가",kind:"added",page:1,x:170,y:140,width:160,height:180,author:"박건축",summary:"회의실 배치와 주변 통로를 함께 확인할 검토 영역입니다.",before:"검토 영역 없음",after:"회의실 검토 영역 표시",sample:true},
  {id:"sample-partition",title:"칸막이 철거 검토",kind:"removed",page:1,x:770,y:365,width:100,height:125,author:"이현장",summary:"업무 공간 확장을 위해 기존 칸막이 철거를 검토하는 예시입니다.",before:"기존 칸막이 영역",after:"철거 검토 영역",sample:true},
];

/** Screen records, not computed PDF/CAD diffs. Never mix template fixtures with user objects. */
export function drawingChangeItems(shapes:ScreenShape[],officeSample:boolean):DrawingChangeItem[]{
  if(shapes.length)return shapes.map(shape=>({id:shape.id,title:shape.name||shape.kind,kind:"added",page:shape.page,x:shape.x,y:shape.y,rotation:shape.rotation,width:shape.width??140,height:shape.height??90,author:"나",summary:"현재 작업실에 배치한 화면 도형입니다. 원본의 자동 변경 감지 결과가 아닙니다.",before:"이전 형상 미등록",after:`${shape.kind} · ${shape.lineWidth}`,sample:false,sourceState:JSON.stringify(shape)}));
  return officeSample?sampleChanges:[];
}

export function nextDrawingChange(items:Pick<DrawingChangeItem,"id">[],selected:string|null,direction:-1|1):string|null{
  if(!items.length)return null;
  const index=items.findIndex(item=>item.id===selected);
  if(index<0)return items[direction===1?0:items.length-1].id;
  return items[(index+direction+items.length)%items.length].id;
}

/** Group display anchors only; original geometry and global item order stay intact. */
export function groupDrawingChanges(items:DrawingChangeItem[],page:number,width:number,height:number):DrawingChangeItem[][]{
  const groups:DrawingChangeItem[][]=[];
  const buckets=new Map<string,{x:number;y:number;group:DrawingChangeItem[]}[]>();
  for(const item of items){
    if(item.page!==page)continue;
    if(width<=0||height<=0){groups.push([item]);continue;}
    const x=item.x*width/1000,y=item.y*height/700,bx=Math.floor(x/36),by=Math.floor(y/36);
    let nearby:DrawingChangeItem[]|undefined;
    for(let dx=-1;dx<=1&&!nearby;dx++)for(let dy=-1;dy<=1&&!nearby;dy++){
      nearby=buckets.get(`${bx+dx}:${by+dy}`)?.find(anchor=>Math.hypot(anchor.x-x,anchor.y-y)<=36)?.group;
    }
    if(nearby){nearby.push(item);continue;}
    const group=[item],key=`${bx}:${by}`;
    groups.push(group);
    buckets.set(key,[...(buckets.get(key)??[]),{x,y,group}]);
  }
  return groups;
}

export function DrawingChangePins({items,selected,page,onSelect,highlight,compare=false}:{items:DrawingChangeItem[];selected:string|null;page:number;onSelect:(id:string)=>void;highlight:boolean;compare?:boolean}){
  const container=useRef<HTMLDivElement>(null);
  const [size,setSize]=useState({width:0,height:0});
  const [expanded,setExpanded]=useState<string|null>(null);
  const groupButton=useRef<HTMLButtonElement|null>(null);
  useEffect(()=>{
    const element=container.current;if(!element)return;
    const observer=new ResizeObserver(()=>{const rect=element.getBoundingClientRect();setSize({width:rect.width,height:rect.height});});
    observer.observe(element);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{setExpanded(null);},[page,selected,size.width,size.height]);
  useEffect(()=>{if(expanded)container.current?.querySelector<HTMLButtonElement>('.change-cluster-list button')?.focus();},[expanded]);
  const groups=groupDrawingChanges(items,page,size.width,size.height);
  const numbers=new Map(items.map((item,index)=>[item.id,index+1]));
  return <div ref={container} className="change-pins" aria-label="도면 변경 위치">
    {groups.map(group=>{const item=group.find(value=>value.id===selected)??group[0];const index=numbers.get(item.id)!;const clustered=group.length>1;const open=expanded===group[0].id;return <div key={group[0].id} className="change-anchor" data-open={open} data-kind={item.kind} data-selected={selected===item.id} data-highlight={highlight} style={{left:`${item.x/10}%`,top:`${item.y/7}%`,width:`${item.width/10}%`,height:item.sample?`${item.height/7}%`:undefined,aspectRatio:item.sample?undefined:`${item.width}/${item.height}`}}>
      {highlight&&<span className="change-region" aria-hidden="true" style={{transform:`rotate(${item.rotation??0}deg)`}}/>}
      {highlight&&compare&&item.kind!=="added"&&<span className="change-before" aria-hidden="true"/>}
      <button type="button" className="change-pin" data-change-pin={clustered?undefined:item.id} aria-label={clustered?`겹친 변경 ${group.length}개`:`${labels[item.kind]} ${index} · ${item.title}`} aria-expanded={clustered?open:undefined} aria-pressed={selected===item.id} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();if(clustered){groupButton.current=event.currentTarget;setExpanded(open?null:group[0].id);}else onSelect(item.id);}}>
        <span>{clustered?group.length:index}</span><span className="change-pin-symbol">{clustered?"≡":symbols[item.kind]}</span>
        <span className="change-tooltip"><strong>{item.title}</strong><span>{item.author}{item.sample?" · 예시 참여자":""} · {labels[item.kind]}</span><span className="change-tooltip-summary">{item.summary}</span><small>{clustered?`클릭하여 겹친 변경 ${group.length}개 보기`:"클릭하여 이 위치의 대화 보기"}</small></span>
      </button>
      {clustered&&open&&<div className="change-cluster-list" role="group" aria-label="겹친 변경 선택" data-align-right={item.x>650} onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();setExpanded(null);groupButton.current?.focus();}}}>
        <strong>이 위치의 변경 {group.length}개</strong>
        {group.map(member=><button type="button" key={member.id} aria-pressed={selected===member.id} onClick={event=>{event.stopPropagation();setExpanded(null);onSelect(member.id);}}><span>{numbers.get(member.id)}</span><span>{member.title}<small>{labels[member.kind]} · {member.author}</small></span></button>)}
      </div>}
    </div>;})}
  </div>;
}

type Props={onRequestsChange?:(requests:ChangeRequestPreview[]|null)=>void;requestToOpen?:{round:number;nonce:number};drawingRevision?:number;requestSelection?:{ids:string[];nonce:number};items:DrawingChangeItem[];selected:string|null;onSelect:(id:string|null)=>void;mode:"author"|"review";onReview:()=>void;onAuthor:(id?:string)=>void;viewer:boolean;compare:boolean;onCompare:()=>void;requesting:boolean;onRequest:(open:boolean)=>void;onLegacyReview:()=>void;hasReviewRecord:boolean;page:number;storageKey?:string;initialRequestRound?:number;onSaveFailure?:(failed:boolean)=>void;onDelivery?:(request:ChangeRequestPreview)=>void;snapshot?:DrawingRequestSnapshot;currentFile?:File};
export function DrawingChangePanel({onRequestsChange,requestToOpen,drawingRevision,requestSelection,items,selected,onSelect,mode,onReview,onAuthor,viewer:readOnlyViewer,compare,onCompare,requesting,onRequest,onLegacyReview,hasReviewRecord,page,storageKey,initialRequestRound,onSaveFailure,onDelivery,snapshot,currentFile}:Props){
  const panelRef=useRef<HTMLElement>(null);
  const requestMessageRef=useRef<HTMLTextAreaElement>(null);
  const locationRequestFocus=useRef(false);
  const requestResultRef=useRef<HTMLHeadingElement>(null);
  const previousLocation=useRef({selected,requesting});
  const [drafts,setDrafts]=useState<Record<string,string>>({});
  const [notes,setNotes]=useState<Record<string,{text:string;kind:string}[]>>({});
  const [checked,setChecked]=useState<Record<string,boolean>>({});
  const [filter,setFilter]=useState("all");
  const [noteKinds,setNoteKinds]=useState<Record<string,string>>({});
  const [requestMessage,setRequestMessage]=useState("");
  const [requestPreviewScope,setRequestPreviewScope]=useState<string|null>(null);
  const [requestMode,setRequestMode]=useState<"page"|"selected">("page");
  const [requestIds,setRequestIds]=useState<string[]>([]);
  const [requests,setRequests]=useState<ChangeRequestPreview[]>([]);
  const [activeRequest,setActiveRequest]=useState(initialRequestRound??0);
  const [showRequest,setShowRequest]=useState(initialRequestRound!==undefined);
  const [requestsRestored,setRequestsRestored]=useState(false);
  const [requestReadError,setRequestReadError]=useState(false);
  const [requestSaveError,setRequestSaveError]=useState(false);
  useEffect(()=>{onRequestsChange?.(requestsRestored&&!requestReadError?requests:null);},[requests,requestsRestored,requestReadError,onRequestsChange]);
  const openedRequest=useRef<object|null>(null);
  useEffect(()=>{
    if(!requestToOpen||openedRequest.current===requestToOpen||!requestsRestored||requestReadError||!requests.some(request=>request.round===requestToOpen.round))return;
    openedRequest.current=requestToOpen;setActiveRequest(requestToOpen.round);setShowRequest(true);onRequest(true);
  },[requestToOpen,requestsRestored,requestReadError,requests,onRequest]);
  const [conversationRestored,setConversationRestored]=useState(false);
  const [conversationReadError,setConversationReadError]=useState(false);
  const [conversationSaveError,setConversationSaveError]=useState(false);
  const viewer=readOnlyViewer||requestReadError||conversationReadError||Boolean(storageKey&&(!requestsRestored||!conversationRestored));
  const appliedSelection=useRef<object|null>(null);
  useEffect(()=>{
    if(!requestSelection||appliedSelection.current===requestSelection||viewer)return;
    if(!requestSelection.ids.length||requestSelection.ids.some(id=>!items.some(item=>item.id===id)))return;
    appliedSelection.current=requestSelection;
    setRequestMode("selected");setRequestIds([...new Set(requestSelection.ids)]);setRequestPreviewScope(null);setShowRequest(false);
    requestAnimationFrame(()=>panelRef.current?.closest('.pdf-screen-right')?.scrollTo({top:0,behavior:'instant'}));
  },[requestSelection,viewer,items]);
  const readConversation=()=>{
    if(!storageKey){setConversationRestored(true);return;}
    try{
      const raw=sessionStorage.getItem(`${storageKey}:conversations`);
      const value:ChangeConversation=raw===null?{schemaVersion:1,drafts:{},notes:{},noteKinds:{},checked:{}}:parseChangeConversation(raw);
      setDrafts(value.drafts);setNotes(value.notes);setNoteKinds(value.noteKinds);setChecked(value.checked);
      setRequestMessage(value.requestDraft?.message??"");setRequestMode(value.requestDraft?.mode??"page");setRequestIds(value.requestDraft?.ids??[]);setRequestPreviewScope(null);
      setConversationRestored(true);setConversationReadError(false);
    }catch{setConversationReadError(true);setConversationRestored(false);}
  };
  const saveConversation=()=>{
    if(!storageKey||!conversationRestored||conversationReadError||readOnlyViewer)return;
    try{
      const raw=JSON.stringify({schemaVersion:1,drafts,notes,noteKinds,checked,requestDraft:{message:requestMessage,mode:requestMode,ids:requestIds}});
      parseChangeConversation(raw);
      sessionStorage.setItem(`${storageKey}:conversations`,raw);setConversationSaveError(false);
    }catch{setConversationSaveError(true);}
  };
  useEffect(readConversation,[storageKey]);
  useEffect(saveConversation,[storageKey,conversationRestored,conversationReadError,readOnlyViewer,drafts,notes,noteKinds,checked,requestMessage,requestMode,requestIds]);
  const readRequests=()=>{
    if(!storageKey){setRequestsRestored(true);return;}
    try{
      const raw=sessionStorage.getItem(storageKey);
      const restored=raw===null?[]:parseChangeRequestStorage(raw);
      setRequests(restored);setActiveRequest(initialRequestRound??restored.at(-1)?.round??0);
      setRequestReadError(false);setRequestsRestored(true);
    }catch{setRequestReadError(true);setRequestsRestored(false);}
  };
  const saveRequests=()=>{
    if(!storageKey||!requestsRestored||readOnlyViewer||requestReadError||!requests.length)return;
    try{sessionStorage.setItem(storageKey,JSON.stringify({schemaVersion:1,requests}));setRequestSaveError(false);}
    catch{setRequestSaveError(true);}
  };
  useEffect(readRequests,[storageKey]);
  useEffect(saveRequests,[storageKey,requestsRestored,readOnlyViewer,requestReadError,requests]);
  useEffect(()=>{onSaveFailure?.(requestSaveError||conversationSaveError);},[requestSaveError,conversationSaveError,onSaveFailure]);
  const requestedIds=new Set(requestIds);
  const requestItems=items.filter(value=>requestMode==="page"?value.page===page:requestedIds.has(value.id));
  const requestPages=requestMode==="page"?`${page}쪽`:`${[...new Set(requestItems.map(value=>value.page))].sort((a,b)=>a-b).join(", ")||"—"}쪽`;
  const requestScope=JSON.stringify({mode:requestMode,pages:requestPages,items:requestItems,snapshot,drawingRevision});
  const item=items.find(value=>value.id===selected);
  const noteKind=item?(noteKinds[item.id]??"의견"):"의견";
  const visible=items.filter(value=>filter!=="pending"||!checked[value.id]);
  const pending=items.filter(value=>!checked[value.id]);
  const checkedCount=items.length-pending.length;
  const changeNumbers=new Map(items.map((value,index)=>[value.id,index+1]));
  const sample=items.some(value=>value.sample);
  useEffect(()=>{
    if(!requesting||requestPreviewScope!==requestScope)return;
    const heading=requestResultRef.current;
    heading?.focus({preventScroll:true});
    heading?.scrollIntoView({block:"start",behavior:"instant"});
  },[requestPreviewScope,requestScope,requesting]);
  useEffect(()=>{
    const previous=previousLocation.current;
    previousLocation.current={selected,requesting};
    if(previous.selected===selected&&previous.requesting===requesting)return;
    const panel=panelRef.current;
    if(!panel||panel.closest('[hidden]')||(showRequest&&requesting))return;
    if(requesting&&locationRequestFocus.current){
      locationRequestFocus.current=false;
      const choice=panel.querySelector<HTMLInputElement>('.change-request-choices input:checked');
      if(choice){choice.focus({preventScroll:true});choice.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});return;}
    }
    const heading=panel.querySelector<HTMLElement>(requesting?'.change-panel-heading h2':'.change-detail-title h3');
    const target=heading??Array.from(panel.querySelectorAll<HTMLElement>('[data-change-item]')).find(element=>element.dataset.changeItem===previous.selected)??panel.querySelector<HTMLElement>('[aria-label="변경 필터"]');
    if(!target)return;
    if(heading){
      heading.tabIndex=-1;
      panel.closest('.pdf-screen-right')?.scrollTo({top:0,behavior:'instant'});
    }
    target.focus({preventScroll:true});
    target.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  },[selected,requesting]);
  return <section ref={panelRef} className="change-panel" aria-label="변경과 대화">
    {conversationReadError&&<div className="change-scope" role="alert"><strong>위치별 대화를 복원하지 못했습니다.</strong><p>기존 기록을 보호하기 위해 작성을 막았습니다. 저장된 기록은 덮어쓰지 않습니다.</p><button className="change-secondary" onClick={readConversation}>위치별 대화 다시 읽기</button></div>}
    {conversationSaveError&&<div className="change-scope" role="alert"><strong>위치별 대화를 보관하지 못했습니다.</strong><p>입력한 내용은 현재 화면에 남아 있습니다. 이동·새로고침 전에 다시 시도해 주세요.</p><button className="change-secondary" onClick={saveConversation}>위치별 대화 보관 다시 시도</button></div>}
    {requestReadError&&<div className="change-scope" role="alert"><strong>요청 묶음을 복원하지 못했습니다.</strong><p>기존 기록을 보호하기 위해 변경을 막았습니다. 저장된 기록을 확인한 뒤 다시 읽어 주세요.</p><button className="change-secondary" onClick={readRequests}>요청 묶음 다시 읽기</button></div>}
    {requestSaveError&&<div className="change-scope" role="alert"><strong>요청 묶음을 보관하지 못했습니다.</strong><p>최신 내용은 현재 화면에 남아 있습니다. 새로고침하거나 이동하기 전에 다시 시도해 주세요.</p><button className="change-secondary" onClick={saveRequests}>요청 묶음 보관 다시 시도</button></div>}
    {requests.length>0&&<p className="change-footnote">{storageKey?"요청 기록은 이 브라우저 탭에만 보관됩니다. 실제 전송·승인 아님.":"이 작업의 요청은 현재 화면에서만 유지됩니다. 새로고침하면 사라집니다."}</p>}
    {requests.length>0&&!showRequest&&<button className="change-legacy-link" onClick={()=>{setShowRequest(true);onRequest(true);}}>요청 묶음 보기</button>}
    <div hidden={!showRequest||!requesting}>
      <DrawingChangeRequestPreview storageKey={storageKey} currentDrawingRevision={drawingRevision} currentFile={currentFile} onDelivery={requestSaveError?undefined:onDelivery} currentItems={items} currentSnapshot={snapshot} requests={requests} active={activeRequest} visible={showRequest&&requesting} viewer={viewer} available={items.map(value=>value.id)} onActive={setActiveRequest}
        onApprove={note=>{if(viewer||requestSaveError||activeRequest!==requests.at(-1)?.round)return;setRequests(current=>current.map(request=>request.round===activeRequest&&canApproveChangeRequest(request,items,snapshot,drawingRevision)?{...request,approval:{note,at:new Date().toISOString()}}:request));}}
        onClose={()=>{setShowRequest(false);onRequest(false);}}
        onEdit={id=>{if(viewer||!items.some(item=>item.id===id))return;setShowRequest(false);onAuthor(id);}}
        onLocate={id=>{setShowRequest(false);onSelect(id);}}
        onDecision={(id,kind,note)=>{if(viewer||activeRequest!==requests.at(-1)?.round||(kind==="changes"&&!note.trim()))return;setRequests(current=>current.map(request=>request.round===activeRequest&&!request.approval?{...request,decisions:{...request.decisions,[id]:{kind,note}}}:request));}}
        onReconfigure={scope=>{if(viewer)return;const request=requests.find(value=>value.round===activeRequest);if(!request)return;setRequestIds((scope==="all"?items:request.items).map(value=>value.id));setRequestMode("selected");setRequestMessage(request.message);setRequestPreviewScope(null);setShowRequest(false);}}
      />
    </div>
    <div hidden={showRequest&&requesting}>
    {mode==="review"&&!requesting&&items.length>0&&<section className="change-progress" aria-label="변경 확인 진행">
      <div><strong>변경 확인</strong><span aria-live="polite">{checkedCount} / {items.length}개 확인</span></div>
      <div className="change-progress-track" role="progressbar" aria-label="화면 변경 확인" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={checkedCount}><span style={{width:`${checkedCount/items.length*100}%`}}/></div>
      <p>{pending.length?"번호를 따라 위치와 의견을 확인하세요.":"모든 위치를 살펴봤습니다. 필요하면 요청 범위를 구성하세요."}</p>
      <button className="change-secondary" disabled={!pending.length} onClick={()=>{
        const index=items.findIndex(value=>value.id===selected);
        const next=[...items.slice(index+1),...items.slice(0,index+1)].find(value=>!checked[value.id]);
        if(next)onSelect(next.id);
      }}>다음 확인 전 항목<ArrowRight size={14}/></button>
      <small>현재 화면의 확인 표시 · 승인 상태와 별개</small>
    </section>}
    {(!item||requesting)&&<div className="change-panel-heading"><span className="change-eyebrow">{mode==="author"?"DRAWING WORKSPACE":"DRAWING REVIEW"}</span><h2>{requesting?"검토 요청 구성":mode==="author"?"도면에서 시작하세요":"변경 사항"}{!requesting&&<span>{items.length}</span>}</h2><p>{sample?"템플릿 변경 시나리오 · 자동 감지 아님":"이 화면의 도형 표시 · 자동 감지 아님"}</p></div>}
    {requesting?<div className="change-request">
      <button className="change-back" onClick={()=>onRequest(false)}><ArrowLeft size={14}/> 변경으로 돌아가기</button>
      {storageKey&&<p className="change-footnote">메시지와 선택은 이 탭에 초안으로 보관됩니다. 현재 페이지 범위와 변경 내용을 다시 미리 확인한 뒤 진행하세요.</p>}
      {requestMode==="selected"&&requestIds.some(id=>!items.some(item=>item.id===id))&&<p role="status" className="change-scope">이전에 선택한 변경 중 현재 도면에서 찾을 수 없는 항목이 있습니다. 요청 범위를 다시 확인해 주세요.</p>}
      <fieldset className="change-request-range" disabled={viewer}><legend>요청 범위</legend>
        <label><input type="radio" name="change-request-range" checked={requestMode==="page"} onChange={()=>setRequestMode("page")}/>현재 페이지 전체</label>
        <label><input type="radio" name="change-request-range" checked={requestMode==="selected"} onChange={()=>setRequestMode("selected")}/>변경 직접 선택</label>
      </fieldset>
      {requestMode==="selected"&&<fieldset className="change-request-choices" disabled={viewer}><legend>검토할 변경 선택</legend>
        {items.map(value=><label key={value.id}><input type="checkbox" aria-label={`${value.title} · ${value.page}쪽`} checked={requestedIds.has(value.id)} onChange={event=>setRequestIds(current=>event.target.checked?[...current,value.id]:current.filter(id=>id!==value.id))}/><span>{value.title}<small>{value.page}쪽 · {labels[value.kind]}</small></span></label>)}
        {!items.length&&<p>선택할 변경이 없습니다.</p>}
      </fieldset>}
      <div className="change-scope"><span>요청 범위 미리보기</span><strong>{requestMode==="page"?"현재 페이지":"직접 선택"} · {requestItems.length}개 변경</strong><small>{requestPages} · {sample?"템플릿 시나리오":"화면 도형"}</small>{!requestItems.length&&<small>검토할 변경을 하나 이상 선택해 주세요.</small>}</div>
      <label>검토자<select disabled={viewer} aria-label="화면 검토자"><option>김검토 · 예시 참여자</option></select></label>
      <label>요청 메시지<textarea aria-label="요청 메시지" ref={requestMessageRef} value={requestMessage} disabled={viewer} onChange={event=>{setRequestMessage(event.target.value);setRequestPreviewScope(null);}} placeholder="검토할 내용을 간단히 적어 주세요." maxLength={500}/></label>
      <button className="change-primary" disabled={viewer||!requestMessage.trim()||!requestItems.length} onClick={()=>setRequestPreviewScope(requestScope)}><Eye size={15}/> 요청 내용 미리보기</button>
      {requestPreviewScope!==null&&requestPreviewScope!==requestScope&&<p className="change-footnote" role="status">페이지 또는 변경 범위가 달라졌습니다. 요청 내용을 다시 미리 확인해 주세요.</p>}
      {requestPreviewScope===requestScope&&<div className="change-scope" role="status"><h3 ref={requestResultRef} tabIndex={-1}>요청 구성 예시 · 미전송</h3><small>{requestPages} · {requestItems.length}개 변경</small><p>{requestItems.map(value=>`${value.title} (${value.page}쪽)`).join(" · ")}</p><p>{requestMessage}</p><small>실제 개정 고정·검토 요청은 실행되지 않았습니다.</small><button className="change-primary" disabled={viewer||!requestItems.length} onClick={()=>{if(viewer||!requestItems.length)return;const round=(requests.at(-1)?.round??0)+1;setRequests(current=>[...current,{round,...(drawingRevision===undefined?{}:{drawingRevision}),message:requestMessage,items:requestItems.map(value=>({...value})),decisions:{},...(snapshot?{snapshot:structuredClone(snapshot)}:{})}]);setActiveRequest(round);setShowRequest(true);setRequestPreviewScope(null);}}>이 구성으로 검토 흐름 체험</button><button className="change-secondary" onClick={()=>{setRequestPreviewScope(null);requestMessageRef.current?.focus();}}>요청 내용 수정</button></div>}
      <p className="change-footnote">화면 확인용입니다. 서버 저장·알림·승인은 연결되지 않았습니다.</p>
    </div>:item?<div className="change-detail" data-change-detail={item.id}>
      <button className="change-back" onClick={()=>onSelect(null)}><ArrowLeft size={14}/> 전체 변경 {items.length}건</button>
      <div className="change-detail-title"><span className="change-kind" data-kind={item.kind}>{symbols[item.kind]} {labels[item.kind]}</span><span className="change-status">{checked[item.id]?"확인 표시 · 예시":"확인 전"}</span><h3>{item.title}</h3><p><span className="change-avatar">{item.author.slice(0,1)}</span>{item.author}{item.sample?" · 예시 참여자":" · 이 화면에서 작성"}<span>· {item.page}쪽</span></p></div>
      <p className="change-summary">{item.summary}</p>
      <div className="change-comparison"><div><small>변경 전</small><strong>{item.before}</strong></div><ArrowRight size={16}/><div><small>변경 후</small><strong>{item.after}</strong></div></div>
      {item.sample&&item.kind!=="added"?<button className="change-secondary" aria-pressed={compare} onClick={onCompare}><Eye size={15}/>{compare?"이전 영역 숨기기":"이전 영역 함께 보기"}</button>:<p className="change-footnote">{item.sample?"새로 추가된 영역입니다. 비교할 이전 영역이 없습니다.":"비교 기준 개정이 없습니다. 이전 형상을 임의로 표시하지 않습니다."}</p>}
      <div className="change-conversation"><h4><MessageSquare size={15}/> 이 위치의 대화 <span>{(notes[item.id]?.length??0)+(item.sample?1:0)}</span></h4>
        {item.sample&&<article className="change-message"><strong>{item.author}<small>예시 의견</small></strong><p>{item.kind==="removed"?"철거 범위와 연결된 설비를 함께 확인해 주세요.":item.kind==="added"?"회의실 출입과 통로 간섭을 확인해 주세요.":"변경 위치를 표시했습니다. 출입 동선 검토 부탁드립니다."}</p></article>}
        {notes[item.id]?.map((note,index)=><article className="change-message own" key={index}><strong>나<small>{note.kind} · 화면 예시</small></strong><p>{note.text}</p></article>)}
        {!item.sample&&!notes[item.id]?.length&&<p className="change-footnote">아직 이 위치에 남긴 의견이 없습니다.</p>}
        <form onSubmit={event=>{event.preventDefault();const text=drafts[item.id]?.trim();if(!text||viewer)return;setNotes(current=>({...current,[item.id]:[...(current[item.id]??[]),{text,kind:noteKind}]}));setDrafts(current=>({...current,[item.id]:""}));}}>
          <label className="change-message-label">대화 유형<select aria-label="위치 대화 유형" value={noteKind} disabled={viewer} onChange={event=>setNoteKinds(current=>({...current,[item.id]:event.target.value}))}><option>의견</option><option>수정 요청</option></select></label>
          <textarea aria-label="이 위치에 의견 남기기" value={drafts[item.id]??""} disabled={viewer} onChange={event=>setDrafts(current=>({...current,[item.id]:event.target.value}))} placeholder={viewer?"보기 전용에서는 의견을 작성할 수 없습니다.":"이 위치에 의견을 남겨 보세요…"} maxLength={1000}/>
          <button className="change-primary" disabled={viewer||!drafts[item.id]?.trim()}><Send size={14}/> 화면에 추가</button>
        </form>
      </div>
      <div className="change-detail-actions"><button className="change-secondary" disabled={viewer} aria-pressed={!!checked[item.id]} onClick={()=>setChecked(current=>({...current,[item.id]:!current[item.id]}))}><Check size={15}/>{checked[item.id]?"확인 표시 해제":"확인 표시"}</button><button className="change-secondary" disabled={viewer} onClick={()=>onAuthor()}><Pencil size={15}/> 작성으로</button></div>
      <div className="change-next-action"><strong>이 위치의 검토를 이어가세요</strong><p>현재 변경 1개를 요청 범위에 담습니다. 다음 화면에서 범위와 메시지를 확인한 뒤 진행합니다.</p><button className="change-primary" disabled={viewer||requestSaveError||conversationSaveError} onClick={()=>{
        if(viewer||requestSaveError||conversationSaveError)return;
        locationRequestFocus.current=true;setRequestMode("selected");setRequestIds([item.id]);setRequestPreviewScope(null);setShowRequest(false);onReview();onRequest(true);
      }}>이 위치 검토 요청<ArrowRight size={15}/></button></div>
      <p className="change-footnote">{storageKey?"대화·초안·확인 표시는 이 브라우저 탭에 보관됩니다.":"대화·확인 표시는 현재 화면에서만 유지됩니다."} 실제 수정 요청·승인·전송이 아닙니다.</p>
    </div>:<>
      {mode==="author"&&<div className="change-start"><span className="change-start-icon"><Pencil size={20}/></span><h3>작업은 도면 위에서,<br/>검토는 같은 자리에서.</h3><p>아래 도구로 표시를 추가하거나<br/>변경 핀을 눌러 의견을 확인하세요.</p><button className="change-primary" onClick={onReview}><Eye size={15}/> 변경 검토하기<ArrowRight size={15}/></button></div>}
      <div className="change-list-header"><strong>{mode==="author"?"이 도면의 변경":"검토할 변경"}</strong><label><SlidersHorizontal size={13}/><select aria-label="변경 필터" value={filter} onChange={event=>setFilter(event.target.value)}><option value="all">전체</option><option value="pending">확인 전</option></select></label></div>
      <div className="change-list">{visible.map(value=><button key={value.id} className="change-list-item" data-change-item={value.id} onClick={()=>onSelect(value.id)}><span className="change-index" data-kind={value.kind}>{changeNumbers.get(value.id)}</span><span><strong>{value.title}</strong><small>{symbols[value.kind]} {labels[value.kind]} · {value.page}쪽 · {value.author}{value.sample?" (예시)":""}</small><span className="change-list-status">{checked[value.id]?"확인 표시 · 예시":"확인 전"}</span></span><ChevronRight size={15}/></button>)}</div>
      {!visible.length&&<div className="change-empty"><MapPin size={22}/><h3>{items.length?"모든 항목에 확인 표시했습니다":"등록된 변경이 없습니다"}</h3><p>{items.length?"전체 필터에서 다시 확인할 수 있습니다.":"작성 모드에서 화면 도형을 추가하면 이곳에서 같은 위치를 확인할 수 있습니다."}</p></div>}
      {mode==="review"&&items.length>0&&<div className="change-review-action"><button className="change-primary" disabled={viewer} onClick={()=>onRequest(true)}>검토 요청 구성<ArrowRight size={15}/></button><p>페이지와 변경 범위를 먼저 확인합니다.</p></div>}
      <div className="change-guide"><MessageSquare size={16}/><p>핀과 목록은 같은 대화로 연결됩니다.<br/>도면을 떠나지 않고 확인해 보세요.</p></div>
    </>}
    {hasReviewRecord&&<button className="change-legacy-link" onClick={onLegacyReview}>기존 개정 검토 기록·결정 열기<ChevronRight size={14}/></button>}
    </div>
  </section>;
}
