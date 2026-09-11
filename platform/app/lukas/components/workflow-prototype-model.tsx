import { useState } from "react";
import type { Workflow, WorkflowPage } from "../lib/workflow-prototype";

export function WorkflowModelPanel({
  state,
  open,
  go,
}: {
  state: Workflow;
  open: (panel: string) => void;
  go: (page: WorkflowPage) => void;
}) {
  const [query, setQuery] = useState("");
  const object = state.object;
  const matches =
    `${object.id} ${object.name} ${object.location} ${object.sourceId}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  return (
    <section aria-label="모델 근거 탐색">
      <p role="status">
        모델 원본은 아직 연결되지 않았습니다. 아래는 현재 시나리오 객체이며 실제
        IFC 속성 조회가 아닙니다.
      </p>
      <label className="flow-input">
        객체·위치 검색
        <input
          aria-label="모델 객체 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="객체 ID, 이름, 위치"
        />
      </label>
      {!matches ? (
        <div className="flow-evidence-summary">
          <p>일치하는 시나리오 객체가 없습니다.</p>
          <button onClick={() => setQuery("")}>검색 초기화</button>
        </div>
      ) : (
        <>
          <div className="flow-evidence-summary">
            <small>
              {state.document} / R{state.revision}
            </small>
            <h3>{object.location}</h3>
            <strong>
              {object.id} · {object.name}
            </strong>
            <dl>
              <dt>근거 ID</dt>
              <dd>{object.sourceId}</dd>
              <dt>IFC 연결</dt>
              <dd>GlobalId 미연결</dd>
              <dt>객체 분류</dt>
              <dd>
                {state.scenario === "ifc"
                  ? "외벽 · 시나리오 분류"
                  : state.scenario === "civil"
                    ? "배수관 구간 · 시나리오 분류"
                    : "마감 영역 · 시나리오 분류"}
              </dd>
              <dt>수량 예시</dt>
              <dd>
                {object.quantity} {object.unit}
              </dd>
              <dt>산출 상태</dt>
              <dd>
                {state.quantityStatus === "current"
                  ? "확인됨 · 예시"
                  : "근거 재확인 필요"}
              </dd>
            </dl>
          </div>
          <div className="flow-actions">
            <button onClick={() => go("workspace")}>
              작업실에서 대상 확인
            </button>
            <button onClick={() => open("formula")}>이 객체의 산출 근거</button>
            <button onClick={() => open("request")}>이 객체 검토 요청</button>
          </div>
        </>
      )}
      <details>
        <summary>3D·단면 확인 방법</summary>
        <p>
          작업실 상단에서 3D 모델 또는 분할 보기를 선택하세요. 같은 객체를 단독
          표시하거나 단면을 켤 수 있습니다.
        </p>
        <p>
          현재 3D는 생성된 예시 형상이며 2D에서 자동 추출한 모델이 아닙니다.
          모델 원본·GlobalId·좌표계·단위 검증이 필요합니다.
        </p>
      </details>
    </section>
  );
}
