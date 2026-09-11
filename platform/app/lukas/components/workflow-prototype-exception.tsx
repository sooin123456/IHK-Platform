import { useState } from "react";
import {
  workflowExceptions,
  type Workflow,
  type WorkflowPage,
} from "../lib/workflow-prototype";

export function WorkflowException({
  kind,
  state,
  change,
  open,
  go,
}: {
  kind: string;
  state: Workflow;
  change: (kind: string) => void;
  open: (panel: string) => void;
  go: (page: WorkflowPage) => void;
}) {
  const [ack, setAck] = useState(false);
  const [requested, setRequested] = useState(false);
  const [source, setSource] = useState("");
  const [recovery, setRecovery] = useState("");
  const title = workflowExceptions.find(([id]) => id === kind)?.[1];
  const clear = () => change("");
  const to = (page: WorkflowPage) => {
    clear();
    go(page);
  };
  return (
    <section
      className="flow-exception flow-recovery"
      aria-label="예외 상태 복구"
    >
      <header>
        <strong>{title}</strong>
        <span className="flow-badge">오류·복구 시나리오</span>
      </header>
      {kind === "empty" && (
        <>
          <p>
            등록된 자료가 없는 프로젝트 화면입니다. 기존 예시 자료는 삭제하지
            않고 잠시 숨겼습니다.
          </p>
          <button onClick={() => to("start")}>첫 자료 준비하기</button>
          <button onClick={() => to("library")}>템플릿 살펴보기</button>
        </>
      )}
      {kind === "loading" && (
        <>
          <p>
            변환을 기다리는 화면 예시입니다. 실제 업로드나 변환 작업은 실행 중이
            아닙니다.
          </p>
          <progress aria-label="변환 대기 예시" />
          <div className="flow-actions">
            <button onClick={clear}>완료 상황 체험</button>
            <button onClick={() => change("unsupported")}>
              실패 상황 체험
            </button>
            <button onClick={() => to("documents")}>
              준비 취소 · 자료 목록
            </button>
          </div>
        </>
      )}
      {kind === "unsupported" && (
        <>
          <p>
            형상·글꼴 또는 외부참조를 확인하지 못했습니다. 파일을 연 것만으로
            편집·납품 호환성을 보장하지 않습니다.
          </p>
          <ul>
            <li>원본 파일은 유지됨</li>
            <li>미지원 객체는 검토 대상</li>
            <li>호환성 미확인 상태에서 납품 불가</li>
          </ul>
          <button onClick={() => open("compatibility")}>지원 범위 확인</button>
          <button onClick={() => change("loading")}>재시도 화면 보기</button>
        </>
      )}
      {kind === "required" && (
        <>
          <p>
            {state.object.id}의 축척·기준 길이가 필요합니다. 단위를 선택한
            것만으로는 측정을 확정할 수 없습니다.
          </p>
          <button onClick={() => open("scale")}>누락 설정 열기</button>
          <button disabled={!state.calibrated} onClick={clear}>
            설정 확인 후 계속
          </button>
        </>
      )}
      {kind === "stale" && (
        <>
          <p>
            R{state.revision}의 변경 내용과 산출 결과를 다시 확인하세요. 이전
            승인본은 그대로 유지됩니다.
          </p>
          <button onClick={() => open("compare")}>변경 근거 비교</button>
          <button onClick={() => open("formula")}>산출 결과 다시 확인</button>
          <button disabled={state.quantityStatus !== "current"} onClick={clear}>
            갱신 확인 후 계속
          </button>
        </>
      )}
      {kind === "missing" && (
        <>
          <p>
            {state.object.id}의 원본 {state.object.sourceId} 연결을 확인하지
            못했습니다. 다른 객체로 자동 대체하지 않습니다.
          </p>
          <label className="flow-input">
            복구 대상 원본
            <select
              aria-label="복구 대상 원본"
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setAck(false);
              }}
            >
              <option value="">직접 선택</option>
              <option value={state.object.sourceId}>
                {state.object.sourceId} · {state.document} · 예시
              </option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />{" "}
            객체 ID와 원본 개정을 대조했습니다 · 체험
          </label>
          <div>
            <button disabled={!source || !ack} onClick={clear}>
              동일 원본 재연결 체험
            </button>
          </div>
          <small>실제 파일 접근·해시 검증은 실행하지 않았습니다.</small>
        </>
      )}
      {kind === "permission" && (
        <>
          <p>
            보기 전용 상황입니다. 이 화면에서는 도면·물량·승인 상태를 변경할 수
            없습니다.
          </p>
          <button disabled={requested} onClick={() => setRequested(true)}>
            편집 권한 요청 작성
          </button>
          {requested && (
            <p role="status">
              요청 초안: {state.project} · 작성 권한 필요. 관리자에게 실제
              전송하지 않았습니다.
            </p>
          )}
          <button onClick={clear}>권한 부족 체험 종료</button>
        </>
      )}
      {kind === "expired" && (
        <>
          <p>
            공유 링크가 만료된 상황입니다. 이 링크로 자료 상세를 계속 열람할 수
            없습니다.
          </p>
          <button disabled={requested} onClick={() => setRequested(true)}>
            새 링크 요청 작성
          </button>
          {requested && (
            <p role="status">
              재발급 요청 초안을 준비했습니다. 실제 링크 생성·이메일 발송은 하지
              않았습니다.
            </p>
          )}
          <button onClick={() => to("projects")}>내 프로젝트로 돌아가기</button>
        </>
      )}
      {kind === "offline" && (
        <>
          <p>
            현재 탭의 작업은 유지됩니다. 검토 요청·승인·납품은 연결을 확인하기
            전 진행할 수 없습니다. 탭 저장이 가능하면 새로고침 후에도 예시
            상태를 복원합니다. 상단 저장 상태를 확인하세요.
          </p>
          <dl>
            <dt>현재 탭</dt>
            <dd>
              R{state.revision} · {state.object.quantity} {state.object.unit}
            </dd>
            <dt>승인 기준</dt>
            <dd>
              {state.approved
                ? `R${state.approved.revision} · ${state.approved.quantity} ${state.object.unit}`
                : "승인된 기준 없음"}
            </dd>
          </dl>
          <label className="flow-input">
            복구 방식
            <select
              aria-label="복구 방식"
              value={recovery}
              onChange={(e) => setRecovery(e.target.value)}
            >
              <option value="">선택하세요</option>
              <option value="keep">현재 탭 작업 유지</option>
              <option value="compare">차이 확인 후 결정</option>
            </select>
          </label>
          {recovery === "compare" && (
            <button onClick={() => open("compare")}>기준과 현재 비교</button>
          )}
          <button disabled={recovery !== "keep"} onClick={clear}>
            현재 작업 유지 · 재연결 체험
          </button>
          <small>실제 outbox 전송이나 원격 덮어쓰기는 수행하지 않습니다.</small>
        </>
      )}
      {kind === "ai" && (
        <>
          <p>
            추천에 필요한 자료가 부족합니다. 검사하지 못한 항목을 정상으로
            처리하지 않습니다. 도면 작성과 수동 검토는 계속할 수 있습니다.
          </p>
          <button onClick={() => open("findings")}>
            근거와 수동 확인 항목
          </button>
          <button onClick={clear}>AI 없이 계속 · 미검사 상태 확인</button>
        </>
      )}
    </section>
  );
}
