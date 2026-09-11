import { useEffect, useRef, useState } from "react";
import {fieldNoteMatches} from '../lib/workflow-document-field';
import {FieldPhotoPreview} from './workflow-field-photos';
import type { WorkflowBlankDocument } from "../lib/workflow-blank-document";
import {
  documentReviewPhase,
  reduceDocumentReview,
  type DocumentReviewRole,
  type DocumentReviewAction,
} from "../lib/workflow-document-review";
const labels = {
  draft: "작성 중",
  requested: "검토 대기",
  changes: "수정 요청",
  reviewed: "승인 대기",
  approved: "승인됨",
};
export function WorkflowDocumentReview({
  document,
  selectedId,
  role,
  onRole,
  onChange,
  onLocate,
  sourceReady,
  roleLocked = false,
  fieldReviewId,
}: {
  document: WorkflowBlankDocument;
  selectedId: string | null;
  role: DocumentReviewRole;
  onRole: (role: DocumentReviewRole) => void;
  onChange: (document: WorkflowBlankDocument) => void;
  onLocate: (id: string, page: number) => void;
  sourceReady: boolean;
  roleLocked?: boolean;
  fieldReviewId?:string;
}) {
  const fieldNote=document.fieldNotes?.find(note=>String(note.id)===fieldReviewId);
  const fieldValid=Boolean(fieldNote&&fieldNoteMatches(document,fieldNote)&&fieldNote.objectId===selectedId);
  const [message, setMessage] = useState(()=>fieldValid&&fieldNote?`현장 기록 #${fieldNote.id} · ${fieldNote.title}\n위치: ${fieldNote.location}\n${fieldNote.note}`.slice(0,500):'');
  const draftHeading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{
    if(!fieldReviewId)return;
    const frame=requestAnimationFrame(()=>draftHeading.current?.focus());
    return ()=>cancelAnimationFrame(frame);
  },[fieldReviewId]);
  const phase = documentReviewPhase(document),
    round = document.reviewRounds?.at(-1);
  const act = (action: DocumentReviewAction) => {
    const next = reduceDocumentReview(document, role, action);
    if (next !== document) {
      onChange(next);
      setMessage("");
    }
  };
  return (
    <section aria-label="이 도면 검토" className="flow-local-review">
      <h3>이 도면 검토 · R{document.revision ?? 1}</h3>
      <span className="flow-badge">{labels[phase]}</span>
      {fieldReviewId&&<section aria-label="현장 기록에서 가져온 검토 초안">
        <h4 ref={draftHeading} tabIndex={-1}>현장 기록에서 가져온 검토 초안</h4>
        {fieldValid&&fieldNote?<><p>{fieldNote.source.name} · {fieldNote.page}쪽 · R{fieldNote.revision} · {fieldNote.objectLabel}</p><p>{fieldNote.location} · {fieldNote.title}</p><details><summary>현장 기록 전체 내용</summary><p>{fieldNote.note}</p></details><p>의견은 최대 500자로 가져옵니다. 기록을 여는 것만으로 요청되지 않습니다. 현재 처리 상태는 위 검토 상태를 확인하세요.</p></>:<p role="alert">현장 기록의 원본·개정·대상 객체를 확인할 수 없습니다. 현장 기록으로 돌아가 대상을 다시 확인하세요.</p>}
      </section>}
      <p>
        로컬 역할 체험입니다. 실제 검토자에게 전송하거나 서버 승인을 기록하지
        않습니다. 물량·금액 승인이 아닌 도면 구상 검토입니다.
      </p>
      <label className="flow-input">
        체험 역할
        <select
          aria-label="도면 검토 체험 역할"
          disabled={roleLocked}
          value={role}
          onChange={(event) => onRole(event.target.value as DocumentReviewRole)}
        >
          <option value="author">작성자</option>
          <option value="reviewer">검토자</option>
          <option value="approver">승인자</option>
          <option value="viewer">열람자</option>
        </select>
      </label>
      {round && (
        <div>
          <strong>
            요청 대상:{" "}
            {round.objects.find((shape) => shape.id === round.targetId)?.label}
          </strong>
          <p>
            {round.source.name} ·{" "}
            {round.objects.find((shape) => shape.id === round.targetId)?.page ??
              1}
            쪽 · R{round.revision}
          </p>
          <p>요청: {round.message}</p>
          {round.fieldEvidence&&<details><summary>요청 당시 현장·사진 근거</summary><p>{round.fieldEvidence.title} · {round.fieldEvidence.location}</p><p>{round.fieldEvidence.note}</p><p>현장 기록 #{round.fieldEvidence.id} · {round.fieldEvidence.source.name} · {round.fieldEvidence.page}쪽 · R{round.fieldEvidence.revision}</p>{round.fieldEvidence.photos?.map(photo=><FieldPhotoPreview key={photo.sha256} photo={photo}/>)}</details>}
          {round.reviewNote && <p>검토 의견: {round.reviewNote}</p>}
          {round.approvalNote && <p>승인 의견: {round.approvalNote}</p>}
          <button
            disabled={!sourceReady}
            onClick={() =>
              onLocate(
                round.targetId,
                round.objects.find((shape) => shape.id === round.targetId)
                  ?.page ?? 1,
              )
            }
          >
            검토 대상 위치로
          </button>
        </div>
      )}
      {phase !== "approved" && role !== "viewer" && (
        <label className="flow-input">
          요청·결정 사유
          <textarea
            aria-label="도면 검토 의견"
            maxLength={500}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
      )}
      {role === "author" && ["draft", "changes"].includes(phase) && (
        <>
          <button
            disabled={
              !sourceReady ||
              Boolean(fieldReviewId&&!fieldValid) ||
              !selectedId ||
              !message.trim() ||
              (document.reviewRounds?.length ?? 0) >= 30
            }
            onClick={() =>
              act({ type: "request", targetId: selectedId!, message,...(fieldReviewId?{fieldNoteId:Number(fieldReviewId)}:{}) })
            }
          >
            {phase === "changes" ? "수정본 재제출" : "선택 객체 검토 요청"}
          </button>
          <p>원본 PDF 연결 후 객체를 선택하고 요청 내용을 입력하세요.</p>
        </>
      )}
      {role === "reviewer" && phase === "requested" && (
        <div className="flow-actions">
          <button
            disabled={!sourceReady || !message.trim()}
            onClick={() => act({ type: "changes", message })}
          >
            수정 요청하기
          </button>
          <button
            disabled={!sourceReady || !message.trim()}
            onClick={() => act({ type: "review", message })}
          >
            검토 완료하기
          </button>
        </div>
      )}
      {role === "approver" && phase === "reviewed" && (
        <button
          disabled={!sourceReady || !message.trim()}
          onClick={() => act({ type: "approve", message })}
        >
          이 개정 승인하기
        </button>
      )}
      {role === "author" && phase === "approved" && (
        <button onClick={() => act({ type: "new-revision" })}>
          새 개정에서 수정
        </button>
      )}
      {phase === "requested" && role !== "reviewer" && (
        <p>다음: 검토자가 요청 대상을 확인합니다.</p>
      )}
      {phase === "reviewed" && role !== "approver" && (
        <p>다음: 승인자가 검토 결과를 확인합니다.</p>
      )}
      {!!document.reviewRounds?.length && (
        <details>
          <summary>개정별 검토 기록 ({document.reviewRounds.length})</summary>
          {document.reviewRounds.map((item) => (
            <article key={item.revision}>
              <h4>
                R{item.revision} · {labels[item.phase]}
              </h4>
              <p>
                {item.source.name} ·{" "}
                {
                  item.objects.find((shape) => shape.id === item.targetId)
                    ?.label
                }
              </p>
              <p>{item.message}</p>
              <p>{item.reviewNote}</p>
              <p>{item.approvalNote}</p>
            </article>
          ))}
        </details>
      )}
    </section>
  );
}
