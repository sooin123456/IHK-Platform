import { useEffect, useState } from "react";
import {WorkflowLocalProjects} from "../components/workflow-local-projects";
import {WorkflowProjectMembers} from '../components/workflow-project-members';
import {projectsSchema,type LocalProject} from "../lib/workflow-projects";
import {WorkflowOrganization} from '../components/workflow-organization';
import {WorkflowLocalField} from '../components/workflow-local-field';
import {WorkflowDailyReports} from '../components/workflow-daily-reports';
import {WorkflowPayments} from '../components/workflow-payments';
import {WorkflowHandover} from '../components/workflow-handover';
import {WorkflowCarbon} from '../components/workflow-carbon';
import {WorkflowPropertyStandards,PropertyValues} from '../components/workflow-property-standards';
import type {PropertyStandard} from '../lib/workflow-property-standards';
import {WorkflowLocalMaterials} from '../components/workflow-local-materials';
import {WorkflowLocalOverview} from '../components/workflow-local-overview';
import {WorkflowRecords,WorkflowReviewRecord} from '../components/workflow-records';
import {WorkflowCommentInbox} from '../components/workflow-object-comments';
import {WorkflowRfiInbox} from '../components/workflow-local-rfi';
import {WorkflowImportManifest} from '../components/workflow-import-manifest';
import {WorkflowLocalDocuments} from '../components/workflow-local-documents';
import {WorkflowLocalShareGuest} from '../components/workflow-local-share';
import {WorkflowShareInbox} from '../components/workflow-share-inbox';
import {appendImportRecords,documentFromImport,type ImportRecord} from '../lib/workflow-import-manifest';
import {deliveryQuantityReview} from '../lib/workflow-document-delivery';
import {
  WorkflowBlankStart,
  WorkflowBlankWorkspace,
} from "../components/workflow-prototype-blank";
import {
  createWorkflowTemplateDocument,
  type WorkflowBlankDocument,
} from "../lib/workflow-blank-document";
import { WorkflowTemplateLibrary } from "../components/workflow-prototype-templates";
import {WorkflowSavedTemplates} from '../components/workflow-saved-templates';
import type {SavedDrawingTemplate} from '../lib/workflow-saved-templates';
import {WorkflowSchedule} from '../components/workflow-schedule';
import {WorkflowSubmittals} from '../components/workflow-submittals';
import {WorkflowSubmittalQueue} from '../components/workflow-submittal-queue';
import {WorkflowTransmittals} from '../components/workflow-transmittals';
import {WorkflowBudget} from '../components/workflow-budget';
import {WorkflowPresentation} from '../components/workflow-presentation';
import { WorkflowDocumentInbox } from "../components/workflow-document-inbox";
import { WorkflowQuantityInbox } from '../components/workflow-quantity-inbox';
import { WorkflowDocumentDeliveries } from "../components/workflow-document-delivery";
import {WorkflowDistributionBatch} from '../components/workflow-distribution-batch';
import { WorkflowDocumentRecipient } from "../components/workflow-document-recipient";
import { WorkflowCommandSearch } from "../components/workflow-command-search";
import { WorkflowDocumentQuantities } from "../components/workflow-document-quantity";
import {WorkflowBoqGroups} from '../components/workflow-boq-groups';
import {WorkflowQuantityReviews} from '../components/workflow-quantity-review';
import {WorkflowQuantityComparison} from '../components/workflow-quantity-comparison';
import {WorkflowDrawingComparison} from '../components/workflow-drawing-comparison';
import type { DocumentReviewRole } from "../lib/workflow-document-review";
import { WorkflowSharePanel } from "../components/workflow-prototype-share";
import { WorkflowModelPanel } from "../components/workflow-prototype-model";
import { WorkflowScalePanel } from "../components/workflow-prototype-scale";
import { WorkflowComparison } from "../components/workflow-prototype-comparison";
import { useSearchParams, Link } from "react-router";
import {
  ArrowLeft,
  ChevronRight,
  Layers3,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/core/components/ui/dialog";
import {
  createWorkflow,
  reduceWorkflow,
  workflowExceptionAllows,
  workflowPages,
  workflowPanels,
  workflowExceptions,
  scenarioLabels,
  roleLabels,
  phaseLabels,
  type Scenario,
  type DemoRole,
  type WorkflowPage,
  type WorkflowAction,
} from "../lib/workflow-prototype";
import {
  WorkflowPrototypePage,
  FindingList,
} from "../components/workflow-prototype-pages";
import "../components/workflow-prototype.css";
import { WorkflowReviewContext } from "../components/workflow-prototype-review-context";
import { WorkflowRatePanel } from "../components/workflow-prototype-rate";
import { WorkflowImportPanel } from "../components/workflow-prototype-import";
import { WorkflowException } from "../components/workflow-prototype-exception";
import { WorkflowAssistantPanel } from "../components/workflow-prototype-assistant";
import { WorkflowPropertiesPanel } from "../components/workflow-prototype-properties";
import { WorkflowFormulaPanel } from "../components/workflow-prototype-formula";
import { WorkflowApprovalPanel } from "../components/workflow-prototype-approval";
import {WorkflowBackup} from '../components/workflow-backup';
import {
  workflowSessionKey,
  decodeWorkflowSession,
  encodeWorkflowSession,
} from "../lib/workflow-prototype-session";
import {
  WorkflowNavigation,
  WorkflowContextNavigation,
} from "../components/workflow-prototype-navigation";

export function loader({ request }: { request: Request }) {
  const host = new URL(request.url).hostname;
  if (
    process.env.NODE_ENV !== "development" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(host)
  )
    throw new Response("Not Found", { status: 404 });
  return null;
}
export default function WorkflowPrototype() {
  const [params, setParams] = useSearchParams();
  const drawingContext=Object.fromEntries(['drawingRevision','drawingTarget','drawingPage','drawingObject','drawingSame'].filter(key=>params.has(key)).map(key=>[key,params.get(key)!]));
  const rfiContext=Object.fromEntries(['rfiRole','rfiSearch','rfiPhase','rfiAssignee','rfiDocument'].filter(key=>params.has(key)).map(key=>[key,params.get(key)!]));
  const submissionContext=Object.fromEntries(['submissionItem','submissionQueueReturn','submissionQueueRole','submissionActor'].filter(key=>params.has(key)).map(key=>[key,params.get(key)!]));
  const scenario: Scenario = ["architecture", "ifc", "civil"].includes(
    params.get("scenario") ?? "",
  )
    ? (params.get("scenario") as Scenario)
    : "architecture";
  const [scenarios, setScenarios] = useState(() => ({
    architecture: createWorkflow("architecture"),
    ifc: createWorkflow("ifc"),
    civil: createWorkflow("civil"),
  }));
  const [panel, setPanel] = useState<string | null>(null);
  const [importRecords,setImportRecords]=useState<ImportRecord[]>([]);
  const [savedTemplates,setSavedTemplates]=useState<SavedDrawingTemplate[]>([]);
  const [propertyStandards,setPropertyStandards]=useState<PropertyStandard[]>([]);
  const [projects,setProjects]=useState<LocalProject[]>([]);
  const [blankDocuments, setBlankDocuments] = useState<WorkflowBlankDocument[]>(
    [],
  );
  const page: WorkflowPage = workflowPages.some(([id])=>id===params.get('page'))
    ?params.get('page') as WorkflowPage
    :projects.length||blankDocuments.length||params.get('scope')==='sample'||params.has('scenario')?'projects':'home';
  const documentKeys:Partial<Record<WorkflowPage,string>>={workspace:'blank',field:'fieldDocument',daily:'dailyDocument',materials:'materialDocument',delivery:'deliveryDocument',quantities:'quantityDocument',estimate:'quantityDocument',changes:'quantityDocument',payments:'paymentDocument',handover:'handoverDocument',budget:'budgetDocument',carbon:'carbonDocument',submittals:'submissionDocument',schedule:'scheduleDocument',standards:'standardDocument'};
  const documentContextId=params.get(documentKeys[page]??'contextDocument')??params.get('contextDocument');
  const projectContextId=params.get('project')??blankDocuments.find(document=>document.id===documentContextId)?.projectId;
  const selectedProject=projects.find(project=>project.id===projectContextId);
  const projectDocuments=projectContextId?blankDocuments.filter(document=>document.projectId===selectedProject?.id&&Boolean(selectedProject)):blankDocuments;
  const boqContext={...(params.has('boqQuery')?{boqQuery:params.get('boqQuery')!}:{}),...(params.has('boqGroup')?{boqGroup:params.get('boqGroup')!}:{})};
  const blankId = page === "workspace" ? params.get("blank") : null;
  const scopedPage = [
    "documents",
    "workspace",
    "quantities",
    "estimate",
    "tasks",
    "reviews",
    "delivery",
    "changes",
    "field",
    "materials",
    "overview",
    "issues",
  ].includes(page);
  const scope = blankId
    ? "local"
    : params.get("scope") === "local" || params.get("scope") === "sample"
      ? params.get("scope")!
      : params.has("scenario") || page === "workspace"
        ? "sample"
        : "local";
  const localScope = scopedPage && scope === "local";
  const comparisonDocument=params.has('quantityDocument')?projectDocuments.find(document=>document.id===params.get('quantityDocument')):projectDocuments[0];
  const blankDocument = projectDocuments.find(
    (document) => document.id === blankId,
  );
  const blankSnapshot = blankDocument?.reviewRounds?.find(
    (round) =>
      round.phase === "approved" &&
      round.revision === Number(params.get("snapshot")),
  );
  const materialEvidence=blankDocument&&blankSnapshot&&deliveryQuantityReview(blankDocument,blankSnapshot.revision,Number(params.get('materialSequence')));
  const invalidMaterialTarget=params.has('materialReturn')&&(!materialEvidence||params.get('materialReturn')!==blankId||params.get('materialObject')!==params.get('target')||!materialEvidence.items.some(item=>item.id===params.get('target')));
  const globalPage =
    (page==='settings'&&scope==='local')||
    ["home", "projects", "start", "library", "schedule", "submittals", "transmittals", "budget", "presentation", "daily", "payments", "handover", "carbon", "standards"].includes(page) ||
    Boolean(blankId) ||
    localScope;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [storageReady, setStorageReady] = useState(false);
  const [storageStatus, setStorageStatus] = useState<
    "loading" | "saved" | "memory" | "invalid"
  >("loading");
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(workflowSessionKey);
      if (raw) {
        const restored = decodeWorkflowSession(raw);
        if (!restored) {
          setStorageStatus("invalid");
          return;
        }
        setScenarios(restored.scenarios);
        setDrafts(restored.drafts);
        setBlankDocuments(restored.blankDocuments ?? []);
        setImportRecords(restored.importRecords??[]);
        setSavedTemplates(restored.savedTemplates??[]);
        setPropertyStandards(restored.propertyStandards??[]);
        setProjects(restored.projects??[]);
      }
      setStorageReady(true);
    } catch {
      setStorageStatus("memory");
      setStorageReady(true);
    }
  }, []);
  useEffect(() => {
    if (!storageReady) return;
    try {
      sessionStorage.setItem(
        workflowSessionKey,
        encodeWorkflowSession({ scenarios, drafts, blankDocuments,importRecords,savedTemplates,propertyStandards,projects }),
      );
      setStorageStatus("saved");
    } catch {
      setStorageStatus("memory");
    }
  }, [scenarios, drafts, blankDocuments,importRecords,savedTemplates,propertyStandards,projects, storageReady]);
  const [demoOpen, setDemoOpen] = useState(false),
    [exception, setException] = useState("");
  const state =
    exception === "permission"
      ? { ...scenarios[scenario], role: "viewer" as const }
      : scenarios[scenario];
  const object = state.object;
  const draftKey = `${scenario}:${panel ?? "none"}:${state.revision}`;
  const message =
    drafts[draftKey] ??
    (panel === "request"
      ? "변경된 위치와 연결 수량을 확인해 주세요."
      : panel === "findings" && state.aiDecision?.revision === state.revision
        ? state.aiDecision.reason
        : "");
  const setMessage = (value: string) =>
    setDrafts((values) => ({ ...values, [draftKey]: value }));
  const [notice, setNotice] = useState("");
  const go = (next: WorkflowPage) => {
    if(next==='workspace'&&scope==='local')next='documents';
    const currentKey=documentKeys[page];
    const documentId=(currentKey?params.get(currentKey):null)??params.get('contextDocument');
    const context=scope==='local'&&documentId?{contextDocument:documentId,...(documentKeys[next]?{[documentKeys[next]!]:documentId}:{})}:{};
    const projectId=blankDocuments.find(doc=>doc.id===documentId)?.projectId??selectedProject?.id;
    setParams({ scenario, page: next, scope, ...context, ...(projectId?{project:projectId}:{}) });
    setPanel(null);
    setNotice("");
  };
  const creationBlockedReason=!storageReady?'탭 자료 복원이 끝난 뒤 작업을 만들 수 있습니다.':selectedProject?.archived?'보관한 프로젝트를 복원한 뒤 새 도면을 추가하세요.':params.has('project')&&!selectedProject?'도면을 보관할 프로젝트를 다시 선택하세요.':blankDocuments.length>=30?'이 탭의 작업 도면은 최대 30개입니다.':undefined;
  const createBlank = (title: string, templateId?: string) => {
    if (!storageReady || ((params.has("project")&&!selectedProject)||selectedProject?.archived) || !title.trim() || title.length > 120 || blankDocuments.length >= 30)
      return;
    const id = crypto.randomUUID();
    const document = templateId
      ? createWorkflowTemplateDocument(templateId, id, title)
      : { id, title: title.trim(), shapes: [] };
    if (!document) return;
    setBlankDocuments((documents) => [...documents, {...document,...(selectedProject?{projectId:selectedProject.id}:{})}]);
    if(templateId)setDrafts(values=>{const next={...values};delete next['template:selected'];delete next['template:title'];return next;});
    setParams({ page: "workspace", blank: id });
    setPanel(null);
  };
  const dispatch = (action: WorkflowAction) => {
    if (!workflowExceptionAllows(exception, action)) {
      setNotice(
        "현재 예외 상태에서는 이 작업을 진행할 수 없습니다. 복구 안내를 먼저 확인하세요.",
      );
      return;
    }
    setScenarios((values) => ({
      ...values,
      [scenario]: reduceWorkflow(values[scenario], action),
    }));
  };
  const open = (id: string, draft?: string) => {
    setPanel(id);
    setNotice("");
    if (draft !== undefined)
      setDrafts((values) => ({
        ...values,
        [`${scenario}:${id}:${state.revision}`]: draft.slice(0, 500),
      }));
  };
  const title = localScope&&page==='overview'&&params.has('recordReviewDocument')?'검토 기록':workflowPages.find(([id]) => id === page)?.[1] ?? "";
  const run = (action: WorkflowAction) => {
    if (!workflowExceptionAllows(exception, action)) {
      dispatch(action);
      return;
    }
    const next = reduceWorkflow(state, action);
    if (next === state) {
      setNotice(
        "현재 역할·산출 상태에서는 진행할 수 없습니다. 필요한 작업을 먼저 확인하세요.",
      );
      return;
    }
    dispatch(action);
    setNotice(
      "시나리오 상태가 변경됐습니다. 실제 서버 작업은 수행하지 않았습니다.",
    );
  };
  if(params.has('sharedDocument'))return <WorkflowLocalShareGuest key={`${params.get('sharedDocument')}:${params.get('share')}`} document={blankDocuments.find(document=>document.id===params.get('sharedDocument'))} sequence={params.get('share')} loading={storageStatus==='loading'} onChange={updated=>setBlankDocuments(documents=>documents.map(document=>document.id===updated.id?updated:document))} onBack={()=>{if(params.has('shareRequestsReturn')){setParams({page:'tasks',scope:'local',shareRequestSearch:params.get('shareRequestSearch')??'',shareRequestRole:params.get('shareRequestRole')??'author'});return;}const id=params.get('sharedDocument')!;setParams(blankDocuments.some(document=>document.id===id)?{page:'workspace',blank:id}:{page:'documents',scope:'local'});}}/>;
  if (params.has("recipientDocument"))
    return (
      <WorkflowDocumentRecipient
        key={`${params.get("recipientDocument")}:${params.get("package")}`}
        document={blankDocuments.find(
          (document) => document.id === params.get("recipientDocument"),
        )}
        sequence={params.get("package")}
        loading={storageStatus === "loading"}
        onChange={(updated) =>
          setBlankDocuments((documents) =>
            documents.map((document) =>
              document.id === updated.id ? updated : document,
            ),
          )
        }
        onBack={() => {
          if(params.get('transmittalReturn')==='1'){setParams({page:'transmittals',scope:'local',...(params.has('project')?{project:params.get('project')!}:{}),transmittalSearch:params.get('transmittalSearch')??'',transmittalStatus:params.get('transmittalStatus')??'all'});setPanel(null);return;}
          setParams({ page: "delivery", scope: "local" });
          setPanel(null);
        }}
      />
    );
  return (
    <div className={`flow-app${page==='workspace'?' flow-workspace-page':''}`}>
      <aside className="flow-sidebar">
        <Link to="/workspace-preview" className="flow-brand">
          1HK<span>WORKSPACE</span>
        </Link>
        <div className="flow-org">
          <span className="flow-avatar">H</span>
          <div>
            <b>한결 프로젝트 팀</b>
            <small>프론트엔드 시나리오</small>
          </div>
        </div>
        <WorkflowNavigation page={page} go={go} />
        <button
          className="flow-demo-trigger"
          onClick={() => setDemoOpen((v) => !v)}
        >
          <SlidersHorizontal size={16} />
          데모 시나리오
        </button>
      </aside>
      <main className="flow-main">
        <header className="flow-top">
          <WorkflowCommandSearch
            documents={blankDocuments}
            onGo={go}
            onOpen={(id) => {
              setParams({ page: "workspace", blank: id });
              setPanel(null);
            }}
          />
          <span>
            {globalPage ? "내 작업공간" : state.project}
            <ChevronRight size={14} />
            <b>{title}</b>
          </span>
          <span className="flow-badge" role="status">
            {storageStatus === "saved"
              ? "탭에 보관됨 · 서버 미저장"
              : storageStatus === "loading"
                ? "탭 자료 복원 중"
                : storageStatus === "invalid"
                  ? "기존 탭 자료 확인 필요"
                  : "현재 화면에만 유지 · 저장 불가"}
          </span>
        </header>
        {storageStatus === "invalid" && (
          <section className="flow-exception" role="alert">
            <strong>이전 예시 자료를 복원하지 못했습니다.</strong>
            <p>
              형식이 다르거나 손상된 자료를 자동으로 덮어쓰지 않습니다. 아래
              버튼은 이 프리뷰의 탭 저장 자료만 현재 화면 상태로 교체합니다.
            </p>
            <button onClick={() => setStorageReady(true)}>
              기존 예시 대신 현재 화면 보관
            </button>
          </section>
        )}
        {storageStatus === "memory" && (
          <section className="flow-exception" role="alert">
            브라우저 저장을 사용할 수 없습니다. 현재 화면에서 계속 작업할 수
            있지만 새로고침 전 입력을 별도로 보관하세요.
          </section>
        )}
        {!blankId && <WorkflowContextNavigation page={page} go={go} />}
        <WorkflowBackup value={{scenarios,drafts,blankDocuments,importRecords,savedTemplates,propertyStandards,projects}} attention={storageStatus==='memory'||storageStatus==='invalid'} invalid={storageStatus==='invalid'} onRestore={restored=>{
          setScenarios(restored.scenarios);setDrafts(restored.drafts);setBlankDocuments(restored.blankDocuments??[]);setImportRecords(restored.importRecords??[]);setSavedTemplates(restored.savedTemplates??[]);setPropertyStandards(restored.propertyStandards??[]);setProjects(restored.projects??[]);setStorageReady(true);setStorageStatus('loading');setParams({page:'projects'});setPanel(null);setException('');
        }}/>
        {demoOpen && (
          <section className="flow-demo" aria-label="데모 설정">
            <label>
              업무 시나리오
              <select
                value={scenario}
                onChange={(e) => {
                  setParams({ scenario: e.target.value, page });
                  setPanel(null);
                  setException("");
                }}
              >
                {Object.entries(scenarioLabels).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              체험 역할
              <select
                value={state.role}
                onChange={(e) =>
                  dispatch({ type: "role", role: e.target.value as DemoRole })
                }
              >
                {Object.entries(roleLabels).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              예외 상태
              <select
                value={exception}
                onChange={(e) => setException(e.target.value)}
              >
                <option value="">정상 흐름</option>
                {workflowExceptions.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => {
                setScenarios((values) => ({
                  ...values,
                  [scenario]: createWorkflow(scenario),
                }));
                setException("");
                setPanel(null);
                setDrafts((values) =>
                  Object.fromEntries(
                    Object.entries(values).filter(
                      ([key]) => !key.startsWith(`${scenario}:`),
                    ),
                  ),
                );
              }}
            >
              <RotateCcw size={15} />
              현재 시나리오 초기화
            </button>
            <p>
              서버 저장·실측·AI 호출·실제 초대·발주 없이 화면 흐름을 확인합니다.
              새로고침 시 같은 탭의 예시 상태·검토 초안을 복원합니다. 탭 종료 후
              보존은 보장하지 않습니다.
            </p>
          </section>
        )}
        <div className="flow-heading">
          <div>
            <span className="flow-eyebrow">
              {globalPage
                ? "내 작업공간"
                : `${scenarioLabels[scenario]} / R${state.revision}`}
            </span>
            <h1>{title}</h1>
          </div>
          {!globalPage && (
            <span className="flow-badge">
              {roleLabels[state.role]} · {phaseLabels[state.phase]}
            </span>
          )}
        </div>
        {exception && (
          <WorkflowException
            key={`${scenario}:${exception}`}
            kind={exception}
            state={state}
            change={setException}
            open={open}
            go={go}
          />
        )}
        {!["empty", "loading", "expired", "unsupported"].includes(
          exception,
        ) && (
          <div className="flow-body">
            {scopedPage && (
              <section className="flow-card" aria-label="업무 대상 선택">
                <div className="flow-actions">
                  {(
                    [
                      ["local", "내 도면"],
                      ["sample", "예시 프로젝트"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      aria-pressed={scope === value}
                      onClick={() => {
                        setParams({ scenario, page, scope: value });
                        setPanel(null);
                        setException("");
                        setNotice("");
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p>
                  {localScope
                    ? "이 탭에서 직접 만든 도면만 표시합니다. 예시 프로젝트는 포함하지 않습니다."
                    : `${scenarioLabels[scenario]} 예시 프로젝트입니다. 직접 만든 도면과 별도이며 실제 업무 결과가 아닙니다.`}
                </p>
              </section>
            )}
            {scope==='local'&&projectContextId&&['overview','documents','quantities','estimate','tasks','reviews','issues','materials','changes','delivery','schedule','submittals','transmittals','budget','daily','payments','handover','carbon','standards','field'].includes(page)&&<section className="flow-card" aria-label="선택 프로젝트"><h2>{selectedProject?.name??'프로젝트를 찾을 수 없습니다'}</h2>{!selectedProject&&<p role="alert">프로젝트를 찾을 수 없습니다. 다른 프로젝트 자료로 대체하지 않습니다.</p>}<button onClick={()=>setParams({page:'projects',scope:'local'})}>내 프로젝트로 돌아가기</button><button onClick={()=>setParams({page,scope:'local'})}>{page==='documents'?'모든 도면 목록 보기':page==='overview'?'모든 도면 개요 보기':'전체 프로젝트 자료 보기'}</button></section>}
            {localScope&&page==='overview'&&!params.has('recordReviewDocument')&&(!params.has('project')||selectedProject)&&<WorkflowLocalOverview documents={projectDocuments} onStart={()=>go('start')} onLocate={(id,finding)=>{
              if(finding.kind==='quantity-review'){setParams({page:'quantities',scope:'local',quantityDocument:id});return;}
              setBlankDocuments(documents=>documents.map(doc=>doc.id===id?{...doc,page:finding.page??doc.page??1}:doc));
              setParams({page:'workspace',blank:id,overviewReturn:'1',...(selectedProject?{project:selectedProject.id}:{}),...(finding.objectId?{target:finding.objectId}:{})});setPanel(null);
            }} onOpen={(id,destination)=>{
              const key={workspace:'blank',quantities:'quantityDocument',field:'fieldDocument',materials:'materialDocument',delivery:'deliveryDocument'}[destination];
              setParams({page:destination,scope:'local',[key]:id,...(selectedProject?{project:selectedProject.id}:{})});setPanel(null);
            }}/>}
            {(params.get('recordReturn')==='1'||(localScope&&page==='overview'&&params.has('recordReviewDocument')))&&<button onClick={()=>{setParams({page:'overview',scope:'local',...((params.get('recordProject')||projectContextId)?{project:params.get('recordProject')||projectContextId!}:{}),recordSearch:params.get('recordSearch')??'',recordKind:params.get('recordKind')??'',recordDocument:params.get('recordDocument')??''});setPanel(null);}}>프로젝트 기록으로 돌아가기</button>}
            {localScope&&page==='overview'&&(params.has('recordReviewDocument')?<WorkflowReviewRecord documents={projectDocuments} documentId={params.get('recordReviewDocument')??''} revision={params.get('recordReviewRevision')??''}/>:<WorkflowRecords documents={projectDocuments} onOpen={record=>{setParams({...record.destination,recordReturn:'1',recordProject:projectContextId??'',recordSearch:params.get('recordSearch')??'',recordKind:params.get('recordKind')??'',recordDocument:params.get('recordDocument')??''});setPanel(null);}}/>)}
            {localScope&&page==='issues'&&<WorkflowCommentInbox documents={projectDocuments} search={params.get('commentSearch')??''} onSearch={value=>setParams(previous=>{const next=new URLSearchParams(previous);if(value)next.set('commentSearch',value);else next.delete('commentSearch');return next;},{replace:true,preventScrollReset:true})} onOpen={(id,target,page)=>{setBlankDocuments(documents=>documents.map(doc=>doc.id===id?{...doc,page}:doc));setParams({page:'workspace',blank:id,target,commentsReturn:'1',commentSearch:params.get('commentSearch')??''});setPanel(null);}}/>}
            {localScope&&(page==='issues'||page==='tasks')&&<WorkflowRfiInbox queue={page==='tasks'} documents={projectDocuments} onChange={updated=>setBlankDocuments(documents=>documents.map(document=>document.id===updated.id?updated:document))} onOpen={(id,target,targetPage)=>{setBlankDocuments(documents=>documents.map(document=>document.id===id?{...document,page:targetPage}:document));setParams({page:'workspace',blank:id,target,rfiReturn:page,...rfiContext});setPanel(null);}}/>}
            {page==='presentation'&&<WorkflowPresentation state={state} drafts={drafts} onSave={(key,value)=>setDrafts(values=>({...values,[key]:value}))} onWorkspace={()=>{setParams({page:'workspace',scope:'sample',scenario,presentationReturn:'1',scene:params.get('scene')??''});setPanel(null);}}/>}
            {page==='workspace'&&params.get('presentationReturn')==='1'&&<button onClick={()=>setParams({page:'presentation',scope:'sample',scenario,scene:params.get('scene')??''})}>보관한 장면으로 돌아가기</button>}
            {page==='budget'&&<WorkflowBudget documents={projectDocuments} drafts={drafts} onDraft={patch=>setDrafts(values=>({...values,...patch}))} onStart={()=>go('start')} onOpen={(id,sequence)=>{setParams({page:'quantities',scope:'local',quantityDocument:id,budgetReturn:id,budgetSequence:String(sequence),comparisonSequence:String(sequence)});setPanel(null);}}/>}
            {localScope&&page==='quantities'&&params.has('budgetReturn')&&<button onClick={()=>setParams({page:'budget',budgetDocument:params.get('budgetReturn')!,budgetSequence:params.get('budgetSequence')??''})}>예산 비교로 돌아가기</button>}
            {localScope && (page === "quantities" || page === "estimate") && (
              <>
                {page==='estimate'&&<WorkflowBoqGroups documents={projectDocuments} onOpen={(id,target,targetPage)=>{setBlankDocuments(documents=>documents.map(document=>document.id===id?{...document,page:targetPage}:document));setParams({page:'workspace',blank:id,target,quantityReturn:'estimate',...boqContext});setPanel(null);}}/>}
                <WorkflowQuantityReviews key={params.get('quantityDocument')??'all'} initialDocumentId={params.get('quantityDocument')??undefined} comparisonSequence={params.get('comparisonSequence')??undefined} comparisonTarget={params.get('comparisonTarget')??undefined} onComparisonSelect={(id,sequence,target)=>setParams({page,scope:'local',quantityDocument:id,comparisonSequence:String(sequence),comparisonTarget:target??'current'})} documents={projectDocuments} onChange={updated=>setBlankDocuments(documents=>documents.map(doc=>doc.id===updated.id?updated:doc))} onOpen={(id,target,page,snapshot,comparisonSequence,comparisonTarget)=>{
                  setBlankDocuments(documents=>documents.map(document=>document.id===id?{...document,page}:document));
                  setParams({page:'workspace',blank:id,target,...(comparisonSequence?{comparisonSequence:String(comparisonSequence),comparisonTarget:comparisonTarget??'current'}:{}),...(snapshot?{snapshot:String(snapshot),localRole:'viewer'}:{})});setPanel(null);
                }}/>
                <WorkflowDocumentQuantities
                  documents={projectDocuments}
                  onOpen={(id, target, targetPage) => {
                    setBlankDocuments((documents) =>
                      documents.map((document) =>
                        document.id === id ? { ...document, page:targetPage } : document,
                      ),
                    );
                    setParams({ page: "workspace", blank: id, target, quantityReturn:page==='estimate'?'estimate':'quantities',...boqContext });
                    setPanel(null);
                  }}
                />
              </>
            )}
            {localScope && page==='changes' && <section className="flow-card" aria-label="내 도면 변경 비교">
              <h2>내 도면 · 변경 비교</h2>
              <p>등록 수량과 도면 객체의 변경을 각각 확인합니다. 수량 승인 회차와 도면 승인 개정은 별개이며 예시 프로젝트 값은 섞지 않습니다.</p>
              {projectDocuments.length>0&&<label className="flow-input">비교할 도면<select aria-label="비교할 도면" value={comparisonDocument?.id??''} onChange={event=>setParams({page:'changes',scope:'local',quantityDocument:event.target.value})}>{!comparisonDocument&&<option value="" disabled>선택한 도면 없음</option>}{projectDocuments.map(document=><option value={document.id} key={document.id}>{document.title}</option>)}</select></label>}
              {comparisonDocument?<WorkflowQuantityComparison key={comparisonDocument.id} document={comparisonDocument} comparisonSequence={params.get('comparisonSequence')??undefined} comparisonTarget={params.get('comparisonTarget')??undefined} onSelect={(id,sequence,target)=>setParams({page:'changes',scope:'local',quantityDocument:id,comparisonSequence:String(sequence),comparisonTarget:target??'current',...drawingContext})} onOpen={(id,target,page,snapshot,sequence,comparisonTarget)=>{
                setBlankDocuments(documents=>documents.map(document=>document.id===id?{...document,page}:document));
                setParams({page:'workspace',blank:id,target,comparisonReturn:'changes',...drawingContext,...(sequence?{comparisonSequence:String(sequence),comparisonTarget:comparisonTarget??'current'}:{}),...(snapshot?{snapshot:String(snapshot),localRole:'viewer'}:{})});setPanel(null);
              }}/>:<p>{params.has('quantityDocument')?'선택한 도면을 찾을 수 없습니다. 다른 도면으로 자동 대체하지 않습니다.':'직접 만든 도면이 없습니다. 빈 작업이나 PDF 작업을 만든 뒤 수량 검산 기록을 비교하세요.'}</p>}
            </section>}
            {page==='schedule'&&<WorkflowSchedule documents={projectDocuments} drafts={drafts} onSave={(key,value)=>setDrafts(values=>({...values,[key]:value}))} onStart={()=>go('start')} onOpen={(id,target,targetPage)=>{
              setBlankDocuments(documents=>documents.map(document=>document.id===id?{...document,page:targetPage}:document));setParams({page:'workspace',blank:id,target,localRole:'viewer',scheduleReturn:id,scheduleDay:params.get('scheduleDay')??'1',scheduleView:params.get('scheduleView')??'list',schedulePage:params.get('schedulePage')??'1'});setPanel(null);
            }}/>}
            {localScope&&page==='changes'&&comparisonDocument&&<WorkflowDrawingComparison key={comparisonDocument.id} document={comparisonDocument}/>}
            {localScope&&page==='materials'&&<WorkflowLocalMaterials documents={projectDocuments} selectedId={params.get('materialDocument')??undefined} initialSequence={params.get('materialSequence')??undefined} initialObject={params.get('materialObject')??undefined} onOpen={(id,sequence,target,page,revision)=>{
              setBlankDocuments(documents=>documents.map(doc=>doc.id===id?{...doc,page}:doc));setParams({page:'workspace',blank:id,target,snapshot:String(revision),localRole:'viewer',materialReturn:id,materialSequence:String(sequence),materialObject:target});setPanel(null);
            }} onSelect={id=>setParams({page:'materials',scope:'local',materialDocument:id})} onChange={updated=>setBlankDocuments(documents=>documents.map(doc=>doc.id===updated.id?updated:doc))}/>}
            {localScope&&page==='field'&&<WorkflowLocalField documents={projectDocuments} drafts={drafts} onDraft={patch=>setDrafts(values=>({...values,...patch}))} selectedId={params.get('fieldDocument')??undefined} onSelect={id=>setParams({page:'field',scope:'local',fieldDocument:id})} onChange={updated=>setBlankDocuments(documents=>documents.map(document=>document.id===updated.id?updated:document))} onOpen={(id,target,page,reviewId)=>{
              setBlankDocuments(documents=>documents.map(document=>document.id===id?{...document,page}:document));setParams({page:'workspace',blank:id,target,fieldReturn:id,localRole:reviewId?'author':'viewer',...(reviewId?{fieldReview:String(reviewId)}:{}),...(params.has('fieldLocation')?{fieldLocation:params.get('fieldLocation')!}:{})});setPanel(null);
            }}/>}
            {localScope && page === "delivery" && (
              <>
                {params.has('deliveryDocument')&&<p>{blankDocuments.find(doc=>doc.id===params.get('deliveryDocument'))?.title??'선택한 도면을 찾을 수 없습니다'} · 선택 도면의 납품만 표시합니다. <button onClick={()=>setParams({page:'delivery',scope:'local'})}>모든 도면 납품 보기</button></p>}
                <WorkflowDistributionBatch documents={projectDocuments} projects={projects} selectedProjectId={projectContextId} drafts={drafts} onDraft={patch=>setDrafts(values=>({...values,...patch}))} onChange={updated=>setBlankDocuments(current=>current.map(doc=>updated.find(item=>item.id===doc.id)??doc))}/>
                <WorkflowDocumentDeliveries
                  drafts={drafts}
                  onDraft={patch=>setDrafts(values=>({...values,...patch}))}
                  documents={params.has('deliveryDocument')?projectDocuments.filter(doc=>doc.id===params.get('deliveryDocument')):projectDocuments}
                  onRecipient={(id, sequence) => {
                    setParams({
                      recipientDocument: id,
                      package: String(sequence),
                    });
                    setPanel(null);
                  }}
                  onChange={(updated) =>
                    setBlankDocuments((documents) =>
                      documents.map((document) =>
                        document.id === updated.id ? updated : document,
                      ),
                    )
                  }
                  onOpen={(id, revision, targetId, page) => {
                    setBlankDocuments((documents) =>
                      documents.map((document) =>
                        document.id === id ? { ...document, page } : document,
                      ),
                    );
                    setParams({
                      page: "workspace",
                      blank: id,
                      snapshot: String(revision),
                      target: targetId,
                      localRole: "viewer",
                    });
                    setPanel(null);
                  }}
                />
              </>
            )}
            {page==='transmittals'&&<WorkflowTransmittals documents={projectDocuments} loading={storageStatus==='loading'} onPrepare={()=>{setParams({page:'delivery',scope:'local',...(projectContextId?{project:projectContextId}:{})});setPanel(null);}} onRecipient={(id,sequence)=>{setParams({page:'transmittals',scope:'local',...(params.has('project')?{project:params.get('project')!}:{}),recipientDocument:id,package:String(sequence),transmittalReturn:'1',transmittalSearch:params.get('transmittalSearch')??'',transmittalStatus:params.get('transmittalStatus')??'all'});setPanel(null);}}/>}
            {localScope&&page==='tasks'&&<WorkflowSubmittalQueue projects={projects} documents={projectDocuments} loading={storageStatus==='loading'} onOpen={(id,item,role,actor)=>{setParams({page:'submittals',submissionDocument:id,submissionItem:String(item),submissionRole:role,submissionQueueReturn:'1',submissionQueueRole:role,submissionActor:actor??''});setPanel(null);}}/>}
            {page==='submittals'&&<WorkflowSubmittals projects={projects} documents={projectDocuments} drafts={drafts} onDraft={patch=>setDrafts(values=>({...values,...patch}))} onChange={updated=>setBlankDocuments(documents=>documents.map(document=>document.id===updated.id?updated:document))} onStart={()=>go('start')} onOpen={(id,submissionDocumentId)=>{setParams({page:'workspace',blank:id,localRole:'viewer',submissionReturn:submissionDocumentId??id,submissionRole:params.get('submissionRole')??'author',...submissionContext});setPanel(null);}}/>}
            {page==='settings'&&<WorkflowOrganization drafts={drafts} onDraft={patch=>setDrafts(values=>({...values,...patch}))}/>}
            {page==='settings'&&scope==='local'&&<WorkflowProjectMembers projects={projects} selectedId={projectContextId??undefined} drafts={drafts} onDraft={patch=>setDrafts(values=>({...values,...patch}))} onSelect={id=>setParams({page:'settings',scope:'local',project:id})} onChange={updated=>setProjects(items=>items.map(project=>project.id===updated.id?updated:project))} onStart={()=>setParams({page:'projects',scope:'local'})}/>}
            {page==='payments'&&<WorkflowPayments documents={projectDocuments} drafts={drafts} onDraft={patch=>setDrafts(values=>({...values,...patch}))} onChange={updated=>setBlankDocuments(documents=>documents.map(doc=>doc.id===updated.id?updated:doc))} onEvidence={(id,item,kind)=>{setParams({...(kind==='quantity'?{page:'quantities',scope:'local',quantityDocument:id,comparisonSequence:String(item.quantitySequence)}:{page:'daily',dailyDocument:id,dailyDate:item.report.date,dailyReport:String(item.report.id),dailyRole:'viewer'}),paymentReturn:id,paymentRole:params.get('paymentRole')??'author'});setPanel(null);}}/>}
            {params.has('paymentReturn')&&(page==='quantities'||page==='daily')&&<button onClick={()=>setParams({page:'payments',paymentDocument:params.get('paymentReturn')!,paymentRole:params.get('paymentRole')??'author'})}>계약·기성 검토로 돌아가기</button>}
            {page==='standards'&&<WorkflowPropertyStandards standards={propertyStandards} documents={projectDocuments} drafts={drafts} onDraft={patch=>setDrafts(values=>({...values,...patch}))} onStandards={setPropertyStandards} onChange={updated=>setBlankDocuments(documents=>documents.map(doc=>doc.id===updated.id?updated:doc))} onOpen={(id,target,page)=>{setBlankDocuments(documents=>documents.map(doc=>doc.id===id?{...doc,page}:doc));setParams({page:'workspace',blank:id,target,localRole:'viewer',standardReturn:id,standardObject:target,...Object.fromEntries(['standardSelection','standardRole'].filter(key=>params.has(key)).map(key=>[key,params.get(key)!]))});setPanel(null);}}/>}
            {blankDocument&&params.get('standardReturn')===blankDocument.id&&!(blankSnapshot?.objects??blankDocument.shapes).some(shape=>shape.id===params.get('target')&&shape.customProperties)&&<button onClick={()=>setParams({page:'standards',standardDocument:blankDocument.id,...Object.fromEntries(['standardObject','standardSelection','standardRole'].filter(key=>params.has(key)).map(key=>[key,params.get(key)!]))})}>속성 기준으로 돌아가기</button>}
            {blankDocument&&(blankSnapshot?.objects??blankDocument.shapes).filter(shape=>shape.id===params.get('target')&&shape.customProperties).map(shape=><section aria-label="도면 객체 사용자 속성" key={shape.id}><div className="flow-actions">{params.get('standardReturn')===blankDocument.id&&<button onClick={()=>setParams({page:'standards',standardDocument:blankDocument.id,...Object.fromEntries(['standardObject','standardSelection','standardRole'].filter(key=>params.has(key)).map(key=>[key,params.get(key)!]))})}>속성 기준으로 돌아가기</button>}<details><summary>{shape.label} · 사용자 속성 확인</summary><PropertyValues property={shape.customProperties!}/></details></div></section>)}
            {page==='carbon'&&<WorkflowCarbon documents={projectDocuments} drafts={drafts} onDraft={patch=>setDrafts(values=>({...values,...patch}))} onChange={updated=>setBlankDocuments(documents=>documents.map(doc=>doc.id===updated.id?updated:doc))} onOpen={(id,sequence)=>{setParams({page:'quantities',scope:'local',quantityDocument:id,comparisonSequence:String(sequence),carbonReturn:id,carbonSequence:String(sequence),...Object.fromEntries(['carbonStage','carbonBefore','carbonAfter','carbonRole'].filter(key=>params.has(key)).map(key=>[key,params.get(key)!]))});setPanel(null);}}/>}
            {params.has('carbonReturn')&&page==='quantities'&&<button onClick={()=>setParams({page:'carbon',carbonDocument:params.get('carbonReturn')!,...Object.fromEntries(['carbonSequence','carbonStage','carbonBefore','carbonAfter','carbonRole'].filter(key=>params.has(key)).map(key=>[key,params.get(key)!]))})}>탄소 근거로 돌아가기</button>}
            {page==='handover'&&<WorkflowHandover documents={projectDocuments} drafts={drafts} onDraft={patch=>setDrafts(values=>({...values,...patch}))} onChange={updated=>setBlankDocuments(documents=>documents.map(doc=>doc.id===updated.id?updated:doc))} onOpen={(id,item,asset)=>{const evidence=item.assets.find(row=>row.objectId===asset.objectId)!.evidence;setBlankDocuments(documents=>documents.map(doc=>doc.id===id?{...doc,page:evidence.page}:doc));setParams({page:'workspace',blank:id,target:asset.objectId,snapshot:String(item.revision),localRole:'viewer',handoverReturn:id,handoverRole:params.get('handoverRole')??'author',handoverRevision:params.get('handoverRevision')??String(item.revision)});setPanel(null);}}/>}
            {blankDocument&&params.get('handoverReturn')===blankDocument.id&&<button onClick={()=>setParams({page:'handover',handoverDocument:blankDocument.id,handoverRole:params.get('handoverRole')??'author',handoverRevision:params.get('handoverRevision')??''})}>준공 인계로 돌아가기</button>}
            {page==='daily'&&<WorkflowDailyReports documents={projectDocuments} drafts={drafts} onDraft={patch=>setDrafts(values=>({...values,...patch}))} onChange={updated=>setBlankDocuments(documents=>documents.map(doc=>doc.id===updated.id?updated:doc))} onField={id=>setParams({page:'field',scope:'local',...(id?{fieldDocument:id}:{}),dailyFieldReturn:'1',dailyRole:params.get('dailyRole')??'author',dailyDate:params.get('dailyDate')??'',...Object.fromEntries(['dailyReport','paymentReturn','paymentRole'].filter(key=>params.has(key)).map(key=>[key,params.get(key)!]))})} onOpen={(doc,report)=>{setBlankDocuments(documents=>documents.map(row=>row.id===doc.id?{...row,page:report.evidence.page}:row));setParams({page:'workspace',blank:doc.id,target:report.evidence.objectId,localRole:'viewer',dailyReturn:doc.id,dailyRole:params.get('dailyRole')??'author',dailyDate:params.get('dailyDate')??'',...Object.fromEntries(['dailyReport','paymentReturn','paymentRole'].filter(key=>params.has(key)).map(key=>[key,params.get(key)!]))});setPanel(null);}}/>}
            {((blankDocument&&params.get('dailyReturn')===blankDocument.id)||(page==='field'&&params.get('dailyFieldReturn')==='1'))&&<button onClick={()=>setParams({page:'daily',dailyDocument:params.get('dailyReturn')??params.get('fieldDocument')??'',dailyRole:params.get('dailyRole')??'author',dailyDate:params.get('dailyDate')??'',...Object.fromEntries(['dailyReport','paymentReturn','paymentRole'].filter(key=>params.has(key)).map(key=>[key,params.get(key)!]))})}>일일 보고로 돌아가기</button>}
            {blankDocument&&projectDocuments.some(document=>document.id===params.get('submissionReturn'))&&<button onClick={()=>setParams({page:'submittals',submissionDocument:params.get('submissionReturn')!,submissionRole:params.get('submissionRole')??'author',...submissionContext})}>제출물 검토로 돌아가기</button>}
            {localScope&&page==='tasks'&&<WorkflowShareInbox documents={projectDocuments} onChange={updated=>setBlankDocuments(documents=>documents.map(document=>document.id===updated.id?updated:document))}/>}
            {localScope && (page === "tasks" || page === "reviews") && (
              <>
                <WorkflowQuantityInbox documents={projectDocuments} mode={page} onOpen={id=>{setParams({page:'quantities',scope:'local',quantityDocument:id});setPanel(null);}}/>
                <WorkflowDocumentInbox
                  documents={projectDocuments}
                  mode={page}
                  onOpen={(id, targetId, page, role, snapshot) => {
                    setBlankDocuments((documents) =>
                      documents.map((document) =>
                        document.id === id ? { ...document, page } : document,
                      ),
                    );
                    setParams({
                      page: "workspace",
                      blank: id,
                      target: targetId,
                      localRole: role,
                      ...(snapshot ? { snapshot: String(snapshot) } : {}),
                    });
                    setPanel(null);
                  }}
                />
              </>
            )}
            {localScope&&page==='workspace'&&!blankId&&<p>열 도면이 지정되지 않았습니다. 아래 목록에서 선택하세요. 예시 도면으로 자동 대체하지 않습니다.</p>}
            {localScope&&(page==='documents'||(page==='workspace'&&!blankId))&&<WorkflowLocalDocuments documents={projectDocuments} search={params.get('documentSearch')??''} onSearch={value=>setParams(previous=>{const next=new URLSearchParams(previous);if(value)next.set('documentSearch',value);else next.delete('documentSearch');return next;},{replace:true,preventScrollReset:true})} onStart={()=>go('start')} onOpen={id=>{setParams({page:'workspace',blank:id,documentsReturn:'1',...(selectedProject?{project:selectedProject.id}:{}),documentSearch:params.get('documentSearch')??''});setPanel(null);}}/>}
            {(page==='start'||page==='library'||(page==='documents'&&scope==='local'))&&<section className="flow-card" aria-label="도면 보관 위치">
              <label className="flow-input">도면을 보관할 프로젝트<select aria-label="도면을 보관할 프로젝트" value={params.get('project')??''} onChange={event=>setParams(previous=>{const next=new URLSearchParams(previous);if(event.target.value)next.set('project',event.target.value);else next.delete('project');return next;})}>
                <option value="">미분류 도면으로 시작</option>{params.has('project')&&!selectedProject&&<option value={params.get('project')!} disabled>프로젝트를 찾을 수 없음</option>}{projects.map(project=><option key={project.id} value={project.id} disabled={project.archived}>{project.name}{project.archived?" · 보관됨":""}</option>)}
              </select></label><p>이후 새로 만드는 도면에 적용됩니다. 기존 도면의 소속은 바뀌지 않습니다.</p>{params.has('project')&&!selectedProject&&<p role="alert">선택한 프로젝트가 없습니다. 보관 위치를 다시 선택하세요.</p>}
              {selectedProject?.archived&&<p role="status">보관한 프로젝트입니다. 새 도면을 추가하려면 프로젝트 목록에서 복원하세요.</p>}<button onClick={()=>go('projects')}>프로젝트 목록·만들기</button>
            </section>}
            {(page==='start'||(page==='documents'&&scope==='local'))&&<WorkflowImportManifest records={params.has("project")?importRecords.filter(record=>!record.documentId||projectDocuments.some(document=>document.id===record.documentId)):importRecords} totalRecordCount={importRecords.length} projectFiltered={params.has("project")} documents={blankDocuments} disabled={!storageReady} onAdd={record=>setImportRecords(records=>appendImportRecords(records,[record]))} onOpen={id=>{
              const record=importRecords.find(record=>record.id===id);if(!record)return;
              if(record.documentId){if(blankDocuments.some(doc=>doc.id===record.documentId))setParams({page:'workspace',blank:record.documentId});return;}
              if(!storageReady||((params.has("project")&&!selectedProject)||selectedProject?.archived)||blankDocuments.length>=30)return;const document=documentFromImport(record,crypto.randomUUID());if(!document)return;
              setBlankDocuments(documents=>[...documents,{...document,...(selectedProject?{projectId:selectedProject.id}:{})}]);setImportRecords(records=>records.map(item=>item.id===id?{...item,documentId:document.id}:item));setParams({page:'workspace',blank:document.id});setPanel(null);
            }}/>}
            {page === "start" && (
              <WorkflowBlankStart
                onCreate={createBlank}
                disabled={Boolean(creationBlockedReason)}
                disabledReason={creationBlockedReason}
              />
            )}
            {page==='projects'&&<section className="flow-card" aria-label="프로젝트 자료 구분">{scope==='sample'?<><p>학습용 예시 프로젝트입니다. 직접 만든 프로젝트와 별도로 보관됩니다.</p><button onClick={()=>setParams({page:'projects',scope:'local'})}>내 프로젝트로 돌아가기</button></>:<><p>직접 만든 프로젝트만 표시합니다. 예시로 기능을 살펴보려면 별도로 들어가세요.</p><button onClick={()=>setParams({page:'projects',scope:'sample'})}>예시 프로젝트 둘러보기</button></>}</section>}
            {page==="projects"&&scope!=='sample'&&<WorkflowLocalProjects projects={projects} documents={blankDocuments} drafts={drafts} disabled={!storageReady} onDraft={patch=>setDrafts(values=>({...values,...patch}))}
              onUpdate={(id,patch)=>{if(!storageReady)return;setProjects(items=>{const result=projectsSchema.safeParse(items.map(project=>project.id===id?{...project,...patch}:project));return result.success?result.data:items;});}}
              onOverview={id=>setParams({page:'overview',scope:'local',project:id})}
              onMembers={id=>setParams({page:'settings',scope:'local',project:id})}
              onCreate={(name,kind)=>{if(!storageReady||projects.length>=30||!name.trim()||name.length>120||!['architecture','civil','both'].includes(kind))return;const id=crypto.randomUUID();setProjects(items=>[...items,{id,name:name.trim(),kind}]);setDrafts(values=>({...values,'projects:name':'','projects:search':'','projects:filter':'active'}));setParams({page:'start',scope:'local',project:id});}}
              onStart={id=>setParams({page:'start',scope:'local',project:id})}
              onOpen={id=>setParams({page:'workspace',blank:id})}
              onAssign={(id,projectId)=>{if(!storageReady||!projects.some(project=>project.id===projectId&&!project.archived))return;setBlankDocuments(items=>items.map(doc=>doc.id===id&&!doc.projectId?{...doc,projectId}:doc));}}
            />}
            {blankId ? (
              invalidMaterialTarget ? <section className="flow-card"><h2>자재 근거 도면을 확인할 수 없습니다</h2><p>선택한 승인 개정·수량·객체가 일치하지 않습니다. 현재 도면으로 대체하지 않습니다.</p><button onClick={()=>setParams({page:'materials',scope:'local',materialDocument:params.get('materialReturn')!,materialSequence:params.get('materialSequence')??'',materialObject:params.get('materialObject')??''})}>자재 기록으로 돌아가기</button></section> : blankDocument ? (
                <WorkflowBlankWorkspace
                  onCommentsBack={params.has('commentsReturn')?()=>setParams({page:'issues',scope:'local',commentSearch:params.get('commentSearch')??''}):undefined}
                  onRfiBack={params.has('rfiReturn')?()=>setParams({page:params.get('rfiReturn')==='tasks'?'tasks':'issues',scope:'local',...rfiContext}):undefined}
                  onDocumentsBack={params.has('documentsReturn')?()=>setParams({page:'documents',scope:'local',...(selectedProject?{project:selectedProject.id}:{}),documentSearch:params.get('documentSearch')??''}):undefined}
                  onOverviewBack={params.has('overviewReturn')?()=>setParams({page:'overview',scope:'local',...(selectedProject?{project:selectedProject.id}:{})}):undefined}
                  onMaterialsBack={params.has('materialReturn')?()=>setParams({page:'materials',scope:'local',materialDocument:params.get('materialReturn')!,materialSequence:params.get('materialSequence')??'',materialObject:params.get('materialObject')??''}):undefined}
                  fieldReviewId={params.get('fieldReview')??undefined}
                  onFieldBack={params.has('fieldReturn')?()=>setParams({page:'field',scope:'local',fieldDocument:params.get('fieldReturn')!,...(params.has('fieldLocation')?{fieldLocation:params.get('fieldLocation')!}:{})}):undefined}
                  pricebook={state.pricebook}
                  pricebookLabel={scenarioLabels[scenario]}
                  key={`${blankDocument.id}:${blankSnapshot?.revision ?? "live"}`}
                  readOnlySnapshot={Boolean(blankSnapshot)}
                  initialRole={
                    (["author", "reviewer", "approver", "viewer"].includes(
                      params.get("localRole") ?? "",
                    )
                      ? params.get("localRole")
                      : "author") as DocumentReviewRole
                  }
                  initialSelectedId={params.get("target")}
                  document={
                    blankSnapshot
                      ? {
                          ...blankDocument,
                          source: blankSnapshot.source,
                          shapes: blankSnapshot.objects,
                          layers: blankSnapshot.layers,
                          revision: blankSnapshot.revision,
                          reviewRounds: blankDocument.reviewRounds?.filter(
                            (round) => round.revision <= blankSnapshot.revision,
                          ),
                        }
                      : blankDocument
                  }
                  onChange={(updated) =>
                    setBlankDocuments((documents) =>
                      documents.map((document) =>
                        document.id === updated.id
                          ? blankSnapshot
                            ? { ...document, page: updated.page }
                            : updated
                          : document,
                      ),
                    )
                  }
                  onBack={() => go("projects")}
                  onComparisonBack={params.get('comparisonReturn')==='changes'?()=>{setParams({page:'changes',scope:'local',quantityDocument:blankDocument.id,...drawingContext,...(params.has('comparisonSequence')?{comparisonSequence:params.get('comparisonSequence')!,comparisonTarget:params.get('comparisonTarget')??'current'}:{})});setPanel(null);}:undefined}
                  onScheduleBack={params.get('scheduleReturn')===blankDocument.id?()=>{setParams({page:'schedule',scheduleDocument:blankDocument.id,scheduleObject:params.get('target')??'',scheduleDay:params.get('scheduleDay')??'1',scheduleView:params.get('scheduleView')??'list',schedulePage:params.get('schedulePage')??'1'});setPanel(null);}:undefined}
                  onQuantities={() => {setParams({page:params.get('quantityReturn')==='estimate'?'estimate':'quantities',...boqContext,scope:'local',quantityDocument:blankDocument.id,...(params.has('comparisonSequence')?{comparisonSequence:params.get('comparisonSequence')!,comparisonTarget:params.get('comparisonTarget')??'current'}:{})});setPanel(null);}}
                />
              ) : (
                <section className="flow-card">
                  <h2>
                    {storageReady
                      ? "빈 작업을 찾을 수 없습니다"
                      : "탭 자료 복원 중"}
                  </h2>
                  <p>
                    다른 탭의 작업이거나 보관 자료가 없을 수 있습니다. 예시
                    도면으로 자동 대체하지 않습니다.
                  </p>
                  <button onClick={() => go("projects")}>
                    내 작업 목록으로
                  </button>
                </section>
              )
            ) : page === "library" ? (
              <>
              <WorkflowSavedTemplates documents={blankDocuments} templates={savedTemplates} drafts={drafts} onDraft={patch=>setDrafts(values=>({...values,...patch}))} onSave={template=>setSavedTemplates(templates=>templates.length<20?[...templates,template]:templates)} onCreate={document=>{if(!storageReady||((params.has("project")&&!selectedProject)||selectedProject?.archived)||blankDocuments.length>=30)return;setBlankDocuments(documents=>[...documents,{...document,...(selectedProject?{projectId:selectedProject.id}:{})}]);setParams({page:'workspace',blank:document.id});setPanel(null);}}
                onRename={(id,name)=>{const next=name.trim();if(!next||next.length>120)return;setSavedTemplates(templates=>templates.map(template=>template.id===id?{...template,name:next}:template));setDrafts(values=>({...values,[`library:rename:${id}`]:next}));}}
                onRemove={id=>{setSavedTemplates(templates=>templates.filter(template=>template.id!==id));setDrafts(values=>{const next:Record<string,string>={...values,'library:selected':''};delete next[`library:rename:${id}`];return next;});}}
              />
              <WorkflowTemplateLibrary
                selected={drafts['template:selected']??'office'}
                title={drafts['template:title']??''}
                onDraft={(selected,title)=>setDrafts(values=>({...values,'template:selected':selected,'template:title':title}))}
                onCreate={createBlank}
                disabled={Boolean(creationBlockedReason)}
                disabledReason={creationBlockedReason}
              />
              </>
            ) : localScope || (['projects','settings'].includes(page)&&scope!=='sample') || page==='schedule'||page==='submittals'||page==='transmittals'||page==='budget'||page==='presentation'||page==='daily'||page==='payments'||page==='handover'||page==='carbon'||page==='standards' ? null : (
              <section className="flow-screen-content"
                aria-label={scopedPage ? "예시 프로젝트 업무" : undefined}
              >
                <WorkflowPrototypePage
                  scenarios={scenarios}
                  onOpenScenario={(next) => {
                    setParams({ scenario: next, page: "overview" });
                    setPanel(null);
                    setNotice("");
                  }}
                  page={page}
                  state={state}
                  go={go}
                  open={open}
                  dispatch={dispatch}
                />
              </section>
            )}
          </div>
        )}
        <footer className="flow-footer">
          <Layers3 size={14} />
          도면·수량·검토가 이어지는 작업실
          <Link to="/workspace-preview/drawing-workspace?layout=pdf&startKind=office">
            기존 PDF 작성 화면
            <ChevronRight size={14} />
          </Link>
        </footer>
      </main>
      <Dialog
        open={Boolean(panel)}
        onOpenChange={(value) => {
          if (!value) setPanel(null);
        }}
      >
        <DialogContent className="flow-dialog">
          <DialogHeader>
            <DialogTitle>
              {workflowPanels.find(([id]) => id === panel)?.[1] ?? "작업 확인"}
            </DialogTitle>
            <DialogDescription>
              {object.id} · {object.location} · R{state.revision} · 시나리오
              예시
            </DialogDescription>
          </DialogHeader>
          {panel === "scale" && <WorkflowScalePanel state={state} run={run} />}
          {panel === "formula" && (
            <>
              <WorkflowFormulaPanel
                key={`${scenario}:${state.revision}`}
                state={state}
                run={run}
                open={open}
              />
              <button onClick={() => go("quantities")}>
                수량 산출서에서 보기
              </button>
            </>
          )}
          {panel === "rate" && (
            <>
              <WorkflowRatePanel state={state} run={run} />
              <button onClick={() => go("rates")}>회사 단가 자료 보기</button>
            </>
          )}
          {panel === "properties" && (
            <WorkflowPropertiesPanel
              key={`${scenario}:${state.revision}`}
              state={state}
              run={run}
            />
          )}
          {panel === "compare" && (
            <>
              <WorkflowComparison state={state} />
              <button onClick={() => go("changes")}>변경 건 상세 보기</button>
            </>
          )}
          {panel === "request" && (
            <>
              <label className="flow-input">
                검토 요청 내용
                <textarea
                  aria-label="검토 요청 내용"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={500}
                />
              </label>
              <p>
                대상: {object.name} / R{state.revision}
                <br />
                산출 상태:{" "}
                {state.quantityStatus === "current"
                  ? "확인된 시나리오"
                  : "확인 필요"}
              </p>
              <button
                disabled={
                  state.role !== "author" ||
                  !["draft", "changes"].includes(state.phase) ||
                  state.quantityStatus !== "current" ||
                  !message.trim()
                }
                onClick={() => run({ type: "request", message })}
              >
                검토 요청 체험
              </button>
              <button onClick={() => open("formula")}>산출 근거 확인</button>
            </>
          )}
          {panel === "review" && (
            <>
              <p>{state.request?.message ?? "아직 요청된 검토가 없습니다."}</p>
              <label className="flow-input">
                검토 의견
                <textarea
                  aria-label="검토 의견"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={500}
                />
              </label>
              <button
                disabled={
                  state.role !== "reviewer" ||
                  state.phase !== "requested" ||
                  !message.trim()
                }
                onClick={() => run({ type: "correction", message })}
              >
                수정 요청 체험
              </button>
              <button
                disabled={
                  state.role !== "reviewer" || state.phase !== "requested"
                }
                onClick={() => run({ type: "review" })}
              >
                검토 완료 체험
              </button>
              <p>아래 검토 흐름에서 다음 담당자 관점으로 전환할 수 있습니다.</p>
            </>
          )}
          {panel === "approval" && (
            <WorkflowApprovalPanel
              key={`${scenario}:${state.revision}`}
              state={state}
              run={run}
            />
          )}
          {panel === "findings" && (
            <>
              <FindingList state={state} open={open} />
              <WorkflowAssistantPanel
                key={`${scenario}:${state.revision}`}
                state={state}
                run={run}
                open={open}
                reason={message}
                setReason={setMessage}
                unavailable={["ai", "missing"].includes(exception)}
              />
            </>
          )}
          {panel === "model" && (
            <WorkflowModelPanel state={state} open={open} go={go} />
          )}
          {panel === "compatibility" && (
            <WorkflowImportPanel
              state={state}
              dispatch={dispatch}
              onOpen={() => go("workspace")}
            />
          )}
          {panel === "share" && <WorkflowSharePanel state={state} run={run} />}
          {panel && ["request", "review", "approval"].includes(panel) && (
            <WorkflowReviewContext
              state={state}
              dispatch={dispatch}
              open={open}
              go={go}
            />
          )}
          {notice && (
            <p role="status" className="flow-notice">
              {notice}
            </p>
          )}
          <button className="flow-back" onClick={() => setPanel(null)}>
            <ArrowLeft size={15} />
            현재 화면으로 돌아가기
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
