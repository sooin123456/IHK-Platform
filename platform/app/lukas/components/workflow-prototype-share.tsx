import { useState } from "react";
import {WorkflowInvitation} from './workflow-invitation';
import type { Workflow, WorkflowAction } from "../lib/workflow-prototype";

export function WorkflowSharePanel({
  state,
  run,
}: {
  state: Workflow;
  run: (action: WorkflowAction) => void;
}) {
  const shared = state.sharePreview;
  const [recipient, setRecipient] = useState(shared?.recipient ?? "");
  const [permission, setPermission] = useState<"view" | "comment">(
    shared?.permission ?? "comment",
  );
  const [includeAmount, setIncludeAmount] = useState(
    shared?.amount !== undefined,
  );
  const [step, setStep] = useState<"setup" | "invite" | "guest">("setup");
  const [message, setMessage] = useState(shared?.feedback ?? "");
  const [request, setRequest] = useState("");
  const [decision, setDecision] = useState("");
  const [accessStep, setAccessStep] = useState<"request"|"pending"|"owner"|"denied">("request");
  const locked = !["author", "approver"].includes(state.role);
  const valid =
    /^\S+@\S+\.\S+$/.test(recipient.trim()) && recipient.length <= 254;
  return (
    <section aria-label="외부 공유 미리보기">
      <p className="flow-note">
        프론트엔드 체험입니다. 이메일·초대 링크를 생성하거나 발송하지 않으며
        실제 접근 권한을 부여하지 않습니다.
      </p>
      {step === "setup" ? (
        <>
          <label className="flow-input">
            수신자 이메일
            <input
              aria-label="공유 수신자 이메일"
              type="email"
              maxLength={254}
              value={recipient}
              disabled={locked}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </label>
          <label className="flow-input">
            공유 권한
            <select
              aria-label="공유 권한"
              value={permission}
              disabled={locked}
              onChange={(e) =>
                setPermission(e.target.value as "view" | "comment")
              }
            >
              <option value="view">보기 전용</option>
              <option value="comment">보기·의견 작성</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={includeAmount}
              disabled={locked}
              onChange={(e) => setIncludeAmount(e.target.checked)}
            />
            금액 예시도 공개
          </label>
          <div className="flow-evidence-summary">
            <strong>공유 범위</strong>
            <p>
              {state.document} / R{state.revision}
            </p>
            <p>
              {state.object.id} · {state.object.name}
            </p>
            <p>
              이 객체의 근거·수량{includeAmount ? "·금액" : ""}만 포함합니다.
              다른 도면·회사 단가표·프로젝트 설정은 포함하지 않습니다.
            </p>
          </div>
          <button
            disabled={locked || !valid}
            onClick={() => {
              run({
                type: "share-preview",
                recipient,
                permission,
                includeAmount,
              });
              setMessage("");
              setStep("invite");
            }}
          >
            {shared
              ? "새 미리보기 구성 · 기존 예시 교체"
              : "수신자 화면 미리보기"}
          </button>
          {shared && (
            <>
              <button onClick={() => setStep("guest")}>
                보관된 수신자 화면 열기
              </button>
              <p>
                보관된 범위: R{shared.revision} ·{" "}
                {shared.status === "expired"
                  ? "접근 종료 예시"
                  : "열람 가능 예시"}
              </p>
              {shared.feedback && (
                <blockquote>
                  <strong>수신자 의견 예시 · R{shared.revision}</strong>
                  <p>{shared.feedback}</p>
                </blockquote>
              )}
            </>
          )}
          {locked && (
            <p role="status">
              현재 역할에서는 공유 범위를 새로 구성할 수 없습니다.
            </p>
          )}
        </>
      ) : step === "invite" && shared ? (
        <WorkflowInvitation shared={shared} onAccept={()=>setStep('guest')} onBack={()=>setStep('setup')}/>
      ) : (
        <>
          <button onClick={() => setStep("setup")}>
            공유 설정으로 돌아가기
          </button>
          {shared?.status === "expired" ? (
            <div role="alert" className="flow-evidence-summary">
              <h3>접근이 종료된 화면 예시</h3>
              <p>
                소유자의 재열람 허용 또는 새 공유 구성이 필요합니다. 도면·금액·의견
                입력은 표시하지 않습니다.
              </p>
              <p>접근 요청·판단은 화면 체험이며 알림이나 실제 권한을 변경하지 않습니다. 요청 초안은 패널을 닫으면 초기화됩니다.</p>
              {accessStep === "request" && <>
                <label className="flow-input">접근 요청 사유<textarea aria-label="접근 요청 사유" maxLength={500} value={request} onChange={event=>setRequest(event.target.value)}/></label>
                <button disabled={!request.trim()} onClick={()=>setAccessStep("pending")}>접근 요청 기록 (체험)</button>
              </>}
              {accessStep === "pending" && <>
                <p role="status">요청 대기 예시 · 허용 전까지 공유 내용은 표시하지 않습니다.</p>
                <p>요청 사유: {request}</p>
                <button onClick={()=>setAccessStep("request")}>요청 수정·취소</button>
                <button disabled={locked} onClick={()=>setAccessStep("owner")}>소유자 판단 화면 체험</button>
              </>}
              {accessStep === "owner" && <>
                <h4>소유자 판단 · 화면 체험</h4>
                <p>요청 사유: {request}</p>
                <p>허용 범위는 기존 수신자와 권한 그대로입니다. 현재 개정·추가 금액을 자동 공개하지 않습니다.</p>
                <label className="flow-input">접근 판단 사유<textarea aria-label="접근 판단 사유" maxLength={500} value={decision} onChange={event=>setDecision(event.target.value)}/></label>
                <button disabled={locked||!decision.trim()} onClick={()=>{run({type:'share-restore',message:decision});setAccessStep('request');setRequest('');setDecision('');}}>기존 범위 재열람 허용 (체험)</button>
                <button disabled={locked||!decision.trim()} onClick={()=>setAccessStep('denied')}>접근 요청 거절 (체험)</button>
                <button onClick={()=>setAccessStep('pending')}>요청자 화면으로</button>
              </>}
              {accessStep === "denied" && <>
                <p role="status">접근 요청 거절 예시 · {decision}</p>
                <button onClick={()=>{setAccessStep('request');setDecision('');}}>사유 보완 후 다시 요청</button>
              </>}
            </div>
          ) : (
            shared && (
              <div aria-label="수신자 열람 화면">
                <div className="flow-evidence-summary">
                  <small>
                    수신자 화면 체험 ·{" "}
                    {shared.permission === "view"
                      ? "보기 전용"
                      : "의견 작성 가능"}
                  </small>
                  <h3>{shared.document}</h3>
                  <p>
                    R{shared.revision} / {shared.sourceId} / {shared.objectId}
                  </p>
                  <p>{shared.objectName}</p>
                  <dl>
                    <dt>수량 예시</dt>
                    <dd>
                      {shared.quantity} {shared.unit}
                    </dd>
                    {shared.amount !== undefined && (
                      <>
                        <dt>금액 예시</dt>
                        <dd>{shared.amount.toLocaleString("ko-KR")}원</dd>
                      </>
                    )}
                  </dl>
                  <p>
                    공유 구성 당시의 예시입니다. 승인·확정 납품본을 의미하지
                    않습니다.
                  </p>
                </div>
                {shared.revision !== state.revision && (
                  <p role="status">
                    작성자의 현재 개정과 다른 고정 범위입니다. 새 개정이 자동
                    공개되지 않습니다.
                  </p>
                )}
                {shared.permission === "comment" ? (
                  <>
                    <label className="flow-input">
                      검토 의견
                      <textarea
                        aria-label="수신자 검토 의견"
                        maxLength={500}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                      />
                    </label>
                    <button
                      disabled={!message.trim()}
                      onClick={() => run({ type: "share-feedback", message })}
                    >
                      의견 예시 보관
                    </button>
                    {shared.feedback && (
                      <p role="status">
                        의견 예시가 보관됐습니다. 검토 완료·승인 상태는 바뀌지
                        않았습니다.
                      </p>
                    )}
                  </>
                ) : (
                  <p>
                    보기 전용 범위입니다. 의견 작성과 편집은 허용하지 않습니다.
                  </p>
                )}
                <button
                  disabled={locked}
                  onClick={() => run({ type: "share-expire" })}
                >
                  접근 종료 상태 체험
                </button>
              </div>
            )
          )}
        </>
      )}
    </section>
  );
}
