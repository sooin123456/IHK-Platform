import {useEffect,useState} from "react";
import {Link,useSearchParams} from "react-router";
import {parseChangeRequestStorage} from "../lib/drawing-change-request-storage";
import type {ChangeRequestPreview} from "./drawing-change-request-preview";

export function ProjectChangeRequestsPreview({documents}:{documents:{id:string;title:string;href:string}[]}){
  const [entries,setEntries]=useState<{document:{id:string;title:string;href:string};request:ChangeRequestPreview}[]>([]);
  const [errors,setErrors]=useState<string[]>([]);
  const [loaded,setLoaded]=useState(false);
  const [params,setParams]=useSearchParams();
  const requestedFilter=params.get("requestStatus");
  const filter=requestedFilter&&["확인 대기","수정 요청","확인 완료","승인 확인"].includes(requestedFilter)?requestedFilter:"전체 요청";
  const setFilter=(value:string)=>setParams(previous=>{
    const next=new URLSearchParams(previous);
    if(value==="전체 요청")next.delete("requestStatus");else next.set("requestStatus",value);
    return next;
  },{replace:true});
  const read=()=>{
    const next:typeof entries=[],failed:string[]=[];
    for(const document of documents){
      try{const raw=sessionStorage.getItem(`1hk:preview:change-requests:${document.id}`);if(raw!==null)for(const request of parseChangeRequestStorage(raw).reverse())next.push({document,request});}
      catch{failed.push(document.title);}
    }
    setEntries(next);setErrors(failed);setLoaded(true);
  };
  useEffect(read,[documents]);
  const statusFor=(request:ChangeRequestPreview)=>request.approval?"승인 확인":request.items.some(item=>request.decisions[item.id]?.kind==="changes")?"수정 요청":request.items.some(item=>!request.decisions[item.id])?"확인 대기":"확인 완료";
  const visible=entries.filter(({request})=>filter==="전체 요청"||statusFor(request)===filter);
  return <section aria-label="프로젝트 변경 요청 묶음" className="mt-6 grid gap-3">
    <h2 className="text-lg font-semibold">변경 요청 묶음</h2><p className="text-sm text-muted-foreground">이 브라우저 탭의 항목별 검토 기록입니다. 개정 승인·실제 전송과는 별개입니다.</p>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">도면별 최신 요청부터 표시 · 이전 요청도 유지됩니다.</p><label className="flex items-center gap-2 text-sm">요청 묶음 상태<select aria-label="요청 묶음 상태" disabled={!loaded} value={filter} onChange={event=>setFilter(event.target.value)} className="rounded-md border bg-background px-3 py-2">{["전체 요청","확인 대기","수정 요청","확인 완료","승인 확인"].map(value=><option key={value}>{value}</option>)}</select></label></div>
    {!loaded&&<p role="status">요청 묶음을 읽고 있습니다.</p>}
    {errors.length>0&&<div role="alert" className="rounded-lg border p-4"><p>일부 요청 기록을 읽지 못했습니다: {errors.join(", ")}</p><button className="mt-2 underline" onClick={read}>요청 목록 다시 읽기</button></div>}
    {loaded&&!entries.length&&!errors.length&&<div className="rounded-xl border border-dashed bg-muted/20 p-5">
      <h3 className="font-semibold">아직 구성한 변경 요청 묶음이 없습니다.</h3>
      <p className="mt-2 text-sm text-muted-foreground">{params.get("role")==="viewer"?"보기 권한에서는 도면과 검토 위치를 확인할 수 있습니다. 요청 구성은 편집자에게 부탁해 주세요.":"도면을 열고 변경 위치를 표시한 뒤, 상단의 검토 요청에서 검토할 항목을 묶어 보세요."}</p>
      {documents.length?<details className="mt-4"><summary className="w-fit cursor-pointer rounded-md border bg-background px-4 py-2 text-sm font-medium">검토할 도면 선택</summary><ul className="mt-3 grid max-h-64 gap-2 overflow-auto">{documents.map(document=><li key={document.id}><Link className="block rounded-md border bg-background px-4 py-3 text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2" to={`${document.href}&returnPanel=project-reviews`}>{document.title} 열기</Link></li>)}</ul></details>:<p className="mt-3 text-sm">이 프로젝트에 도면이 없습니다. 도면 목록에서 빈 도면·템플릿 또는 파일로 시작해 주세요.</p>}
    </div>}
    {loaded&&entries.length>0&&!visible.length&&<p role="status" className="rounded-lg border border-dashed p-4 text-sm">선택한 상태의 요청 묶음이 없습니다. 다른 상태를 선택해 주세요.</p>}
    {visible.map(({document,request})=>{
      const changes=request.items.filter(item=>request.decisions[item.id]?.kind==="changes").length;
      const pending=request.items.filter(item=>!request.decisions[item.id]).length;
      return <article key={`${document.id}:${request.round}`} className="rounded-xl border p-4">
        <h3 className="font-semibold">{document.title} · 요청 {request.round}</h3>
        <span className="mt-2 inline-block rounded-md bg-muted px-2 py-1 text-xs">{statusFor(request)} · 예시</span>
        {request.approval&&<p className="mt-2 text-xs text-muted-foreground">요청 당시 {request.items.length}개 항목의 승인 확인 기록입니다. 도면 개정 승인·납품 완료와는 다릅니다.</p>}
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">{request.message}</p>
        <p className="my-2 text-sm">{request.items.length}개 항목 · 확인 대기 {pending}건 · 수정 요청 {changes}건</p>
        <Link className="text-sm underline" to={`${document.href}&requestRound=${request.round}&returnPanel=project-reviews${filter!=="전체 요청"?`&returnRequestStatus=${encodeURIComponent(filter)}`:""}`}>요청 {request.round} 검토하기</Link>
      </article>;
    })}
  </section>;
}
