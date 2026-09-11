import type { Route } from "./+types/workspace-preview";

import { BellOff, FileText, Search } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useBlocker, useNavigate, useSearchParams } from "react-router";

import { Button } from "~/core/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/core/components/ui/dialog";
import { ProjectDrawingsBrowser, type ProjectDrawingSummary } from "~/lukas/components/project-drawings-browser";
import {ProjectChangeRequestsPreview} from "~/lukas/components/project-change-requests-preview";
import { parseReviewLoopSession, reviewLoopLabels, type ReviewLoopState } from "~/lukas/components/drawing-review-loop";
import { WorkspaceDashboard } from "~/lukas/components/workspace-dashboard";
import { ProjectChangePreview } from "~/lukas/components/project-change-preview";
import { ProjectDeliveryPreview } from "~/lukas/components/project-delivery-preview";
import { ProjectResourcesPreview } from "~/lukas/components/project-resources-preview";
import { ProjectSharingPreview, ProjectGuestPreview, ExternalRequestPanel } from "~/lukas/components/project-sharing-preview";
import { DrawingMaterialPreview } from "~/lukas/components/drawing-material-preview";
import { WorkspaceManagementPreview } from "~/lukas/components/workspace-management-preview";
import { DrawingTeamPreview } from "~/lukas/components/drawing-team-preview";
import { DrawingNativeStartPreview, DrawingRegistrationPreview, type RegistrationRecord, type RegistrationChoice } from "~/lukas/components/drawing-native-start-preview";
import {
  localPdfSelectionError,
  stageLocalPdf,
} from "~/lukas/lib/drawing-pdf-screen-handoff";

const previewDate = "2026-09-07T03:00:00.000Z";
const localProjectPattern = /^00000000-0000-4000-9000-[0-9a-f]{12}$/;
type LocalProject = { id: string; name: string; description: string; workflow_status: string; created_at: string; updated_at: string };
const localProjectsKey = "1hk:preview:projects";
type LocalDrawing = {id: string; project_id: string; title: string; updated_at: string; source_file_id: null; previewStartKind: "blank" | "office" | "house" | "pdf"; previewPaper: "A2" | "A3" | "A4"};
type ReviewEntry = {document: ProjectDrawingSummary & {project_id?: string}; state: ReviewLoopState};
const localDrawingsKey = "1hk:preview:drawings";

export function saveLocalPreviewDrawing(current: LocalDrawing[], drawing: LocalDrawing, storage: Pick<Storage, "setItem">): LocalDrawing[] {
  const next = [...current, drawing];
  storage.setItem(localDrawingsKey, JSON.stringify(next));
  return next;
}

export function parseLocalPreviewProjects(raw: string): LocalProject[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((p): p is LocalProject => Boolean(p && typeof p === "object" &&
      typeof p.id === "string" && localProjectPattern.test(p.id) &&
      typeof p.name === "string" && p.name.trim().length > 0 && p.name.length <= 80 &&
      typeof p.description === "string" && p.description.length <= 300 &&
      typeof p.workflow_status === "string" && typeof p.created_at === "string" && typeof p.updated_at === "string"));
  } catch { return []; }
}

const organizations = [
  {
    id: "00000000-0000-4000-8000-000000000201",
    name: "개인 작업공간",
    can_manage: true,
    is_personal: true,
  },
];

const projects = [
  {
    id: "00000000-0000-4000-8000-000000000101",
    name: "성수동 사무실",
    description: "사무공간 평면 계획과 도면 검토",
    workflow_status: "expert_review",
    created_at: "2026-09-01T03:00:00.000Z",
    updated_at: previewDate,
  },
  {
    id: "00000000-0000-4000-8000-000000000102",
    name: "판교 주택 리모델링",
    description: "주택 리모델링 설계와 발행 도면",
    shared: true,
    workflow_status: "bim_modeling",
    created_at: "2026-09-02T03:00:00.000Z",
    updated_at: previewDate,
  },
  {
    id: "00000000-0000-4000-8000-000000000103",
    name: "강남 카페",
    description: "카페 인테리어 평면과 검토 항목",
    workflow_status: "quantity_takeoff",
    created_at: "2026-09-03T03:00:00.000Z",
    updated_at: previewDate,
  },
];

const projectDocuments = {
  [projects[0].id]: [
    {
      id: "00000000-0000-4000-8000-000000000111",
      project_id: projects[0].id,
      title: "1층 평면도",
      source_file_id: "00000000-0000-4000-8000-000000000121",
      updated_at: previewDate,
      thumbnailUrl: "/images/workspace-start/office-plan.png",
    },
    {
      id: "00000000-0000-4000-8000-000000000112",
      project_id: projects[0].id,
      title: "아이디어 스케치",
      source_file_id: null,
      updated_at: "2026-09-06T03:00:00.000Z",
      thumbnailUrl: "/images/workspace-start/house-plan.png",
    },
    {
      id: "00000000-0000-4000-8000-000000000113",
      project_id: projects[0].id,
      title: "기존 DXF 평면",
      source_file_id: "00000000-0000-4000-8000-000000000122",
      updated_at: "2026-09-05T03:00:00.000Z",
    },
  ],
  [projects[1].id]: [
    {
      id: "00000000-0000-4000-8000-000000000114",
      project_id: projects[1].id,
      title: "리모델링 평면도",
      source_file_id: "00000000-0000-4000-8000-000000000124",
      updated_at: previewDate,
      thumbnailUrl: "/images/workspace-start/house-plan.png",
    },
  ],
  [projects[2].id]: [
    {
      id: "00000000-0000-4000-8000-000000000115",
      project_id: projects[2].id,
      title: "카페 배치도",
      source_file_id: "00000000-0000-4000-8000-000000000125",
      updated_at: previewDate,
      thumbnailUrl: "/images/workspace-start/office-plan.png",
    },
  ],
};

const projectFiles = {
  [projects[0].id]: [
    {
      id: "00000000-0000-4000-8000-000000000121",
      kind: "pdf",
      original_filename: "성수동_1층.pdf",
      byte_size: 2_420_000,
      created_at: previewDate,
    },
    {
      id: "00000000-0000-4000-8000-000000000122",
      kind: "dxf",
      original_filename: "성수동_기존.dxf",
      byte_size: 984_000,
      created_at: "2026-09-05T03:00:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000000123",
      kind: "ifc",
      original_filename: "성수동_모델.ifc",
      byte_size: 18_700_000,
      created_at: "2026-09-04T03:00:00.000Z",
    },
  ],
  [projects[1].id]: [
    {
      id: "00000000-0000-4000-8000-000000000124",
      kind: "pdf",
      original_filename: "판교_리모델링.pdf",
      byte_size: 1_810_000,
      created_at: previewDate,
    },
  ],
  [projects[2].id]: [
    {
      id: "00000000-0000-4000-8000-000000000125",
      kind: "pdf",
      original_filename: "강남카페_배치.pdf",
      byte_size: 1_220_000,
      created_at: previewDate,
    },
  ],
};

const drawings = Object.values(projectDocuments).flat();

const projectMetrics = Object.fromEntries(
  projects.map((project, index) => [
    project.id,
    {
      canCreateWorkspace: true,
      fileCount: projectFiles[project.id].length,
      ifcCount: projectFiles[project.id].filter((file) => file.kind === "ifc")
        .length,
      openReviewCount: [3, 2, 1][index],
      memberCount: [5, 4, 3][index],
      latestIfcId:
        projectFiles[project.id].find((file) => file.kind === "ifc")?.id ??
        null,
      latestDrawingId: projectDocuments[project.id][0].id,
      unresolvedDrawingCount: [3, 2, 1][index],
      assignedToMeCount: [1, 2, 0][index],
      latestFilename: projectDocuments[project.id][0].title,
    },
  ]),
);

const activities = projects.slice(0, 2).map((project, index) => ({
  id: `00000000-0000-4000-8000-00000000013${index + 1}`,
  projectId: project.id,
  projectName: project.name,
  kind: index === 0 ? ("review" as const) : ("file" as const),
  title: index === 0 ? "도면 검토가 업데이트되었습니다." : "1층 평면도",
  detail:
    index === 0
      ? "치수 검토 항목을 확인하세요."
      : "최근 도면이 추가되었습니다.",
  createdAt: previewDate,
}));

const previewTemplates = [
  {
    kind: "office" as const,
    title: "사무실 평면",
    summary: "회의실과 업무 좌석이 포함된 1층 배치 예시",
    image: "/images/workspace-start/office-plan.png",
    keywords: "사무실 오피스 업무 회의실",
  },
  {
    kind: "house" as const,
    title: "주택 리모델링",
    summary: "생활 동선과 공용 공간을 살펴보는 주택 예시",
    image: "/images/workspace-start/house-plan.png",
    keywords: "주택 집 리모델링 생활",
  },
];

