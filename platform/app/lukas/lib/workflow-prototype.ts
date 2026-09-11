/** Frontend scenario state only. Never used as a server quantity or approval authority. */
import {appendPriceBook,previewPriceBookCsv,type PriceBookEntry} from './workflow-pricebook.ts';
import {priceBookDraftSchema,type PriceBookDraft} from './workflow-pricebook-draft';
export type Scenario = "architecture" | "ifc" | "civil";
export type DemoRole = "author" | "reviewer" | "approver" | "viewer";
export type DemoPhase =
  | "draft"
  | "requested"
  | "changes"
  | "reviewed"
  | "approved";
export type Workflow = {
  pricebook?: PriceBookEntry[];
  pricebookDraft?:PriceBookDraft;
  members?: {name:string;email:string;role:DemoRole}[];
  layers?: {name:string;kind:'source'|'overlay';visible:boolean;locked:boolean}[];
  deliveryPackage?: {revision:number;formats:('PDF'|'DWG'|'XLSX'|'CSV')[];recipient:string};
  sharePreview?: {recipient:string;permission:'view'|'comment';revision:number;objectId:string;sourceId:string;objectName:string;document:string;quantity:number;unit:string;amount?:number;status:'active'|'expired';feedback?:string};
  fieldNotes?: {id:string;objectId:string;sourceId:string;revision:number;location:string;title:string;note:string;condition:'changed'|'conforming'|'needs-check';photoName?:string}[];
  materials?: {approvedRevision:number;ordered:number;received:number;installed:number;reason:string};
  measurement?: {
    raw: number;
    correction: number;
    reason: string;
    revision: number;
    rule: "DEMO-QTY-01";
  };
  aiDecision?: {
    revision: number;
    decision: "accepted" | "dismissed";
    reason: string;
  };
  importSetup?: {
    format: "PDF" | "IFC" | "DWG";
    unit: "mm" | "m";
    page: number;
  };
  persistence: "demo-only";
  scenario: Scenario;
  project: string;
  document: string;
  revision: number;
  role: DemoRole;
  phase: DemoPhase;
  calibrated: boolean;
  scale?: {length:number;unit:'mm'|'m'};
  quantityStatus: "missing" | "current" | "stale";
  object: {
    rateSource?: PriceBookEntry;
    geometryChanged?: boolean;
    appearance?: {
      layer: string;
      stroke: string;
      fill: string;
      lineWidth: number;
    };
    id: string;
    sourceId: string;
    name: string;
    location: string;
    unit: string;
    quantity: number;
    baseline: number;
    rate: number;
  };
  request: { objectId: string; revision: number; message: string } | null;
  approved: {
    rateSource?: PriceBookEntry;
    revision: number;
    quantity: number;
    amount: number;
    objectId?: string;
    sourceId?: string;
    objectName?: string;
    document?: string;
    unit?: string;
    rate?: number;
  } | null;
  history: { revision: number; label: string }[];
  delivery: "unprepared" | "prepared";
};

export const scenarioLabels: Record<Scenario, string> = {
  architecture: "건축 적산",
  ifc: "3D 검토",
  civil: "토목 현장",
};
export const phaseLabels: Record<DemoPhase, string> = {
  draft: "작성 중",
  requested: "검토 대기",
  changes: "수정 요청",
  reviewed: "승인 대기",
  approved: "승인본",
};
export const roleLabels: Record<DemoRole, string> = {
  author: "작성자",
  reviewer: "검토자",
  approver: "승인자",
  viewer: "보기 전용",
};

export function createWorkflow(scenario: Scenario): Workflow {
  const objects = {
    architecture: {
      id: "A-101",
      sourceId: "PDF-01",
      name: "회의실 바닥 마감",
      location: "1층 · 회의실 101",
      unit: "m²",
      quantity: 24,
      baseline: 24,
      rate: 42000,
    },
    ifc: {
      id: "W-201",
      sourceId: "IFC-01",
      name: "코어 외벽 W-201",
      location: "2층 · 코어 A",
      unit: "m²",
      quantity: 36,
      baseline: 36,
      rate: 65000,
    },
    civil: {
      id: "C-301",
      sourceId: "CIVIL-01",
      name: "배수관 구간 C-301",
      location: "1공구 · STA 0+120–0+180",
      unit: "m",
      quantity: 60,
      baseline: 60,
      rate: 85000,
    },
  };
  return {
    persistence: "demo-only",
    scenario,
    project:
      scenario === "civil" ? "철도 역사 진입부 정비" : "성수 업무시설 리모델링",
    document:
      scenario === "architecture"
        ? "A-101 1층 평면도"
        : scenario === "ifc"
          ? "구조·설비 통합 모델"
          : "C-301 배수계획도",
    revision: 1,
    role: "author",
    phase: "draft",
    calibrated: scenario !== "architecture",
    quantityStatus: "missing",
    object: { ...objects[scenario] },
    request: null,
    approved: null,
    history: [],
    delivery: "unprepared",
  };
}

