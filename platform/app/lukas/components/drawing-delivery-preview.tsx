import { useState } from "react";
import { Button } from "~/core/components/ui/button";
import {DrawingReviewLoop,reviewLoopLabels,type ReviewLoopState} from "./drawing-review-loop";
import type {DeliveryRecord} from "./drawing-delivery-draft";
import {compareDrawingRequestSnapshots,type ChangeRequestPreview} from "./drawing-change-request-preview";
import {DrawingRequestSnapshotPreview,type DrawingRequestSnapshot} from "./drawing-request-snapshot";
import {DrawingSnapshotComparison} from "./drawing-snapshot-comparison";
import type {
  DrawingScreenReviewState,
  DrawingScreenExportSelection,
} from "./drawing-screen-workflow";

export type DeliveryConfiguration = {recipient: string; includeEvidence: boolean; includeBoq: boolean; boqFormat: string};
export type DeliveryStage="package"|"preparing"|"failed"|"recipient";
export const initialDeliveryConfiguration: DeliveryConfiguration = {recipient:"발주 담당 · 예시",includeEvidence:true,includeBoq:false,boqFormat:"xlsx"};

export function hasDrawingReviewRecord(record?:ReviewLoopState){
  return Boolean(record&&(record.target||record.position>0||record.phase!=="draft"||record.history.length||record.message||record.issue));
}

export function DrawingDeliveryApprovalSummary({request,record}:{request?:ChangeRequestPreview;record?:ReviewLoopState}){
  const hasRecord=hasDrawingReviewRecord(record);
  return <section aria-label="납품 승인 범위 안내" className="grid gap-3 rounded-lg border bg-slate-50 p-3 text-sm">
    <h4 className="font-semibold">이 구성에 포함된 검토 근거</h4>
    <dl className="grid gap-2 sm:grid-cols-[auto_1fr]">
      <dt className="font-medium">요청 항목</dt><dd>{request?.approval?`요청 ${request.round} · ${request.items.length}개 항목 승인 확인 기록 첨부`:"첨부된 요청 승인 기록 없음"}</dd>
      <dt className="font-medium">별도 개정 검토</dt><dd>{hasRecord&&record?`R${record.revision} · ${reviewLoopLabels[record.phase]} · ${record.page}쪽 · ${record.target?.name||"문 위치 예시"}`:"별도 개정 검토 기록 없음"}</dd>
      <dt className="font-medium">도면 전체·물량·금액</dt><dd>이 화면에서 승인 여부를 확정하지 않습니다.</dd>
    </dl>
    <p className="text-xs text-muted-foreground">요청 항목의 승인 확인을 도면 전체 승인으로 확대하지 않습니다. 두 검토 흐름은 별도 기록이며 실제 승인·전송은 연결되지 않았습니다.</p>
    {!request?.approval&&<p className="text-xs">요청 근거를 첨부하려면 도면에서 변경 항목을 검토하고, 해당 요청의 승인 확인 후 납품 구성을 시작하세요.</p>}
  </section>;
}

function deliveryDrawingComparison(request?:ChangeRequestPreview,snapshot?:DrawingRequestSnapshot){
  const comparison=request?.snapshot?compareDrawingRequestSnapshots(request.snapshot,snapshot):null;
  const orderChanged=Boolean(comparison&&request?.snapshot&&snapshot&&!comparison.added.length&&!comparison.removed.length&&request.snapshot.objects.some((object,index)=>object.id!==snapshot.objects[index]?.id));
  const changed=orderChanged||Boolean(comparison&&(comparison.added.length||comparison.modified.length||comparison.removed.length||comparison.layersChanged||comparison.sourceChanged||comparison.documentChanged));
  const missingEvidence=Boolean(request&&(!request.snapshot||!snapshot||!request.snapshot.source||!snapshot.source));
  return {comparison,changed,orderChanged,missingEvidence};
}