export function filterWorkspacePreviewTemplates(search: string) {
  const needle = search.trim().toLocaleLowerCase("ko-KR");
  if (!needle) return previewTemplates;
  return previewTemplates.filter((template) =>
    `${template.title} ${template.summary} ${template.keywords}`
      .toLocaleLowerCase("ko-KR")
      .includes(needle),
  );
}

export function workspacePreviewDrawingTitleError(title: string) {
  return title.trim() ? null : "도면 제목을 입력해 주세요.";
}

type DrawingWorkspacePreviewStart = {
  documentId?: string;
  paper?: "A2" | "A3" | "A4";
  pdf?: string;
  reviewPreview?: boolean;
  workflowPanel?: "review" | "export" | "share";
  takeoffPreview?: boolean;
  reviewState?: "requested" | "changes" | "approved";
  startKind?: "blank" | "office" | "house" | "pdf";
  title?: string;
};

const localPreviewBase = new URL(
  "http://workspace-preview.local/workspace-preview",
);

function safeWorkspacePreviewOrigin(href: string) {
  try {
    const candidate = new URL(href, localPreviewBase);
    return candidate.origin === localPreviewBase.origin &&
      candidate.pathname === localPreviewBase.pathname
      ? candidate
      : null;
  } catch {
    return null;
  }
}

function workspacePreviewStartHref(
  closeHref: string,
  start: "blank" | "template" | "file" | "dwg" | "ifc",
) {
  const origin =
    safeWorkspacePreviewOrigin(closeHref) ??
    new URL("/workspace-preview?state=empty", localPreviewBase);
  origin.searchParams.set("start", start);
  return `${origin.pathname}?${origin.searchParams}`;
}

export function drawingWorkspacePreviewHref(
  closeHref: string,
  start: DrawingWorkspacePreviewStart,
) {
  const query = new URLSearchParams({ layout: "pdf" });
  if (start.documentId) query.set("screenDocument", start.documentId);
  if (start.pdf) query.set("pdf", start.pdf);
  if (start.startKind) query.set("startKind", start.startKind);
  if (start.title !== undefined)
    query.set("title", start.title.trim().slice(0, 80));
  if (start.paper) query.set("paper", start.paper);
  if (start.reviewPreview) query.set("reviewPreview", "1");
  if (start.workflowPanel && ["review", "export", "share"].includes(start.workflowPanel)) query.set("workflowPanel", start.workflowPanel);
  if (start.takeoffPreview) query.set("takeoffPreview", "1");
  if (
    start.reviewState &&
    ["requested", "changes", "approved"].includes(start.reviewState)
  )
    query.set("reviewState", start.reviewState);

  const origin = safeWorkspacePreviewOrigin(closeHref);

  if (origin) {
    const returnProject = origin.searchParams.get("project");
    if (projects.some((project) => project.id === returnProject) || (returnProject && localProjectPattern.test(returnProject)))
      query.set("returnProject", returnProject!);
    const returnState = origin.searchParams.get("state");
    if (returnState === "default" || returnState === "empty")
      query.set("returnState", returnState);
    if (origin.searchParams.get("empty") === "1") query.set("returnEmpty", "1");
    if (origin.searchParams.get("tab") === "files")
      query.set("returnTab", "files");
    if (origin.searchParams.get("role") === "viewer")
      query.set("role", "viewer");
  }

  return `/workspace-preview/drawing-workspace?${query}`;
}

const projectReviews = [
  {
    id: "review-door",
    title: "회의실 출입문 폭 확인",
    detail: "휠체어 통행 폭과 문 열림 방향을 함께 확인합니다.",
    status: "검토 중" as const,
    reviewState: "requested" as const,
  },
  {
    id: "review-route",
    title: "비상 동선 표기 수정",
    detail: "복도 끝 피난 방향 표기를 최신안과 맞춥니다.",
    status: "수정 필요" as const,
    reviewState: "changes" as const,
  },
  {
    id: "review-desk",
    title: "업무 좌석 배치 확인",
    detail: "창가 좌석과 주 통로 간격 검토를 마쳤습니다.",
    status: "완료" as const,
    reviewState: "approved" as const,
  },
];

type PreviewDialog =
  | {
      kind: "project-files";
      files: Array<{
        id: string;
        kind: string;
        original_filename: string;
        byte_size: number;
        created_at: string;
      }>;
    }
  | {
      kind:
        | "blank"
        | "new-project"
        | "dwg"
        | "ifc"
        | "template"
        | "file"
        | "library"
        | "settings"
        | "notifications"
        | "project-overview"
        | "project-reviews"
        | "project-changes"
        | "project-resources"
        | "project-sharing"
        | "project-quantities"
        | "project-materials"
        | "project-deliveries"
        | "project-members";
    };

export function resolveWorkspacePreview(search: string, localProjects: LocalProject[] = [], localDrawings: LocalDrawing[] = []) {
  const query = new URLSearchParams(search);
  const state = query.get("state");
  const start = query.get("start");
  const panel = query.get("panel");
  const projectId = query.get("project");
  const availableProjects = [...localProjects, ...projects];
  const requestedProject = availableProjects.find((project) => project.id === projectId);
  const validStart =
    start === "blank" || start === "template" || start === "file" || start === "dwg" || start === "ifc"
      ? start
      : null;
  const isEmpty =
    (state === "empty" && !requestedProject) ||
    (validStart !== null && !requestedProject && state !== "default");
  const visibleProjects = isEmpty ? [] : availableProjects;
  const visibleDrawings = isEmpty ? [] : [...localDrawings.filter(d => availableProjects.some(p => p.id === d.project_id)), ...drawings];
  const selectedProject = visibleProjects.find(
    (project) => project.id === projectId,
  );

  const selectedProjectData = selectedProject
    ? {
        project: selectedProject,
        documents:
          query.get("empty") === "1"
            ? []
            : [...localDrawings.filter(d => d.project_id === selectedProject.id), ...(projectDocuments[selectedProject.id] ?? [])],
        files:
          query.get("empty") === "1" ? [] : projectFiles[selectedProject.id] ?? [],
        canCreateWorkspace: query.get("role") !== "viewer",
      }
    : null;

  let dialog: PreviewDialog | null = null;
  if (
    validStart &&
    (!selectedProjectData || selectedProjectData.canCreateWorkspace)
  ) {
    dialog = { kind: validStart };
  } else if (panel === "project-files" && selectedProjectData) {
    dialog = { kind: "project-files", files: selectedProjectData.files };
  } else if (
    panel === "new-project" ||
    panel === "library" ||
    panel === "settings" ||
    panel === "notifications" ||
    (selectedProject &&
      (panel === "project-overview" ||
        panel === "project-changes" ||
        panel === "project-resources" ||
        panel === "project-sharing" ||
        panel === "project-reviews" ||
        panel === "project-quantities" ||
        panel === "project-materials" ||
        panel === "project-deliveries" ||
        panel === "project-members"))
  ) {
    dialog = { kind: panel };
  }

  const explicitState = state === "empty" || state === "default";
  const selectedProjectHref = selectedProject
    ? `/workspace-preview?${new URLSearchParams({
        project: selectedProject.id,
        ...(query.get("role") === "viewer" ? { role: "viewer" } : {}),
        ...(query.get("empty") === "1" ? { empty: "1" } : {}),
        ...(query.get("tab") === "files" ? { tab: "files" } : {}),
      }).toString()}`
    : null;
  let closeHref =
    selectedProjectHref && dialog
      ? selectedProjectHref
      : validStart && dialog
        ? `/workspace-preview?state=${state === "default" ? "default" : "empty"}`
        : explicitState
          ? `/workspace-preview?state=${state}`
          : "/workspace-preview";
  if (query.get("role") === "viewer") {
    const origin = new URL(closeHref, "http://preview.local");
    origin.searchParams.set("role", "viewer");
    closeHref = `${origin.pathname}${origin.search}`;
  }

  return {
    activities: isEmpty ? [] : activities,
    activeScope: {
      key: organizations[0].id,
      kind: "organization" as const,
      name: organizations[0].name,
      organizationId: organizations[0].id,
      can_manage: true,
      is_personal: true,
    },
    closeHref,
    dialog,
    drawings: visibleDrawings,
    hasAccessibleProjects: !isEmpty,
    organizations,
    projectMetrics: isEmpty ? {} : projectMetrics,
    projects: visibleProjects,
    selectedProject: selectedProjectData,
  };
}

