import { useState } from "react";
import {
  phaseLabels,
  scenarioLabels,
  type Scenario,
  type Workflow,
} from "../lib/workflow-prototype";

export function WorkflowProjectsPage({
  scenarios,
  onOpen,
  onStart,
}: {
  scenarios: Partial<Record<Scenario, Workflow>>;
  onOpen: (scenario: Scenario) => void;
  onStart: () => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const all = Object.values(scenarios).filter((state): state is Workflow =>
    Boolean(state),
  );
  const filtered = all.filter(
    (state) =>
      (status === "all" || state.phase === status) &&
      `${state.project} ${state.document} ${state.object.name} ${scenarioLabels[state.scenario]}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const projects = [...new Set(filtered.map((state) => state.project))];
  return (
    <>
      <div className="flow-toolbar">
        <p>
          프로젝트 {new Set(all.map((state) => state.project)).size}개 · 작업
          묶음 {all.length}개 · 예시 자료
        </p>
        <button onClick={onStart}>프로젝트 시작</button>
      </div>
      <div className="flow-project-filters">
        <label className="flow-input">
          프로젝트·자료 검색
          <input
            aria-label="프로젝트·자료 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="프로젝트, 도면, 작업 종류"
          />
        </label>
        <label className="flow-input">
          작업 상태
          <select
            aria-label="프로젝트 작업 상태"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">모든 상태</option>
            {Object.entries(phaseLabels).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="flow-note">
        같은 프로젝트의 건축 도면과 3D 검토를 한 카드에 모았습니다.
        역할·개정·검토 상태는 각 작업 묶음에 보관됩니다.
      </p>
      {!projects.length ? (
        <section className="flow-card" role="status">
          <h2>일치하는 프로젝트가 없습니다</h2>
          <p>검색어나 상태 필터를 바꾸세요. 기존 작업은 삭제되지 않았습니다.</p>
          <button
            onClick={() => {
              setQuery("");
              setStatus("all");
            }}
          >
            검색·필터 초기화
          </button>
        </section>
      ) : (
        projects.map((project) => (
          <section
            className="flow-card flow-project-entry"
            data-project-card={project}
            key={project}
          >
            <header>
              <h2>{project}</h2>
              <span className="flow-badge">
                {filtered.filter((state) => state.project === project).length}개
                작업
              </span>
            </header>
            {filtered
              .filter((state) => state.project === project)
              .map((state) => (
                <article className="flow-project-work" key={state.scenario}>
                  <div>
                    <small>{scenarioLabels[state.scenario]}</small>
                    <h3>{state.document}</h3>
                    <p>
                      {state.object.location} · R{state.revision} ·{" "}
                      {phaseLabels[state.phase]}
                    </p>
                  </div>
                  <button
                    aria-label={`${scenarioLabels[state.scenario]} 열기`}
                    onClick={() => onOpen(state.scenario)}
                  >
                    {scenarioLabels[state.scenario]} 열기
                  </button>
                </article>
              ))}
          </section>
        ))
      )}
    </>
  );
}
