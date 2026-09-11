import { workflowPages, type WorkflowPage } from "../lib/workflow-prototype";

const sections: { label: string; pages: WorkflowPage[] }[] = [
  { label: "개요", pages: ["overview"] },
  { label: "도면/모델", pages: ["documents", "start", "workspace", "presentation"] },
  { label: "물량/내역", pages: ["quantities", "estimate", "budget", "payments", "rates"] },
  { label: "검토", pages: ["issues", "reviews", "submittals", "changes"] },
  { label: "현장", pages: ["field", "daily", "schedule", "materials", "carbon"] },
  { label: "납품", pages: ["delivery", "transmittals", "handover"] },
];
type Props = { page: WorkflowPage; go: (page: WorkflowPage) => void };
const labelFor = (page: WorkflowPage) =>
  workflowPages.find(([id]) => id === page)?.[1];

export function WorkflowNavigation({ page, go }: Props) {
  const links = (pages: WorkflowPage[]) =>
    pages.map((id) => (
      <button
        key={id}
        data-page={id}
        aria-current={page === id || (id==='library'&&page==='standards') ? "page" : undefined}
        onClick={() => go(id)}
      >
        {labelFor(id)}
      </button>
    ));
  return (
    <nav aria-label="작업 영역">
      <div className="flow-nav-group">
        <small>내 작업공간</small>
        {links(["home", "projects", "tasks"])}
      </div>
      <div className="flow-nav-group">
        <small>현재 프로젝트</small>
        {sections.map((section) => (
          <button
            key={section.label}
            data-project-section={section.label}
            data-page={section.pages[0]}
            aria-current={section.pages.includes(page) ? "true" : undefined}
            onClick={() =>
              go(section.pages[0])
            }
          >
            {section.label}
          </button>
        ))}
      </div>
      <div className="flow-nav-group">
        <small>공통 관리</small>
        {links(["library", "settings"])}
      </div>
    </nav>
  );
}

export function WorkflowContextNavigation({ page, go }: Props) {
  const section = sections.find((section) => section.pages.includes(page))??(['library','standards'].includes(page)?{label:'라이브러리',pages:['library','standards'] as WorkflowPage[]}:undefined);
  if (!section || section.pages.length < 2) return null;
  return (
    <nav className="flow-context-nav" aria-label={`${section.label} 세부 화면`}>
      {section.pages.map((id) => (
        <button
          key={id}
          data-page={id}
          aria-current={page === id ? "page" : undefined}
          onClick={() => go(id)}
        >
          {labelFor(id)}
        </button>
      ))}
    </nav>
  );
}
