import type {ChangeRequestPreview} from "../components/drawing-change-request-preview";
import type {DrawingRequestSnapshot} from "../components/drawing-request-snapshot";

/** Preflight only: never creates an approval or promotes historical item decisions. */
export function documentApprovalPreflight(request:ChangeRequestPreview,currentSnapshot?:DrawingRequestSnapshot,currentRevision?:number):{ready:boolean;reasons:string[];outsideCount:number}{
  const reasons:string[]=[];
  if(!request.approval)reasons.push("요청 항목의 승인 확인을 먼저 완료하세요.");
  if(!request.snapshot?.source||!currentSnapshot?.source)reasons.push("전체 도면과 원본 식별 근거가 필요합니다.");
  if(request.drawingRevision===undefined||currentRevision===undefined)reasons.push("요청과 현재 도면의 개정 정보가 필요합니다.");
  else if(request.drawingRevision!==currentRevision)reasons.push("현재 개정이 요청 당시와 다릅니다. 현재 개정으로 다시 검토하세요.");
  if(request.snapshot&&currentSnapshot&&JSON.stringify(request.snapshot)!==JSON.stringify(currentSnapshot))reasons.push("요청 이후 도면이 바뀌었습니다. 현재 도면으로 다시 검토하세요.");
  const ids=new Set(request.items.map(item=>item.id));
  const objectIds=new Set(request.snapshot?.objects.map(object=>object.id));
  if(!request.items.length||request.items.some(item=>item.sample||!objectIds.has(item.id)))reasons.push("예시 또는 당시 도면에 없는 항목은 전체 도면 승인 근거로 사용할 수 없습니다.");
  const outsideCount=request.snapshot?.objects.filter(object=>!ids.has(object.id)).length??0;
  if(outsideCount)reasons.push(`요청 밖 화면 도형 ${outsideCount}개가 있습니다. 전체 범위로 검토 요청을 구성하세요.`);
  return {ready:reasons.length===0,reasons,outsideCount};
}
