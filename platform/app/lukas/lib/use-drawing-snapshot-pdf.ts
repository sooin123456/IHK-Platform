import {useEffect,useState} from "react";
import type {PDFDocumentProxy} from "pdfjs-dist";
import type {DrawingRequestSnapshot} from "../components/drawing-request-snapshot";
import {localPdfFingerprint,localPdfSelectionError} from "./drawing-pdf-screen-handoff";

/** Local-only PDF evidence. Changing selection cancels the previous verification/load. */
export function useDrawingSnapshotPdf(snapshot:DrawingRequestSnapshot){
 const [file,setFile]=useState<File|null>(null);
 const [loaded,setLoaded]=useState<{fileName:string;document:PDFDocumentProxy;Surface:typeof import("../components/drawing-pdf-screen-renderer.client").PdfScreenSurface}|null>(null);
 const [error,setError]=useState("");
 const [checking,setChecking]=useState(false);
 const source=snapshot.source;
 const fingerprint=source?.kind==="pdf"?source.fingerprint:undefined;
 const byteSize=source?.kind==="pdf"?source.byteSize:undefined;
 useEffect(()=>{
  if(!file)return;
  const abort=new AbortController();
  let url:string|undefined,opened:{destroy:()=>Promise<void>}|undefined;
  setLoaded(null);setError("");setChecking(true);
  void(async()=>{
   const invalid=localPdfSelectionError(file);if(invalid)throw Error(invalid);
   if(file.size!==byteSize||await localPdfFingerprint(file)!==fingerprint)throw Error("기록된 원본과 다릅니다. 동일한 PDF 원본을 선택해 주세요.");
   if(abort.signal.aborted)return;
   const [reader,renderer]=await Promise.all([import("./pdf-page-renderer.client"),import("../components/drawing-pdf-screen-renderer.client")]);
   if(abort.signal.aborted)return;
   url=URL.createObjectURL(file);
   const next=await reader.openPdfDocument(url,abort.signal);opened=next;
   if(abort.signal.aborted){await next.destroy();opened=undefined;return;}
   if(next.document.numPages!==snapshot.pageCount){await next.destroy();opened=undefined;throw Error("기록된 페이지 수와 다릅니다. 원본 기록을 확인해 주세요.");}
   setLoaded({fileName:file.name,document:next.document,Surface:renderer.PdfScreenSurface});
  })().catch(cause=>{if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:"PDF를 표시하지 못했습니다. 다시 선택해 주세요.");}).finally(()=>{if(!abort.signal.aborted)setChecking(false);});
  return()=>{abort.abort();void opened?.destroy();if(url)URL.revokeObjectURL(url);};
 },[file,fingerprint,byteSize,snapshot.pageCount]);
 const select=(next:File)=>{setLoaded(null);setError("");setChecking(true);setFile(next);};
 return {loaded,error,checking,select};
}
