import type { ReactNode } from "react";
import {WorkflowMembers} from './workflow-members';
import {WorkflowPriceBook} from './workflow-pricebook';
import {WorkflowProjectsPage} from './workflow-prototype-projects';
import type {Scenario} from '../lib/workflow-prototype';
import { WorkflowPrototypeCanvas } from "./workflow-prototype-canvas";
import { WorkflowDeliveryPage } from "./workflow-prototype-delivery";
import {WorkflowFieldPage,WorkflowMaterialsPage} from './workflow-prototype-field';
import {WorkflowComparison} from './workflow-prototype-comparison';
import {
  ArrowUpRight,
  FileText,
  Layers3,
  Plus,
  Check,
  Clock3,
  ArrowRight,
  Box,
  MapPin,
} from "lucide-react";
import {
  phaseLabels,
  workflowFindings,
  type Workflow,
  type WorkflowAction,
  type WorkflowPage,
} from "../lib/workflow-prototype";

export type WorkflowPageProps = {
  scenarios?:Partial<Record<Scenario,Workflow>>;
  onOpenScenario?:(scenario:Scenario)=>void;
  page: WorkflowPage;
  state: Workflow;
  go: (page: WorkflowPage) => void;
  open: (panel: string, draft?:string) => void;
  dispatch: (action: WorkflowAction) => void;
};
const money = (value: number) => new Intl.NumberFormat("ko-KR").format(value);
export function FlowCard({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="flow-card">
      <header>
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}
export function WorkflowPrototypePage({
  scenarios,
  onOpenScenario,
  page,
  state: s,
  go,
  open,
  dispatch,
}: WorkflowPageProps) {
  if (page === "workspace")
    return (
      <WorkflowPrototypeCanvas
        state={s}
        open={open}
        go={go}
        dispatch={dispatch}
      />
    );
  const o = s.object,
    current = s.quantityStatus === "current",
    findings = workflowFindings(s);
  const source = (
    <button className="flow-source" onClick={() => go("workspace")}>
      <FileText size={16} />
      {o.id} · {o.location}
      <ArrowUpRight size={14} />
    </button>
  );
  const goto = (p: WorkflowPage, label: string) => (
    <button onClick={() => go(p)}>
      {label}
      <ArrowRight size={15} />
    </button>
  );
  const stats = (
    <div className="flow-stats">
      {[
        ["검토 대상", o.id],
        ["개정", `R${s.revision}`],
        ["수량", current ? `${o.quantity} ${o.unit}` : "확인 필요"],
        ["상태", phaseLabels[s.phase]],
      ].map(([label, value]) => (
        <div key={label}>
          <small>{label}</small>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
  if (page === "home")
    return (
      <>
        <div className="flow-welcome">
          <span className="flow-eyebrow">YOUR NEXT PROJECT STARTS HERE</span>
          <h2>
            근거가 이어지는
            <br />첫 작업을 시작하세요.
          </h2>
          <p>도면을 올리거나, 빈 작업실에서 시작해 필요한 자료를 연결하세요.</p>
          <button className="flow-primary" onClick={() => go("start")}>
            새 작업 시작
            <Plus size={16} />
          </button>
        </div>
        <div className="flow-grid-three">
          {[
            ["빈 작업실", "자료 없이 계획하고 필요한 시점에 연결"],
            ["템플릿으로 시작", "회사 표준 공종과 산출 구조 재사용"],
            ["원본 자료에서 시작", "PDF · IFC · DWG 도면 준비"],
          ].map(([title, text]) => (
            <FlowCard key={title} title={title}>
              <p>{text}</p>
              {goto(
                title === "템플릿으로 시작" ? "library" : "start",
                "시작하기",
              )}
            </FlowCard>
          ))}
        </div>
      </>
    );
  if (page === "projects")
    return <WorkflowProjectsPage scenarios={scenarios??{[s.scenario]:s}} onOpen={onOpenScenario??(()=>go('overview'))} onStart={()=>go('start')}/>;
  if (page === "overview")
    return (
      <>
        {stats}
        <div className="flow-grid-two">
          <FlowCard title="이어서 작업" action={goto("documents", "전체 자료")}>
            <div className="flow-feature">
              <FileText size={32} />
              <div>
                <h3>{s.document}</h3>
                <p>
                  {o.location} · {o.name}
                </p>
              </div>
            </div>
            {goto("workspace", "작업실 열기")}
          </FlowCard>
          <FlowCard title="확인할 항목">
            <FindingList state={s} open={open} />
          </FlowCard>
          <FlowCard title="적산 진행">
            <p>
              {current
                ? "현재 개정의 산출 예시가 준비됐습니다."
                : "객체 근거를 확인하고 산출 결과를 준비하세요."}
            </p>
            {goto("quantities", "수량 산출서")}
          </FlowCard>
          <FlowCard title="최근 변경">
            <History state={s} />
          </FlowCard>
        </div>
      </>
    );
  if (page === "tasks" || page === "issues")
    return (
      <>
        <div className="flow-toolbar">
          <p>
            {page === "tasks"
              ? "역할에 따라 처리할 작업을 확인합니다."
              : "도면 위치와 연결된 문제를 모아 봅니다."}
          </p>
          <span className="flow-badge">{findings.length}건</span>
        </div>
        <FlowCard title={page === "tasks" ? "현재 확인할 작업" : "열린 이슈"}>
          <FindingList state={s} open={open} />
        </FlowCard>
        <FlowCard title="검토 요청">
          {s.request ? (
            <>
              <h3>{s.request.message}</h3>
              <p>
                R{s.request.revision} · {phaseLabels[s.phase]}
              </p>
              {source}
              {goto("reviews", "요청 확인")}
            </>
          ) : (
            <p>
              아직 제출한 검토 요청이 없습니다. 작업실에서 수량을 확인한 뒤
              요청하세요.
            </p>
          )}
        </FlowCard>
      </>
    );
  if (page === "documents")
    return (
      <>
        <div className="flow-toolbar">
          <p>원본과 작업 개정을 구분해 관리합니다.</p>
          {goto("start", "자료 준비")}
        </div>
        <FlowCard title="프로젝트 자료">
          <div className="flow-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>자료 이름</th>
                  <th>원본 ID</th>
                  <th>작업 개정</th>
                  <th>상태</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <FileText size={16} />
                    {s.document}
                  </td>
                  <td>{o.sourceId}</td>
                  <td>R{s.revision}</td>
                  <td>시나리오 자료</td>
                  <td>{goto("workspace", "열기")}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <button onClick={() => open("compatibility")}>
            원본 형식·호환성 확인
          </button>
        </FlowCard>
      </>
    );
  if (page === "start")
    return (
      <>
        <div className="flow-steps">
          <b>01 자료 준비</b>
          <span>02 단위·축척</span>
          <span>03 작업실</span>
        </div>
        <FlowCard title="작업을 어떤 자료로 시작할까요?">
          <p>
            실제 업로드·변환은 수행하지 않습니다. 현재 선택한 시나리오 자료로
            흐름을 확인합니다.
          </p>
          <div className="flow-grid-three">
            {["PDF 도면", "IFC 모델", "DWG 도면"].map((t) => (
              <button
                className="flow-file-choice"
                key={t}
                onClick={() => open("compatibility")}
              >
                <FileText />
                {t}
                <small>처리·호환성 화면 확인</small>
              </button>
            ))}
          </div>
        </FlowCard>
        <FlowCard title="준비된 시나리오">
          <h3>{s.document}</h3>
          <p>
            {o.location} · 원본 {o.sourceId}
          </p>
          <div className="flow-actions">
            <button onClick={() => open("scale")}>단위·축척 확인</button>
            {goto("workspace", "이 자료로 작업실 열기")}
          </div>
        </FlowCard>
      </>
    );
  if (page === "quantities" || page === "estimate")
    return (
      <>
        {stats}
        <FlowCard
          title={
            page === "quantities" ? "근거가 연결된 산출 항목" : "공종별 내역"
          }
          action={
            <button
              onClick={() => open(page === "quantities" ? "formula" : "rate")}
            >
              {page === "quantities" ? "산출 근거 확인" : "단가 자료 연결"}
            </button>
          }
        >
          <div className="flow-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>항목·근거</th>
                  <th>규격 / 위치</th>
                  <th>단위</th>
                  <th>수량</th>
                  <th>{page === "quantities" ? "산출 상태" : "단가"}</th>
                  <th>{page === "quantities" ? "원본" : "금액"}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <b>{o.name}</b>
                    {source}
                  </td>
                  <td>{o.location}</td>
                  <td>{o.unit}</td>
                  <td>{current ? o.quantity : "미산출"}</td>
                  <td>
                    {page === "quantities"
                      ? current
                        ? "확인된 예시"
                        : "재확인 필요"
                      : money(o.rate)}
                  </td>
                  <td>
                    {page === "quantities"
                      ? o.sourceId
                      : current
                        ? `${money(o.quantity * o.rate)}원`
                        : "미산출"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="flow-note">
            시나리오 수량·단가입니다. 실제 도면 측정·견적 결과가 아닙니다.
          </p>
          <div className="flow-actions">
            {goto(
              page === "quantities" ? "estimate" : "quantities",
              page === "quantities" ? "내역서 확인" : "산출서 확인",
            )}
            <button onClick={() => open("request")}>이 개정 검토 요청</button>
          </div>
        </FlowCard>
      </>
    );
  if (page === "rates")
    return (
      <>
        <FlowCard
          title="회사 단가 자료"
          action={<button onClick={() => open("rate")}>가져오기·연결</button>}
        >
          <WorkflowPriceBook key={s.scenario} state={s} dispatch={dispatch} />
          <details><summary>현재 객체 단가 요약</summary>
          <div className="flow-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>품목</th>
                  <th>단위</th>
                  <th>예시 단가</th>
                  <th>연결</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{o.name}</td>
                  <td>{o.unit}</td>
                  <td>{money(o.rate)}원</td>
                  <td>{source}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="flow-note">
            시장 가격이나 확정 견적이 아닙니다.
          </p>
          </details>
        </FlowCard>
      </>
    );
  if (page === "changes")
    return (
      <>
        <FlowCard
          title={`변경 건 CH-01 · ${o.name}`}
          action={<button onClick={() => open("compare")}>전후 비교</button>}
        >
          <WorkflowComparison state={s}/>
          {source}
          <p>
            {s.quantityStatus === "stale"
              ? "객체가 변경되어 산출 결과를 다시 확인해야 합니다."
              : "현재 연결된 근거를 기준으로 확인합니다."}
          </p>
        </FlowCard>
        <FlowCard title="변경·검토 이력">
          <History state={s} />
        </FlowCard>
      </>
    );
  if (page === "reviews")
    return (
      <>
        <FlowCard
          title="검토 요청 묶음"
          action={<span className="flow-badge">{phaseLabels[s.phase]}</span>}
        >
          {s.request ? (
            <>
              <h3>{s.request.message}</h3>
              <p>
                요청 개정 R{s.request.revision} · 객체 {s.request.objectId}
              </p>
              {source}
              <div className="flow-actions">
                <button onClick={() => open("review")}>대상 확인·의견</button>
                <button onClick={() => open("approval")}>승인 상태 확인</button>
              </div>
            </>
          ) : (
            <>
              <p>
                아직 검토 요청이 없습니다. 원본과 수량 근거를 준비해 요청하세요.
              </p>
              <button onClick={() => open("request")}>요청 작성</button>
            </>
          )}
        </FlowCard>
        <FlowCard title="결정 이력">
          <History state={s} />
        </FlowCard>
      </>
    );
  if (page === "delivery")
    return <WorkflowDeliveryPage key={`${s.scenario}:${JSON.stringify(s.deliveryPackage??null)}`} state={s} dispatch={dispatch}/>;
  if (page === "library")
    return (
      <>
        <p>반복 작업에 필요한 도형과 산출 구성을 재사용합니다.</p>
        <div className="flow-grid-three">
          {[
            ["바닥 마감", "면적 · 마감 품목 · 산출식"],
            ["벽체 검토", "모델 속성 · 물량 근거 · 검토 항목"],
            ["배수관 구간", "노선·측점 · 길이 · 자재 규격"],
          ].map(([title, text]) => (
            <FlowCard key={title} title={title}>
              <Layers3 size={30} />
              <p>{text}</p>
              <button onClick={() => open("properties")}>구성 미리보기</button>
            </FlowCard>
          ))}
        </div>
      </>
    );
  if (page === "settings")
    return (
      <div className="flow-grid-two">
        <FlowCard
          title="프로젝트 구성원"
          action={<button onClick={() => open("share")}>초대</button>}
        >
          <WorkflowMembers key={s.scenario} state={s} dispatch={dispatch} />
        </FlowCard>
        <FlowCard title="프로젝트 기준">
          <dl>
            <dt>위치 체계</dt>
            <dd>
              {s.scenario === "civil"
                ? "노선 / 공구 / 측점 / 구조물"
                : "동 / 층 / 실 / 부재"}
            </dd>
            <dt>원본 보존</dt>
            <dd>작업본은 별도 개정</dd>
            <dt>데이터 범위</dt>
            <dd>프론트엔드 시나리오 · 서버 미저장</dd>
          </dl>
        </FlowCard>
      </div>
    );
  if (page === "field")
    return <WorkflowFieldPage key={s.scenario} state={s} dispatch={dispatch} go={go} open={open}/>;
  if (page === "materials")
    return <WorkflowMaterialsPage key={`${s.scenario}:${JSON.stringify(s.materials ?? null)}`} state={s} dispatch={dispatch} go={go}/>;
  return (
    <FlowCard title="도면 작업실">
      <div className="flow-feature">
        <Box size={40} />
        <div>
          <h3>{s.document}</h3>
          <p>
            {o.name} · {o.location}
          </p>
        </div>
      </div>
      <p>
        도면과 모델 캔버스 연결 작업 중입니다. 기존 PDF 작성 화면도 유지됩니다.
      </p>
      <div className="flow-actions">
        {["properties", "model", "formula", "compare", "findings"].map(
          (p, i) => (
            <button key={p} onClick={() => open(p)}>
              {
                [
                  "객체 속성",
                  "3D 보기",
                  "적산 근거",
                  "변경 비교",
                  "확인할 항목",
                ][i]
              }
            </button>
          ),
        )}
      </div>
      {stats}
    </FlowCard>
  );
}
export function FindingList({
  state,
  open,
}: {
  state: Workflow;
  open: (panel: string) => void;
}) {
  const items = workflowFindings(state);
  return items.length ? (
    <ul className="flow-findings">
      {items.map((f) => (
        <li key={f.id}>
          <button onClick={() => open(f.panel)}>
            <span>
              <strong>{f.title}</strong>
              <small>{f.detail}</small>
            </span>
            <ArrowUpRight size={17} />
          </button>
        </li>
      ))}
    </ul>
  ) : (
    <p className="flow-note">
      현재 시나리오 규칙에서 확인할 항목이 없습니다. 전체 도면의 검사 완료를
      뜻하지 않습니다.
    </p>
  );
}
export function History({ state }: { state: Workflow }) {
  return state.history.length ? (
    <ol className="flow-history">
      {state.history.map((h, i) => (
        <li key={i}>
          <span>R{h.revision}</span>
          {h.label}
        </li>
      ))}
    </ol>
  ) : (
    <p className="flow-note">
      아직 기록된 변경이 없습니다. 작성·검토 체험 후 이곳에 표시됩니다.
    </p>
  );
}
