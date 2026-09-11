import { useState } from "react";
import type { DocumentReviewRound } from "../lib/workflow-document-review";
import { WorkflowPdfBackground } from "./workflow-prototype-pdf";
import { WorkflowDraftShape } from "./workflow-draft-shape";
import {
  draftLayer,
  orderedDraftShapes,
} from "../lib/workflow-document-layers";

export function WorkflowRecipientDrawing({
  round,
}: {
  round: DocumentReviewRound;
}) {
  const [page, setPage] = useState(
    round.objects.find((object) => object.id === round.targetId)?.page ?? 1,
  );
  const [selected, setSelected] = useState(round.targetId);
  const [ready, setReady] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  return (
    <section className="flow-card" aria-label="수신 승인 도면">
      <h2>승인 도면 R{round.revision} · 읽기 전용</h2>
      <p>
        자동으로 전송된 파일이 아닙니다. 보유한 동일 원본을 선택해 확인합니다.
        객체는 승인 당시의 페이지 상대 위치이며 실측 정합을 의미하지 않습니다.
        페이지 이동·확인은 원본과 작업 중인 개정을 변경하지 않습니다.
      </p>
      <label>
        <input
          type="checkbox"
          aria-label="승인 숨긴 레이어 임시 표시"
          checked={showHidden}
          onChange={(event) => setShowHidden(event.target.checked)}
        />
        승인 당시 숨긴 레이어 임시 표시 · 원본 기록 유지
      </label>
      <WorkflowPdfBackground
        source={round.source}
        page={page}
        // Fingerprint validation happens in the renderer; never replace approved provenance.
        onSource={() => {}}
        onReady={setReady}
        onPage={(next) => {
          setPage(next);
          setSelected("");
        }}
      >
        <svg
          className="flow-blank-canvas"
          viewBox="0 0 800 520"
          preserveAspectRatio="none"
          role="img"
          aria-label="승인 도면 표시"
        >
          {orderedDraftShapes({ layers: round.layers, shapes: round.objects })
            .filter(
              (object) =>
                (object.page ?? 1) === page &&
                (showHidden || draftLayer(round, object)?.visible),
            )
            .map((object) => (
              <g
                key={object.id}
                role="img"
                aria-label={`승인 객체: ${object.label}`}
              >
                <WorkflowDraftShape
                  shape={object}
                  selected={object.id === selected}
                />
              </g>
            ))}
        </svg>
      </WorkflowPdfBackground>
      <div className="flow-actions">
        {round.objects.map((object) => (
          <button
            key={object.id}
            disabled={!ready}
            aria-label={`승인 위치 보기: ${object.label}`}
            onClick={() => {
              setPage(object.page ?? 1);
              if (!draftLayer(round, object)?.visible) setShowHidden(true);
              setSelected(object.id);
            }}
          >
            {object.page ?? 1}쪽 · {object.label || "이름 없는 객체"}
          </button>
        ))}
      </div>
    </section>
  );
}
