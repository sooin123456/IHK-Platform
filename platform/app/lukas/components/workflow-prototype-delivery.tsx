import { useState } from "react";
import type { Workflow, WorkflowAction } from "../lib/workflow-prototype";
import { WorkflowEvidenceSummary } from "./workflow-prototype-approval";

export function WorkflowDeliveryPage({
  state,
  dispatch,
}: {
  state: Workflow;
  dispatch: (action: WorkflowAction) => void;
}) {
  const saved = state.deliveryPackage;
  const [formats, setFormats] = useState<("PDF" | "DWG" | "XLSX" | "CSV")[]>(
    saved?.formats ?? ["PDF", "XLSX"],
  );
  const [recipient, setRecipient] = useState(saved?.recipient ?? "");
  const [manifest, setManifest] = useState(false);
  const locked =
    state.phase !== "approved" || state.role !== "approver" || !state.approved;
  const pending =
    saved &&
    (saved.formats.join() !== formats.join() ||
      saved.recipient !== recipient.trim());
  return (
    <section className="flow-card">
      <header>
        <h2>제출 패키지 DEL-01</h2>
        <span className="flow-badge">
          {state.approved ? "승인본 준비됨 · 예시" : "승인본 필요"}
        </span>
      </header>
      <p>승인된 도면·산출 근거·내역·검토 기록을 함께 묶습니다.</p>
      <WorkflowEvidenceSummary state={state} approved />
      <fieldset disabled={locked}>
        <legend>요청할 출력 형식</legend>
        <div className="flow-actions">
          {(["PDF", "DWG", "XLSX", "CSV"] as const).map((format) => (
            <label key={format}>
              <input
                type="checkbox"
                aria-label={`${format} 출력 선택`}
                checked={formats.includes(format)}
                onChange={(e) =>
                  setFormats((values) =>
                    e.target.checked
                      ? [...values, format]
                      : values.filter((item) => item !== format),
                  )
                }
              />
              {format}
            </label>
          ))}
        </div>
      </fieldset>
      {!formats.length && <p role="alert">출력 형식을 하나 이상 선택하세요.</p>}
      {formats.includes("DWG") && (
        <p role="alert">
          DWG 재저장 엔진 미연결: 호환성·폰트·외부참조 검증이 필요합니다. DWG
          생성 완료로 표시하지 않습니다.
        </p>
      )}
      <label className="flow-input">
        인계 대상 메모
        <input
          aria-label="인계 대상 메모"
          maxLength={120}
          value={recipient}
          disabled={locked}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="예: 발주처 검토 담당 · 발송하지 않음"
        />
      </label>
      <ul className="flow-checklist">
        {[
          "도면 원본·승인 개정",
          "수량 산출서·계산 근거",
          "단가 버전·내역서",
          "변경·검토·승인 이력",
        ].map((label) => (
          <li key={label}>
            <span>{label}</span>
            <small>필수 포함 계획 · 파일 미생성</small>
          </li>
        ))}
      </ul>
      <p className="flow-note">
        모든 형식은 구성 계획만 보관합니다. 파일 생성·변환·다운로드·전송·수령
        확인은 실행하지 않습니다.
      </p>
      <button
        className="flow-primary"
        disabled={locked || !formats.length}
        onClick={() => dispatch({ type: "deliver", formats, recipient })}
      >
        패키지 준비 체험
      </button>
      {pending && (
        <p role="status">
          변경한 구성은 아직 보관하지 않았습니다. 아래 목록은 이전에 보관한
          구성을 표시합니다.
        </p>
      )}
      {state.delivery === "prepared" && (
        <p role="status">
          패키지 구성 확인 완료 · 실제 파일 생성·전송은 수행하지 않았습니다.
        </p>
      )}
      {saved && (
        <>
          <button
            onClick={() => setManifest(!manifest)}
            aria-expanded={manifest}
          >
            인계 목록 미리보기
          </button>
          {manifest && (
            <section aria-label="인계 목록 미리보기">
              <h3>보관된 구성 · 승인 R{saved.revision}</h3>
              <p>인계 대상 메모: {saved.recipient || "미지정"}</p>
              <div className="flow-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>형식</th>
                      <th>포함 계획</th>
                      <th>생성 상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {saved.formats.map((format) => (
                      <tr key={format}>
                        <td>{format}</td>
                        <td>
                          {format === "PDF" || format === "DWG"
                            ? "승인 도면 개정"
                            : "수량·내역·근거 목록"}
                        </td>
                        <td>
                          {format === "DWG"
                            ? "변환 엔진 미연결"
                            : "미생성 · 화면 예시"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                검토·승인 이력과 근거 식별자는 모든 패키지의 필수 포함
                계획입니다.
              </p>
            </section>
          )}
        </>
      )}
      {state.approved && state.phase !== "approved" && (
        <p>
          현재 작업 개정은 미승인 상태입니다. 기존 승인본과 구성을 덮어쓰지
          않으며 새 개정의 납품 준비는 재승인 후 가능합니다.
        </p>
      )}
    </section>
  );
}
