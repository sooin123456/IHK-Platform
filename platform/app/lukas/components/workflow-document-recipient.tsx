import { useState } from "react";
import { WorkflowDeliveryQuantity } from './workflow-delivery-quantity';
import { deliveryQuantityReview } from '../lib/workflow-document-delivery';
import type { WorkflowBlankDocument } from "../lib/workflow-blank-document";
import { reduceDocumentDelivery } from "../lib/workflow-document-delivery";
import { WorkflowRecipientDrawing } from "./workflow-recipient-drawing";
import {FieldPhotoPreview} from './workflow-field-photos';

export function WorkflowDocumentRecipient({
  document,
  sequence,
  loading,
  onChange,
  onBack,
}: {
  document?: WorkflowBlankDocument;
  sequence: string | null;
  loading: boolean;
  onChange: (document: WorkflowBlankDocument) => void;
  onBack: () => void;
}) {
  const [message, setMessage] = useState("");
  const [showDrawing, setShowDrawing] = useState(false);
  const saved = document?.delivery;
  const round = document?.reviewRounds?.find(
    (item) => item.revision === saved?.revision && item.phase === "approved",
  );
  const problem = loading
    ? "납품 자료를 확인하고 있습니다"
    : !saved || !round
      ? "이 탭에서 납품 자료를 찾을 수 없습니다"
      : sequence !== String(saved.sequence ?? 0)
        ? "이 납품 구성이 교체되었습니다"
        : saved.linkStatus === "expired"
          ? "수신 화면이 만료되었습니다"
          : saved.quantityReviewSequence !== undefined && !deliveryQuantityReview(document!, saved.revision, saved.quantityReviewSequence)
            ? '납품 검산 근거가 일치하지 않습니다'
            : null;
  return (
    <div className="flow-app flow-recipient">
      <main className="flow-main" aria-label="수신자 납품 확인">
        <header className="flow-top">
          <strong>1HK · 납품 확인</strong>
          <span className="flow-badge">수신자 화면 체험</span>
        </header>
        <section className="flow-card">
          <p>
            같은 탭의 로컬 자료를 사용하는 미리보기입니다. 실제 공유 링크·접근
            권한·메일 전송·수신 증명이 아닙니다. 다른 브라우저나 새 탭에는
            자료가 없을 수 있습니다.
          </p>
          {problem ? (
            <>
              <h1>{problem}</h1>
              {!loading && (
                <p>
                  보내는 사람이 유효한 납품 구성을 다시 준비해야 합니다. 현재
                  작업이나 다른 개정으로 자동 대체하지 않습니다.
                </p>
              )}
            </>
          ) : (
            <>
              <h1>
                {document!.title} · 승인본 R{round!.revision}
              </h1>
              <p>
                수신 대상: {saved!.recipient} · 구성 #{saved!.sequence ?? 0}
              </p>
              {saved!.reference&&<p>문서번호 {saved!.reference} · 발행일 {saved!.issuedOn}</p>}
              <h2>납품 구성 확인</h2>
              <p>
                원본 참조: {round!.source.name} · {round!.source.pages}페이지
              </p>
              <p>
                원본 PDF·DWG·내역 파일은 생성·전송되지 않았습니다. 아래 목록은
                승인 시점의 객체와 검토 기록입니다.
              </p>
              <ul>
                {round!.objects.map((object) => (
                  <li key={object.id}>
                    {object.page ?? 1}쪽 · {object.label || "이름 없는 객체"}
                  </li>
                ))}
              </ul>
              <button
                aria-expanded={showDrawing}
                onClick={() => setShowDrawing((value) => !value)}
              >
                {showDrawing ? "승인 도면 접기" : "승인 도면 보기"}
              </button>
              {showDrawing && (
                <WorkflowRecipientDrawing
                  key={round!.revision}
                  round={round!}
                />
              )}
              <p>검토 요청: {round!.message}</p>
              <p>검토 의견: {round!.reviewNote || "기록 없음"}</p>
              <p>승인 의견: {round!.approvalNote || "기록 없음"}</p>
              {round!.fieldEvidence&&<section className="flow-card" aria-label="승인 당시 현장·사진 근거">
                <h2>승인 당시 현장·사진 근거</h2>
                <p>선택한 승인본에 고정된 현장 관찰 기록입니다. 현장 검측 적합성 승인이나 사진 파일 전송을 의미하지 않습니다.</p>
                <h3>{round!.fieldEvidence.title}</h3><p>{round!.fieldEvidence.location} · {round!.fieldEvidence.objectLabel}</p><p>{round!.fieldEvidence.note}</p>
                <p>현장 기록 #{round!.fieldEvidence.id} · {round!.fieldEvidence.source.name} · {round!.fieldEvidence.page}쪽 · R{round!.fieldEvidence.revision}</p>
                {round!.fieldEvidence.photos?.length?<><p>사진 {round!.fieldEvidence.photos.length}장 · 같은 원본을 연결하면 확인할 수 있습니다.</p>{round!.fieldEvidence.photos.map(photo=><FieldPhotoPreview key={photo.sha256} photo={photo}/>)}</>:<p>첨부된 사진이 없습니다.</p>}
              </section>}
              <WorkflowDeliveryQuantity document={document!} delivery={saved!}/>
              {saved!.status === "prepared" ? (
                <>
                  <label className="flow-input">
                    수신자 확인 의견
                    <textarea
                      aria-label="수신자 확인 의견"
                      value={message}
                      maxLength={500}
                      onChange={(event) => setMessage(event.target.value)}
                      placeholder="확인 결과 또는 보완이 필요한 내용을 남겨 주세요"
                    />
                  </label>
                  <div className="flow-actions">
                    <button
                      disabled={!message.trim()}
                      onClick={() =>
                        onChange(
                          reduceDocumentDelivery(document!, {
                            type: "receive",
                            message,
                          }),
                        )
                      }
                    >
                      수신 확인 기록 (체험)
                    </button>
                    <button
                      disabled={!message.trim()}
                      onClick={() =>
                        onChange(
                          reduceDocumentDelivery(document!, {
                            type: "correction",
                            message,
                          }),
                        )
                      }
                    >
                      보완 요청 기록 (체험)
                    </button>
                  </div>
                </>
              ) : (
                <section role="status">
                  <h2>
                    {saved!.status === "received"
                      ? "수신 확인 기록됨 (체험)"
                      : "보완 요청 기록됨 (체험)"}
                  </h2>
                  <p>{saved!.feedback}</p>
                  <p>도면 승인 상태는 변경하지 않았습니다.</p>
                </section>
              )}
            </>
          )}
          <button onClick={onBack}>내부 납품 화면으로 (체험)</button>
        </section>
      </main>
    </div>
  );
}
