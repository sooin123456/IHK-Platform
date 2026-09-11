import { useState } from "react";
import type { WorkflowBlankDocument } from "../lib/workflow-blank-document";
import type { DocumentReviewRole } from "../lib/workflow-document-review";
const phases = {
  requested: "검토 대기",
  changes: "수정 요청",
  reviewed: "승인 대기",
  approved: "승인됨",
};
const roles = {
  requested: "검토자",
  changes: "작성자",
  reviewed: "승인자",
  approved: "열람자",
};
const nextRoles: Record<keyof typeof phases, DocumentReviewRole> = {
  requested: "reviewer",
  changes: "author",
  reviewed: "approver",
  approved: "viewer",
};
export function WorkflowDocumentInbox({
  documents,
  mode,
  onOpen,
}: {
  documents: WorkflowBlankDocument[];
  mode: "tasks" | "reviews";
  onOpen: (
    id: string,
    targetId: string,
    page: number,
    role: DocumentReviewRole,
    snapshot?: number,
  ) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const entries = documents
    .flatMap((document) => {
      const round = document.reviewRounds?.at(-1);
      return round ? [{ document, round }] : [];
    })
    .filter(({ round }) => mode === "reviews" || round.phase !== "approved");
  const visible = entries.filter(
    ({ document, round }) =>
      (filter === "all" || round.phase === filter) &&
      `${document.title} ${round.source.name} ${round.message}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <section className="flow-card" aria-label="내 도면 검토 목록">
      <h2>
        {mode === "tasks" ? "내 PDF 작업 · 처리 대기" : "내 PDF 작업 · 검토함"}
      </h2>
      <p>
        직접 만든 로컬 도면의 최근 요청입니다. 역할은 체험용이며 실제
        배정·알림은 전송되지 않습니다.
      </p>
      <div className="flow-grid-two">
        <label className="flow-input">
          검색
          <input
            aria-label="내 도면 검토 검색"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="도면·파일·요청 내용"
          />
        </label>
        <label className="flow-input">
          처리 상태
          <select
            aria-label="내 도면 검토 상태"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">전체</option>
            {Object.entries(phases)
              .filter(([phase]) => mode === "reviews" || phase !== "approved")
              .map(([phase, label]) => (
                <option key={phase} value={phase}>
                  {label}
                </option>
              ))}
          </select>
        </label>
      </div>
      {!entries.length ? (
        <p>
          {mode === "tasks"
            ? "처리할 로컬 검토 작업이 없습니다."
            : "아직 로컬 도면 검토 요청이 없습니다."}
        </p>
      ) : !visible.length ? (
        <div>
          <p>검색 조건에 맞는 검토가 없습니다.</p>
          <button
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            검토 검색 초기화
          </button>
        </div>
      ) : (
        visible.map(({ document, round }) => {
          const object = round.objects.find(
            (shape) => shape.id === round.targetId,
          );
          return (
            <article className="flow-project-work" key={document.id}>
              <div>
                <h3>{document.title}</h3>
                <span className="flow-badge">{phases[round.phase]}</span>
                <p>
                  {round.source.name} · {object?.page ?? 1}쪽 · 요청 R
                  {round.revision}
                </p>
                <p>
                  {object?.label} · {round.message}
                </p>
                <p>다음 역할: {roles[round.phase]}</p>
                {round.reviewNote && <p>검토 의견: {round.reviewNote}</p>}
                {(document.revision ?? 1) > round.revision && (
                  <p>
                    현재 R{document.revision} 작성 중 · 이 기록은 이전
                    요청입니다.
                  </p>
                )}
              </div>
              <button
                onClick={() =>
                  onOpen(
                    document.id,
                    round.targetId,
                    object?.page ?? 1,
                    nextRoles[round.phase],
                    round.phase === 'approved' ? round.revision : undefined,
                  )
                }
              >
                {document.title} 검토 열기
              </button>
            </article>
          );
        })
      )}
    </section>
  );
}
