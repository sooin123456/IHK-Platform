import {useEffect,useState} from "react";
import {Link} from "react-router";
import {Button} from "~/core/components/ui/button";
import {ExternalRequestPanel,externalRequestWorkspaceHref,readExternalRequestContext} from "./project-sharing-preview";
import {SharedDrawingPreview} from "./shared-drawing-preview";
import {parseReviewLoopSession} from "./drawing-review-loop";

/** Same drawing context, frozen request view; never restores over the current editor. */
export function ExternalRequestWorkspacePreview({projectId,documentId,requestId,viewer}:{projectId:string;documentId:string;requestId:string;viewer:boolean}) {
  const [request,setRequest]=useState<ReturnType<typeof readExternalRequestContext>|null>(null);
  const [currentAvailable,setCurrentAvailable]=useState(false);
  const [error,setError]=useState("");
  const returnHref=`/workspace-preview?${new URLSearchParams({project:projectId,panel:"project-sharing",externalFocus:requestId,...(viewer?{role:"viewer"}:{})})}`;
  useEffect(()=>{
    try{
      const row=readExternalRequestContext(sessionStorage.getItem(`1hk:preview:external-requests:${projectId}`)??"[]",projectId,documentId,requestId);
      setRequest(row);setError("");
      setCurrentAvailable(Boolean(parseReviewLoopSession(sessionStorage.getItem(`1hk:preview:review:${documentId}`)??"null")));
    }catch(e){setRequest(null);setError(e instanceof Error?e.message:"요청 당시 도면을 확인하지 못했습니다.");}
  },[projectId,documentId,requestId]);
  return <main className="min-h-screen bg-slate-50" aria-label="요청 당시 도면 문맥">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-5 py-4">
      <div><p className="text-xs font-semibold">1HK · 도면 작업실</p><h1 className="text-xl font-semibold">요청 당시 도면</h1></div>
      <Button asChild variant="outline"><Link to={returnHref}>요청 목록으로 돌아가기</Link></Button>
    </header>
    {error?<section role="alert" className="m-5 rounded border bg-white p-5">{error}</section>:!request?<p role="status" className="p-5">요청의 도면·개정·페이지를 확인하고 있습니다.</p>:<>
      <section className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-5 py-3">
        <div className="min-w-0"><h2 className="break-words font-semibold">{request.target.title} · R{request.target.revision} · {request.target.page}쪽</h2><p className="break-all text-xs">요청 ID · {request.id}</p><p className="text-sm">요청 당시 고정본 · 읽기 전용. 현재 편집본을 덮어쓰지 않습니다.</p></div>
        {currentAvailable?<Button asChild variant="outline"><Link to={externalRequestWorkspaceHref(request,viewer,false)}>{viewer?"현재 도면 보기":"현재 편집본에서 수정"}</Link></Button>:<p className="text-sm">현재 도면 기록이 없어 편집본으로 이동할 수 없습니다.</p>}
      </section>
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 rounded-xl border bg-white p-4" aria-label="요청 도면 캔버스"><SharedDrawingPreview view={request.target.view} title={request.target.title}/></section>
        <aside className="min-w-0 bg-white" aria-label="선택한 수정 요청"><ExternalRequestPanel projectId={projectId} documentId={documentId} requestId={requestId} viewer={viewer}/></aside>
      </div>
    </>}
  </main>;
}