export function DrawingDeliveryDrawingCheck({request,snapshot}:{request:ChangeRequestPreview;snapshot?:DrawingRequestSnapshot}){
  const {comparison,changed,orderChanged}=deliveryDrawingComparison(request,snapshot);
  return <section aria-label="요청과 납품 도면 기록 대조" className="grid gap-2 rounded-lg border p-3 text-sm break-words">
    <h4 className="font-semibold">도면 기록 대조</h4>
    <p>요청 당시: {request.snapshot?.documentName??"기록 없음"}</p><p>납품 구성 당시: {snapshot?.documentName??"기록 없음"}</p>
    <div className="flex flex-wrap gap-2">
      {request.snapshot&&snapshot&&<DrawingSnapshotComparison before={request.snapshot} after={snapshot}/>}
      {request.snapshot&&<DrawingRequestSnapshotPreview snapshot={request.snapshot} round={request.round}/>}
      {snapshot&&<DrawingRequestSnapshotPreview snapshot={snapshot} round={request.round} context="delivery"/>}
    </div>
    {!request.snapshot?<p role="status">요청 당시 도면 기록이 없어 대조할 수 없습니다.</p>:!snapshot?<p role="status">납품 구성 당시 도면 기록이 없어 대조할 수 없습니다.</p>:changed?<div role="status" className="grid gap-1 rounded bg-amber-50 p-2 text-amber-900"><strong>승인 요청과 납품 구성의 도면 기록이 다릅니다.</strong><p>추가 {comparison!.added.length}개 · 수정 {comparison!.modified.length}개 · 삭제 {comparison!.removed.length}개</p>{comparison!.layersChanged&&<p>레이어 구성이 변경됐습니다.</p>}{comparison!.sourceChanged&&<p>원본 식별 정보가 변경됐습니다.</p>}{comparison!.documentChanged&&<p>도면 이름 또는 페이지 수가 변경됐습니다.</p>}<p>도면에서 변경 내용을 검토한 뒤 새 요청과 납품 구성을 만들어 주세요. 기존 기록은 유지됩니다.</p></div>:<p>요청 당시 기록과 납품 구성 당시 기록이 일치합니다.</p>}
    {orderChanged&&<p>도형 표시 순서가 변경됐습니다.</p>}
    {comparison&&(!request.snapshot?.source||!snapshot?.source)&&<p>원본 식별 정보가 없어 원본 일치 여부는 미확인입니다.</p>}
    <p className="text-xs text-muted-foreground">보관된 화면 도형·레이어·원본 식별 정보의 대조입니다. 실제 납품 파일 검증이나 도면 전체 승인을 대신하지 않습니다.</p>
  </section>;
}

function requestPageCoverage(request:ChangeRequestPreview,selection:DrawingScreenExportSelection,page:number,pageCount?:number){
  const pages=[...new Set(request.items.map(item=>item.page))].sort((a,b)=>a-b);
  const known=Number.isSafeInteger(pageCount)&&pageCount!>0&&Number.isSafeInteger(page)&&page>0&&page<=pageCount!;
  const missing=pages.filter(value=>!known||value>pageCount!||(selection.pageRange==="current"&&value!==page));
  return {pages,known,missing,blocked:!known||missing.length>0,canIncludeAll:known&&pages.every(value=>value<=pageCount!),extra:known?(selection.pageRange==="all"?pageCount!:1)-(pages.length-missing.length):0};
}

