import {
  phaseLabels,
  type Workflow,
  type WorkflowAction,
  type WorkflowPage,
  type DemoRole,
} from "../lib/workflow-prototype";

export function WorkflowReviewContext({
  state,
  dispatch,
  open,
  go,
}: {
  state: Workflow;
  dispatch: (action: WorkflowAction) => void;
  open: (panel: string) => void;
  go: (page: WorkflowPage) => void;
}) {
  const stage = state.phase;
  const next: {
    role: DemoRole;
    label: string;
    description: string;
    panel: string;
  } =
    stage === "requested"
      ? {
          role: "reviewer",
          label: "검토자로 전환",
          description: "요청된 개정과 산출 근거를 확인하고 의견을 남겨주세요.",
          panel: "review",
        }
      : stage === "reviewed"
        ? {
            role: "approver",
            label: "승인자로 전환",
            description: "검토 완료된 개정의 도면·수량·금액을 확인합니다.",
            panel: "approval",
          }
        : stage === "approved"
          ? {
              role: "author",
              label: "작성자로 전환",
              description:
                "승인본은 유지됩니다. 수정하려면 새 개정을 시작하세요.",
              panel: "approval",
            }
          : {
              role: "author",
              label: "작성자로 전환",
              description:
                stage === "changes"
                  ? "수정 의견을 반영한 뒤 산출 근거를 다시 확인하고 재제출하세요."
                  : "산출 근거를 확인한 뒤 검토를 요청하세요.",
              panel: state.quantityStatus === "current" ? "request" : "formula",
            };
  const correction = [...state.history]
    .reverse()
    .find((item) => item.label.startsWith("수정 요청:"));
  return (
    <section className="flow-review-context" aria-label="현재 검토 흐름">
      <div>
        <strong>{phaseLabels[stage]}</strong>
        <span>
          {state.object.id} · {state.object.sourceId} · R{state.revision}
        </span>
      </div>
      <ol aria-label="검토 단계">
        {["작성", "검토", "승인", "인계"].map((label, index) => (
          <li
            key={label}
            aria-current={
              index ===
              (stage === "approved"
                ? 3
                : stage === "reviewed"
                  ? 2
                  : stage === "requested"
                    ? 1
                    : 0)
                ? "step"
                : undefined
            }
          >
            {label}
          </li>
        ))}
      </ol>
      {state.request && (
        <p>
          요청 R{state.request.revision}: {state.request.message}
        </p>
      )}
      {correction && <blockquote>{correction.label}</blockquote>}
      <p>{next.description}</p>
      <div className="flow-actions">
        {state.role !== next.role ? (
          <button
            onClick={() => {
              dispatch({ type: "role", role: next.role });
              open(next.panel);
            }}
          >
            {next.label} · 데모
          </button>
        ) : (
          <button onClick={() => open(next.panel)}>
            {stage === "requested"
              ? "검토 의견 작성"
              : stage === "reviewed"
                ? "승인 내용 확인"
                : stage === "approved"
                  ? "새 개정 준비"
                  : state.quantityStatus === "current"
                    ? "검토 요청 작성"
                    : "산출 근거 확인"}
          </button>
        )}
        <button onClick={() => go("workspace")}>
          {stage === "changes"
            ? "같은 도면에서 수정"
            : "대상 도면으로 돌아가기"}
        </button>
      </div>
      <small>
        역할 전환은 화면 체험용입니다. 실제 권한 변경·알림 전송은 하지 않습니다.
      </small>
    </section>
  );
}
