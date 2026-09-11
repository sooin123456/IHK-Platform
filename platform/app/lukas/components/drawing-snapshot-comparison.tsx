import {useRef,useState} from "react";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from "~/core/components/ui/dialog";
import {DrawingScreenObjectPreview} from "./drawing-screen-object-preview";
import type {DrawingRequestSnapshot} from "./drawing-request-snapshot";
import {useDrawingSnapshotPdf} from "../lib/use-drawing-snapshot-pdf";
import {DrawingObjectPropertiesRecord} from "./drawing-object-properties-record";

export function DrawingSnapshotComparisonPane({label,snapshot,page,selected,onSelect,showHidden=false,zoom=1,fitKey=0,relativePosition,onRelativePositionChange}:{label:string;snapshot:DrawingRequestSnapshot;page:number;selected:string|null;onSelect:(id:string)=>void;showHidden?:boolean;zoom?:number;fitKey?:number;relativePosition?:{key:number;x:number;y:number}|null;onRelativePositionChange?:(position:{x:number;y:number})=>void}){
 const pdf=useDrawingSnapshotPdf(snapshot);
 const exists=page<=snapshot.pageCount;
 const objects=snapshot.objects.filter(object=>object.page===page&&snapshot.layers.some(layer=>layer.id===object.layer&&(layer.visible||showHidden)));
 const object=objects.find(object=>object.id===selected);
 const template=snapshot.source?.kind==="office"?"/images/workspace-start/office-plan.png":snapshot.source?.kind==="house"?"/images/workspace-start/house-plan.png":null;
 return <section aria-label={`${label} 비교`} className="min-w-0 rounded-lg border bg-slate-50 p-3">
  <h3 className="font-semibold">{label}</h3><p className="break-all text-sm">{snapshot.documentName} · {page}쪽</p>
  {snapshot.source?.kind==="pdf"&&<div className="mt-3 grid gap-2 text-xs">
   <label>{label} 비교 PDF 선택<input className="block w-full" aria-label={`${label} 비교 PDF 선택`} type="file" accept=".pdf" onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value="";if(file)pdf.select(file);}}/></label>
   <p>동일한 원본만 표시 · SHA-256·크기·페이지 수 확인 · 업로드하지 않습니다.</p>
   <details><summary>비교 원본 식별 정보</summary><p className="break-all">{snapshot.source.fileName} · {snapshot.source.byteSize}바이트 · SHA-256 {snapshot.source.fingerprint}</p></details>
  </div>}
  {pdf.checking&&<p role="status" className="mt-2 text-sm">원본을 확인하고 있습니다.</p>}
  {pdf.loaded&&<p role="status" className="mt-2 break-all rounded bg-emerald-50 p-2 text-sm text-emerald-800">원본 확인 완료 · {pdf.loaded.fileName}</p>}
  {pdf.error&&<p role="alert" className="mt-2 text-sm text-red-700">{pdf.error}</p>}
  {!exists?<p role="status" className="p-8 text-sm">이 기록에는 {page}쪽이 없습니다.</p>:<>
   {pdf.loaded?<div className="mt-3 h-80 overflow-hidden rounded border bg-white"><pdf.loaded.Surface document={pdf.loaded.document} pageNumber={page} zoom={zoom} fitKey={fitKey} panEnabled={true} relativePosition={relativePosition} onRelativePositionChange={onRelativePositionChange} overlay={<DrawingScreenObjectPreview objects={objects} selected={selected} tool="" onSelect={onSelect} onCreate={()=>{}}/>}/></div>:<div className={`relative mt-3 overflow-hidden rounded border bg-white ${template?"aspect-[7/3]":"aspect-[10/7]"}`}>
    {template&&<img src={template} alt="템플릿 배경 예시" className="absolute inset-0 h-full w-full object-contain grayscale opacity-65"/>}
    <DrawingScreenObjectPreview objects={objects} selected={selected} tool="" onSelect={onSelect} onCreate={()=>{}}/>
    {!objects.length&&<p className="p-4 text-sm text-slate-600">이 페이지에 표시할 저장 도형이 없습니다.</p>}
   </div>}
   <p className="mt-2 text-xs text-muted-foreground">표시 도형 {objects.length}개 · {snapshot.source?.kind==="pdf"?(pdf.loaded?`기록과 일치하는 PDF 원본 · 배경을 드래그해 ${onRelativePositionChange?"같이":"개별"} 이동`:"원본 선택 전에는 저장된 화면 도형만 표시합니다."):template?"현재 템플릿 배경 예시이며 당시 원본 이미지 증거는 아닙니다.":"저장된 화면 도형만 표시합니다."}</p>
   <p className="mt-2 min-h-10 break-words text-sm">{object?`${object.name} · ${object.kind} · 화면 위치 ${Number(object.x.toFixed(2))}, ${Number(object.y.toFixed(2))}`:selected?"선택한 도형이 이 페이지에 없거나 숨겨져 있습니다.":"도형을 선택하면 양쪽 기록에서 같은 도형을 확인합니다."}</p>
   {object&&<DrawingObjectPropertiesRecord object={object} showAbsent/>}
  </>}
 </section>;
}