export function DrawingDeliveryRequestScope({request,selection,page,pageCount}:{request:ChangeRequestPreview;selection:DrawingScreenExportSelection;page:number;pageCount?:number}){
  const scope=requestPageCoverage(request,selection,page,pageCount);
  return <section aria-label="요청과 납품 페이지 대조" className="grid gap-2 rounded-lg border p-3 text-sm">
    <h4 className="font-semibold">요청 {request.round} · 납품 범위 확인</h4>
    <p>요청 항목 페이지: {scope.pages.join(", ")}쪽</p>
    <p>납품 페이지: {selection.pageRange==="all"?`전체 ${pageCount??"미확인"}쪽`:`${page}쪽`}</p>
    {!scope.known?<p role="status">페이지 정보를 확인할 수 없습니다. 요청 페이지를 포함하는 도면으로 새 납품 구성을 시작해 주세요.</p>:scope.missing.length?<div role="status" className="rounded bg-amber-50 p-2 text-amber-900"><p>납품 범위에서 빠진 요청 페이지: {scope.missing.join(", ")}쪽</p><p>범위를 확인한 뒤 준비 화면으로 진행할 수 있습니다.</p>{!scope.canIncludeAll&&<p>요청 페이지를 포함하는 도면으로 새 납품 구성을 시작해 주세요.</p>}</div>:<p>요청 항목이 있는 모든 페이지가 포함됩니다.</p>}
    {scope.extra>0&&<p>요청 항목이 없는 납품 페이지: {scope.extra}개 · 해당 페이지의 검토·승인은 별도입니다.</p>}
    <p className="text-xs text-muted-foreground">페이지 번호의 포함 여부만 대조합니다. 파일 동일성·도면 전체 승인을 확인한 결과가 아닙니다.</p>
  </section>;
}

export function DrawingDeliveryRequestEvidence({request}:{request:ChangeRequestPreview}) {
  return <section aria-label="납품에 첨부할 요청 기록" className="rounded-lg border p-4 text-sm break-words">
    <h3 className="font-semibold">승인 확인 요청 {request.round} · 고정 기록</h3>
    <p className="mt-2 whitespace-pre-wrap">{request.message}</p>
    <details className="mt-3"><summary>요청 항목·검토 의견 {request.items.length}개</summary>
      <ul className="mt-2 grid gap-2">{request.items.map(item=><li key={item.id} className="rounded border p-3">
        <strong>{item.title} · {item.page}쪽</strong>
        <p className="mt-1 whitespace-pre-wrap">{request.decisions[item.id]?.note||"별도 검토 의견 없음"}</p>
      </li>)}</ul>
    </details>
    <p className="mt-3 whitespace-pre-wrap">승인 확인 의견: {request.approval?.note||"별도 의견 없음"}</p>
    {request.approval&&<time className="text-xs text-muted-foreground" dateTime={request.approval.at}>{new Date(request.approval.at).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}</time>}
    <p className="mt-2 text-xs text-muted-foreground">요청 당시 검토 기록의 읽기 전용 첨부입니다. 현재 도면 파일의 승인이나 과거 PDF 원본 복원을 의미하지 않습니다.</p>
  </section>;
}

