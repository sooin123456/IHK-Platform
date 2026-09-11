import {useState} from "react";
import {Dialog,DialogTrigger,DialogContent,DialogHeader,DialogTitle,DialogDescription} from "~/core/components/ui/dialog";
import type {ChangeRequestPreview} from "./drawing-change-request-preview";
import type {DrawingRequestSnapshot} from "./drawing-request-snapshot";

export function DrawingDeliveryHandoffDialog({request,currentSnapshot,currentRevision,viewer,onContinue}:{request:ChangeRequestPreview;currentSnapshot?:DrawingRequestSnapshot;currentRevision?:number;viewer:boolean;onContinue:(request:ChangeRequestPreview)=>void}){
  const [open,setOpen]=useState(false);
  const known=!!request.snapshot?.source&&!!currentSnapshot?.source&&request.drawingRevision!==undefined&&currentRevision!==undefined;
  const matches=known&&request.drawingRevision===currentRevision&&JSON.stringify(request.snapshot)===JSON.stringify(currentSnapshot);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><button className="change-primary" disabled={viewer||!request.approval}>이 요청을 납품 구성에 첨부</button></DialogTrigger>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>납품으로 넘길 검토 기록</DialogTitle><DialogDescription>검토 기록을 첨부합니다. 전체 도면 개정 승인이 아닙니다.</DialogDescription></DialogHeader>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <dt>요청 기록</dt><dd>요청 {request.round} · {request.drawingRevision===undefined?"개정 미기록":`R${request.drawingRevision}`}</dd>
        <dt>검토한 범위</dt><dd>{request.items.length}개 항목 · {[...new Set(request.items.map(item=>item.page))].join(", ")}쪽</dd>
        <dt>당시 전체 도면</dt><dd>{request.snapshot?`${request.snapshot.pageCount}쪽 · 화면 도형 ${request.snapshot.objects.length}개`:"기록 없음"}</dd>
        <dt>승인 의견</dt><dd className="max-h-24 overflow-auto whitespace-pre-wrap break-words">{request.approval?.note||"별도 의견 없음"}</dd>
      </dl>
      <section role="status" className="rounded border p-3 text-sm">
        <strong>{!known?"현재 도면 대조 근거 부족":matches?"현재 도면 기록과 일치":"현재 도면이 요청 당시와 다릅니다"}</strong>
        <p className="mt-2">{matches?"다음 화면에서 내보낼 형식과 페이지 범위를 지정하세요.":"기록은 과거 검토 근거로 첨부할 수 있습니다. 다음 화면에서 도면 대조와 페이지 범위를 확인하며, 근거 부족이나 불일치 상태에서는 납품 준비가 제한됩니다."}</p>
      </section>
      <p className="text-xs text-muted-foreground">화면 도형 기준의 검토 기록입니다. 원본 PDF·IFC 전체나 수량·금액을 승인하지 않으며, 기존 개정 승인 기록을 변경하지 않습니다.</p>
      <div className="flex flex-wrap justify-end gap-2">
        <button className="change-secondary" onClick={()=>setOpen(false)}>검토에 머무르기</button>
        <button className="change-primary" disabled={viewer||!request.approval} onClick={()=>{if(viewer||!request.approval)return;setOpen(false);onContinue(request);}}>이 기록으로 납품 구성 열기</button>
      </div>
    </DialogContent>
  </Dialog>;
}
