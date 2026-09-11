import { useState } from "react";
import {WorkflowMeasurementEvidence} from './workflow-measurement-evidence';
import {WorkflowQuantityComparison,type QuantityComparisonOpen} from './workflow-quantity-comparison';
import type { WorkflowBlankDocument } from "../lib/workflow-blank-document";
import type { DocumentReviewRole } from "../lib/workflow-document-review";
import {
  quantityReviewInput,
  quantityReviewMatches,
  reduceQuantityReview,
  type QuantityReviewRound,
} from "../lib/workflow-quantity-review";
const labels = {
  requested: "수량 검산 대기",
  changes: "수량 보완 요청",
  reviewed: "금액 승인 대기",
  approved: "금액 승인 체험 완료",
};
const total = (items: QuantityReviewRound["items"]) =>
  items
    .reduce(
      (sum, item) =>
        sum +
        Math.round(
          (item.quantity.raw + item.quantity.correction) * item.quantity.rate,
        ),
      0,
    )
    .toLocaleString("ko-KR");
export function WorkflowQuantityReviews({
  documents,
  onChange,
  initialDocumentId,
  onOpen,
  comparisonSequence,
  comparisonTarget,
  onComparisonSelect,
}: {
  documents: WorkflowBlankDocument[];
  onChange: (doc: WorkflowBlankDocument) => void;
  initialDocumentId?: string;
  onOpen?:QuantityComparisonOpen;
  comparisonSequence?:string;
  comparisonTarget?:string;
  onComparisonSelect?:(documentId:string,sequence:number,target?:string)=>void;
}) {
  const [id, setId] = useState(initialDocumentId ?? "");
  const doc = id ? documents.find((doc) => doc.id === id) : documents[0];
  return (
    <section aria-label="수량 검산·금액 승인" className="flow-card">
      <h2>수량 검산·금액 승인</h2>
      <p>
        도면 검토와 별도의 로컬 역할 체험입니다. 실제 계약·납품 승인이나 확정
        계산이 아니며 서버로 전송하지 않습니다.
      </p>
      {!doc ? (
        <p>{id?'선택한 도면을 찾을 수 없습니다. 다른 도면으로 자동 대체하지 않습니다.':'도면 객체에 수량 근거를 연결하면 검산을 시작할 수 있습니다.'}</p>
      ) : (
        <>
          <label className="flow-input">
            검산할 도면
            <select
              aria-label="검산할 도면"
              value={doc.id}
              onChange={(event) => setId(event.target.value)}
            >
              {documents.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.title}
                </option>
              ))}
            </select>
          </label>
          <QuantityReviewDocument
            key={doc.id}
            document={doc}
            onChange={onChange}
          />
          <WorkflowQuantityComparison key={`compare:${doc.id}`} document={doc} onOpen={onOpen} comparisonSequence={doc.id===initialDocumentId?comparisonSequence:undefined} comparisonTarget={doc.id===initialDocumentId?comparisonTarget:undefined} onSelect={onComparisonSelect}/>
        </>
      )}
    </section>
  );
}
function QuantityReviewDocument({
  document: doc,
  onChange,
}: {
  document: WorkflowBlankDocument;
  onChange: (doc: WorkflowBlankDocument) => void;
}) {
  const [role, setRole] = useState<DocumentReviewRole>("author"),
    [note, setNote] = useState("");
  const rounds = doc.quantityReviews ?? [],
    last = rounds.at(-1),
    current = quantityReviewInput(doc),
    matched = last ? quantityReviewMatches(doc, last) : false;
  const canRequest = Boolean(
    doc.source &&
      current.items.length &&
      !current.stale &&
      rounds.length < 20 &&
      (!last || last.phase === "changes" || !matched),
  );
  const act = (type: "request" | "changes" | "review" | "approve") => {
    const next = reduceQuantityReview(doc, role, { type, message: note });
    if (next !== doc) {
      onChange(next);
      setNote("");
    }
  };
  const renderRound = (round: QuantityReviewRound) => (
    <div className="flow-card" key={round.sequence}>
      <h3>
        검산 {round.sequence}차 · {labels[round.phase]}
      </h3>
      <p>
        {round.source.name} · 도면 R{round.revision} · 요청 합계{" "}
        {total(round.items)}원
      </p>
      <p>
        포함 {round.items.length}건 · 수량 미연결 {round.excludedCount}건 제외.
        부가세·제경비 미포함.
      </p>
      <p>요청: {round.requestNote}</p>
      {round.reviewNote && <p>검산 의견: {round.reviewNote}</p>}
      {round.approvalNote && <p>금액 확인 의견: {round.approvalNote}</p>}
      <details>
        <summary>요청 당시 수량·단가 근거</summary>
        {round.items.map((item) => (
          <div key={item.id}>
            <strong>
              {item.label || "이름 없는 객체"} · {item.page}쪽
            </strong>
            <p>
              원수량 {item.quantity.raw} + 보정 {item.quantity.correction} ={" "}
              {item.quantity.raw + item.quantity.correction}{" "}
              {item.quantity.unit} · 단가{" "}
              {item.quantity.rate.toLocaleString("ko-KR")}원
            </p>
            <p>{item.quantity.reason}</p>
            <WorkflowMeasurementEvidence evidence={item.quantity.measurementSource}/>
            <p>
              {item.quantity.rateSource
                ? `${item.quantity.rateSource.code} · v${item.quantity.rateSource.version} · ${item.quantity.rateSource.source}`
                : item.quantity.rateReference
                  ? `${item.quantity.rateReference.catalogVersion} · ${item.quantity.rateReference.code}`
                  : "직접 입력 단가"}
            </p>
          </div>
        ))}
      </details>
    </div>
  );
  return (
    <>
      <p>
        현재 등록 수량 {current.items.length}건 · 미확정 합계{" "}
        {total(current.items)}원 · 미연결 {current.excludedCount}건 제외
      </p>
      <p>
        숨긴 레이어를 포함한 이 도면의 등록 수량만 검산합니다. 수량이 없는
        주석·객체나 프로젝트 전체의 완전성을 승인하지 않습니다.
      </p>
      {current.stale && (
        <p role="alert">
          도면 근거가 바뀌었습니다. 작업실에서 수량 근거를 재확인한 뒤
          요청하세요.
        </p>
      )}
      {last && !matched && (
        <p role="alert">
          현재 값이 요청 당시와 다릅니다 · 새 검산 필요. 이전 승인에 현재 값은
          포함되지 않습니다.
        </p>
      )}
      {last && renderRound(last)}
      <label className="flow-input">
        수량 검토 체험 역할
        <select
          aria-label="수량 검토 체험 역할"
          value={role}
          onChange={(event) => {
            setRole(event.target.value as DocumentReviewRole);
            setNote("");
          }}
        >
          <option value="author">작성자</option>
          <option value="reviewer">검산자</option>
          <option value="approver">금액 승인자</option>
          <option value="viewer">열람자</option>
        </select>
      </label>
      {role !== "viewer" && (
        <label className="flow-input">
          검산·승인 의견
          <textarea
            aria-label="검산·승인 의견"
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      )}
      <div className="flow-actions">
        {role === "author" && (
          <button
            disabled={!canRequest || !note.trim()}
            onClick={() => act("request")}
          >
            수량 검산 요청
          </button>
        )}
        {role === "reviewer" && last?.phase === "requested" && (
          <>
            <button disabled={!note.trim()} onClick={() => act("changes")}>
              수량 보완 요청
            </button>
            <button
              disabled={!matched || !note.trim()}
              onClick={() => act("review")}
            >
              수량 검산 완료
            </button>
          </>
        )}
        {role === "approver" && last?.phase === "reviewed" && (
          <button
            disabled={!matched || !note.trim()}
            onClick={() => act("approve")}
          >
            금액 승인 체험
          </button>
        )}
      </div>
      {!doc.source && <p>먼저 PDF 원본과 수량 근거를 연결하세요.</p>}
      {rounds.length >= 20 && (
        <p>
          검산 이력 한도 20회에 도달했습니다. 이전 기록은 삭제하지 않습니다.
        </p>
      )}
      {rounds.length > 1 && (
        <details>
          <summary>이전 검산 기록 ({rounds.length - 1})</summary>
          {rounds.slice(0, -1).reverse().map(renderRound)}
        </details>
      )}
    </>
  );
}