/** Read-only normalized screen records, not a native CAD or PDF revision diff. */
export function DrawingSnapshotComparison({before,after}:{before:DrawingRequestSnapshot;after:DrawingRequestSnapshot}){
 const [open,setOpen]=useState(false),[page,setPage]=useState(1),[selected,setSelected]=useState<string|null>(null),[showHidden,setShowHidden]=useState(false);
 const [zoom,setZoom]=useState(1),[fitKey,setFitKey]=useState(0);
 const [syncPan,setSyncPan]=useState(false);
 const [position,setPosition]=useState<{key:number;x:number;y:number;side:"before"|"after"}|null>(null);
 const sequence=useRef(0);
 const move=(side:"before"|"after",value:{x:number;y:number})=>{if(syncPan)setPosition({...value,side,key:++sequence.current});};
 return <>
  <button className="change-secondary" onClick={()=>{setPage(1);setSelected(null);setShowHidden(false);setZoom(1);setSyncPan(false);setPosition(null);setOpen(true);}}>두 기록 나란히 비교</button>
  <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl" onKeyDown={event=>event.stopPropagation()}>
   <DialogHeader><DialogTitle>요청과 납품 도형 비교</DialogTitle><DialogDescription>같은 페이지 번호의 저장 도형을 읽기 전용으로 비교합니다. 화면 좌표 기준이며 실제 치수·원본 정합성을 보장하지 않습니다. 현재 도면과 승인 기록은 바뀌지 않습니다.</DialogDescription></DialogHeader>
   <div className="flex flex-wrap items-center gap-3 text-sm">
    <label>비교 페이지<select aria-label="비교 페이지" className="ml-2 rounded border p-2" value={page} onChange={event=>{setPosition(null);setPage(Number(event.target.value));setSelected(null);}}>{Array.from({length:Math.max(before.pageCount,after.pageCount)},(_,index)=><option key={index+1} value={index+1}>{index+1}쪽</option>)}</select></label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={showHidden} onChange={event=>{setShowHidden(event.target.checked);setSelected(null);}}/>숨긴 도형 임시 표시</label>
   </div>
   {(before.source?.kind==="pdf"||after.source?.kind==="pdf")&&<div role="group" aria-label="비교 PDF 확대 조절" className="flex flex-wrap items-center gap-2 text-sm">
    <button className="min-h-9 min-w-9 rounded border bg-white px-3 disabled:opacity-40" aria-label="비교 PDF 함께 축소" disabled={zoom<=.5} onClick={()=>{setPosition(null);setZoom(value=>Math.max(.5,value-.25));}}>−</button><output aria-label="비교 PDF 확대율">{Math.round(zoom*100)}%</output>
    <button className="min-h-9 min-w-9 rounded border bg-white px-3 disabled:opacity-40" aria-label="비교 PDF 함께 확대" disabled={zoom>=3} onClick={()=>{setPosition(null);setZoom(value=>Math.min(3,value+.25));}}>+</button>
    <button className="min-h-9 rounded border bg-white px-3" onClick={()=>{setPosition(null);setZoom(1);setFitKey(value=>value+1);}}>비교 PDF 화면 맞춤</button>
    {before.source?.kind==="pdf"&&after.source?.kind==="pdf"&&<label className="flex items-center gap-2"><input type="checkbox" checked={syncPan} onChange={event=>{setPosition(null);setSyncPan(event.target.checked);}}/>PDF 같이 이동</label>}
    <small>각 화면 맞춤 기준 배율 · 이동은 스크롤 범위의 상대 위치 연동이며 실제 축척 일치나 자동 정렬이 아닙니다.</small>
   </div>}
   <div className="grid gap-3 md:grid-cols-2">
    <DrawingSnapshotComparisonPane label="요청 당시" snapshot={before} page={page} selected={selected} onSelect={setSelected} showHidden={showHidden} zoom={zoom} fitKey={fitKey} relativePosition={syncPan&&position?.side==="after"?position:null} onRelativePositionChange={syncPan?value=>move("before",value):undefined}/>
    <DrawingSnapshotComparisonPane label="납품 구성 당시" snapshot={after} page={page} selected={selected} onSelect={setSelected} showHidden={showHidden} zoom={zoom} fitKey={fitKey} relativePosition={syncPan&&position?.side==="before"?position:null} onRelativePositionChange={syncPan?value=>move("after",value):undefined}/>
   </div>
   <button className="change-secondary" onClick={()=>setOpen(false)}>나란히 비교 닫기</button>
  </DialogContent></Dialog>
 </>;
}
