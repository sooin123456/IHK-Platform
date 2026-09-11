import {useEffect,useState,type ReactNode} from "react";
import type {PDFDocumentProxy} from "pdfjs-dist";
import {Button} from "~/core/components/ui/button";
import {isSameLocalPdf,localPdfSelectionError} from "~/lukas/lib/drawing-pdf-screen-handoff";

type Renderer=typeof import("./drawing-pdf-screen-renderer.client");

/** Local reader only: no drawing registration, review mutation, or file upload. */
export function ProjectResourceReader({fixed,fixedLabel="공유"}:{fixed?:{fingerprint:string;page:number;overlay?:ReactNode};fixedLabel?:"공유"|"지정"}={}) {
  const [file,setFile]=useState<File|null>(null);
  const [document,setDocument]=useState<PDFDocumentProxy|null>(null);
  const [renderer,setRenderer]=useState<Renderer|null>(null);
  const [page,setPage]=useState(1);
  const [zoom,setZoom]=useState(1);
  const [attempt,setAttempt]=useState(0);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const fingerprint=fixed?.fingerprint;
  const fixedPage=fixed?.page;
  useEffect(()=>{
    if(!file)return;
    const controller=new AbortController();
    const url=URL.createObjectURL(file);
    let opened:{destroy:()=>Promise<void>}|undefined;
    setLoading(true);setError("");setDocument(null);
    void Promise.all([import("~/lukas/lib/pdf-page-renderer.client"),import("./drawing-pdf-screen-renderer.client")]).then(async([reader,surface])=>{
      if(fingerprint&&!await isSameLocalPdf(file,fingerprint))throw Error("SOURCE_MISMATCH");
      if(controller.signal.aborted)return;
      const next=await reader.openPdfDocument(url,controller.signal);
      if(controller.signal.aborted){await next.destroy();return;}
      if(fixedPage&&fixedPage>next.document.numPages){await next.destroy();throw Error("PAGE_MISSING");}
      opened=next;setDocument(next.document);setRenderer(surface);setLoading(false);
    }).catch(error=>{
      if(controller.signal.aborted)return;
      setError(error?.message==="SOURCE_MISMATCH"?`${fixedLabel} 당시 원본과 다른 PDF입니다. 파일 이름이 같아도 바이트가 다르면 열지 않습니다.`:error?.message==="PAGE_MISSING"?`${fixedLabel}된 페이지가 원본에 없습니다. 다른 페이지로 대신 열지 않았습니다.`:"PDF를 열지 못했습니다. 암호·손상 여부를 확인하거나 원본 PDF를 다시 선택하세요.");setLoading(false);
    });
    return()=>{controller.abort();if(opened)void opened.destroy().catch(()=>{});URL.revokeObjectURL(url);};
  },[file,attempt,fingerprint,fixedPage,fixedLabel]);
  const Surface=renderer?.PdfScreenSurface;
  return <section className="grid min-w-0 gap-3 border-t pt-3" aria-label={fixed?`${fixedLabel} PDF 읽기 전용 열람`:"자료 PDF 읽기 전용 열람"}>
    <h4 className="font-medium">로컬 PDF 열람 · 읽기 전용</h4>
    <p className="text-xs text-muted-foreground">{fixed?`${fixedLabel} 당시 SHA-256과 일치하는 원본을 직접 선택하면 지정된 ${fixed.page}쪽만 표시합니다. 파일 전송·서버 권한 검증이 아닌 로컬 체험입니다. 새로고침 후에는 다시 선택하세요.`:"직접 선택한 PDF를 이 상세 화면에서만 엽니다. 목록 자료와의 동일성은 확인되지 않았습니다. 파일 이름과 내용을 확인하세요. 자료 전환·닫기·새로고침 후에는 다시 선택해야 합니다."}</p>
    <label className="grid gap-1 text-sm">{fixed?`${fixedLabel} 원본 PDF 다시 선택`:"열람할 로컬 PDF 선택"}<input className="max-w-full" type="file" accept="application/pdf,.pdf" onChange={e=>{
      const next=e.currentTarget.files?.[0];e.currentTarget.value="";if(!next)return;
      const invalid=localPdfSelectionError(next);if(invalid){setError(invalid);return;}
      setFile(next);setPage(1);setZoom(1);setDocument(null);
    }}/></label>
    <p className="text-xs text-muted-foreground">{fixed?"PDF 50MB 이하 · 업로드·편집·다른 페이지 탐색 없음.":"PDF 50MB 이하 · 업로드·편집 없음. Excel·Word·HWP 본문 열람은 미지원이며 PDF 사본으로 확인할 수 있습니다."}</p>
    {file&&<p className="break-all text-sm">현재 선택한 파일: {file.name}</p>}
    {loading&&<p role="status">자료 PDF를 준비하고 있습니다.</p>}
    {error&&<div role="alert" className="text-sm text-destructive">{error}{file&&<Button variant="outline" onClick={()=>setAttempt(value=>value+1)}>자료 PDF 다시 시도</Button>}</div>}
    {document&&Surface&&<>
      <div className="flex flex-wrap items-center gap-2" aria-label="자료 PDF 페이지 이동">
        {fixed?<span>{fixedLabel}된 {fixed.page}쪽 · 페이지 고정</span>:<><Button variant="outline" disabled={page<=1} onClick={()=>setPage(value=>value-1)}>자료 이전 페이지</Button><span>{page} / {document.numPages}쪽</span><Button variant="outline" disabled={page>=document.numPages} onClick={()=>setPage(value=>value+1)}>자료 다음 페이지</Button></>}
        <Button variant="outline" disabled={zoom<=1} onClick={()=>setZoom(value=>Math.max(1,value-.25))}>자료 축소</Button><Button variant="outline" disabled={zoom>=3} onClick={()=>setZoom(value=>Math.min(3,value+.25))}>자료 확대</Button>
      </div>
      <div className="relative h-[min(55vh,520px)] min-h-64 overflow-hidden rounded border bg-slate-100"><Surface document={document} pageNumber={fixed?.page??page} zoom={zoom} panEnabled fitKey={attempt} overlay={fixed?.overlay}/></div>
    </>}
  </section>;
}