export type WorkflowAction =
  | {type:'pricebook-save';entry:Omit<PriceBookEntry,'version'>}
  | {type:'pricebook-import';csv:string}
  | {type:'pricebook-draft';patch:Partial<PriceBookDraft>}
  | {type:'member-plan';name:string;email:string;role:DemoRole}
  | {type:'field-note';title:string;note:string;condition:'changed'|'conforming'|'needs-check';photoName?:string}
  | {type:'materials';ordered:number;received:number;installed:number;reason:string}
  | { type: "formula"; raw: number; correction: number; reason: string }
  | {
      type: "properties";
      name: string;
      layer: string;
      stroke: string;
      fill: string;
      lineWidth: number;
    }
  | {
      type: "ai-decision";
      revision: number;
      decision: "accepted" | "dismissed";
      reason: string;
    }
  | {
      type: "import-setup";
      format: "PDF" | "IFC" | "DWG";
      unit: "mm" | "m";
      page: number;
    }
  | { type: "rate"; rate: number; unit: string;reference?:{code:string;version:number} }
  | { type: "role"; role: DemoRole }
  | { type: "request" | "correction"; message: string }
  | {
      type:
        | "calculate"
        | "revise"
        | "review"
        | "approve"
        | "new-revision";
    }
  | {type:'calibrate';length?:number;unit?:'mm'|'m'}
  | {type:'share-preview';recipient:string;permission:'view'|'comment';includeAmount:boolean}
  | {type:'share-feedback';message:string}
  | {type:'share-expire'}
  | {type:'share-restore';message:string}
  | {type:'deliver';formats?:('PDF'|'DWG'|'XLSX'|'CSV')[];recipient?:string}
  | {type:'layer-create';name:string}
  | {type:'layer-toggle';name:string;property:'visible'|'locked'};

export function getWorkflowLayers(s:Workflow):NonNullable<Workflow['layers']> {
  const layers=s.layers??[
    {name:'원본 배경',kind:'source',visible:true,locked:true},
    ...['도면 편집','검토 주석','물량 근거'].map(name=>({name,kind:'overlay' as const,visible:true,locked:false})),
  ];
  const name=s.object.appearance?.layer??'물량 근거';
  return layers.some(layer=>layer.name===name)?layers:[...layers,{name,kind:'overlay',visible:true,locked:false}];
}

export function compareWorkflow(s: Workflow) {
  const baseline = createWorkflow(s.scenario).object;
  const baselineAmount = baseline.quantity * baseline.rate;
  const currentAmount = s.object.quantity * s.object.rate;
  return {baseline, baselineAmount, currentAmount,
    quantityDelta: Math.round((s.object.quantity - baseline.quantity) * 1000) / 1000,
    amountDelta: currentAmount - baselineAmount,
  };
}

