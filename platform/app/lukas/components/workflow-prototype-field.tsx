import { useEffect, useState } from "react";
import type {
  Workflow,
  WorkflowAction,
  WorkflowPage,
} from "../lib/workflow-prototype";

export function WorkflowFieldPage({
  state,
  dispatch,
  go,
  open,
}: {
  state: Workflow;
  dispatch: (action: WorkflowAction) => void;
  go: (page: WorkflowPage) => void;
  open: (panel: string, draft?: string) => void;
}) {
  const [title, setTitle] = useState(""),
    [note, setNote] = useState(""),
    [condition, setCondition] = useState<
      "changed" | "conforming" | "needs-check"
    >("needs-check");
  const [photo, setPhoto] = useState<File | null>(null),
    [preview, setPreview] = useState(""),
    [fileError, setFileError] = useState("");
  useEffect(() => {
    if (!photo) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  const locked = !["author", "reviewer"].includes(state.role);
  const notes = state.fieldNotes ?? [];
  const labels = {
    changed: "변경 검토 필요",
    conforming: "현장 일치 기록",
    "needs-check": "추가 확인 필요",
  };
  return (
    <div className="flow-grid-two">
      <section className="flow-card">
        <h2>위치 기반 현장 기록</h2>
        <div className="flow-field-map">
          <strong>{state.object.location}</strong>
          <span>
            {state.object.id} · {state.object.sourceId} · R{state.revision}
          </span>
          <small>시나리오 위치 · 실제 지도/GPS 아님</small>
        </div>
        <button onClick={() => go("workspace")}>이 위치의 도면 열기</button>
        <label className="flow-input">
          기록 제목
          <input
            aria-label="현장 기록 제목"
            maxLength={120}
            disabled={locked}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="flow-input">
          관찰 상태
          <select
            aria-label="현장 관찰 상태"
            disabled={locked}
            value={condition}
            onChange={(e) => setCondition(e.target.value as typeof condition)}
          >
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flow-input">
          관찰·변경 사유
          <textarea
            aria-label="현장 기록 내용"
            maxLength={1000}
            disabled={locked}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <label className="flow-input">
          현장 사진 미리보기
          <input
            aria-label="현장 사진 선택"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={locked}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) {
                setPhoto(null);
                return;
              }
              if (
                !["image/png", "image/jpeg", "image/webp"].includes(
                  file.type,
                ) ||
                file.size > 5_000_000 ||
                file.name.length > 160
              ) {
                setFileError("5MB 이하 PNG/JPEG/WebP 파일을 선택하세요.");
                setPhoto(null);
                return;
              }
              setFileError("");
              setPhoto(file);
            }}
          />
        </label>
        {fileError && <p role="alert">{fileError}</p>}
        {preview && (
          <img
            className="flow-field-photo"
            src={preview}
            alt="사용자가 선택한 현장 사진 · 현재 화면 미리보기"
          />
        )}
        <p className="flow-note">
          사진은 현재 화면에서만 미리 봅니다. 보관되는 것은 파일명뿐이며 서버
          업로드·GPS 판독은 하지 않습니다.
        </p>
        <button
          disabled={
            locked || !title.trim() || !note.trim() || Boolean(fileError)
          }
          onClick={() =>
            dispatch({
              type: "field-note",
              title,
              note,
              condition,
              photoName: photo?.name,
            })
          }
        >
          현장 기록 예시 보관
        </button>
      </section>
      <section className="flow-card">
        <h2>검측 기록 · {notes.length}건</h2>
        {!notes.length ? (
          <p>아직 기록이 없습니다. 위치와 관찰 내용을 먼저 남겨주세요.</p>
        ) : (
          notes
            .slice()
            .reverse()
            .map((item) => (
              <article className="flow-field-note" key={item.id}>
                <header>
                  <strong>{item.title}</strong>
                  <span className="flow-badge">{labels[item.condition]}</span>
                </header>
                <p>{item.note}</p>
                <small>
                  {item.id} · {item.objectId} · {item.sourceId} · R
                  {item.revision} · {item.location}
                </small>
                <p>
                  {item.photoName
                    ? `사진명: ${item.photoName} · 원본 이미지는 별도 첨부 필요`
                    : "사진 미첨부"}
                </p>
                <button
                  onClick={() =>
                    open(
                      "request",
                      `근거 ${item.sourceId} / ${item.objectId} / R${item.revision}\n위치 ${item.location}\n현장 기록 ${item.id}: ${item.title}\n${item.note}`,
                    )
                  }
                >
                  이 기록으로 검토 초안 작성
                </button>
              </article>
            ))
        )}
      </section>
    </div>
  );
}