export function PreviewDialogContent({
  dialog,
  closeHref,
  onOpenPdf,
  onCreateProject,
  onStartDrawing,
  localDrawingCount = 0,
  reviewEntries,
  reviewReadError = false,
  registrationDocuments = [],
}: {
  dialog: PreviewDialog;
  closeHref: string;
  onOpenPdf: (file: File, record?: RegistrationRecord) => void;
  onCreateProject?: (name: string, description: string) => void;
  onStartDrawing?: (start: DrawingWorkspacePreviewStart) => void;
  localDrawingCount?: number;
  reviewEntries?: ReviewEntry[];
  reviewReadError?: boolean;
  registrationDocuments?: {id: string; title: string}[];
}) {
  const navigate = useNavigate();
  const [notificationExample, setNotificationExample] = useState(false);
  const [notificationKind, setNotificationKind] = useState("검토 요청");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pdfRegistrationOpen, setPdfRegistrationOpen] = useState(false);
  const [pdfRegistrationChoice, setPdfRegistrationChoice] = useState<RegistrationChoice | undefined>();
  const [drawingTitle, setDrawingTitle] = useState("제목 없는 도면");
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectError, setProjectError] = useState("");
  const [paper, setPaper] = useState<"A2" | "A3" | "A4">("A3");
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateTitle, setTemplateTitle] = useState(previewTemplates[0].title);
  const [selectedTemplateKind, setSelectedTemplateKind] =
    useState<(typeof previewTemplates)[number]["kind"]>("office");
  const [reviewFilter, setReviewFilter] = useState<
    "전체" | (typeof projectReviews)[number]["status"]
  >("전체");
  const selectedTemplate =
    previewTemplates.find(
      (template) => template.kind === selectedTemplateKind,
    ) ?? previewTemplates[0];
  const visibleTemplates = filterWorkspacePreviewTemplates(templateSearch);
  const selectedProject = projects.find((project) =>
    closeHref.includes(`project=${project.id}`),
  );
  const drawingTitleError = workspacePreviewDrawingTitleError(drawingTitle);
  const templateTitleError = workspacePreviewDrawingTitleError(templateTitle);

  if (dialog.kind === "notifications" && (reviewEntries?.length || reviewReadError)) {
    return <>
      <DialogHeader><DialogTitle>알림 작업함 · 로컬 검토 활동</DialogTitle><DialogDescription>이 탭에서 체험한 도면별 최신 검토 상태입니다. 실제 수신 알림·담당자 배정·읽음 기록은 아닙니다.</DialogDescription></DialogHeader>
      {reviewReadError && <p role="alert" className="text-sm text-destructive">일부 검토 기록을 읽지 못했습니다. 해당 도면에서 확인해 주세요.</p>}
      <ul className="grid gap-3">{(reviewEntries ?? []).map(({document,state}) => {
        const origin = new URL(closeHref, "http://preview.local");
        if (document.project_id) origin.searchParams.set("project", document.project_id);
        const href = drawingWorkspacePreviewHref(`${origin.pathname}${origin.search}`, {documentId:document.id, startKind:document.previewStartKind ?? (document.thumbnailUrl?.endsWith("house-plan.png") ? "house" : document.source_file_id ? "office" : "blank"),paper:document.previewPaper,title:document.title,workflowPanel:"review"});
        return <li key={document.id} className="rounded-xl border p-4"><h2 className="break-words font-semibold">{document.title}</h2><p className="mt-1 text-sm">R{state.revision} · {state.page}쪽 · {reviewLoopLabels[state.phase]}</p><p className="mt-2 break-words text-sm">{state.message || state.issue || "새 개정 작성 중"}</p><Button asChild variant="outline" className="mt-3"><Link to={href}>해당 도면에서 검토 확인</Link></Button></li>;
      })}</ul>
    </>;
  }

  if (dialog.kind === "project-sharing" || dialog.kind === "project-resources" || dialog.kind === "project-changes") {
    return <ProjectSupplement kind={dialog.kind} closeHref={closeHref} reviewEntries={reviewEntries} reviewReadError={reviewReadError}/>;
  }
  if (dialog.kind === "project-reviews" && reviewEntries !== undefined) {
    return <ProjectReviewContent closeHref={closeHref} reviewEntries={reviewEntries} reviewReadError={reviewReadError}/>;
  }

  const localProjectId = safeWorkspacePreviewOrigin(closeHref)?.searchParams.get("project") ?? "";
  const emptyLocalPanels = {
    "project-overview": ["프로젝트 개요", localDrawingCount ? `미리보기 도면 ${localDrawingCount}개` : "도면을 시작할 준비가 되었습니다.", "도면 목록의 제목과 시작 설정만 이 탭에 보관합니다. 편집·검토·물량 기록은 아직 연결되지 않았습니다."],
    "project-reviews": ["검토", "아직 검토 요청이 없습니다.", "도면을 작성하고 변경 내용을 검토 요청하면 이곳에서 확인합니다."],
    "project-quantities": ["물량", "아직 연결된 물량이 없습니다.", "도면 객체와 근거를 연결한 뒤 수량을 확인하세요."],
    "project-materials": ["자재", "아직 연결된 자재가 없습니다.", "검토한 물량과 내역을 바탕으로 자재를 연결하세요."],
    "project-members": ["참여자", "아직 초대한 참여자가 없습니다.", "현재는 로컬 화면 체험입니다. 실제 초대나 권한 변경은 이루어지지 않습니다."],
  };
  if (localProjectPattern.test(localProjectId) && dialog.kind in emptyLocalPanels) {
    const [title, heading, description] = emptyLocalPanels[dialog.kind as keyof typeof emptyLocalPanels];
    const viewer = safeWorkspacePreviewOrigin(closeHref)?.searchParams.get("role") === "viewer";
    return <>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>새 프로젝트 · 브라우저 탭에만 보관하는 화면 예시</DialogDescription></DialogHeader>
      <section className="rounded-xl border border-dashed p-6 text-center"><h2 className="font-semibold">{heading}</h2><p className="mt-2 text-sm text-muted-foreground">{description}</p></section>
      {viewer ? <p className="text-sm text-muted-foreground">보기 전용입니다. 작성자에게 도면 등록을 요청하세요.</p> : <Button asChild variant="outline"><Link to={workspacePreviewStartHref(closeHref, "blank")}>도면에서 시작하기</Link></Button>}
    </>;
  }

  if (dialog.kind === "dwg" || dialog.kind === "ifc") {
    return <><DialogHeader><DialogTitle>{dialog.kind.toUpperCase()} 가져오기 준비</DialogTitle><DialogDescription>파일 선택부터 작업실 진입까지의 화면 흐름을 확인합니다.</DialogDescription></DialogHeader>
      <nav aria-label="파일 시작 탐색" className="grid gap-2">
        <Button asChild variant="outline"><Link to={workspacePreviewStartHref(closeHref, "file")}>파일 형식 선택으로 돌아가기</Link></Button>
        <p className="text-xs text-muted-foreground">돌아가면 선택한 파일 이름과 준비 설정은 초기화됩니다. 프로젝트와 기존 도면은 변경되지 않습니다.</p>
      </nav>
      <DrawingNativeStartPreview key={dialog.kind} kind={dialog.kind} documents={registrationDocuments} onOpen={(view, title, registrationPreview) => {
        const href = drawingWorkspacePreviewHref(closeHref, {startKind: "blank", title});
        void navigate(`${href}&view=${view}`, {state: {registrationPreview}});
      }} />
    </>;
  }
  if (dialog.kind === "new-project") {
    return <>
      <DialogHeader><DialogTitle>새 프로젝트</DialogTitle><DialogDescription>도면 없이도 프로젝트를 시작할 수 있습니다. 이 브라우저 탭에서만 사용하는 화면 예시이며 실제 계정에 저장되지 않습니다.</DialogDescription></DialogHeader>
      <form className="grid gap-4" onSubmit={(event) => {
        event.preventDefault();
        if (!projectName.trim()) { setProjectError("프로젝트 이름을 입력해 주세요."); return; }
        onCreateProject?.(projectName.trim(), projectDescription.trim());
      }}>
        <label className="grid gap-2 text-sm">프로젝트 이름<input className="min-h-11 rounded-lg border px-3" autoFocus maxLength={80} value={projectName} onChange={e => {setProjectName(e.target.value);setProjectError("");}} aria-invalid={Boolean(projectError)} /></label>
        <label className="grid gap-2 text-sm">설명 · 선택<textarea aria-label="설명 · 선택" className="rounded-lg border p-3" maxLength={300} rows={3} value={projectDescription} onChange={e => setProjectDescription(e.target.value)} /></label>
        {projectError ? <p role="alert" className="text-sm text-red-700">{projectError}</p> : null}
        <Button type="submit" disabled={!onCreateProject}>미리보기 프로젝트 만들기</Button>
      </form>
    </>;
  }
  if (dialog.kind === "blank") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>새 도면</DialogTitle>
          <DialogDescription>
            이름과 용지를 정한 뒤 화면 미리보기 작업실을 엽니다. 변경 내용은
            프로젝트에 저장되지 않습니다.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-xl border border-[#d9d7ff] bg-[#f7f6ff] px-4 py-3 text-sm dark:bg-[#222131]">
          <strong className="text-[#2925d9] dark:text-[#b9b7ff]">
            화면 미리보기
          </strong>
          <span className="ml-2 text-muted-foreground">
            브라우저에서만 체험하며 영구 저장되지 않습니다.
          </span>
        </div>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (drawingTitleError) return;
            if (onStartDrawing) { onStartDrawing({paper, startKind: "blank", title: drawingTitle}); return; }
            void navigate(
              drawingWorkspacePreviewHref(closeHref, {
                paper,
                startKind: "blank",
                title: drawingTitle,
              }),
            );
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium sm:col-span-2">
              도면 제목
              <input
                aria-invalid={Boolean(drawingTitleError)}
                className="h-10 rounded-lg border bg-background px-3 font-normal outline-none focus-visible:ring-2 focus-visible:ring-[#2925d9]"
                maxLength={80}
                onChange={(event) => setDrawingTitle(event.currentTarget.value)}
                value={drawingTitle}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              용지
              <select
                className="h-10 rounded-lg border bg-background px-3 font-normal"
                onChange={(event) =>
                  setPaper(event.currentTarget.value as "A2" | "A3" | "A4")
                }
                value={paper}
              >
                <option value="A3">A3 가로</option>
                <option value="A4">A4 가로</option>
                <option value="A2">A2 가로</option>
              </select>
            </label>
            <p className="self-end pb-2 text-xs leading-5 text-muted-foreground">
              용지 이름만 미리 봅니다. 실제 문서 설정은 저장되지 않습니다.
            </p>
          </div>
          {drawingTitleError ? (
            <p className="text-sm text-destructive" role="alert">
              {drawingTitleError}
            </p>
          ) : null}
          <Button
            className="w-full"
            disabled={Boolean(drawingTitleError)}
            type="submit"
          >
            새 도면 열기
          </Button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          예시 구성을 먼저 보고 싶다면{" "}
          <Link
            className="font-semibold text-[#2925d9] underline underline-offset-4 dark:text-[#b9b7ff]"
            to={workspacePreviewStartHref(closeHref, "template")}
          >
            템플릿에서 시작
          </Link>
        </p>
      </>
    );
  }

  if (dialog.kind === "template" || dialog.kind === "library") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>도면 템플릿</DialogTitle>
          <DialogDescription>
            파일 없이 시작할 이미지 레이아웃 예시를 선택하세요.
          </DialogDescription>
        </DialogHeader>
        <label className="relative block">
          <span className="sr-only">템플릿 검색</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="템플릿 검색"
            className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#2925d9]"
            onChange={(event) => setTemplateSearch(event.currentTarget.value)}
            placeholder="템플릿 검색"
            type="search"
            value={templateSearch}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          {visibleTemplates.map((template) => (
            <button
              aria-pressed={template.kind === selectedTemplate.kind}
              className="overflow-hidden rounded-xl border text-left transition hover:border-[#2925d9] aria-pressed:border-[#2925d9] aria-pressed:ring-2 aria-pressed:ring-[#2925d9]/20"
              key={template.kind}
              onClick={() => {
                setSelectedTemplateKind(template.kind);
                setTemplateTitle(template.title);
              }}
              type="button"
            >
              <img
                alt={`${template.title} 이미지 레이아웃 예시`}
                className="h-32 w-full bg-[#fafaff] object-contain p-3"
                src={template.image}
              />
              <span className="block border-t px-3 py-3">
                <strong className="block text-sm">{template.title}</strong>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  {template.summary}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div hidden={visibleTemplates.length > 0}>
          <div className="grid place-items-center gap-3 rounded-xl border border-dashed py-7 text-center">
            <p className="text-sm font-medium">검색 결과가 없습니다.</p>
            <Button
              onClick={() => setTemplateSearch("")}
              type="button"
              variant="outline"
            >
              검색 초기화
            </Button>
          </div>
        </div>
        <div className="rounded-xl bg-muted p-4">
          <p className="text-xs font-semibold text-[#2925d9] dark:text-[#b9b7ff]">
            선택한 템플릿
          </p>
          <h3 className="mt-1 font-semibold">{selectedTemplate.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {selectedTemplate.summary}
          </p>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          이미지 레이아웃 예시이며 편집 가능한 벡터 도면을 가져오지 않습니다.
        </p>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (templateTitleError) return;
            if (onStartDrawing) { onStartDrawing({startKind: selectedTemplate.kind, title: templateTitle}); return; }
            void navigate(
              drawingWorkspacePreviewHref(closeHref, {
                startKind: selectedTemplate.kind,
                title: templateTitle,
              }),
            );
          }}
        >
          <label className="grid gap-2 text-sm font-medium">
            템플릿 도면 제목
            <input
              aria-invalid={Boolean(templateTitleError)}
              className="h-10 rounded-lg border bg-background px-3 font-normal outline-none focus-visible:ring-2 focus-visible:ring-[#2925d9]"
              maxLength={80}
              onChange={(event) => setTemplateTitle(event.currentTarget.value)}
              value={templateTitle}
            />
          </label>
          {templateTitleError ? (
            <p className="text-sm text-destructive" role="alert">
              {templateTitleError}
            </p>
          ) : null}
          <Button
            className="w-full"
            disabled={Boolean(templateTitleError)}
            type="submit"
          >
            이 템플릿으로 시작
          </Button>
        </form>
      </>
    );
  }

  if (dialog.kind === "file") {
    const selectionError = selectedFile
      ? localPdfSelectionError(selectedFile)
      : null;
    if (pdfRegistrationOpen && selectedFile && !selectionError) return <>
      <DialogHeader><DialogTitle>PDF 등록 준비</DialogTitle><DialogDescription>선택한 PDF는 로컬에서 열립니다. 등록 방식은 화면 체험이며 원본 교체·개정 저장을 실행하지 않습니다.</DialogDescription></DialogHeader>
      <DrawingRegistrationPreview fileName={selectedFile.name} documents={registrationDocuments} initial={pdfRegistrationChoice} localListing={new URL(closeHref,"http://preview.local").searchParams.has("project")} onBack={choice=>{setPdfRegistrationChoice(choice);setPdfRegistrationOpen(false);}} onContinue={choice=>onOpenPdf(selectedFile, {mode:choice.mode,fileName:selectedFile.name,targetTitle:registrationDocuments.find(document=>document.id===choice.targetId)?.title ?? "",reason:choice.reason})}/>
    </>;
    return (
      <>
        <DialogHeader>
          <DialogTitle>파일로 작업 시작</DialogTitle>
          <DialogDescription>
            실제 PDF를 선택하면 도면과 페이지 목록을 작업실에서 볼 수 있습니다.
            파일은 브라우저에서만 열리며 프로젝트에 업로드하거나 영구 저장되지
            않습니다.
          </DialogDescription>
        </DialogHeader>
        <nav aria-label="파일 형식 선택" className="grid gap-2 sm:grid-cols-3">
          <div aria-current="page" className="rounded-xl border border-primary bg-primary/5 p-3 text-sm"><strong>PDF</strong><p className="mt-1 text-xs text-muted-foreground">실제 도면 보기 · 아래에서 선택</p></div>
          <Link className="rounded-xl border p-3 text-sm hover:bg-muted focus-visible:outline-2" to={workspacePreviewStartHref(closeHref,"dwg")}><strong>DWG 가져오기 화면</strong><p className="mt-1 text-xs text-muted-foreground">모델·레이아웃 · 엔진 미연결</p></Link>
          <Link className="rounded-xl border p-3 text-sm hover:bg-muted focus-visible:outline-2" to={workspacePreviewStartHref(closeHref,"ifc")}><strong>IFC 가져오기 화면</strong><p className="mt-1 text-xs text-muted-foreground">3D·분할 보기 · 엔진 미연결</p></Link>
        </nav>
        <label className="grid cursor-pointer place-items-center gap-2 rounded-xl border border-dashed p-6 text-center text-sm font-semibold">
          <FileText className="size-6 text-[#2925d9]" />
          PDF 선택
          <input
            accept="application/pdf,.pdf"
            aria-label="작업실에서 열 PDF 선택"
            className="sr-only"
            onChange={(event) => {
              const next = event.currentTarget.files?.[0];
              if (next) {setSelectedFile(next);setPdfRegistrationChoice(undefined);}
              event.currentTarget.value = "";
            }}
            type="file"
          />
        </label>
        {selectedFile ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl bg-muted p-4 text-sm">
            <dt className="text-muted-foreground">파일명</dt>
            <dd className="min-w-0 truncate font-medium">
              {selectedFile.name}
            </dd>
            <dt className="text-muted-foreground">형식</dt>
            <dd>{selectedFile.type || "알 수 없음"}</dd>
            <dt className="text-muted-foreground">크기</dt>
            <dd>{selectedFile.size.toLocaleString("ko-KR")} bytes</dd>
          </dl>
        ) : (
          <p className="text-center text-xs text-muted-foreground">
            아직 선택한 파일이 없습니다.
          </p>
        )}
        {selectionError && (
          <p role="alert" className="text-sm text-destructive">
            {selectionError}
          </p>
        )}
        <Button
          disabled={!selectedFile || Boolean(selectionError)}
          onClick={() => {
            if (selectedFile && !selectionError) setPdfRegistrationOpen(true);
          }}
        >
          선택한 PDF 등록 방식 확인
        </Button>
        <p className="text-xs leading-5 text-muted-foreground">
          화면 미리보기 · PDF 50MB 이하 · 프로젝트에 영구 저장되지 않음 ·
          DWG·IFC 가져오기는 별도 단계입니다.
        </p>
      </>
    );
  }

  if (dialog.kind === "settings") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>설정 미리보기</DialogTitle>
          <DialogDescription>
            이 화면에서는 계정이나 작업공간 설정을 변경하지 않습니다. 실제
            프로필, 조직 권한과 보존 설정은 로그인 후 각 설정 화면에서
            관리합니다.
          </DialogDescription>
        </DialogHeader>
        <WorkspaceManagementPreview draftKey="1hk:preview:management:personal" viewer={new URL(closeHref, "http://preview.local").searchParams.get("role") === "viewer"}/>
      </>
    );
  }

  if (dialog.kind === "project-files") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>프로젝트 파일</DialogTitle>
          <DialogDescription>
            이 목록은 로컬 예시 파일의 이름과 형식만 보여줍니다. 실제 파일
            관리와 다운로드는 로그인 후 프로젝트에서 이용할 수 있습니다.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2">
          {dialog.files.map((file) => (
            <li
              className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3 text-sm"
              key={file.id}
            >
              <span className="min-w-0 truncate font-medium">
                {file.original_filename}
              </span>
              <span className="shrink-0 text-xs font-semibold uppercase text-muted-foreground">
                {file.kind}
              </span>
            </li>
          ))}
        </ul>
      </>
    );
  }

  if (dialog.kind === "project-reviews") {
    const visibleReviews = projectReviews.filter(
      (review) => reviewFilter === "전체" || review.status === reviewFilter,
    );
    return (
      <>
        <DialogHeader>
          <DialogTitle>검토 현황</DialogTitle>
          <DialogDescription>
            {selectedProject?.name ?? "예시 프로젝트"}의 화면용 검토 예시입니다.
            상태별로 확인하고 도면 위치를 미리 볼 수 있습니다.
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          화면 구성 예시 · 실제 검토 데이터 저장·전송 없음
        </p>
        <div aria-label="검토 상태 필터" className="flex flex-wrap gap-2">
          {(["전체", "검토 중", "수정 필요", "완료"] as const).map((status) => (
            <Button
              aria-pressed={reviewFilter === status}
              key={status}
              onClick={() => setReviewFilter(status)}
              size="sm"
              type="button"
              variant={reviewFilter === status ? "default" : "outline"}
            >
              {status}
            </Button>
          ))}
        </div>
        <ul className="grid gap-2">
          {visibleReviews.map((review) => (
            <li className="rounded-xl border p-4" key={review.id}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <strong className="text-sm">{review.title}</strong>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {review.detail}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs font-medium">
                  {review.status}
                </span>
              </div>
              <Link
                className="mt-3 inline-flex text-sm font-semibold text-[#2925d9] underline-offset-4 hover:underline dark:text-[#b9b7ff]"
                to={drawingWorkspacePreviewHref(closeHref, {
                  reviewPreview: true,
                  reviewState: review.reviewState,
                  startKind: "office",
                  title: `${selectedProject?.name ?? "사무실 평면"} · ${review.title}`,
                })}
              >
                도면에서 확인
              </Link>
            </li>
          ))}
        </ul>
      </>
    );
  }

  if (
    dialog.kind === "project-overview" ||
    dialog.kind === "project-quantities" ||
    dialog.kind === "project-materials" ||
    dialog.kind === "project-members"
  ) {
    const panes = {
      "project-overview": {
        title: "프로젝트 개요",
        description: "현재 설계 흐름과 다음 확인 항목을 한눈에 봅니다.",
        notice: "화면 구성 예시 · 실제 프로젝트 정보나 도면 상태 연결 없음",
        rows: [
          ["단계", "예시: 설계 검토"],
          ["최근 도면", "예시: 1층 평면도"],
          ["다음 확인", "예시: 회의실 치수와 출입 동선"],
        ],
      },
      "project-quantities": {
        title: "물량 현황",
        description:
          "도면 객체와 수량을 연결할 화면입니다. 아직 계산되지 않았습니다.",
        notice: "화면 구성 예시 · 실제 측정이나 수량 데이터 연결 없음",
        rows: [
          ["공간", "도면 연결 전"],
          ["길이", "측정 기준 설정 전"],
          ["개수", "집계 전"],
        ],
      },
      "project-materials": {
        title: "자재 현황",
        description:
          "자재 연결 화면 예시입니다. 실제 사양은 연결되지 않았습니다.",
        notice: "화면 구성 예시 · 실제 자재·사양 데이터 연결 없음",
        rows: [
          ["바닥", "화면 예시: 데코타일 · 카펫 타일"],
          ["벽", "화면 예시: 저VOC 수성 페인트"],
          ["문", "화면 예시: 방화문 · 유리 도어"],
        ],
      },
      "project-members": {
        title: "참여자 현황",
        description: "프로젝트 역할 구성을 보여주는 화면 예시입니다.",
        notice: "가상 참여자 · 실제 접속·초대 없음",
        rows: [
          ["김민준", "설계 담당"],
          ["박서연", "검토 담당"],
          ["이도윤", "현장 협업 담당"],
        ],
      },
    } as const;
    const pane = panes[dialog.kind];
    return (
      <>
        <DialogHeader>
          <DialogTitle>{pane.title}</DialogTitle>
          <DialogDescription>{pane.description}</DialogDescription>
        </DialogHeader>
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          {pane.notice}
        </p>
        {dialog.kind === "project-materials" ? <DrawingMaterialPreview
          documentName={`${selectedProject?.name ?? "프로젝트"} 1층 평면도 · 템플릿 예시`}
          page={1} ready={true}
          viewer={new URL(closeHref, "http://preview.local").searchParams.get("role") === "viewer"}
          onReturn={() => navigate(drawingWorkspacePreviewHref(closeHref, {startKind: "office", title: `${selectedProject?.name ?? "프로젝트"} 1층 평면도`, takeoffPreview: true}))}
        /> : dialog.kind === "project-members" ? <DrawingTeamPreview ready={true} viewer={new URL(closeHref, "http://preview.local").searchParams.get("role") === "viewer"} reviewState="draft"/> : <dl className="divide-y rounded-xl border px-4">
          {pane.rows.map(([label, value]) => (
            <div
              className="grid grid-cols-[7rem_1fr] gap-4 py-3 text-sm"
              key={label}
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>}
        {dialog.kind !== "project-materials" && <Button asChild className="w-full">
          <Link
            to={drawingWorkspacePreviewHref(closeHref, {
              startKind: "office",
              title: `${selectedProject?.name ?? "사무실 평면"} 1층 평면도`,
              takeoffPreview: dialog.kind === "project-quantities",
            })}
          >
            도면에서 확인
          </Link>
        </Button>}
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>알림 작업함</DialogTitle>
        <DialogDescription>
          로컬 미리보기에는 새 알림이 없습니다.
        </DialogDescription>
      </DialogHeader>
      {!notificationExample ? <div className="grid place-items-center gap-2 rounded-xl border border-dashed py-8 text-center">
        <BellOff className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">확인할 알림이 없습니다.</p>
        <Button type="button" variant="outline" onClick={() => setNotificationExample(true)}>알림 예시 살펴보기</Button>
      </div> : <section className="grid gap-4" aria-label="알림 상세 예시">
        <p className="rounded-lg bg-violet-50 p-3 text-xs text-violet-800">화면 예시 · 실제 알림·읽음 기록·전송 없음</p>
        <nav className="flex flex-wrap gap-2" aria-label="알림 예시 종류">{["검토 요청", "댓글 멘션", "납품 안내"].map(kind => <Button type="button" key={kind} variant={kind === notificationKind ? "default" : "outline"} aria-pressed={kind === notificationKind} onClick={() => setNotificationKind(kind)}>{kind}</Button>)}</nav>
        <div className="rounded-xl border p-4"><h3 className="font-semibold">{notificationKind} · 예시</h3><p className="mt-2 text-sm text-muted-foreground">{notificationKind === "검토 요청" ? "검토자에게 도면 확인을 요청한 상황입니다." : notificationKind === "댓글 멘션" ? "도면의 기준선 확인 의견에 담당자가 언급된 상황입니다." : "납품 패키지 구성을 확인하도록 안내하는 상황입니다."}</p><p className="mt-3 text-xs text-muted-foreground">발신자·발신 시각 미연결 · 실제 요청이 아닙니다.</p></div>
        <Button asChild><Link to={drawingWorkspacePreviewHref(closeHref, {startKind: "office", workflowPanel: notificationKind === "납품 안내" ? "export" : notificationKind === "댓글 멘션" ? "share" : "review"})}>예시 도면에서 확인</Link></Button>
        <Button type="button" variant="outline" onClick={() => setNotificationExample(false)}>알림 없는 상태로 돌아가기</Button>
      </section>}
    </>
  );
}

export const meta: Route.MetaFunction = () => [
  { title: "로컬 미리보기 | 1HK Platform" },
];

function ProjectReviewContent({closeHref, reviewEntries, reviewReadError = false, inline = false, loaded = true, children}: {closeHref: string; reviewEntries: ReviewEntry[]; reviewReadError?: boolean; inline?: boolean; loaded?: boolean; children?:ReactNode}) {
  const [params, setParams] = useSearchParams();
  const selectedStatus = params.get("reviewStatus");
  const reviewFilter = selectedStatus && ["검토 중", "수정 필요", "완료"].includes(selectedStatus) ? selectedStatus : "전체";
  const setReviewFilter = (status: string) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (status === "전체") next.delete("reviewStatus"); else next.set("reviewStatus", status);
    return next;
  }, {replace: true});
    const statusFor = (state: ReviewLoopState) => state.phase === "approved" ? "완료" : state.phase === "changes" ? "수정 필요" : state.phase === "requested" || state.phase === "reviewed" ? "검토 중" : "작성 중";
    const entries = reviewEntries.filter(entry => reviewFilter === "전체" || statusFor(entry.state) === reviewFilter);
    return <div className="grid gap-6">
      {inline ? <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">검토 현황</h1><p className="mt-2 text-sm text-muted-foreground">도면별 검토와 수정 요청을 확인하세요. 이 탭의 화면 예시입니다.</p></div><Button asChild variant="outline"><Link to={closeHref}>도면 목록으로</Link></Button></header> : <DialogHeader><DialogTitle>검토 현황</DialogTitle><DialogDescription>이 탭의 도면별 검토 기록입니다. 실제 요청·승인이 아닙니다.</DialogDescription></DialogHeader>}
      {children}
      {!loaded ? <p role="status">검토 기록을 불러오고 있습니다.</p> : <>
      {reviewReadError ? <p role="alert" className="text-sm text-red-700">일부 검토 기록을 읽지 못했습니다. 기록이 없다는 뜻은 아닙니다. 해당 도면에서 상태를 확인해 주세요.</p> : null}
      <div className="border-t pt-6"><h2 className="text-lg font-semibold">개정 검토 기록</h2><p className="mt-1 text-sm text-muted-foreground">도면 개정 단위의 수정·승인 화면 기록입니다. 항목별 변경 요청과는 별도로 관리됩니다.</p></div>
      <div aria-label="검토 상태 필터" className="flex flex-wrap gap-2">{(["전체","검토 중","수정 필요","완료"] as const).map(status=><Button key={status} size="sm" variant={reviewFilter===status?"default":"outline"} aria-pressed={reviewFilter===status} onClick={()=>setReviewFilter(status)}>{status}</Button>)}</div>
      {!entries.length ? <section className="rounded-xl border border-dashed p-6 text-center"><h2 className="font-semibold">{reviewFilter === "전체" ? "아직 개정 검토 기록이 없습니다." : "조건에 맞는 검토가 없습니다."}</h2><p className="mt-2 text-sm text-muted-foreground">도면의 개정 검토 기록이 이 영역에 표시됩니다.</p></section> : <ul className="grid gap-3">{entries.map(({document,state})=><li key={document.id} className="rounded-xl border p-4">
        <h2 className="font-semibold break-words">{document.title}</h2><p className="mt-1 text-sm">R{state.revision} · {state.page}쪽 · {reviewLoopLabels[state.phase]}</p>
        <p className="mt-2 break-words text-sm text-muted-foreground">{state.message || "새 개정 작성 중 · 이전 검토 기록은 도면에서 확인하세요."}</p>
        {state.history.length ? <p className="mt-2 text-xs text-muted-foreground">이전 개정 {state.history.length}개 보관</p> : null}
        <Button asChild variant="outline" className="mt-3"><Link to={drawingWorkspacePreviewHref(closeHref,{documentId:document.id,startKind:document.previewStartKind ?? (document.thumbnailUrl?.endsWith("house-plan.png") ? "house" : document.source_file_id ? "office" : "blank"),paper:document.previewPaper,title:document.title,workflowPanel:"review"})}>같은 도면에서 검토 계속하기</Link></Button>
      </li>)}</ul>}
      <ExternalRequestPanel projectId={new URL(closeHref,"http://preview.local").searchParams.get("project")??""} viewer={new URL(closeHref,"http://preview.local").searchParams.get("role")==="viewer"} internalEntries={reviewEntries.map(({document,state})=>({documentId:document.id,title:document.title,state,href:drawingWorkspacePreviewHref(closeHref,{documentId:document.id,startKind:document.previewStartKind??(document.thumbnailUrl?.endsWith("house-plan.png")?"house":document.source_file_id?"office":"blank"),paper:document.previewPaper,title:document.title,workflowPanel:"review"})}))}/>
      </>}
    </div>;
}

type ProjectSupplementKind = "project-sharing" | "project-resources" | "project-changes";
function ProjectSupplement({kind, closeHref, reviewEntries = [], reviewReadError = false, inline = false, loaded = true}: {kind: ProjectSupplementKind; closeHref: string; reviewEntries?: ReviewEntry[]; reviewReadError?: boolean; inline?: boolean; loaded?: boolean}) {
  const titles = {"project-sharing":"외부 공유 준비", "project-resources":"프로젝트 자료", "project-changes":"프로젝트 변경 이력"};
  const descriptions = {"project-sharing":"수신자 역할과 공개할 개정·자료 범위를 지정합니다. 실제 초대나 본인 인증은 실행하지 않습니다.", "project-resources":"견적서·시방서·일정표·회의록의 로컬 준비 화면입니다. 도면 원본과 자재 목록은 별도로 관리합니다.", "project-changes":"변경 사유와 관련 도면 개정을 하나의 회차로 정리합니다. 실제 설계변경 등록·승인·서버 저장은 아닙니다."};
  return <section className="grid gap-6">
    {inline ? <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">{titles[kind]}</h1><p className="mt-2 text-sm text-muted-foreground">{descriptions[kind]}</p></div><Button asChild variant="outline"><Link to={closeHref}>도면 목록으로</Link></Button></header> : <DialogHeader><DialogTitle>{titles[kind]}</DialogTitle><DialogDescription>{descriptions[kind]}</DialogDescription></DialogHeader>}
    {loaded ? <ProjectSupplementBody kind={kind} closeHref={closeHref} reviewEntries={reviewEntries} reviewReadError={reviewReadError}/> : <p role="status">프로젝트 기록을 불러오고 있습니다.</p>}
  </section>;
}
function ProjectSupplementBody({kind, closeHref, reviewEntries, reviewReadError}: {kind: ProjectSupplementKind; closeHref: string; reviewEntries: ReviewEntry[]; reviewReadError: boolean}) {
  if (kind === "project-sharing") {
    const origin=new URL(closeHref,"http://preview.local");
    return <><ProjectSharingPreview key={origin.searchParams.get("project")} projectId={origin.searchParams.get("project")??""} viewer={origin.searchParams.get("role")==="viewer"} readError={reviewReadError} drawings={(reviewEntries??[]).map(({document,state})=>({id:`drawing:${document.id}`,kind:"drawing",title:document.title,revision:state.revision,page:state.page,detail:state.message||state.issue||"검토 내용 없음",view:{kind:document.previewStartKind??(document.thumbnailUrl?.endsWith("house-plan.png")?"house":document.source_file_id?"office":"blank"),paper:document.previewPaper??"A3",review:state}}))}/></>;
  }
  if (kind === "project-resources") {
    const origin=new URL(closeHref,"http://preview.local");
    return <><ProjectResourcesPreview key={origin.searchParams.get("project")} projectId={origin.searchParams.get("project")??""} viewer={origin.searchParams.get("role")==="viewer"}/></>;
  }
  if (kind === "project-changes") {
    const origin = new URL(closeHref, "http://preview.local");
    return <>
      <ProjectChangePreview projectId={origin.searchParams.get("project") ?? ""} viewer={origin.searchParams.get("role") === "viewer"} readError={reviewReadError}
        candidates={(reviewEntries ?? []).map(({document,state}) => ({documentId:document.id,title:document.title,revision:state.revision,page:state.page,phase:state.phase}))}
        hrefFor={(id, roundId) => {
          const document = reviewEntries?.find(entry => entry.document.id === id)?.document;
          return document ? `${drawingWorkspacePreviewHref(closeHref,{documentId:document.id,startKind:document.previewStartKind ?? (document.thumbnailUrl?.endsWith("house-plan.png") ? "house" : document.source_file_id ? "office" : "blank"),paper:document.previewPaper,title:document.title,workflowPanel:"review"})}&changeRound=${encodeURIComponent(roundId)}` : null;
        }}/>
    </>;
  }
}

function ProjectWorkData({kind,documents,closeHref}:{kind:"quantities"|"materials";documents:ProjectDrawingSummary[];closeHref:string}) {
  const [materialFailed,setMaterialFailed]=useState(false);
  const blocker=useBlocker(materialFailed);
  useEffect(()=>{if(blocker.state==="blocked")blocker.reset();},[blocker]);
  useEffect(()=>{if(!materialFailed)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[materialFailed]);
  const [params,setParams]=useSearchParams();
  const navigate=useNavigate();
  const sourceId=params.get("sourceDrawing");
  const selected=documents.find(document=>document.id===sourceId);
  const viewer=new URL(closeHref,"http://preview.local").searchParams.get("role")==="viewer";
  const drawingHref=(document:ProjectDrawingSummary)=>`${drawingWorkspacePreviewHref(closeHref,{documentId:document.id,title:document.title,paper:document.previewPaper,startKind:document.previewStartKind??(document.thumbnailUrl?.endsWith("house-plan.png")?"house":document.source_file_id?"office":"blank"),takeoffPreview:true})}&returnPanel=project-${kind}${kind==="materials"?`&returnSourceDrawing=${encodeURIComponent(document.id)}`:""}`;
  return <section className="grid gap-6">
    {materialFailed&&<p role="alert">자재 초안 보관 실패로 이동을 중지합니다. 보관 다시 시도 후 이동해 주세요.</p>}
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">{kind==="quantities"?"물량 현황":"자재 현황"}</h1><p className="mt-2 text-sm text-muted-foreground">프로젝트 도면을 기준으로 연결 흐름을 확인합니다. 실제 집계·발주 데이터가 아닌 화면 예시입니다.</p></div><Button asChild variant="outline"><Link to={closeHref}>도면 목록으로</Link></Button></header>
    {!documents.length?<div className="rounded-xl border border-dashed p-6"><h2 className="font-semibold">연결할 도면이 없습니다.</h2><p className="mt-2 text-sm">도면 목록에서 빈 도면·템플릿·파일로 먼저 시작하세요.</p></div>:kind==="quantities"?<ul className="grid gap-3 sm:grid-cols-2">{documents.map(document=><li key={document.id} className="grid gap-3 rounded-xl border p-4"><h2 className="break-words font-semibold">{document.title}</h2><p className="text-sm text-muted-foreground">수량 미집계 · 측정·내역 연결 예시 열기</p><Button asChild variant="outline"><Link to={drawingHref(document)}>이 도면의 물량·내역 보기</Link></Button></li>)}</ul>:<>
      <label className="grid gap-2 text-sm">기준 도면<select className="rounded-lg border p-3" value={sourceId??""} onChange={e=>setParams(previous=>{const next=new URLSearchParams(previous);if(e.target.value)next.set("sourceDrawing",e.target.value);else next.delete("sourceDrawing");return next;},{replace:true})}><option value="">기준 도면을 선택하세요</option>{documents.map(document=><option key={document.id} value={document.id}>{document.title}</option>)}</select></label>
      {sourceId&&!selected?<p role="alert">이 프로젝트에서 지정한 도면을 찾을 수 없습니다. 다른 도면으로 대신 열지 않았습니다.</p>:selected?<DrawingMaterialPreview key={selected.id} draftKey={`1hk:preview:material-draft:${new URL(closeHref,"http://preview.local").searchParams.get("project")}:${selected.id}`} onSaveFailure={setMaterialFailed} documentName={selected.title} page={1} ready viewer={viewer} onReturn={()=>navigate(drawingHref(selected))}/>:<p className="rounded-xl border border-dashed p-6">기준 도면을 선택하면 자재·발주·입고·근거 화면을 확인할 수 있습니다.</p>}
    </>}
  </section>;
}

export default function WorkspacePreview() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [localProjects, setLocalProjects] = useState<LocalProject[]>([]);
  const [localDrawings, setLocalDrawings] = useState<LocalDrawing[]>([]);
  const [localNotice, setLocalNotice] = useState("");
  const [drawingSaveError, setDrawingSaveError] = useState("");
  useEffect(() => { setDrawingSaveError(""); }, [searchParams.toString()]);
  const [localRestored, setLocalRestored] = useState(false);
  const [reviewRecords, setReviewRecords] = useState<Record<string, ReviewLoopState>>({});
  const [reviewReadError, setReviewReadError] = useState(false);
  const [reviewReadScope, setReviewReadScope] = useState("");
  const selectedReviewProject = searchParams.get("project");
  const selectedPanel = searchParams.get("panel");
  useEffect(() => {
    if (selectedPanel !== "notifications" && ((selectedPanel !== "project-reviews" && selectedPanel !== "project-changes" && selectedPanel !== "project-sharing") || !selectedReviewProject)) return;
    const records: Record<string, ReviewLoopState> = {};
    let failed = false;
    const documents = selectedReviewProject
      ? [...(projectDocuments[selectedReviewProject] ?? []), ...localDrawings.filter(d=>d.project_id===selectedReviewProject)]
      : [...Object.values(projectDocuments).flat(), ...localDrawings];
    for (const document of documents) {
      try {
        const raw = sessionStorage.getItem(`1hk:preview:review:${document.id}`);
        if (raw) {
          const state = parseReviewLoopSession(raw);
          if (state) records[document.id] = state;
          else failed = true;
        }
      } catch { failed = true; }
    }
    setReviewRecords(records);setReviewReadError(failed);
    setReviewReadScope(`${selectedPanel}:${selectedReviewProject}`);
  }, [selectedPanel, selectedReviewProject, localDrawings]);
  useEffect(() => {
    try {
      setLocalProjects(parseLocalPreviewProjects(sessionStorage.getItem(localProjectsKey) ?? "[]"));
      const stored: unknown = JSON.parse(sessionStorage.getItem(localDrawingsKey) ?? "[]");
      if (Array.isArray(stored)) setLocalDrawings(stored.filter((d): d is LocalDrawing => Boolean(d && typeof d === "object" && typeof d.id === "string" && typeof d.project_id === "string" && typeof d.title === "string" && d.title.length <= 80 && typeof d.updated_at === "string" && d.source_file_id === null && ["blank", "office", "house", "pdf"].includes(d.previewStartKind) && ["A2", "A3", "A4"].includes(d.previewPaper))));
    }
    catch { setLocalNotice("브라우저 저장 공간을 사용할 수 없습니다. 프로젝트 예시는 현재 화면에서만 유지됩니다."); }
    finally { setLocalRestored(true); }
  }, []);
  const model = resolveWorkspacePreview(searchParams.toString(), localProjects, localDrawings);
  const inlineReview = Boolean(model.selectedProject && model.dialog?.kind === "project-reviews");
  const inlineDelivery = Boolean(model.selectedProject && model.dialog?.kind === "project-deliveries");
  const workKind = model.selectedProject && model.dialog?.kind === "project-quantities" ? "quantities" : model.selectedProject && model.dialog?.kind === "project-materials" ? "materials" : null;
  const supplementKind = model.selectedProject && (model.dialog?.kind === "project-resources" || model.dialog?.kind === "project-changes" || model.dialog?.kind === "project-sharing") ? model.dialog.kind : null;
  const inlineSection = inlineDelivery?"deliveries":inlineReview ? "reviews" : supplementKind === "project-resources" ? "resources" : supplementKind === "project-changes" ? "changes" : supplementKind === "project-sharing" ? "sharing" : workKind;
  const reviewEntries = (model.selectedProject?.documents ?? (selectedPanel === "notifications" ? [...Object.values(projectDocuments).flat(), ...localDrawings] : [])).flatMap(document => {
    const state = reviewRecords[document.id];
    return state && (state.message || state.issue || state.history.length) ? [{document,state}] : [];
  });

  if (searchParams.has("guest")) return <ProjectGuestPreview key={`${selectedReviewProject}:${searchParams.get("guest")}`} projectId={selectedReviewProject??""} invitationId={searchParams.get("guest")??""}/>;

  if (searchParams.has("project") && !model.selectedProject) {
    const localProject = localProjectPattern.test(searchParams.get("project") ?? "");
    return <main className="mx-auto max-w-xl p-8">
      {localProject && !localRestored ? <p role="status">프로젝트를 복원하고 있습니다.</p> : <>
        <h1 className="text-xl font-semibold">{localProject ? "이 탭에서 프로젝트를 찾을 수 없습니다." : "프로젝트를 열 수 없습니다."}</h1>
        <p className="my-4 text-sm text-muted-foreground">{localProject ? "로컬 미리보기 프로젝트는 생성한 브라우저 탭에만 보관됩니다. 탭을 닫았거나 브라우저 보관이 해제되면 복원할 수 없습니다." : "이 링크의 프로젝트는 현재 미리보기에서 확인할 수 없습니다. 링크를 다시 확인하거나 프로젝트 목록에서 작업을 선택해 주세요."}</p>
        <Button asChild variant="outline"><Link to="/workspace-preview">프로젝트 목록으로</Link></Button>
      </>}
    </main>;
  }

  return (
    <>
      {localNotice ? <p role="status" className="border-b bg-amber-50 px-5 py-2 text-sm text-amber-900">{localNotice}</p> : null}
      {model.selectedProject ? (
        <ProjectDrawingsBrowser {...model.selectedProject} previewMode activeSection={inlineSection ?? "drawings"}>
{inlineDelivery?<ProjectDeliveryPreview key={model.selectedProject.project.id} projectId={model.selectedProject.project.id} returnHref={model.closeHref} documents={model.selectedProject.documents.map((document:ProjectDrawingSummary)=>({id:document.id,title:document.title,href:`${drawingWorkspacePreviewHref(model.closeHref,{documentId:document.id,title:document.title,paper:document.previewPaper,startKind:document.previewStartKind??(document.thumbnailUrl?.endsWith("house-plan.png")?"house":document.source_file_id?"office":"blank"),workflowPanel:"export"})}&returnPanel=project-deliveries`}))}/>:workKind ? <ProjectWorkData kind={workKind} documents={model.selectedProject.documents} closeHref={model.closeHref}/> : inlineReview ? <ProjectReviewContent closeHref={model.closeHref} reviewEntries={reviewEntries} reviewReadError={reviewReadError} inline loaded={localRestored && reviewReadScope === `${selectedPanel}:${selectedReviewProject}`}><ProjectChangeRequestsPreview documents={model.selectedProject.documents.map((document:ProjectDrawingSummary)=>({id:document.id,title:document.title,href:drawingWorkspacePreviewHref(model.closeHref,{documentId:document.id,title:document.title,paper:document.previewPaper,startKind:document.previewStartKind??(document.thumbnailUrl?.endsWith("house-plan.png")?"house":document.source_file_id?"office":"blank")})}))}/></ProjectReviewContent> : supplementKind ? <ProjectSupplement kind={supplementKind} closeHref={model.closeHref} reviewEntries={reviewEntries} reviewReadError={reviewReadError} inline loaded={localRestored && (supplementKind === "project-resources" || reviewReadScope === `${selectedPanel}:${selectedReviewProject}`)}/> : null}
        </ProjectDrawingsBrowser>
      ) : (
        <WorkspaceDashboard
          activeScope={model.activeScope}
          activities={model.activities}
          drawings={model.drawings}
          email="local-preview@1hk.local"
          hasAccessibleProjects={model.hasAccessibleProjects}
          isStaff={false}
          organizations={model.organizations}
          previewMode
          projectMetrics={model.projectMetrics}
          projects={model.projects}
        />
      )}
      <Dialog
        onOpenChange={(open) => {
          if (!open) void navigate(model.closeHref);
        }}
        open={model.dialog !== null && !inlineSection}
      >
        {model.dialog && !inlineSection ? (
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            {drawingSaveError && <p role="alert" className="rounded-lg border border-red-200 p-3 text-sm text-red-700">{drawingSaveError}</p>}
            <PreviewDialogContent
              key={`${model.dialog.kind}:${model.closeHref}`}
              closeHref={model.closeHref}
              dialog={model.dialog}
              localDrawingCount={model.selectedProject?.documents.length ?? 0}
              registrationDocuments={model.selectedProject?.documents ?? []}
              reviewEntries={reviewEntries}
              reviewReadError={reviewReadError}
              onStartDrawing={(start) => {
                if (model.selectedProject?.canCreateWorkspace && start.startKind) {
                  const drawing: LocalDrawing = {id: crypto.randomUUID(), project_id: model.selectedProject.project.id, title: (start.title ?? "새 도면").trim().slice(0, 80), updated_at: new Date().toISOString(), source_file_id: null, previewStartKind: start.startKind, previewPaper: start.paper ?? "A3"};
                  start = {...start, documentId: drawing.id};
                  try {
                    const next = saveLocalPreviewDrawing(localDrawings, drawing, sessionStorage);
                    setLocalDrawings(next);
                    setDrawingSaveError("");
                  }
                  catch { setDrawingSaveError("도면 목록을 보관하지 못했습니다. 입력은 이 창에 유지됩니다. 브라우저 저장 공간을 확인한 뒤 다시 시작해 주세요. 도면은 추가되지 않았습니다."); return; }
                }
                void navigate(drawingWorkspacePreviewHref(model.closeHref, start));
              }}
              onCreateProject={(name, description) => {
                const now = new Date().toISOString();
                const project = {id: `00000000-0000-4000-9000-${crypto.randomUUID().slice(-12)}`, name, description, workflow_status: "draft", created_at: now, updated_at: now};
                const next = [...localProjects, project];
                try { sessionStorage.setItem(localProjectsKey, JSON.stringify(next)); }
                catch { setDrawingSaveError("프로젝트를 보관하지 못했습니다. 이름과 설명은 이 창에 유지됩니다. 브라우저 저장 공간을 확인한 뒤 다시 시도해 주세요. 프로젝트는 추가되지 않았습니다."); return; }
                setLocalProjects(next);
                setDrawingSaveError("");
                setLocalNotice("미리보기 프로젝트를 만들었습니다. 실제 계정에는 저장되지 않습니다.");
                void navigate(`/workspace-preview?project=${project.id}`);
              }}
              onOpenPdf={(file, registrationPreview) => {
                let documentId: string | undefined;
                if (model.selectedProject?.canCreateWorkspace && registrationPreview?.mode === "new") {
                  const drawing: LocalDrawing = {id:crypto.randomUUID(),project_id:model.selectedProject.project.id,title:file.name.normalize("NFC").slice(0,80),updated_at:new Date().toISOString(),source_file_id:null,previewStartKind:"pdf",previewPaper:"A3"};
                  try {setLocalDrawings(saveLocalPreviewDrawing(localDrawings,drawing,sessionStorage));setDrawingSaveError("");documentId=drawing.id;}
                  catch {setDrawingSaveError("PDF 목록 정보를 보관하지 못했습니다. 파일과 입력은 이 창에 유지됩니다. 저장 공간을 확인한 뒤 다시 시도해 주세요.");return;}
                }
                void navigate(
                  drawingWorkspacePreviewHref(model.closeHref, {
                    pdf: stageLocalPdf(file),
                    documentId,
                    startKind:"pdf",
                    title:file.name.normalize("NFC"),
                  }),
                  {state: {registrationPreview}},
                );
              }}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button asChild variant="outline">
                  <Link to={model.closeHref}>닫기</Link>
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