export function DrawingDeliveryHistory({records}:{records:DeliveryRecord[]}) {
  return <details className="rounded-lg border p-3"><summary>이전 납품 구성 ({records.length})</summary><section aria-label="이전 납품 구성 목록" className="mt-3 grid gap-3">
    <p className="text-xs">새 구성으로 전환할 때 보관한 화면 예시입니다. 실제 납품·전송 기록이 아닙니다. 현재 초안의 변경은 이전 기록에 반영하지 않습니다.</p>
    {!records.length&&<p>보관된 이전 구성이 없습니다.</p>}
    {[...records].reverse().map((record,index)=>{const source=record.deliverySource;return <details key={record.id} className="rounded-lg border p-3">
      <summary>구성 {records.length-index} · {source?.reviewContext?`R${source.reviewContext.revision}`:"개정 미등록"} · {record.deliveryConfiguration.recipient}</summary>
      <p className="mt-2 text-xs">보관 당시 구성 · 읽기 전용 · <time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}</time></p>
      {source?<dl className="mt-2 grid grid-cols-[auto_1fr] gap-2 text-sm"><dt>도면</dt><dd>{source.documentName}</dd><dt>검토 대상</dt><dd>{source.reviewContext?`R${source.reviewContext.revision} · ${source.reviewContext.page}쪽 · ${source.reviewContext.targetName||"D01"}`:"개정 미등록"}</dd><dt>범위</dt><dd>{record.exportSelection?.pageRange==="all"?`전체 페이지 (${source.pageCount}쪽)`:`${source.page}쪽`}</dd><dt>형식</dt><dd>{record.exportSelection?.format.toUpperCase()}</dd><dt>단계</dt><dd>{{package:"구성 중",preparing:"준비 화면",failed:"실패 체험",recipient:"수신자 화면 체험"}[record.deliveryStage]}</dd><dt>포함 항목</dt><dd>{record.deliveryConfiguration.includeEvidence?"근거 목록 포함":"근거 목록 미포함"} · {record.exportSelection?.includeComments?"댓글 포함":"댓글 미포함"} · {record.deliveryConfiguration.includeBoq?`${record.deliveryConfiguration.boqFormat.toUpperCase()} 미확정 내역 예시`:"내역 미포함"}</dd></dl>:<p>기록의 도면 정보를 확인할 수 없습니다.</p>}
      {source&&<DrawingDeliveryApprovalSummary request={source.approvedRequest} record={source.reviewLoop}/>}
      {source?.reviewLoop&&hasDrawingReviewRecord(source.reviewLoop)&&<details className="mt-2"><summary>보관된 검토 기록</summary><DrawingReviewLoop state={source.reviewLoop} dispatch={()=>{}} ready viewer onLocate={()=>{}}/></details>}
      {source?.approvedRequest&&<DrawingDeliveryRequestEvidence request={source.approvedRequest}/>}
      {source?.approvedRequest&&record.exportSelection&&<DrawingDeliveryRequestScope request={source.approvedRequest} selection={record.exportSelection} page={source.page} pageCount={source.pageCount}/>}
      {source?.approvedRequest&&<DrawingDeliveryDrawingCheck request={source.approvedRequest} snapshot={source.drawingSnapshot}/>}
    </details>;})}
  </section></details>;
}

