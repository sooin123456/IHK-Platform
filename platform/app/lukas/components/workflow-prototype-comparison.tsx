import { compareWorkflow, type Workflow } from "../lib/workflow-prototype";

export function WorkflowComparison({ state }: { state: Workflow }) {
  const comparison = compareWorkflow(state);
  const number = (value: number) =>
    value.toLocaleString("ko-KR", { maximumFractionDigits: 3 });
  const signed = (value: number) => `${value > 0 ? "+" : ""}${number(value)}`;
  const rows = [
    [
      "수량",
      `${number(comparison.baseline.quantity)} ${state.object.unit}`,
      `${number(state.object.quantity)} ${state.object.unit}`,
      `${signed(comparison.quantityDelta)} ${state.object.unit}`,
    ],
    [
      "단가",
      `${number(comparison.baseline.rate)}원`,
      `${number(state.object.rate)}원`,
      `${signed(state.object.rate - comparison.baseline.rate)}원`,
    ],
    [
      "금액",
      `${number(comparison.baselineAmount)}원`,
      `${number(comparison.currentAmount)}원`,
      `${signed(comparison.amountDelta)}원`,
    ],
  ];
  return (
    <section aria-label="도면 변경 영향 비교">
      <p>비교 기준: 초기 예시 R1 → 현재 R{state.revision}</p>
      <p className="flow-note">
        {state.object.sourceId} / {state.object.id} · {state.object.name}. 직전
        개정 또는 최신 승인본과의 비교가 아닙니다.
      </p>
      <div className="flow-table-wrap">
        <table>
          <thead>
            <tr>
              <th>항목</th>
              <th>초기 예시 R1</th>
              <th>현재 R{state.revision}</th>
              <th>차이</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, before, after, delta]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{before}</td>
                <td>{after}</td>
                <td>{delta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p role="status">
        {state.quantityStatus === "current"
          ? "예시 산출 확인됨 · 실제 확정 금액 아님"
          : "미확정 미리보기 · 현재 개정의 산출 근거를 다시 확인하세요."}
      </p>
      <p className="flow-note">
        금액 차이 = 현재 수량 × 현재 단가 − 기준 수량 × 기준 단가.
        세금·간접비·계약 조정은 포함하지 않습니다.
      </p>
    </section>
  );
}
