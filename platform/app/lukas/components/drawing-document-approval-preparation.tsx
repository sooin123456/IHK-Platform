import {useEffect,useState} from "react";
import {Dialog,DialogTrigger,DialogContent,DialogHeader,DialogTitle,DialogDescription} from "~/core/components/ui/dialog";
import type {ChangeRequestPreview} from "./drawing-change-request-preview";

/** Approval composition UI only. This draft never mutates a request or locks a revision. */
export function DrawingDocumentApprovalPreparation({request,ready,viewer,storageKey}:{request:ChangeRequestPreview;ready:boolean;viewer:boolean;storageKey?:string}){
  const [open,setOpen]=useState(false),[pagesChecked,setPagesChecked]=useState(false),[objectsChecked,setObjectsChecked]=useState(false),[note,setNote]=useState(""),[preview,setPreview]=useState(false);
  const draftKey=storageKey?`${storageKey}:approval-opinion:${request.round}`:undefined;
  const [readError,setReadError]=useState(false),[saveError,setSaveError]=useState(false);
  const readDraft=()=>{
    if(!draftKey)return;
    try{
      const raw=sessionStorage.getItem(draftKey);
      if(raw!==null){
        const value=JSON.parse(raw);
        if(value?.schemaVersion!==1||typeof value.note!=="string"||value.note.length>1000)throw new Error("Invalid approval opinion");
        setNote(value.note);
      }
      setReadError(false);
    }catch{setReadError(true);}
  };
  useEffect(readDraft,[draftKey]);
  const saveDraft=(value:string)=>{
    if(!draftKey||viewer||readError)return;
    try{sessionStorage.setItem(draftKey,JSON.stringify({schemaVersion:1,note:value}));setSaveError(false);}
    catch{setSaveError(true);}
  };
  const eligible=ready&&!viewer&&pagesChecked&&objectsChecked;
  const showingPreview=preview&&eligible;
  const changeOpen=(value:boolean)=>{setOpen(value);if(!value)setPreview(false);};
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><button className="change-primary" disabled={!ready||viewer}>전체 도면 승인 내용 구성</button></DialogTrigger>
    <DialogContent className="max-h-[85dvh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-lg">
      <DialogHeader><DialogTitle>전체 도면 승인 내용 구성</DialogTitle><DialogDescription>검토한 요청을 기준으로 전체 승인 범위와 의견을 준비합니다. 아직 승인되지 않았습니다.</DialogDescription></DialogHeader>
      <div className="min-h-0 overflow-y-auto space-y-4" aria-label="승인 구성 내용">
      <div className="rounded border p-3 text-sm"><strong>{request.snapshot?.documentName} · R{request.drawingRevision}</strong><p>원본 {request.snapshot?.pageCount}쪽 · 화면 도형 {request.snapshot?.objects.length}개 · 요청 {request.round}</p></div>
      {!ready&&<p role="alert">도면 또는 요청 상태가 달라졌습니다. 검토로 돌아가 범위를 다시 확인하세요.</p>}
      {readError&&<p role="alert">의견 초안을 불러오지 못했습니다. 기존 초안은 덮어쓰지 않습니다. <button className="underline" onClick={readDraft}>초안 다시 불러오기</button></p>}
      {saveError&&<p role="alert">의견을 탭에 보관하지 못했습니다. 새로고침 전에 내용을 복사하거나 <button className="underline" onClick={()=>saveDraft(note)}>초안 저장 다시 시도</button>하세요.</p>}
      {!showingPreview&&<fieldset disabled={!ready||viewer||readError} className="grid gap-4 text-sm">
        <legend className="mb-3 font-semibold">전체 범위 확인</legend>
        <label className="flex items-start gap-2"><input type="checkbox" checked={pagesChecked} onChange={event=>{setPagesChecked(event.target.checked);setPreview(false);}}/>원본 전체 페이지를 확인했습니다</label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={objectsChecked} onChange={event=>{setObjectsChecked(event.target.checked);setPreview(false);}}/>화면 도형과 레이어 범위를 확인했습니다</label>
        <label className="grid gap-2">전체 도면 승인 의견<textarea aria-label="전체 도면 승인 의견" className="min-h-24 rounded border p-2" maxLength={1000} value={note} onChange={event=>{setNote(event.target.value);saveDraft(event.target.value);setPreview(false);}}/></label>
      </fieldset>}
      {showingPreview&&<section role="status" className="rounded border bg-slate-50 p-3 text-sm"><strong>승인 내용 미리보기 · 아직 승인되지 않았습니다</strong><p className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words">{note.trim()||"별도 승인 의견 없음"}</p><p className="mt-2">전체 페이지와 화면 도형 범위를 확인한 초안입니다. 승인 기록 저장·편집 잠금·새 개정 전환은 실행되지 않았습니다.</p></section>}
      <p className="text-xs text-muted-foreground">{draftKey?"의견은 이 브라우저 탭에만 초안으로 보관됩니다. 새로고침 후 범위 확인은 다시 해야 합니다.":"입력은 현재 화면에서만 유지되며 새로고침하면 사라집니다."} 실제 승인·전송이나 수량·금액 승인이 아닙니다.</p>
      </div>
      <div className="flex flex-wrap justify-end gap-2"><button className="change-secondary" onClick={()=>changeOpen(false)}>검토로 돌아가기</button><button className="change-primary" disabled={!eligible} onClick={()=>{if(eligible)setPreview(value=>!value);}}>{showingPreview?"승인 내용 수정":"승인 내용 미리보기"}</button></div>
    </DialogContent>
  </Dialog>;
}
