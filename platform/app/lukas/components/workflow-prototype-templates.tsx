import {WorkflowDraftShape} from "./workflow-draft-shape";
import { createWorkflowTemplateDocument, workflowDraftTemplates } from "../lib/workflow-blank-document";

export function WorkflowTemplateLibrary({
  onCreate,
  disabled,
  disabledReason='이 탭의 구상 작업은 최대 30개입니다.',
  selected, title, onDraft,
}: {
  onCreate: (title: string, templateId: string) => void;
  disabled: boolean;
  disabledReason?:string;
  selected: string;
  title: string;
  onDraft: (selected: string, title: string) => void;
}) {
  const template = workflowDraftTemplates.find(
    (template) => template.id === selected,
  );
  const preview=template?createWorkflowTemplateDocument(template.id,'template-preview',template.title):null;
  return (
    <section className="flow-card" aria-label="구상 템플릿 라이브러리">
      <h2>템플릿으로 새 작업 시작</h2>
      <p>
        1HK 화면용 구상 예시입니다. 실측 설계도·회사 표준·승인된 산출식이
        아니며, 선택할 때마다 별도 작업을 만듭니다.
      </p>
      <div className="flow-grid-two">
        {workflowDraftTemplates.map((item) => (
          <button
            className="flow-template-choice"
            key={item.id}
            aria-pressed={selected === item.id}
            onClick={() => onDraft(item.id,title)}
          >
            <strong>{item.title}</strong>
            <p>{item.description}</p>
            <span>{item.labels.length}개 구상 객체</span>
          </button>
        ))}
      </div>
      {!template&&<p role="alert">보관된 템플릿을 찾을 수 없습니다. 다른 템플릿을 선택하세요. 입력한 이름은 유지됩니다.</p>}
      {template&&preview&&<><section className="flow-card" aria-label="템플릿 구성 안내"><h3>{template.title} 구성</h3><p>{template.description}</p><ul>{template.labels.map(label=><li key={label}>{label}</li>)}</ul><p>{template.id==='civil'?'노선은 폴리라인 구상입니다. 측점·좌표·토공량은 포함하지 않습니다. 실제 노선 설계나 시공 지시로 사용하지 마세요.':'영역은 공간 관계를 설명하는 구상 객체이며 실제 벽체·실측 치수가 아닙니다.'}</p><p>기존 도면을 바꾸지 않고 독립된 새 작업을 만듭니다. 원본·수량·단가·승인은 복사되지 않습니다. 시작 후 PDF를 연결하고 검토 근거를 지정하세요.</p></section>
      <h3>{template.title} 미리보기</h3>
      <svg
        viewBox="0 0 800 520"
        className="flow-blank-canvas"
        role="img"
        aria-label={`${template.title} 템플릿 미리보기`}
      >
        {preview.shapes.map(shape=><WorkflowDraftShape key={shape.id} shape={shape} selected={false}/>)}
      </svg></>}
      <label className="flow-input">
        새 작업 이름
        <input
          aria-label="템플릿 작업 이름"
          maxLength={120}
          value={title}
          onChange={(event) => onDraft(selected,event.target.value)}
          placeholder={`예: ${template?.title??'새 작업'} 초안`}
        />
      </label>
      <button
        disabled={disabled || !template || !title.trim() || title.length>120}
        onClick={() => onCreate(title.trim(), selected)}
      >
        이 템플릿으로 작업 만들기
      </button>
      <button onClick={()=>onDraft('office','')}>시작 입력 초기화</button>
      <p>선택과 이름은 이 탭의 작업 보관에 포함됩니다. 작업을 만들면 시작 입력만 초기화됩니다.</p>
      {disabled && <p>{disabledReason}</p>}
    </section>
  );
}
