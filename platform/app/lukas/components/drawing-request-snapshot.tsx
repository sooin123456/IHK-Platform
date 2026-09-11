import {useEffect,useRef,useState} from "react";
import type {PDFDocumentProxy} from "pdfjs-dist";
import {Dialog,DialogTrigger,DialogContent,DialogHeader,DialogTitle,DialogDescription} from "~/core/components/ui/dialog";
import {DrawingScreenObjectPreview,type ScreenShape} from "./drawing-screen-object-preview";
import type {PreviewLayer} from "./drawing-document-preview";
import {localPdfFingerprint,localPdfSelectionError} from "../lib/drawing-pdf-screen-handoff";
import {DrawingObjectPropertiesRecord} from "./drawing-object-properties-record";

export type DrawingRequestSnapshot={documentName:string;pageCount:number;objects:ScreenShape[];layers:PreviewLayer[];source?:{kind:"pdf";fileName:string;byteSize:number;fingerprint:string}|{kind:"blank"|"office"|"house";paper:"A2"|"A3"|"A4"}};

/** Frozen screen overlays only: no source PDF bytes or native CAD geometry. */
export function DrawingRequestSnapshotPreview({snapshot,round,initialPage=1,currentFile,context="request"}:{snapshot:DrawingRequestSnapshot;round:number;initialPage?:number;currentFile?:File;context?:"request"|"delivery"}){
 const recordLabel=context==="delivery"?"납품 구성 당시":"요청 당시";
 const startPage=Math.max(1,Math.min(snapshot.pageCount,initialPage));
 const [open,setOpen]=useState(false),[page,setPage]=useState(startPage),[selected,setSelected]=useState<string|null>(null);
 const [showHidden,setShowHidden]=useState(false);
 const [zoom,setZoom]=useState(1),[fitKey,setFitKey]=useState(0);
 const [file,setFile]=useState<File|null>(null),[error,setError]=useState(""),[checking,setChecking]=useState(false);
 const [loaded,setLoaded]=useState<{document:PDFDocumentProxy;Surface:typeof import("./drawing-pdf-screen-renderer.client").PdfScreenSurface}|null>(null);
 const selection=useRef(0);
 useEffect(()=>{if(!open){selection.current++;setFile(null);setLoaded(null);setError("");setChecking(false);}},[open]);
 useEffect(()=>{
  if(!open||!file)return;
  const abort=new AbortController(),url=URL.createObjectURL(file);
  let opened:{destroy:()=>Promise<void>}|undefined;
  setLoaded(null);
  void Promise.all([import("../lib/pdf-page-renderer.client"),import("./drawing-pdf-screen-renderer.client")]).then(async([reader,renderer])=>{
   if(abort.signal.aborted)return;
   const next=await reader.openPdfDocument(url,abort.signal);opened=next;
   if(abort.signal.aborted){await next.destroy();return;}
   if(next.document.numPages!==snapshot.pageCount){await next.destroy();throw Error("page count mismatch");}
   setLoaded({document:next.document,Surface:renderer.PdfScreenSurface});
  }).catch(()=>{if(!abort.signal.aborted)setError("원본 PDF를 표시하지 못했습니다. 같은 원본을 다시 선택해 주세요.");});
  return()=>{abort.abort();void opened?.destroy();URL.revokeObjectURL(url);};
 },[file,open,snapshot.pageCount]);
 const selectPdf=async(next:File)=>{
  const attempt=++selection.current;
  setFile(null);setLoaded(null);setError("");setChecking(true);
  try{
   const invalid=localPdfSelectionError(next);if(invalid)throw Error(invalid);
   const fingerprint=await localPdfFingerprint(next);
   if(attempt!==selection.current)return;
   if(snapshot.source?.kind!=="pdf"||fingerprint!==snapshot.source.fingerprint||next.size!==snapshot.source.byteSize)throw Error(`${recordLabel} 원본과 다릅니다. 같은 이름이 아닌 동일한 PDF 원본을 선택해 주세요.`);
   setFile(next);
  }catch(cause){if(attempt===selection.current)setError(cause instanceof Error?cause.message:"원본을 확인하지 못했습니다.");}
  finally{if(attempt===selection.current)setChecking(false);}
 };
 const pageObjects=snapshot.objects.filter(object=>object.page===page);
 const hiddenCount=pageObjects.filter(object=>snapshot.layers.some(layer=>layer.id===object.layer&&!layer.visible)).length;
 const visible=pageObjects.filter(object=>snapshot.layers.some(layer=>layer.id===object.layer&&(layer.visible||showHidden)));
 const object=visible.find(object=>object.id===selected);
 const templateImage=snapshot.source?.kind==="office"?"/images/workspace-start/office-plan.png":snapshot.source?.kind==="house"?"/images/workspace-start/house-plan.png":null;
 return <>
  <Dialog open={open} onOpenChange={setOpen}>
  <DialogTrigger asChild><button className="change-secondary" onClick={()=>{setPage(startPage);setSelected(null);setShowHidden(false);setZoom(1);if(currentFile&&snapshot.source?.kind==="pdf")void selectPdf(currentFile);}}>{recordLabel} 도형 배치 보기</button></DialogTrigger>
  <DialogContent onKeyDown={event=>event.stopPropagation()} className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
   <DialogHeader><DialogTitle>{context==="delivery"?"납품 구성 당시 도형 배치":`요청 ${round} · 당시 도형 배치`}</DialogTitle><DialogDescription>읽기 전용 화면 기록입니다. 열려 있는 PDF가 당시 원본과 일치하면 자동 표시합니다. 파일이 없거나 다르면 같은 원본을 다시 선택하세요. 현재 도면과 원본 파일은 변경하지 않습니다.</DialogDescription></DialogHeader>
   <section aria-label={`${recordLabel} 도형 배치`} className="grid gap-3">
    <strong>{snapshot.documentName}</strong>
    <details className="rounded border p-3 text-sm"><summary className="cursor-pointer">{recordLabel} 원본 근거</summary>
     {snapshot.source?.kind==="pdf"?<dl className="mt-3 grid gap-2 break-all"><dt>파일 이름</dt><dd>{snapshot.source.fileName}</dd><dt>파일 크기 · 바이트</dt><dd>{snapshot.source.byteSize}</dd><dt>SHA-256</dt><dd>{snapshot.source.fingerprint}</dd></dl>:snapshot.source?<p className="mt-3">{snapshot.source.kind==="blank"?"빈 도면":snapshot.source.kind==="office"?"사무실 템플릿":"주택 템플릿"} · {snapshot.source.paper}</p>:<p className="mt-3">원본 식별 정보가 기록되지 않았습니다. 현재 파일을 당시 원본으로 간주하지 않습니다.</p>}
     <p className="mt-2 text-xs text-muted-foreground">원본 바이트는 이 기록에 포함되지 않습니다. 파일 이름만 같아도 동일한 PDF라고 판단하지 않습니다.</p>
    </details>
    {snapshot.source?.kind==="pdf"&&<label className="grid gap-2 rounded border p-3 text-sm">{recordLabel} PDF 재선택<input aria-label={`${recordLabel} PDF 재선택`} type="file" accept=".pdf" onChange={event=>{const next=event.currentTarget.files?.[0];event.currentTarget.value="";if(next)void selectPdf(next);}}/><small>SHA-256이 같은 파일만 이 창에서 표시합니다. 업로드·원본 교체는 하지 않습니다.</small></label>}
    {checking&&<p role="status">{recordLabel} 원본과 비교하고 있습니다.</p>}
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    {file&&!loaded&&!error&&<p role="status">일치한 원본 PDF를 열고 있습니다.</p>}
    <label>기록 페이지<select aria-label="기록 페이지" className="ml-3 rounded border p-2" value={page} onChange={event=>{setPage(Number(event.target.value));setSelected(null);}}>{Array.from({length:snapshot.pageCount},(_,index)=><option key={index+1} value={index+1}>{index+1}쪽</option>)}</select></label>
    <p className="text-sm text-muted-foreground">전체 {snapshot.objects.length}개 도형 · 현재 페이지 표시 {visible.length}개 · {showHidden?"숨긴 레이어 임시 표시":`${recordLabel} 레이어 표시 상태`}</p>
    {(hiddenCount>0||showHidden)&&<label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label="숨긴 도형 함께 보기" checked={showHidden} onChange={event=>{setShowHidden(event.target.checked);setSelected(null);}}/>숨긴 도형 함께 보기 · 이 페이지 {hiddenCount}개</label>}
    {showHidden&&<p role="status" className="text-xs text-amber-700">이 창에서만 임시 표시합니다. 요청 기록과 현재 도면의 표시·잠금 상태는 바뀌지 않습니다.</p>}
    {templateImage&&<p className="text-xs text-muted-foreground">기록된 시작 종류의 템플릿 배경 예시입니다. 당시 이미지 바이트를 보관한 원본 증거는 아닙니다.</p>}
    {loaded&&<div role="group" aria-label="기록 PDF 보기 조절" className="flex flex-wrap items-center gap-2"><button className="change-secondary" aria-label="기록 PDF 축소" disabled={zoom<=.5} onClick={()=>setZoom(value=>Math.max(.5,value-.25))}>−</button><output aria-label="기록 PDF 확대율">{Math.round(zoom*100)}%</output><button className="change-secondary" aria-label="기록 PDF 확대" disabled={zoom>=3} onClick={()=>setZoom(value=>Math.min(3,value+.25))}>+</button><button className="change-secondary" onClick={()=>{setZoom(1);setFitKey(value=>value+1);}}>기록 PDF 화면 맞춤</button><small>배경을 드래그해 이동 · 도형은 읽기 전용</small></div>}
    {loaded?<div className="h-[55vh] min-h-64 overflow-hidden rounded border bg-slate-100"><loaded.Surface document={loaded.document} pageNumber={page} zoom={zoom} panEnabled={true} fitKey={fitKey} overlay={<DrawingScreenObjectPreview objects={visible} selected={selected} tool="" onSelect={setSelected} onCreate={()=>{}}/>}/></div>:<div className={`relative overflow-hidden rounded border bg-white ${templateImage?"aspect-[7/3]":"aspect-[10/7] min-h-48"}`}>
     {templateImage&&<img src={templateImage} alt="템플릿 배경 예시" className="absolute inset-0 h-full w-full object-contain grayscale opacity-65"/>}
     <DrawingScreenObjectPreview objects={visible} selected={selected} tool="" onSelect={setSelected} onCreate={()=>{}}/>
     {!visible.length&&<p className="p-6 text-sm text-slate-600">이 페이지에 표시할 저장 도형이 없습니다.</p>}
    </div>}
    {object&&<p className="text-sm">{object.name} · {object.kind} · {object.lineWidth} · {snapshot.layers.find(layer=>layer.id===object.layer)?.name}</p>}
    {object&&<DrawingObjectPropertiesRecord object={object}/>}
   </section>
   <button className="change-secondary" onClick={()=>setOpen(false)}>{recordLabel} 도형 배치 닫기</button>
  </DialogContent></Dialog>
 </>;
}
