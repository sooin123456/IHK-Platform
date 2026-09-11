import { useState } from "react";
import { WorkflowPriceBookImport } from "./workflow-pricebook-import";
import {
  priceBookEntrySchema,
  type PriceBookEntry,
} from "../lib/workflow-pricebook";
import type { Workflow, WorkflowAction } from "../lib/workflow-prototype";
export function WorkflowPriceBook({
  state,
  dispatch,
}: {
  state: Workflow;
  dispatch: (action: WorkflowAction) => void;
}) {
  const [code, setCode] = useState(""),
    [name, setName] = useState(""),
    [unit, setUnit] = useState<PriceBookEntry["unit"]>("m²"),
    [rate, setRate] = useState(""),
    [source, setSource] = useState(""),
    [query, setQuery] = useState(""),
    [editing, setEditing] = useState(false);
  const entries = state.pricebook ?? [],
    locked = state.role !== "author";
  const latest = [
    ...new Map(entries.map((entry) => [entry.code, entry])).values(),
  ];
  const visible = latest.filter((entry) =>
    `${entry.code} ${entry.name} ${entry.source}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const input = { code, name, unit, rate: Number(rate), source };
  const valid =
    rate.trim() !== "" &&
    priceBookEntrySchema.safeParse({ ...input, version: 1 }).success;
  const reset = () => {
    setCode("");
    setName("");
    setRate("");
    setSource("");
    setEditing(false);
  };
  const render = (entry: PriceBookEntry, old = false) => (
    <article className="flow-card" key={`${entry.code}:${entry.version}`}>
      <h3>
        {entry.name} · {entry.code} · v{entry.version}
        {old ? " · 이전 버전" : ""}
      </h3>
      <p>
        {entry.rate.toLocaleString("ko-KR")}원/{entry.unit} · 출처:{" "}
        {entry.source}
      </p>
      {entry.unit !== state.object.unit && (
        <p>현재 객체 단위 {state.object.unit}와 다릅니다.</p>
      )}
      <div className="flow-actions">
        <button
          disabled={locked}
          onClick={() => {
            setCode(entry.code);
            setName(entry.name);
            setUnit(entry.unit);
            setRate(String(entry.rate));
            setSource(entry.source);
            setEditing(true);
          }}
        >
          수정본 작성
        </button>
        <button
          disabled={
            locked ||
            !["draft", "changes"].includes(state.phase) ||
            entry.unit !== state.object.unit ||
            (state.object.rateSource?.code === entry.code &&
              state.object.rateSource.version === entry.version)
          }
          onClick={() =>
            dispatch({
              type: "rate",
              rate: entry.rate,
              unit: entry.unit,
              reference: { code: entry.code, version: entry.version },
            })
          }
        >
          이 버전 단가 적용
        </button>
      </div>
    </article>
  );
  return (
    <section aria-label="단가표 버전 관리">
      <WorkflowPriceBookImport
        draft={state.pricebookDraft}
        onDraft={patch=>dispatch({type:'pricebook-draft',patch})}
        entries={entries}
        locked={locked}
        onImport={(csv) => dispatch({ type: "pricebook-import", csv })}
      />
      <p>
        이 시나리오·탭에서 보관하는 단가표입니다. 실제 회사 데이터베이스나 시장
        가격이 아닙니다. 수정은 새 버전으로 남기며, 적용한 단가는 자동 갱신하지
        않습니다.
      </p>
      <p>
        {state.object.rateSource
          ? `현재 연결: ${state.object.rateSource.code} · v${state.object.rateSource.version}`
          : "현재 단가: 직접 입력·기본 예시"}{" "}
        · {state.object.rate.toLocaleString("ko-KR")}원/{state.object.unit} ·{" "}
        {state.object.id}
      </p>
      <label className="flow-input">
        단가표 검색
        <input
          aria-label="단가표 검색"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="코드·품목·출처"
        />
      </label>
      {!latest.length && (
        <p>등록한 단가가 없습니다. 아래에서 첫 항목을 등록하세요.</p>
      )}
      {!!latest.length && !visible.length && (
        <p role="status">검색 결과가 없습니다.</p>
      )}
      {visible.map((entry) => (
        <div key={entry.code}>
          {render(entry)}
          {entries.some(
            (old) => old.code === entry.code && old.version < entry.version,
          ) && (
            <details>
              <summary>이전 버전 · {entry.code}</summary>
              {entries
                .filter(
                  (old) =>
                    old.code === entry.code && old.version < entry.version,
                )
                .slice()
                .reverse()
                .map((old) => render(old, true))}
            </details>
          )}
        </div>
      ))}
      <h3>{editing ? "단가 수정본 등록" : "새 단가 등록"}</h3>
      <fieldset disabled={locked || entries.length >= 200}>
        <label className="flow-input">
          단가 코드
          <input
            aria-label="단가 코드"
            maxLength={40}
            value={code}
            disabled={editing}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        <label className="flow-input">
          단가 품목명
          <input
            aria-label="단가 품목명"
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="flow-input">
          단가 단위
          <select
            aria-label="단가 단위"
            value={unit}
            onChange={(event) =>
              setUnit(event.target.value as PriceBookEntry["unit"])
            }
          >
            {["m", "m²", "m³", "개"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="flow-input">
          단가 금액
          <input
            aria-label="단가 금액"
            type="number"
            min="0"
            max="1000000000"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
          />
        </label>
        <label className="flow-input">
          단가 출처
          <textarea
            aria-label="단가 출처"
            maxLength={500}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="단가표 이름·기준일·페이지 등"
          />
        </label>
        <p>
          같은 코드는 새 버전으로 저장합니다. 이 화면에서 파일
          가져오기·발주·견적 확정은 하지 않습니다.
        </p>
        <button
          disabled={!valid}
          onClick={() => {
            if (valid) {
              dispatch({ type: "pricebook-save", entry: input });
              reset();
            }
          }}
        >
          새 단가 버전 보관
        </button>
        {editing && <button onClick={reset}>수정 취소</button>}
      </fieldset>
      {entries.length >= 200 && (
        <p>
          로컬 단가 버전 보관 한도 200건에 도달했습니다. 이전 버전은 삭제하지
          않습니다.
        </p>
      )}
    </section>
  );
}
