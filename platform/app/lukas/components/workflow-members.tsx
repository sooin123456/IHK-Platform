import { useState } from "react";
import {
  getWorkflowMembers,
  roleLabels,
  type Workflow,
  type WorkflowAction,
  type DemoRole,
} from "../lib/workflow-prototype";

export function WorkflowMembers({
  state,
  dispatch,
  projectName,
}: {
  state: Pick<Workflow,'role'|'members'>;
  dispatch: (action: WorkflowAction) => void;
  projectName?: string;
}) {
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [role, setRole] = useState<DemoRole>("viewer"),
    [editing, setEditing] = useState(false),
    [notice, setNotice] = useState("");
  const members = getWorkflowMembers(state),
    locked = !["author", "approver"].includes(state.role);
  const normalized = email.trim().toLowerCase(),
    existing = members.some((member) => member.email === normalized);
  const invalid =
    !name.trim() ||
    !/^\S+@\S+\.\S+$/.test(normalized) ||
    (!editing && existing) ||
    (!existing && members.length >= 50);
  const reset = () => {
    setName("");
    setEmail("");
    setRole("viewer");
    setEditing(false);
  };
  return (
    <section aria-label="구성원 역할 배치안">
      <p>
        {projectName?`${projectName}의 로컬 구성원 배치안입니다. 관리자 체험에서 수정할 수 있습니다.`:'예시 프로젝트의 역할 배치안입니다. 작성자·승인자 체험에서 배치안을 편집할 수 있습니다.'} 실제 구성원 추가·초대 메일·접근 권한 변경은 하지 않습니다.
      </p>
      {locked && (
        <p role="status">현재 체험 역할에서는 배치안을 편집할 수 없습니다.</p>
      )}
      {members.map((member) => (
        <article className="flow-card" key={member.email}>
          <h3>{member.name}</h3>
          <p style={{ overflowWrap: "anywhere" }}>{member.email}</p>
          <p>계획 역할: {roleLabels[member.role]} · 서버 미적용</p>
          <button
            disabled={locked}
            onClick={() => {
              setName(member.name);
              setEmail(member.email);
              setRole(member.role);
              setEditing(true);
              setNotice("");
            }}
          >
            배치안 수정
          </button>
        </article>
      ))}
      <h3>{editing ? "역할 배치안 수정" : "구성원 배치안 추가"}</h3>
      <fieldset disabled={locked}>
        <label className="flow-input">
          구성원 이름
          <input
            aria-label="구성원 이름"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="flow-input">
          구성원 이메일
          <input
            aria-label="구성원 이메일"
            type="email"
            value={email}
            maxLength={254}
            disabled={editing}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="flow-input">
          계획 역할
          <select
            aria-label="계획 역할"
            value={role}
            onChange={(event) => setRole(event.target.value as DemoRole)}
          >
            {Object.entries(roleLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p>
          {role === "author"
            ? "도면 작성·수량 근거 편집"
            : role === "reviewer"
              ? "검토 의견·수정 요청"
              : role === "approver"
                ? "검토 완료본 승인"
                : "자료 보기"}{" "}
          역할 배치안이며, 현재 로그인 권한은 변경되지 않습니다.
        </p>
        {!editing && existing && (
          <p role="alert">
            이미 등록한 이메일입니다. 해당 구성원의 배치안 수정을 이용하세요.
          </p>
        )}
        <button
          disabled={invalid}
          onClick={() => {
            if (!invalid) {
              dispatch({ type: "member-plan", name, email, role });
              reset();
              setNotice(
                "역할 배치안을 이 탭에 보관했습니다. 실제 초대·권한 변경은 하지 않았습니다.",
              );
            }
          }}
        >
          구성원 배치안 보관
        </button>
        {editing && <button onClick={reset}>수정 취소</button>}
      </fieldset>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
