import { useEffect, useRef, useState } from "react";
import {
  encodeWorkflowSession,
  decodeWorkflowSession,
  workflowAutosaveLimit,
  workflowBackupLimit,
  workflowSessionKey,
  type WorkflowSession,
} from "../lib/workflow-prototype-session";
function downloadText(raw: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([raw], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function WorkflowBackup({
  value,
  attention,
  invalid,
  onRestore,
}: {
  value: WorkflowSession;
  attention: boolean;
  invalid: boolean;
  onRestore: (value: WorkflowSession) => void;
}) {
  const [open, setOpen] = useState(attention),
    [message, setMessage] = useState(""),
    [pending, setPending] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const [candidate, setCandidate] = useState<{
    value: WorkflowSession;
    large: boolean;
    name: string;
  } | null>(null);
  const request = useRef(0);
  const fileInput=useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (attention) setOpen(true);
  }, [attention]);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  return (
    <section aria-label="작업 백업·복원" className="flow-card">
      <details
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>작업 백업·복원</summary>
        <p>
          이 프리뷰의 도면 객체·레이어·수량·검토·초안·재사용 템플릿·속성 기준을 JSON 파일로 보관합니다.
          원본 PDF·DWG·IFC 파일은 포함되지 않으며 복원 후 동일 원본을 다시
          연결해야 합니다. 완료하지 않은 폴리라인이나 미제출 폼 등 임시 입력은
          포함되지 않을 수 있으니 필요한 입력은 먼저 완료·저장해 주세요.
        </p>
        <p>
          검토 의견과 금액 등 업무 자료가 포함됩니다. 파일 공유에 주의하세요.
          백업은 최대 2천만자이며, 자동 저장 한도 2백만자를 넘으면 파일로만
          보관할 수 있습니다.
        </p>
        <button
          onClick={() => {
            try {
              downloadText(
                encodeWorkflowSession(value, workflowBackupLimit),
                "1hk-workspace-backup.json",
              );
              setMessage(
                "백업 다운로드를 요청했습니다. 파일이 저장됐는지 확인하세요.",
              );
            } catch {
              setMessage(
                "백업 크기 또는 데이터 형식을 확인할 수 없습니다. 화면을 닫지 말고 자료를 나누어 보관하세요.",
              );
            }
          }}
        >
          현재 작업 백업 다운로드
        </button>
        {invalid && (
          <button
            onClick={() => {
              try {
                const raw = sessionStorage.getItem(workflowSessionKey);
                if (raw) {
                  downloadText(raw, "1hk-unrestored-original.json");
                  setMessage(
                    "기존 탭 원문 다운로드를 요청했습니다. 복원 가능 여부는 검증되지 않은 파일입니다.",
                  );
                }
              } catch {
                setMessage("기존 탭 원문을 읽을 수 없습니다.");
              }
            }}
          >
            복원되지 않은 탭 원문 다운로드
          </button>
        )}
        <label className="flow-input">
          작업 백업 파일
          <input
            aria-label="작업 백업 파일"
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            onChange={async (event) => {
              const token = ++request.current,
                file = event.target.files?.[0];
              setCandidate(null);
              setConfirmed(false);
              setMessage("");
              if (!file) {
                setPending(false);
                return;
              }
              if (file.size > workflowBackupLimit * 4) {
                setPending(false);
                setMessage(
                  "파일이 너무 큽니다. 최대 80MB 이내의 백업을 선택하세요.",
                );
                return;
              }
              setPending(true);
              try {
                const raw = await file.text();
                if (token !== request.current) return;
                const parsed = decodeWorkflowSession(raw, workflowBackupLimit);
                if (!parsed) {
                  setMessage(
                    "복원할 수 없는 파일입니다. 현재 작업은 변경하지 않았습니다.",
                  );
                  return;
                }
                setCandidate({
                  value: parsed,
                  large:
                    encodeWorkflowSession(parsed, workflowBackupLimit).length >
                    workflowAutosaveLimit,
                  name: file.name,
                });
              } catch {
                if (token === request.current)
                  setMessage(
                    "복원할 수 없는 파일입니다. 현재 작업은 변경하지 않았습니다.",
                  );
              } finally {
                if (token === request.current) setPending(false);
              }
            }}
          />
        </label>
        {pending && <p role="status">백업 형식 확인 중…</p>}
        {candidate && (
          <div className="flow-card">
            <strong>{candidate.name}</strong>
            <p>
              프로젝트 {candidate.value.projects?.length ?? 0}개 · 도면 {candidate.value.blankDocuments?.length ?? 0}개 · 객체{" "}
              {candidate.value.blankDocuments?.reduce(
                (sum, doc) => sum + doc.shapes.length,
                0,
              ) ?? 0}
              개 · 재사용 템플릿 {candidate.value.savedTemplates?.length ?? 0}개 · 속성 기준 {candidate.value.propertyStandards?.length ?? 0}버전
            </p>
            <p>
              이 탭의 현재 프로젝트·도면·예시·검토 초안·재사용 템플릿·속성 기준을 모두 교체합니다. 현재 작업이
              필요하면 먼저 백업 파일을 저장하세요.
            </p>
            {candidate.large && (
              <p>
                자동 저장 한도 초과: 복원 후에도 이 파일을 보관하세요.
                새로고침하면 현재 탭에서 복원한 작업이 사라질 수 있습니다.
              </p>
            )}
          </div>
        )}
        <label>
          <input
            aria-label="현재 탭의 작업을 선택한 백업으로 교체함을 확인합니다"
            type="checkbox"
            disabled={!candidate || pending}
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          현재 탭의 작업을 선택한 백업으로 교체함을 확인합니다
        </label>
        <div className="flow-actions">
          <button
            disabled={!candidate || !confirmed || pending}
            onClick={() => {
              if (!candidate || !confirmed || pending) return;
              onRestore(candidate.value);
              if(fileInput.current)fileInput.current.value='';
              setCandidate(null);
              setConfirmed(false);
              setMessage(
                "백업을 현재 탭에 복원했습니다. 저장 상태를 확인하세요.",
              );
            }}
          >
            확인한 백업으로 현재 탭 복원
          </button>
          <button
            onClick={() => {
              request.current++;
              if(fileInput.current)fileInput.current.value='';
              setCandidate(null);
              setConfirmed(false);
              setPending(false);
              setMessage(
                "복원을 취소했습니다. 현재 작업은 변경하지 않았습니다.",
              );
            }}
          >
            복원 취소
          </button>
        </div>
        {message && <p role="status">{message}</p>}
      </details>
    </section>
  );
}