export function getWorkflowMembers(s:Pick<Workflow,'members'>):NonNullable<Workflow['members']> {
  return s.members ?? [
    {name:'이작성',email:'author@example.test',role:'author'},
    {name:'김검토',email:'reviewer@example.test',role:'reviewer'},
    {name:'박승인',email:'approver@example.test',role:'approver'},
  ];
}
export function reduceWorkflow(s: Workflow, action: WorkflowAction): Workflow {
  if (action.type === "role") return { ...s, role: action.role };
  if (s.role === "viewer") return s;
  if(action.type==='pricebook-draft'){
    if(s.role!=='author')return s;
    const parsed=priceBookDraftSchema.safeParse({csv:'',...s.pricebookDraft,...action.patch});
    return parsed.success?{...s,pricebookDraft:parsed.data}:s;
  }
  if(action.type==='pricebook-import') {
    if(s.role!=='author')return s;
    const result=previewPriceBookCsv(action.csv,s.pricebook??[]);
    return result.errors.length?s:{...s,pricebook:[...(s.pricebook??[]),...result.entries],pricebookDraft:undefined};
  }
  if(action.type==='pricebook-save') {
    if(s.role!=='author')return s;
    const pricebook=appendPriceBook(s.pricebook??[],action.entry);
    return pricebook?{...s,pricebook}:s;
  }
  if(action.type==='member-plan') {
    const email=action.email.trim().toLowerCase(),name=action.name.trim();
    if(!['author','approver'].includes(s.role)||!name||name.length>80||email.length>254||!/^\S+@\S+\.\S+$/.test(email)||!['author','reviewer','approver','viewer'].includes(action.role))return s;
    const members=getWorkflowMembers(s),exists=members.some(member=>member.email===email);
    if(!exists&&members.length>=50)return s;
    const member={name,email,role:action.role};
    return {...s,members:exists?members.map(item=>item.email===email?member:item):[...members,member]};
  }
  const record = (label: string, revision = s.revision) => [
    ...s.history,
    { revision, label },
  ];
  if(action.type==='share-preview') {
    if(!['author','approver'].includes(s.role)||!/^\S+@\S+\.\S+$/.test(action.recipient.trim())||action.recipient.length>254||!['view','comment'].includes(action.permission))return s;
    return {...s,sharePreview:{recipient:action.recipient.trim(),permission:action.permission,revision:s.revision,objectId:s.object.id,sourceId:s.object.sourceId,objectName:s.object.name,document:s.document,quantity:s.object.quantity,unit:s.object.unit,...(action.includeAmount?{amount:s.object.quantity*s.object.rate}:{}),status:'active'},history:record('외부 공유 범위 미리보기 구성 · 미발송')};
  }
  if(action.type==='share-feedback') {
    if(!s.sharePreview||s.sharePreview.status!=='active'||s.sharePreview.permission!=='comment'||!action.message.trim()||action.message.length>500)return s;
    return {...s,sharePreview:{...s.sharePreview,feedback:action.message.trim()},history:record('수신자 의견 예시 기록 · 실제 외부 의견 아님',s.sharePreview.revision)};
  }
  if(action.type==='share-expire') {
    if(!s.sharePreview||!['author','approver'].includes(s.role))return s;
    return {...s,sharePreview:{...s.sharePreview,status:'expired'}};
  }
  if(action.type==='share-restore') {
    if(!s.sharePreview||s.sharePreview.status!=='expired'||!['author','approver'].includes(s.role)||!action.message.trim()||action.message.length>500)return s;
    return {...s,sharePreview:{...s.sharePreview,status:'active'},history:record(`기존 공유 범위 재열람 허용 체험: ${action.message.trim()}`,s.sharePreview.revision)};
  }
  if(action.type==='field-note') {
    if(!['author','reviewer'].includes(s.role)||!action.title.trim()||action.title.length>120||!action.note.trim()||action.note.length>1000||!['changed','conforming','needs-check'].includes(action.condition)||(action.photoName?.length??0)>160) return s;
    const notes=s.fieldNotes??[];
    return {...s,fieldNotes:[...notes,{id:`FIELD-${notes.length+1}`,objectId:s.object.id,sourceId:s.object.sourceId,revision:s.revision,location:s.object.location,title:action.title.trim(),note:action.note.trim(),condition:action.condition,photoName:action.photoName}],history:record(`현장 기록: ${action.title.trim()} · 예시`)};
  }
  if(action.type==='materials') {
    if(!s.approved||!['author','approver'].includes(s.role)||![action.ordered,action.received,action.installed].every(v=>Number.isFinite(v)&&v>=0&&v<=1e9)||action.received>action.ordered||action.installed>action.received||!action.reason.trim()||action.reason.length>500) return s;
    return {...s,materials:{approvedRevision:s.approved.revision,ordered:action.ordered,received:action.received,installed:action.installed,reason:action.reason.trim()},history:record('자재 현황 예시 보관 · 실제 발주·입고·지급 아님')};
  }
  if (action.type === "ai-decision") {
    if (
      action.revision !== s.revision ||
      !action.reason.trim() ||
      action.reason.length > 500 ||
      !["accepted", "dismissed"].includes(action.decision)
    )
      return s;
    return {
      ...s,
      aiDecision: {
        revision: s.revision,
        decision: action.decision,
        reason: action.reason.trim(),
      },
      history: record(
        `AI 제안 예시 ${action.decision === "accepted" ? "채택" : "기각"}: ${action.reason.trim()}`,
      ),
    };
  }
  if (action.type === "deliver") {
    const formats=action.formats??['PDF','XLSX'];
    const recipient=action.recipient?.trim()??'';
    if(!formats.length||formats.length>4||new Set(formats).size!==formats.length||formats.some(format=>!['PDF','DWG','XLSX','CSV'].includes(format))||recipient.length>120)return s;
    return s.phase === "approved" && s.role === "approver" && s.approved
      ? {
          ...s,
          deliveryPackage:{revision:s.approved.revision,formats:formats as ('PDF'|'DWG'|'XLSX'|'CSV')[],recipient},
          delivery: "prepared",
          history: record("납품 패키지 준비 · 예시"),
        }
      : s;
  }
  if (s.role === "author") {
    if (action.type === "new-revision" && s.phase === "approved")
      return {
        ...s,
        revision: s.revision + 1,
        phase: "draft",
        quantityStatus: "stale",
        request: null,
        delivery: "unprepared",
        history: record("새 개정 시작", s.revision + 1),
      };
    if (s.phase !== "draft" && s.phase !== "changes") return s;
    if(action.type==='layer-create') {
      const layers=getWorkflowLayers(s),name=action.name.trim();
      if(!name||name.length>80||layers.length>=30||layers.some(layer=>layer.name===name))return s;
      return {...s,layers:[...layers,{name,kind:'overlay',visible:true,locked:false}]};
    }
    if(action.type==='layer-toggle') {
      const layers=getWorkflowLayers(s),layer=layers.find(layer=>layer.name===action.name);
      if(!layer||!['visible','locked'].includes(action.property)||(layer.kind==='source'&&action.property==='locked'))return s;
      return {...s,layers:layers.map(layer=>layer.name===action.name?{...layer,[action.property]:!layer[action.property]}:layer)};
    }
    const currentLayer=getWorkflowLayers(s).find(layer=>layer.name===(s.object.appearance?.layer??'물량 근거'));
    if((action.type==='revise'||action.type==='properties')&&currentLayer?.locked)return s;
    if (action.type === "formula") {
      const total = Math.round((action.raw + action.correction) * 1000) / 1000;
      if (
        !s.calibrated ||
        !Number.isFinite(action.raw) ||
        !Number.isFinite(action.correction) ||
        action.raw < 0 ||
        !Number.isFinite(total) ||
        total < 0 ||
        total > 1e9 ||
        action.reason.length > 500 ||
        ((action.correction !== 0 || action.raw !== s.object.quantity) &&
          !action.reason.trim())
      )
        return s;
      const nextRevision = s.revision + (total !== s.object.quantity ? 1 : 0);
      return {
        ...s,
        object: { ...s.object, quantity: total },
        measurement: {
          raw: action.raw,
          correction: action.correction,
          reason: action.reason.trim(),
          revision: nextRevision,
          rule: "DEMO-QTY-01",
        },
        revision: nextRevision,
        quantityStatus: "current",
        phase: "draft",
        delivery: "unprepared",
        history: [
          ...s.history,
          {
            revision: nextRevision,
            label: `산출 근거 확인: ${action.raw} + (${action.correction}) = ${total} ${s.object.unit} · ${action.reason.trim() || "보정 없음"} · 예시`,
          },
        ],
      };
    }
    if (action.type === "properties") {
      if(getWorkflowLayers(s).find(layer=>layer.name===action.layer.trim())?.locked)return s;
      if (
        !action.name.trim() ||
        action.name.length > 120 ||
        !action.layer.trim() ||
        action.layer.length > 80 ||
        !/^#[0-9a-f]{6}$/i.test(action.stroke) ||
        !/^#[0-9a-f]{6}$/i.test(action.fill) ||
        !Number.isFinite(action.lineWidth) ||
        action.lineWidth < 0.1 ||
        action.lineWidth > 20
      )
        return s;
      return {
        ...s,
        object: {
          ...s.object,
          name: action.name.trim(),
          appearance: {
            layer: action.layer.trim(),
            stroke: action.stroke,
            fill: action.fill,
            lineWidth: action.lineWidth,
          },
        },
        revision: s.revision + 1,
        quantityStatus: "stale",
        phase: "draft",
        delivery: "unprepared",
        history: record(`객체 속성 변경: ${action.name.trim()} · 원본 유지`, s.revision + 1),
      };
    }
    if (action.type === "import-setup") {
      if (
        !["PDF", "IFC", "DWG"].includes(action.format) ||
        !["mm", "m"].includes(action.unit) ||
        !Number.isInteger(action.page) ||
        action.page < 1 ||
        action.page > 9999
      )
        return s;
      return {
        ...s,
        importSetup: {
          format: action.format,
          unit: action.unit,
          page: action.page,
        },
        history: record(`${action.format} 가져오기 설정 확인 · 실제 변환 아님`),
      };
    }
    if (action.type === "rate") {
      const source=action.reference?s.pricebook?.find(item=>item.code===action.reference?.code&&item.version===action.reference.version):undefined;
      if(action.reference&&(!source||source.rate!==action.rate||source.unit!==action.unit))return s;
      if (
        !Number.isFinite(action.rate) ||
        action.rate < 0 ||
        action.unit !== s.object.unit ||
        (action.rate === s.object.rate && JSON.stringify(source)===JSON.stringify(s.object.rateSource))
      )
        return s;
      const {rateSource: previousRateSource,...object}=s.object;
      return {
        ...s,
        object: { ...object, rate: action.rate,...(source?{rateSource:{...source}}:{}) },
        revision: s.revision + 1,
        phase: "draft",
        quantityStatus: "stale",
        delivery: "unprepared",
        history: record(
          `단가 변경: ${s.object.rate} → ${action.rate}원/${action.unit} · 재검토 필요`,
          s.revision + 1,
        ),
      };
    }
    if (action.type === "calibrate") {
      const length=action.length??6000, unit=action.unit??'mm';
      if(!Number.isFinite(length)||length<=0||length>1e9||!['mm','m'].includes(unit))return s;
      return { ...s, calibrated: true, scale:{length,unit}, quantityStatus: "stale", history:record(`축척 기준 ${length} ${unit} · 예시 구간 설정`) };
    }
    if (action.type === "calculate" && s.calibrated)
      return {
        ...s,
        quantityStatus: "current",
        history: record("산출 결과 확인 · 예시"),
      };
    if (action.type === "revise")
      return {
        ...s,
        object: {
          ...s.object,
          geometryChanged: true,
          quantity: s.object.quantity + (s.scenario === "civil" ? 6 : 4),
        },
        revision: s.revision + 1,
        phase: "draft",
        quantityStatus: "stale",
        delivery: "unprepared",
        history: record("객체 수정 · 재검토 필요", s.revision + 1),
      };
    if (
      action.type === "request" &&
      action.message.trim() &&
      s.calibrated &&
      s.quantityStatus === "current"
    )
      return {
        ...s,
        phase: "requested",
        request: {
          objectId: s.object.id,
          revision: s.revision,
          message: action.message.trim(),
        },
        history: record("검토 요청 · 예시"),
      };
  }
  if (s.role === "reviewer" && s.phase === "requested") {
    if (action.type === "correction" && action.message.trim())
      return {
        ...s,
        phase: "changes",
        history: record(`수정 요청: ${action.message.trim()}`),
      };
    if (action.type === "review")
      return { ...s, phase: "reviewed", history: record("검토 완료 · 예시") };
  }
  if (
    s.role === "approver" &&
    s.phase === "reviewed" &&
    action.type === "approve"
  )
    return {
      ...s,
      phase: "approved",
      approved: {
        revision: s.revision,
        quantity: s.object.quantity,
        amount: s.object.quantity * s.object.rate,
        objectId: s.object.id,
        sourceId: s.object.sourceId,
        objectName: s.object.name,
        document: s.document,
        unit: s.object.unit,
        rate: s.object.rate,
        ...(s.object.rateSource?{rateSource:{...s.object.rateSource}}:{}),
      },
      history: record("승인 · 예시"),
    };
  return s;
}

