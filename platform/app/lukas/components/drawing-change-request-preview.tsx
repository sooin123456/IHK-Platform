import {useEffect,useRef,useState} from "react";
import type {DrawingChangeItem} from "./drawing-change-preview";
import {DrawingRequestSnapshotPreview,type DrawingRequestSnapshot} from "./drawing-request-snapshot";
import {DrawingObjectPropertiesRecord} from "./drawing-object-properties-record";
import {DrawingDeliveryHandoffDialog} from "./drawing-delivery-handoff-dialog";
import {documentApprovalPreflight} from "../lib/drawing-document-approval-preflight";
import {DrawingDocumentApprovalPreparation} from "./drawing-document-approval-preparation";

export type ChangeRequestPreview={
  round:number;message:string;items:DrawingChangeItem[];
  decisions:Record<string,{kind:"checked"|"changes";note:string}>;
  approval?:{note:string;at:string};
  snapshot?:DrawingRequestSnapshot;
  drawingRevision?:number;
};
export function canApproveChangeRequest(request:ChangeRequestPreview,current:DrawingChangeItem[],currentSnapshot?:DrawingRequestSnapshot,currentDrawingRevision?:number):boolean{
  return (request.drawingRevision===undefined||request.drawingRevision===currentDrawingRevision)&&(!request.snapshot||JSON.stringify(request.snapshot)===JSON.stringify(currentSnapshot))&&!request.approval&&request.items.length>0&&request.items.every(item=>request.decisions[item.id]?.kind==="checked"&&JSON.stringify(current.find(value=>value.id===item.id))===JSON.stringify(item));
}
export function compareDrawingRequestSnapshots(before:DrawingRequestSnapshot,after?:DrawingRequestSnapshot){
  if(!after)return null;
  const previous=new Map(before.objects.map(object=>[object.id,object]));
  const current=new Map(after.objects.map(object=>[object.id,object]));
  return {
    added:after.objects.filter(object=>!previous.has(object.id)),
    modified:after.objects.filter(object=>previous.has(object.id)&&JSON.stringify(previous.get(object.id))!==JSON.stringify(object)),
    removed:before.objects.filter(object=>!current.has(object.id)),
    layersChanged:JSON.stringify(before.layers)!==JSON.stringify(after.layers),
    sourceChanged:JSON.stringify(before.source)!==JSON.stringify(after.source),
    documentChanged:before.pageCount!==after.pageCount||before.documentName!==after.documentName,
  };
}

