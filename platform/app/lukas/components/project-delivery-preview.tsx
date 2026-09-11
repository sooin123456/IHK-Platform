import {useEffect,useState} from "react";
import {Link} from "react-router";
import {Button} from "~/core/components/ui/button";
import {DrawingDeliveryHistory,DrawingDeliveryRequestEvidence,DrawingDeliveryRequestScope,DrawingDeliveryDrawingCheck,DrawingDeliveryApprovalSummary,hasDrawingReviewRecord} from "./drawing-delivery-preview";
import {parseDeliveryDraft,type DeliveryDraft} from "./drawing-delivery-draft";
import {DrawingReviewLoop} from "./drawing-review-loop";

export function ProjectDeliveryPreview({projectId,documents,returnHref}:{projectId:string;documents:{id:string;title:string;href:string}[];returnHref:string}) {
  const scope=JSON.stringify([projectId,documents.map(document=>document.id)]);
  const [result,setResult]=useState<{scope:string;drafts:Record<string,DeliveryDraft>;errors:string[]}>({scope:"",drafts:{},errors:[]});
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    const drafts:Record<string,DeliveryDraft>={},errors:string[]=[];
    for(const document of documents){
      try{const raw=sessionStorage.getItem(`1hk:preview:delivery:${projectId}:${document.id}`);if(raw!==null){const draft=parseDeliveryDraft(raw);if(!draft)throw Error("invalid delivery draft");drafts[document.id]=draft;}}
      catch{errors.push(document.id);}
    }
    setResult({scope,drafts,errors});
  },[scope,retry]);
  const loaded=result.scope===scope;
  return <section aria-label="프로젝트 납품 구성" className="grid gap-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">납품 구성</h1><p className="mt-2 text-sm text-muted-foreground">이 프로젝트 도면의 현재 초안과 이전 구성을 모아 봅니다. 이 탭의 화면 예시이며 실제 파일·전송 기록은 아닙니다.</p></div><Button asChild variant="outline"><Link to={returnHref}>도면 목록으로</Link></Button></header>
    {!loaded?<p role="status">납품 구성을 불러오고 있습니다.</p>:<>
      {result.errors.length>0&&<div role="alert"><p>일부 도면의 납품 구성을 읽지 못했습니다. 기록을 변경하거나 다른 도면으로 대체하지 않았습니다.</p><Button variant="outline" onClick={()=>setRetry(value=>value+1)}>납품 목록 다시 읽기</Button></div>}
      {!documents.length&&<p className="rounded-lg border border-dashed p-6">등록된 도면이 없습니다. 도면 목록에서 빈 도면·템플릿·파일로 시작하세요.</p>}
      {documents.map(document=>{const draft=result.drafts[document.id],source=draft?.deliverySource;return <article key={document.id} data-document-id={document.id} className="grid gap-3 rounded-xl border p-4">
        <h2 className="break-words font-semibold">{document.title}</h2>
        {result.errors.includes(document.id)?<p>이 도면의 납품 기록을 확인할 수 없습니다.</p>:<>
          {source&&draft.exportSelection?<><h3 className="text-sm font-semibold">현재 납품 초안 · 구성 시점 기준</h3><dl className="grid grid-cols-[auto_1fr] gap-2 text-sm"><dt>검토 대상</dt><dd>{source.reviewContext?`R${source.reviewContext.revision} · ${source.reviewContext.page}쪽 · ${source.reviewContext.targetName||"D01"}`:"개정 미등록"}</dd><dt>범위</dt><dd>{draft.exportSelection.pageRange==="all"?`전체 페이지 (${source.pageCount}쪽)`:`${source.page}쪽`}</dd><dt>형식</dt><dd>{draft.exportSelection.format.toUpperCase()}</dd><dt>수신자 예시</dt><dd>{draft.deliveryConfiguration.recipient}</dd></dl>{source.reviewLoop&&hasDrawingReviewRecord(source.reviewLoop)&&<details><summary>고정된 검토 기록 확인</summary><DrawingReviewLoop state={source.reviewLoop} dispatch={()=>{}} ready viewer onLocate={()=>{}}/></details>}</>:<p className="text-sm text-muted-foreground">현재 납품 구성이 없습니다.</p>}
          {source&&<DrawingDeliveryApprovalSummary request={source.approvedRequest} record={source.reviewLoop}/>}
          <DrawingDeliveryHistory records={draft?.deliveryHistory??[]}/>
          {source?.approvedRequest&&<DrawingDeliveryRequestEvidence request={source.approvedRequest}/>}
          {source?.approvedRequest&&draft.exportSelection&&<DrawingDeliveryRequestScope request={source.approvedRequest} selection={draft.exportSelection} page={source.page} pageCount={source.pageCount}/>}
          {source?.approvedRequest&&<DrawingDeliveryDrawingCheck request={source.approvedRequest} snapshot={source.drawingSnapshot}/>}
        </>}
        <Button asChild variant="outline"><Link to={document.href}>납품 작업 이어가기</Link></Button>
      </article>;})}
    </>}
  </section>;
}