export function workflowFindings(s: Workflow) {
  // Findings remain independent from simulated network/permission availability.
  const results: {
    id: string;
    objectId: string;
    title: string;
    detail: string;
    panel: string;
  }[] = [];
  if (!s.calibrated)
    results.push({
      id: "scale",
      objectId: s.object.id,
      title: "축척 설정 필요",
      detail: "실측 전에 기준 길이와 페이지 단위를 확인하세요.",
      panel: "scale",
    });
  if (s.quantityStatus !== "current")
    results.push({
      id: "quantity",
      objectId: s.object.id,
      title:
        s.quantityStatus === "stale" ? "변경 수량 재검토" : "수량 산출 준비",
      detail: `${s.object.location} · R${s.revision}의 근거를 확인하세요.`,
      panel: "formula",
    });
  if (s.phase === "requested" || s.phase === "reviewed")
    results.push({
      id: "review",
      objectId: s.object.id,
      title: s.phase === "requested" ? "검토 의견 대기" : "최종 승인 대기",
      detail: s.request?.message ?? "",
      panel: "review",
    });
  return results;
}

export const workflowPages = [
  ["home", "시작 홈", "시작"],
  ["projects", "프로젝트 목록", "시작"],
  ["tasks", "내 할 일", "시작"],
  ["overview", "프로젝트 개요", "개요"],
  ["documents", "도면·자료", "도면/모델"],
  ["start", "새 작업 준비", "도면/모델"],
  ["workspace", "작업실", "도면/모델"],
  ["presentation", "3D 장면·발표", "도면/모델"],
  ["quantities", "수량 산출서", "적산"],
  ["estimate", "내역서", "적산"],
  ["budget", "예산·금액 비교", "적산"],
  ["payments", "계약·기성 검토", "적산"],
  ["rates", "회사 단가", "적산"],
  ["changes", "변경 관리", "검토"],
  ["issues", "이슈 목록", "검토"],
  ["reviews", "검토·승인함", "검토"],
  ["submittals", "제출물 검토", "검토"],
  ["delivery", "납품·인계", "납품"],
  ["transmittals", "배포·수신 대장", "납품"],
  ["handover", "준공·자산 인계", "납품"],
  ["library", "회사 라이브러리", "관리"],
  ["standards", "속성·분류 기준", "관리"],
  ["settings", "구성원·설정", "관리"],
  ["field", "현장·검측", "현장"],
  ["daily", "일일 작업 보고", "현장"],
  ["schedule", "공정·작업 구간", "현장"],
  ["materials", "자재·기성", "현장"],
  ["carbon", "탄소 근거", "현장"],
] as const;
export type WorkflowPage = (typeof workflowPages)[number][0];
/** Preview policy only; never replaces production authorization. */
export function workflowExceptionAllows(
  exception: string,
  action: WorkflowAction,
) {
  if (["ai", "missing"].includes(exception) && action.type === "ai-decision")
    return false;
  if (
    ["permission", "expired", "loading", "empty", "unsupported"].includes(
      exception,
    )
  )
    return false;
  if (
    exception === "missing" &&
    [
      "calculate",
      "formula",
      "request",
      "review",
      "approve",
      "deliver",
    ].includes(action.type)
  )
    return false;
  if (
    exception === "offline" &&
    ["request", "review", "approve", "deliver"].includes(action.type)
  )
    return false;
  return true;
}
export const workflowPanels = [
  ["scale", "축척·단위"],
  ["compatibility", "파일 호환성"],
  ["properties", "객체 속성·레이어"],
  ["model", "모델 구조·단면"],
  ["formula", "산출식·보정 근거"],
  ["rate", "품목·단가 연결"],
  ["compare", "변경 전후 비교"],
  ["request", "검토 요청"],
  ["review", "의견·수정 요청"],
  ["approval", "승인·새 개정"],
  ["findings", "확인할 항목·AI"],
  ["share", "공유·초대"],
] as const;
export const workflowExceptions = [
  ["empty", "빈 프로젝트"],
  ["loading", "업로드·변환 중"],
  ["unsupported", "변환 실패·일부 미지원"],
  ["required", "필수 정보 누락"],
  ["stale", "변경 후 미갱신"],
  ["missing", "원본 연결 끊김"],
  ["permission", "권한 부족"],
  ["expired", "초대·링크 만료"],
  ["offline", "오프라인·저장 충돌"],
  ["ai", "AI 자료 부족"],
] as const;