/** Screen-only request snapshots. These never approve or mutate a document revision. */
export function DrawingChangeRequestPreview({requests,active,onActive,onDecision,onLocate,onReconfigure,onClose,onEdit,viewer,available,visible,currentItems,currentSnapshot,currentFile,currentDrawingRevision,onApprove,onDelivery,storageKey}:{
  storageKey?:string;
  requests:ChangeRequestPreview[];active:number;onActive:(round:number)=>void;
  onDecision:(id:string,kind:"checked"|"changes",note:string)=>void;
  onEdit?:(id:string)=>void;
  onLocate:(id:string)=>void;onReconfigure:(scope?:"all")=>void;onClose:()=>void;
  viewer:boolean;available:string[];visible:boolean;
  currentItems:DrawingChangeItem[];onApprove:(note:string)=>void;
  currentSnapshot?:DrawingRequestSnapshot;currentFile?:File;
  currentDrawingRevision?:number;
  onDelivery?:(request:ChangeRequestPreview)=>void;
}){
  const [role,setRole]=useState<"author"|"reviewer"|"approver">("author");
  const [approvalNotes,setApprovalNotes]=useState<Record<number,string>>({});
  const [drafts,setDrafts]=useState<Record<string,string>>({});
  const [itemFilter,setItemFilter]=useState<{round:number;status:"all"|"pending"|"changes"|"checked"}>({round:active,status:"all"});
  const [itemSearch,setItemSearch]=useState({round:active,query:""});
  const heading=useRef<HTMLHeadingElement>(null);
  const root=useRef<HTMLElement>(null);
  const returnItem=useRef<{round:number;id:string}|null>(null);
  const request=requests.find(value=>value.round===active);
  const latest=requests.at(-1)?.round===active;
  const editable=!viewer&&latest&&role==="reviewer"&&!request?.approval;
  useEffect(()=>{
    if(returnItem.current?.round!==active)returnItem.current=null;
    if(!visible)return;
    const item=returnItem.current;
    const article=item?Array.from(root.current?.querySelectorAll<HTMLElement>('[data-request-item]')??[]).find(node=>node.dataset.requestItem===item.id):undefined;
    const target=article?.querySelector<HTMLElement>('h4')??heading.current;
    if(target){target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:"start",behavior:"instant"});}
    returnItem.current=null;
  },[visible,active]);
  if(!request)return visible?<section className="change-request" aria-label="요청 묶음 검토"><p role="status">이 문서에서 요청 기록을 찾을 수 없습니다. 다른 요청으로 대신 열지 않습니다.</p><button className="change-secondary" onClick={onClose}>변경으로 돌아가기</button></section>:null;
  const changes=request.items.filter(item=>request.decisions[item.id]?.kind==="changes").length;
  const pending=request.items.filter(item=>!request.decisions[item.id]).length;
  const readyForApproval=canApproveChangeRequest(request,currentItems,currentSnapshot,currentDrawingRevision);
  const snapshotChanged=Boolean(request.snapshot&&JSON.stringify(request.snapshot)!==JSON.stringify(currentSnapshot));
  const comparison=request.snapshot?compareDrawingRequestSnapshots(request.snapshot,currentSnapshot):null;
  const firstCorrection=request.items.find(item=>request.decisions[item.id]?.kind==="changes"&&available.includes(item.id));
  const step=request.approval?2:readyForApproval?1:0;
  const requestedIds=new Set(request.items.map(item=>item.id));
  const outsideScope=request.snapshot?.objects.filter(object=>!requestedIds.has(object.id));
  const documentPreflight=documentApprovalPreflight(request,currentSnapshot,currentDrawingRevision);
  const filter=itemFilter.round===active?itemFilter.status:"all";
  const search=itemSearch.round===active?itemSearch.query:"";
  const query=search.trim().toLocaleLowerCase();
  const visibleItems=request.items.filter(item=>(filter==="all"||(request.decisions[item.id]?.kind??"pending")===filter)&&(!query||`${item.title} ${item.page}쪽 ${request.decisions[item.id]?.note??""}`.toLocaleLowerCase().includes(query)));
  const resetItemSearch=()=>{setItemFilter({round:active,status:"all"});setItemSearch({round:active,query:""});};
  const locate=(id:string)=>{
    const inRequest=request.items.some(item=>item.id===id);
    if(inRequest&&!visibleItems.some(item=>item.id===id))resetItemSearch();
    returnItem.current=inRequest?{round:active,id}:null;
    onLocate(id);
  };
  return <section ref={root} className="change-request" aria-label="요청 묶음 검토">
    <button className="change-back" onClick={onClose}>변경으로 돌아가기</button>
    <div className="change-scope"><h3 ref={heading} tabIndex={-1}>요청 {request.round} · 검토 흐름 예시</h3><small>미전송 · 브라우저 화면 예시 · 실제 승인 아님</small><p>{request.message}</p><strong>{pending?`확인 대기 ${pending}건`:changes?`수정 요청 ${changes}건`:`전체 ${request.items.length}건 확인 · 예시`}</strong>{pending>0&&changes>0&&<small>수정 요청 {changes}건</small>}</div>
    <section className="change-scope" aria-label="요청 기준 도면 개정"><strong>{request.drawingRevision===undefined?"기준 도면 개정 미기록":`요청 당시 기준 도면 R${request.drawingRevision}`}</strong><small>요청 회차와 도면 개정 번호는 별개입니다. 요청 확인으로 도면 전체가 승인되지는 않습니다.</small>{request.drawingRevision!==undefined&&request.drawingRevision!==currentDrawingRevision&&<p role="status">현재 도면 개정 {currentDrawingRevision===undefined?"확인 불가":`R${currentDrawingRevision}`} · 기준 개정과 다릅니다. 현재 개정에서 새 요청을 구성하세요.</p>}</section>
    <ol className="change-request-steps" aria-label="요청 진행 단계">{["항목 검토","승인 확인","납품 기록 첨부"].map((label,index)=><li key={label} aria-current={step===index?"step":undefined} data-complete={index<step}><span aria-hidden="true">{index+1}</span>{label}</li>)}</ol>
    <label>요청 이력<select aria-label="요청 이력" value={active} onChange={event=>onActive(Number(event.target.value))}>{requests.map(value=><option key={value.round} value={value.round}>요청 {value.round}{value.round===requests.at(-1)?.round?" · 최신":" · 읽기 전용"}</option>)}</select></label>
    {request.snapshot?<DrawingRequestSnapshotPreview currentFile={currentFile} key={request.round} round={request.round} snapshot={request.snapshot} initialPage={request.items[0]?.page}/>:<p className="change-footnote">이 요청에는 당시 전체 도형 배치 기록이 없습니다. 현재 도면으로 대신 표시하지 않습니다.</p>}
    {snapshotChanged&&<div role="status" className="change-scope"><strong>요청 당시 전체 도면과 현재 화면이 다릅니다</strong><p>요청 항목 외의 도형·레이어·원본 정보도 비교합니다. 당시 기록은 보존되며, 현재 도면으로 진행하려면 새 요청을 구성해 주세요.</p></div>}
    {snapshotChanged&&comparison&&<details className="change-scope"><summary>요청 이후 변경 내역 · 추가 {comparison.added.length} · 수정 {comparison.modified.length} · 삭제 {comparison.removed.length}</summary><p className="change-footnote">이 작업실에 기록한 도형 비교입니다. PDF·IFC 원본 내부의 자동 변경 분석은 아닙니다.</p>{comparison.layersChanged&&<p>레이어 구성·표시·잠금 정보가 변경됐습니다.</p>}{comparison.sourceChanged&&<p>원본 식별 정보 또는 템플릿 설정이 변경됐습니다.</p>}{comparison.documentChanged&&<p>문서 이름 또는 페이지 수가 변경됐습니다.</p>}{([['추가',comparison.added],['수정',comparison.modified],['삭제',comparison.removed]] as const).map(([label,objects])=>objects.length>0&&<section key={label} aria-label={`${label}된 도형`}><strong>{label} {objects.length}개</strong><ul>{objects.map(object=><li key={object.id}>{object.name||object.kind} · {object.page}쪽 {label!=="삭제"&&available.includes(object.id)&&<button className="change-secondary" onClick={()=>locate(object.id)}>현재 위치 확인</button>}{label==="삭제"&&<small> · 당시 위치는 위의 도형 배치에서 확인</small>}</li>)}</ul></section>)}</details>}
    <div className="change-detail-actions"><button className="change-secondary" aria-pressed={role==="author"} onClick={()=>setRole("author")}>작성자 보기 · 예시</button><button className="change-secondary" aria-pressed={role==="reviewer"} onClick={()=>setRole("reviewer")}>검토자 보기 · 예시</button></div>
    <button className="change-secondary" aria-pressed={role==="approver"} onClick={()=>setRole("approver")}>승인자 보기 · 예시</button>
    {latest&&!request.approval&&<div className="change-next-action" aria-label="요청의 다음 단계">
      <strong>{changes?"수정 의견을 도면에서 확인하세요":pending?`남은 ${pending}개 항목을 확인하세요`:readyForApproval?"항목 검토를 마쳤습니다":"현재 도면과 요청 내용이 다릅니다"}</strong>
      <p>{changes?"기존 요청은 남겨 두고, 도면을 수정한 뒤 새 요청을 구성합니다.":pending?"검토자 보기에서 각 항목의 확인 또는 수정 요청을 남깁니다.":readyForApproval?"다음 단계에서 요청 범위와 승인 의견을 확인합니다. 아직 승인된 상태는 아닙니다.":"요청 이후 바뀌거나 사라진 항목이 있습니다. 작성자 보기에서 범위를 다시 구성하세요."}</p>
      {readyForApproval&&role!=="approver"&&<button className="change-primary" disabled={viewer} onClick={()=>setRole("approver")}>승인 확인으로 계속</button>}
      {firstCorrection&&onEdit&&<button className="change-primary" disabled={viewer} onClick={()=>{if(!viewer)onEdit(firstCorrection.id);}}>수정 요청 도형 편집</button>}
      {firstCorrection&&<button className="change-secondary" onClick={()=>locate(firstCorrection.id)}>첫 수정 요청 위치 확인</button>}
      {!changes&&pending>0&&role!=="reviewer"&&<button className="change-secondary" disabled={viewer} onClick={()=>setRole("reviewer")}>항목 검토 시작</button>}
    </div>}
    {request.approval&&<div className="change-scope" role="status"><strong>요청 {request.round} 승인 확인 · 화면 예시</strong><p>{request.approval.note||"별도 승인 의견 없음"}</p><small>{request.approval.at} · 당시 {request.items.length}개 항목과 검토 의견은 읽기 전용입니다. 실제 도면 개정 승인은 아닙니다.</small></div>}
    {!latest&&<p className="change-footnote">이전 요청은 읽기 전용입니다. 당시 범위와 의견을 유지합니다.</p>}
    {request.approval&&<section className="change-scope" aria-label="도면 개정 승인 전 범위 확인">
      <h4>도면 개정 승인 전 범위 확인</h4>
      <div role="status" aria-label="전체 도면 승인 사전 점검">
        <strong>{documentPreflight.ready?"전체 도면 승인 전 확인 준비됨 · 아직 승인 아님":"전체 도면 승인 전 보완 필요"}</strong>
        {!!documentPreflight.reasons.length&&<ul>{documentPreflight.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>}
      </div>
      <p>전체 도면 승인은 아직 이루어지지 않았습니다. 이 요청의 확인 기록과 별도로 전체 범위를 검토해야 합니다.</p>
      <DrawingDocumentApprovalPreparation key={`${storageKey}:${request.round}`} storageKey={storageKey} request={request} ready={latest&&documentPreflight.ready} viewer={viewer}/>
      <dl><dt>확인된 요청 범위</dt><dd>{request.items.length}개 항목 · {[...new Set(request.items.map(item=>item.page))].join(", ")}쪽</dd><dt>요청 당시 도면 기록</dt><dd>{request.snapshot?`${request.snapshot.pageCount}쪽 · ${request.snapshot.objects.length}개 도형`:"전체 도면 기록 없음"}</dd></dl>
      {outsideScope?<details><summary>요청 범위 밖 도형 · {outsideScope.length}개</summary>{outsideScope.length?<ul>{outsideScope.map(object=><li key={object.id}>{object.name||object.kind} · {object.page}쪽 <button className="change-secondary" disabled={!available.includes(object.id)} onClick={()=>locate(object.id)}>현재 도형 위치 확인</button></li>)}</ul>:<p>기록된 도형은 모두 요청에 포함됐습니다. 이것만으로 원본 PDF 내용이나 전체 도면이 승인되지는 않습니다.</p>}</details>:<p>당시 전체 기록이 없어 요청 밖의 범위를 판단할 수 없습니다.</p>}
      <small>도형 수는 브라우저에 기록한 오버레이 기준입니다. 원본 PDF·IFC 내부 요소의 승인 범위가 아닙니다. 기존 단일 도형 개정 검토 기록을 자동 변경하지 않습니다.</small>
      <div className="change-next-action">
        <strong>현재 도면의 다른 도형도 검토할까요?</strong>
        <p>현재 화면에 기록된 모든 페이지의 도형 {currentItems.length}개를 선택해 새 요청을 준비합니다. 다음 화면에서 범위를 조정하세요. 기존 요청과 승인 의견은 그대로 남습니다.</p>
        <button className="change-secondary" disabled={viewer||!currentItems.length} onClick={()=>{if(!viewer&&currentItems.length)onReconfigure("all");}}>전체 화면 도형으로 새 요청 구성</button>
      </div>
    </section>}
    {request.approval&&onDelivery&&<DrawingDeliveryHandoffDialog key={request.round} request={request} currentSnapshot={currentSnapshot} currentRevision={currentDrawingRevision} viewer={viewer} onContinue={onDelivery}/>}
    <section className="change-scope" aria-label="검토할 항목 찾기">
      <label>항목 검색<input type="search" aria-label="요청 항목 검색" placeholder="이름 · 페이지 · 저장된 의견" value={search} onChange={event=>setItemSearch({round:active,query:event.target.value})}/></label>
      <label>요청 항목 상태<select aria-label="요청 항목 상태" value={filter} onChange={event=>setItemFilter({round:active,status:event.target.value as typeof itemFilter.status})}>
        <option value="all">전체 · {request.items.length}</option>
        <option value="pending">확인 대기 · {pending}</option>
        <option value="changes">수정 요청 · {changes}</option>
        <option value="checked">확인 완료 · {request.items.length-pending-changes}</option>
      </select></label>
      <small aria-live="polite">{visibleItems.length} / {request.items.length}개 표시 · 요청 범위는 바뀌지 않습니다.</small>
      {!visibleItems.length&&<><p role="status">{query?"검색 조건에 맞는 항목이 없습니다.":"이 상태의 항목이 없습니다."}</p><button className="change-secondary" onClick={resetItemSearch}>전체 항목 보기</button></>}
    </section>
    {visibleItems.map(item=>{
      const decision=request.decisions[item.id],key=`${request.round}:${item.id}`,note=drafts[key]??decision?.note??"";
      const exists=available.includes(item.id);
      const current=currentItems.find(value=>value.id===item.id);
      const savedObject=request.snapshot?.objects.find(object=>object.id===item.id);
      const currentObject=currentSnapshot?.objects.find(object=>object.id===item.id);
      const changed=!!current&&JSON.stringify(current)!==JSON.stringify(item);
      return <article className="change-request-item" key={item.id} data-request-item={item.id} aria-label={item.title}>
        <h4>{item.title}</h4><small>{item.page}쪽 · 요청 당시 항목</small>
        <p role="status">{!current?"현재 도면에 없음":changed?"요청 이후 변경됨":"요청 당시와 동일"}</p>
        <details>
          <summary>요청 당시 · 현재 비교</summary>
          <section className="change-scope" aria-label="요청 당시 내용"><strong>요청 당시</strong><p>{item.title} · {item.page}쪽</p><p>{item.after}</p><small>화면 위치 X {Math.round(item.x)} · Y {Math.round(item.y)}</small></section>
          <section className="change-scope" aria-label="현재 내용"><strong>현재 도면</strong>{current?<><p>{current.title} · {current.page}쪽</p><p>{current.after}</p><small>화면 위치 X {Math.round(current.x)} · Y {Math.round(current.y)}</small>{changed&&current.title===item.title&&current.after===item.after&&current.x===item.x&&current.y===item.y&&<p>색상·레이어 등 표시 속성 또는 항목 정보가 달라졌습니다.</p>}</>:<p>현재 항목을 찾을 수 없습니다. 요청 당시 기록은 보존됩니다.</p>}</section>
          <p className="change-footnote">요청에 담긴 항목 정보 비교입니다. 당시 PDF·도면 전체를 복원한 화면은 아닙니다.</p>
          {savedObject?.properties&&<section aria-label="요청 당시 사용자 속성"><h5>요청 당시 사용자 속성</h5><DrawingObjectPropertiesRecord object={savedObject}/></section>}
          {currentObject&&(currentObject.properties||savedObject?.properties)&&<section aria-label="현재 사용자 속성"><h5>현재 사용자 속성</h5><DrawingObjectPropertiesRecord object={currentObject} before={savedObject}/></section>}
        </details>
        <p>{decision?.kind==="changes"?"수정 요청 · 예시":decision?.kind==="checked"?"확인 · 예시":"확인 대기"}</p>
        {decision?.note&&<p className="change-message">{decision.note}</p>}
        {latest&&!request.approval&&decision?.kind==="changes"&&onEdit&&<button className="change-primary" disabled={viewer||!exists} onClick={()=>{if(!viewer&&exists)onEdit(item.id);}}>이 수정 대상 편집</button>}
        <button className="change-secondary" disabled={!exists} onClick={()=>locate(item.id)}>도면에서 확인</button>
        {exists&&<small>현재 도면의 위치를 엽니다. 요청 당시 기록은 변경하지 않습니다.</small>}
        {!exists&&<p className="change-footnote">현재 도면에서 이 항목을 찾을 수 없습니다. 요청 당시 기록은 유지됩니다.</p>}
        {role==="reviewer"&&<><label>검토 의견<textarea aria-label="검토 의견" value={note} maxLength={1000} disabled={!editable} onChange={event=>setDrafts(current=>({...current,[key]:event.target.value}))}/></label><div className="change-detail-actions"><button className="change-secondary" disabled={!editable} onClick={()=>onDecision(item.id,"checked",note.trim())}>확인 · 예시</button><button className="change-secondary" disabled={!editable||!note.trim()} onClick={()=>onDecision(item.id,"changes",note.trim())}>수정 요청 · 예시</button></div></>}
      </article>;
    })}
    {role==="approver"&&!request.approval&&<div className="change-scope"><h4>승인 대상 확인</h4><p>요청 {request.round} · {request.items.length}개 항목 · {[...new Set(request.items.map(item=>item.page))].join(", ")}쪽</p><p className="change-footnote">모든 항목이 확인됐고, 기록된 전체 도형·레이어·원본 정보가 현재 화면과 같아야 진행할 수 있습니다. 화면 체험이며 실제 권한이나 도면 개정 승인을 부여하지 않습니다.</p><label>승인 의견<textarea aria-label="요청 승인 의견" maxLength={1000} value={approvalNotes[active]??""} disabled={viewer||!latest} onChange={event=>setApprovalNotes(current=>({...current,[active]:event.target.value}))}/></label><button className="change-primary" disabled={viewer||!latest||!canApproveChangeRequest(request,currentItems,currentSnapshot,currentDrawingRevision)} onClick={()=>onApprove(approvalNotes[active]?.trim()??"")}>이 요청 승인 확인 · 예시</button>{!canApproveChangeRequest(request,currentItems,currentSnapshot,currentDrawingRevision)&&<p role="status">미확인·수정 요청 항목이 있거나 현재 도면이 달라졌습니다. 작성자에게 돌아가 새 요청을 구성해 주세요.</p>}</div>}
    {role==="author"&&latest&&<><button className="change-primary" disabled={viewer} onClick={()=>onReconfigure()}>{request.items.some(item=>!available.includes(item.id))?"현재 항목으로 재검토 구성":"같은 항목으로 재검토 구성"}</button>{request.items.some(item=>!available.includes(item.id))&&<p className="change-footnote">사라진 항목은 새 요청에 포함하지 않습니다. 다음 화면에서 남은 항목과 추가할 변경을 선택하세요. 기존 요청은 보존됩니다.</p>}</>}
    <p className="change-footnote">항목 확인은 도면 승인과 다릅니다. 서버 요청·알림은 전송되지 않습니다.</p>
  </section>;
}