export function WorkflowMaterialsPage({
  state,
  dispatch,
  go,
}: {
  state: Workflow;
  dispatch: (action: WorkflowAction) => void;
  go: (page: WorkflowPage) => void;
}) {
  const data = state.materials;
  const [ordered, setOrdered] = useState(data ? String(data.ordered) : ""),
    [received, setReceived] = useState(data ? String(data.received) : ""),
    [installed, setInstalled] = useState(data ? String(data.installed) : ""),
    [reason, setReason] = useState(data?.reason ?? "");
  const values = [ordered, received, installed];
  const invalid =
    values.some(
      (v) =>
        !v.trim() ||
        !Number.isFinite(Number(v)) ||
        Number(v) < 0 ||
        Number(v) > 1e9,
    ) ||
    Number(received) > Number(ordered) ||
    Number(installed) > Number(received) ||
    !reason.trim();
  const locked =
    !state.approved || !["author", "approver"].includes(state.role);
  return (
    <section className="flow-card">
      <h2>승인 수량과 자재 현황</h2>
      <p>
        {state.object.id} · {state.object.name} · {state.object.unit}.
        설계·발주·입고·시공 수량은 서로 다른 값입니다.
      </p>
      <div className="flow-table-wrap">
        <table>
          <thead>
            <tr>
              <th>승인 설계수량</th>
              <th>발주 수량</th>
              <th>입고 수량</th>
              <th>시공 확인 수량</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                {state.approved
                  ? `${state.approved.quantity} ${state.object.unit} · R${state.approved.revision}`
                  : "미승인"}
              </td>
              <td>{data ? data.ordered : "미등록"}</td>
              <td>{data ? data.received : "미등록"}</td>
              <td>{data ? data.installed : "미등록"}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {data && (
        <p>
          자재 기록 기준: 승인 R{data.approvedRevision} · {data.reason}
        </p>
      )}
      {data && state.approved?.revision !== data.approvedRevision && (
        <p role="alert">
          새 승인본과 자재 기록의 기준 개정이 다릅니다. 자동으로 수량을 덮어쓰지
          않습니다.
        </p>
      )}
      <div className="flow-grid-three">
        {[
          ["발주 수량", ordered, setOrdered],
          ["입고 수량", received, setReceived],
          ["시공 확인 수량", installed, setInstalled],
        ].map(([label, value, setter]) => (
          <label className="flow-input" key={String(label)}>
            {String(label)}
            <input
              aria-label={String(label)}
              type="number"
              min="0"
              step="0.001"
              value={String(value)}
              disabled={locked}
              onChange={(e) =>
                (setter as (value: string) => void)(e.target.value)
              }
            />
          </label>
        ))}
      </div>
      <label className="flow-input">
        기록 사유
        <textarea
          aria-label="자재 기록 사유"
          maxLength={500}
          disabled={locked}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {!state.approved && (
        <p role="status">
          승인 설계수량이 필요합니다. 먼저 검토·승인 흐름을 완료하세요.
        </p>
      )}
      {invalid && !locked && (
        <p role="alert">
          0 이상 수량과 사유를 입력하세요. 입고는 발주를, 시공 확인은 입고를
          초과할 수 없습니다.
        </p>
      )}
      {Number(ordered) > (state.approved?.quantity ?? Infinity) && (
        <p>
          승인 설계수량보다 발주 수량이 많습니다. 여유분·포장 단위 등 근거를
          기록하세요.
        </p>
      )}
      <button
        disabled={locked || invalid}
        onClick={() =>
          dispatch({
            type: "materials",
            ordered: Number(ordered),
            received: Number(received),
            installed: Number(installed),
            reason,
          })
        }
      >
        자재 현황 예시 보관
      </button>
      <button onClick={() => go("reviews")}>기준 승인 확인</button>
      <p className="flow-note">
        실제 구매·발주·입고·기성 청구·지급을 실행하지 않습니다. 시공 확인 수량은
        승인된 기성 수량이 아닙니다.
      </p>
    </section>
  );
}