export function DrawingDeliveryPreview({
  documentName,
  page,
  ready,
  viewer,
  reviewState,
  reviewContext,
  selection,
  onReturn,
  stage = "package",
  configuration,
  onConfigurationChange,
  onStageChange,
  reviewRecord,
  pageCount,
  approvedRequest,
  onSelectionChange,
  drawingSnapshot,
}: {
  documentName: string;
  page: number;
  ready: boolean;
  viewer: boolean;
  reviewState: DrawingScreenReviewState;
  reviewContext?: { revision: number; page: number;targetName?:string };
  selection: DrawingScreenExportSelection;
  onReturn: () => void;
  stage?: DeliveryStage;
  configuration?: DeliveryConfiguration;
  onConfigurationChange?: (value: DeliveryConfiguration) => void;
  onStageChange?: (value:DeliveryStage)=>void;
  reviewRecord?:ReviewLoopState;
  pageCount?:number;
  approvedRequest?:ChangeRequestPreview;
  onSelectionChange?:(value:DrawingScreenExportSelection)=>void;
  drawingSnapshot?:DrawingRequestSnapshot;
}) {
  const [localStage, setLocalStage] = useState(stage);
  const current=onStageChange?stage:localStage;
  const setCurrent=(next:DeliveryStage)=>{setLocalStage(next);onStageChange?.(next);};
  const [localConfiguration, setLocalConfiguration] = useState(initialDeliveryConfiguration);
  const config = configuration ?? localConfiguration;
  const {recipient, includeEvidence, includeBoq, boqFormat} = config;
  const changeConfiguration = (patch: Partial<DeliveryConfiguration>) => {
    const next = {...config, ...patch};
    setLocalConfiguration(next);
    onConfigurationChange?.(next);
  };
  const [checked, setChecked] = useState(false);
  const coverage=approvedRequest?requestPageCoverage(approvedRequest,selection,page,pageCount):null;
  const {changed:drawingChanged,missingEvidence}=deliveryDrawingComparison(approvedRequest,drawingSnapshot);
  const preparationBlocked=Boolean(coverage?.blocked||drawingChanged||missingEvidence);
  if (!ready)
    return (
      <p className="rounded-xl border p-4">
        도면을 먼저 열어 주세요. 납품 구성은 아직 없습니다.
      </p>
    );
  const status = {
    draft: "검토 전",
    requested: "검토 요청 중",
    reviewed: "검토 완료 · 최종 승인 대기",
    changes: "변경 요청",
    approved: "승인 화면 예시 · 실제 승인 아님",
  }[reviewState];
  return (
    <section
      className="grid gap-4 rounded-xl border p-4"
      aria-label="납품·수신 화면 예시"
    >
      <h3 className="font-semibold">
        {{package: "납품 패키지 구성", preparing: "납품 준비 중 · 화면 예시", failed: "납품 준비 실패 · 화면 예시", recipient: "수신자 화면 예시"}[current]}
      </h3>
      <p className="text-xs text-[#2925d9]">화면 예시 · 실제 파일·전송 없음</p>
      <DrawingDeliveryApprovalSummary request={approvedRequest} record={reviewRecord}/>
      {missingEvidence&&<section role="status" aria-label="납품 준비 보류 안내" className="grid gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><strong>준비 보류 · 도면 대조 근거 부족</strong><p>첨부 요청과 납품 구성의 도면 기록·원본 식별 정보가 모두 있어야 준비 화면으로 진행할 수 있습니다.</p><p>첨부된 기존 요청·도면 기록은 읽기 전용 근거로 남겨 두고, 도면으로 돌아가 원본을 확인한 뒤 새 검토 요청과 납품 구성을 만들어 주세요. 기존 기록을 현재 도면으로 채워 넣지 않습니다.</p></section>}
      <dl className="grid grid-cols-[auto_1fr] gap-2 text-sm">
        <dt>도면</dt>
        <dd className="min-w-0 break-words">{documentName}</dd>
        <dt>범위</dt>
        <dd>{selection.pageRange === "all" ? `전체 페이지${pageCount?` (${pageCount}쪽)`:""}` : `${page}쪽`}</dd>
        <dt>개정 검토 상태</dt>
        <dd>{!hasDrawingReviewRecord(reviewRecord)&&!reviewContext&&reviewState==="draft"?"기록 없음":status}</dd>
        <dt>검토 대상</dt>
        <dd>{reviewContext ? `R${reviewContext.revision} · ${reviewContext.page}쪽 · ${reviewContext.targetName||"D01"}` : "개정 미등록"}</dd>
        <dt>파일 형식</dt>
        <dd>{selection.format.toUpperCase()}</dd>
      </dl>
      {reviewContext && <p className="text-xs text-muted-foreground">{reviewContext.targetName||"D01"} 검토 상태입니다. 내보내기 범위 전체의 승인을 의미하지 않습니다. 물량·금액 승인은 별도입니다.</p>}
      {reviewRecord&&hasDrawingReviewRecord(reviewRecord)&&<details><summary>구성 당시 검토 기록</summary><DrawingReviewLoop state={reviewRecord} dispatch={()=>{}} ready viewer onLocate={()=>{}}/></details>}
      {approvedRequest&&<DrawingDeliveryRequestScope request={approvedRequest} selection={selection} page={page} pageCount={pageCount}/>}
      {approvedRequest&&<DrawingDeliveryDrawingCheck request={approvedRequest} snapshot={drawingSnapshot}/>}
      {coverage?.missing.length&&coverage.canIncludeAll&&current==="package"&&onSelectionChange?<Button variant="outline" disabled={viewer} onClick={()=>{if(!viewer)onSelectionChange({...selection,pageRange:"all"});}}>전체 페이지로 범위 변경</Button>:null}
      <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
        호환성 미검증 · DWG 엔진·폰트·외부 참조 검사 미연결. 이 화면은 납품 가능
        판정이 아닙니다.
      </p>
      {current === "package" ? (
        <fieldset disabled={viewer} className="grid gap-3">
          <label className="grid gap-2 text-sm">
            수신 대상 예시
            <select
              className="min-h-10 rounded-lg border bg-background px-3"
              value={recipient}
              onChange={(e) => changeConfiguration({recipient:e.target.value})}
            >
              <option>발주 담당 · 예시</option>
              <option>현장 담당 · 예시</option>
              <option>협력사 담당 · 예시</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeEvidence}
              onChange={(e) => changeConfiguration({includeEvidence:e.target.checked})}
            />
            근거 목록 포함 · 예시
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeBoq}
              onChange={(event) => changeConfiguration({includeBoq:event.target.checked})}
            />
            미확정 내역 예시 포함
          </label>
          <label className="grid gap-2 text-sm">내역 인계 형식
            <select disabled={!includeBoq} value={boqFormat} onChange={event=>changeConfiguration({boqFormat:event.target.value})} className="min-h-10 rounded-lg border bg-background px-3 disabled:opacity-50">
              <option value="xlsx">Excel (.xlsx)</option>
              <option value="csv">CSV (.csv)</option>
            </select>
          </label>
          <p className="text-xs text-muted-foreground">예시 내역을 포함하면 형식을 선택할 수 있습니다. Q01 수량·B01 내역·A01 근거 식별자의 인계 구성을 확인하며 실제 파일은 생성하지 않습니다.</p>
          <Button disabled type="button">확정 자료 내보내기 · 승인 근거 필요</Button>
        </fieldset>
      ) : current === "recipient" ? (
        <p className="text-sm">
          {recipient}의 보기 전용 화면입니다. 전달받은 실제 파일은 없습니다.
        </p>
      ) : <div role={current === "failed" ? "alert" : "status"} className="rounded-lg border p-3 text-sm">
        {current === "failed" ? "참조 파일 또는 생성 엔진 연결을 확인하지 못한 상황의 예시입니다. 아래 구성은 유지되며 실제 파일을 생성하거나 전송하지 않았습니다." : "파일 생성 진행률이 아닌 화면 체험입니다. 아래 구성을 확인하고 실패 또는 수신자 화면으로 이어가세요."}
      </div>}
      <ul className="grid gap-2 rounded-lg bg-muted/40 p-3 text-sm">
        <li>도면 파일 · 생성 안 됨</li>
        {selection.includeComments && <li>검토 댓글 목록 · 예시</li>}
        {includeEvidence && <li>원본·개정 근거 목록 · {reviewContext ? `R${reviewContext.revision} · ${reviewContext.page}쪽 · ${reviewContext.targetName||"D01"} · 예시` : "개정 미등록"}</li>}
        <li>수량·금액 확정 자료 · 미포함</li>
        {includeBoq && (
          <li>B01 내역 구성 · {boqFormat === "xlsx" ? "Excel (.xlsx)" : "CSV (.csv)"} · Q01 수량/A01 근거 포함 예시 · 미확정 예시 · 실제 견적·납품 파일 아님</li>
        )}
      </ul>
      {current === "recipient" && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            구성 확인 · 화면 체험
          </label>
          <p role="status" className="text-xs text-muted-foreground">
            {checked
              ? "구성 확인 표시 · 실제 수신 확인 기록 없음"
              : "수신 확인 전 · 예시"}
          </p>
        </>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {current === "preparing" ? <>
          <Button variant="outline" onClick={()=>setCurrent("failed")}>실패 상태 체험</Button>
          <Button variant="outline" onClick={()=>setCurrent("package")}>준비 취소</Button>
        </> : null}
        <Button
          type="button"
          variant="outline"
          disabled={preparationBlocked&&current!=="recipient"}
          onClick={() => {
            if(preparationBlocked&&current!=="recipient")return;
            setCurrent(current === "package" || current === "failed" ? "preparing" : current === "preparing" ? "recipient" : "package");
            setChecked(false);
          }}
        >
          {{package:"납품 준비 화면 보기",preparing:"수신자 화면 보기",failed:"같은 구성으로 재시도",recipient:"납품 구성으로 돌아가기"}[current]}
        </Button>
        {current === "failed" && <Button variant="outline" onClick={()=>setCurrent("package")}>납품 구성 수정</Button>}
        <Button type="button" variant="outline" onClick={onReturn}>
          도면으로 돌아가기
        </Button>
      </div>
    </section>
  );
}
