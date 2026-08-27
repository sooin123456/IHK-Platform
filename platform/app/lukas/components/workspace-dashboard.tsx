import {
  ArrowUpRight,
  Bell,
  BookOpen,
  Box,
  CheckCircle2,
  Clock3,
  FileBox,
  FolderKanban,
  Grid2X2,
  List,
  LogOut,
  MessageSquareText,
  Plus,
  Search,
  UserRound,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Form, Link } from "react-router";

import { Button } from "~/core/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/core/components/ui/dialog";
import { Input } from "~/core/components/ui/input";
import { Label } from "~/core/components/ui/label";
import { cn } from "~/core/lib/utils";

type ProjectMetric = {
  fileCount: number;
  ifcCount: number;
  openReviewCount: number;
  memberCount: number;
  latestIfcId: string | null;
  latestDrawingId: string | null;
  unresolvedDrawingCount: number;
  assignedToMeCount: number;
  latestFilename: string | null;
};

type WorkspaceProject = {
  id: string;
  name: string;
  description: string;
  workflow_status: string;
  created_at: string;
  updated_at: string;
};

type WorkspaceActivity = {
  id: string;
  projectId: string;
  projectName: string;
  kind: "file" | "review";
  title: string;
  detail: string;
  createdAt: string;
};

type WorkspaceDashboardProps = {
  projects: WorkspaceProject[];
  projectMetrics: Record<string, ProjectMetric>;
  activities: WorkspaceActivity[];
  email: string;
  isStaff: boolean;
  organizations?: Array<{ id: string; name: string }>;
  actionError?: string;
  previewMode?: boolean;
};

const workflowLabels: Record<string, string> = {
  inquiry_received: "문의 접수",
  quote_review: "견적 검토",
  confirmed: "작업 확정",
  bim_modeling: "BIM 모델링",
  quantity_takeoff: "물량산출",
  expert_review: "전문가 검토",
  delivered: "납품 완료",
};

const workflowProgress: Record<string, number> = {
  inquiry_received: 8,
  quote_review: 18,
  confirmed: 28,
  bim_modeling: 45,
  quantity_takeoff: 65,
  expert_review: 82,
  delivered: 100,
};

const previewColors = [
  "bg-[#dfe8f7] text-[#2f4f79]",
  "bg-[#e9e4d8] text-[#665637]",
  "bg-[#dcebe5] text-[#315d50]",
  "bg-[#eee3ea] text-[#6b455e]",
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function projectHref(projectId: string, metric: ProjectMetric | undefined) {
  if (metric?.latestDrawingId)
    return `/projects/${projectId}/drawings/${metric.latestDrawingId}`;
  return `/projects/${projectId}/files?kind=ifc#upload`;
}

function NewProjectDialog({ actionError }: { actionError?: string }) {
  const [open, setOpen] = useState(Boolean(actionError));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="min-h-11 rounded-xl bg-[#2925d9] px-4 text-white hover:bg-[#211dc0]">
          <Plus className="size-4" /> 새 프로젝트
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-2xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl">새 도면 프로젝트</DialogTitle>
          <DialogDescription>
            프로젝트를 만든 뒤 Revit·IFC·도면 파일과 검토 참여자를 추가할 수
            있습니다.
          </DialogDescription>
        </DialogHeader>
        <Form className="mt-2 grid gap-4 sm:grid-cols-2" method="post">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="workspace-project-name">프로젝트명</Label>
            <Input
              autoFocus
              id="workspace-project-name"
              maxLength={160}
              name="name"
              placeholder="예: 건우설계 근린생활시설"
              required
            />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="workspace-project-description">설명 (선택)</Label>
            <Input
              id="workspace-project-description"
              maxLength={2000}
              name="description"
              placeholder="설계 단계, 검토 범위 또는 발행 차수"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="workspace-contact-name">담당자 (선택)</Label>
            <Input
              id="workspace-contact-name"
              maxLength={80}
              name="contactName"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="workspace-contact-phone">연락처 (선택)</Label>
            <Input
              id="workspace-contact-phone"
              maxLength={40}
              name="contactPhone"
            />
          </div>
          {actionError ? (
            <p className="text-sm text-destructive sm:col-span-2" role="alert">
              {actionError}
            </p>
          ) : null}
          <Button className="min-h-11 sm:col-span-2" type="submit">
            프로젝트 만들고 작업공간 열기
          </Button>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function WorkspaceDashboard({
  projects,
  projectMetrics,
  activities,
  email,
  isStaff,
  organizations = [],
  actionError,
  previewMode = false,
}: WorkspaceDashboardProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "review">("all");
  const [view, setView] = useState<"grid" | "list">("grid");

  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    return projects.filter((project) => {
      const metric = projectMetrics[project.id];
      const matchesQuery =
        normalized.length === 0 ||
        project.name.toLocaleLowerCase("ko-KR").includes(normalized) ||
        project.description.toLocaleLowerCase("ko-KR").includes(normalized) ||
        Boolean(
          metric?.latestFilename
            ?.toLocaleLowerCase("ko-KR")
            .includes(normalized),
        );
      const matchesFilter =
        filter === "all" ||
        (filter === "active" && project.workflow_status !== "delivered") ||
        (filter === "review" && (metric?.openReviewCount ?? 0) > 0);
      return matchesQuery && matchesFilter;
    });
  }, [filter, projectMetrics, projects, query]);

  const activeCount = projects.filter(
    (project) => project.workflow_status !== "delivered",
  ).length;
  const reviewCount = Object.values(projectMetrics).reduce(
    (sum, metric) => sum + metric.openReviewCount,
    0,
  );
  const fileCount = Object.values(projectMetrics).reduce(
    (sum, metric) => sum + metric.fileCount,
    0,
  );
  const userInitial = (email[0] ?? "H").toUpperCase();
  const workspaceHref = previewMode ? "/workspace-preview" : "/workspace";
  const linkTo = (target: string) => (previewMode ? workspaceHref : target);
  const previewProjectHref = (projectId: string, fileId?: string | null) =>
    `/workspace-preview/projects/${projectId}/drawings/${fileId ?? "preview-drawing"}`;
  const sidebarItems = [
    {
      id: "all" as const,
      label: "모든 프로젝트",
      icon: FolderKanban,
      count: projects.length,
    },
    {
      id: "active" as const,
      label: "진행 중",
      icon: Clock3,
      count: activeCount,
    },
    {
      id: "review" as const,
      label: "검토 필요",
      icon: MessageSquareText,
      count: reviewCount,
    },
  ];

  return (
    <div className="min-h-screen bg-[#f7f7f8] text-[#17171a] dark:bg-[#121214] dark:text-white">
      <div className="flex min-h-screen">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-black/10 bg-white px-4 py-5 dark:border-white/10 dark:bg-[#19191c] lg:flex">
          <Link className="flex items-center gap-3 px-2" to={workspaceHref}>
            <span className="grid size-9 place-items-center rounded-xl bg-[#2925d9] text-sm font-black text-white">
              1H
            </span>
            <span>
              <strong className="block text-sm">1HK Platform</strong>
              <span className="block text-xs text-muted-foreground">
                도면 협업 공간
              </span>
            </span>
          </Link>
          <nav aria-label="프로젝트 분류" className="mt-8 space-y-1">
            <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
              작업공간
            </p>
            {sidebarItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className={cn(
                    "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition",
                    filter === item.id
                      ? "bg-[#ecebff] text-[#2925d9] dark:bg-[#2925d9]/20 dark:text-[#b9b7ff]"
                      : "text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5",
                  )}
                  key={item.id}
                  onClick={() => setFilter(item.id)}
                  type="button"
                >
                  <Icon className="size-4" />
                  <span className="flex-1">{item.label}</span>
                  <span className="text-xs tabular-nums">{item.count}</span>
                </button>
              );
            })}
          </nav>
          <div className="mt-7 border-t pt-5 dark:border-white/10">
            <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
              바로가기
            </p>
            {projects.slice(0, 5).map((project, index) => (
              <Link
                className="flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                key={project.id}
                to={
                  previewMode
                    ? previewProjectHref(
                        project.id,
                        projectMetrics[project.id]?.latestDrawingId,
                      )
                    : projectHref(project.id, projectMetrics[project.id])
                }
              >
                <span
                  className={cn(
                    "size-2.5 rounded-sm",
                    previewColors[index % previewColors.length],
                  )}
                />
                <span className="truncate">{project.name}</span>
              </Link>
            ))}
          </div>
          <div className="mt-auto space-y-2">
            {organizations.map((organization) => (
              <Link
                className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-black/5 hover:text-foreground"
                key={organization.id}
                to={linkTo(`/organizations/${organization.id}/drawing-library`)}
              >
                <BookOpen className="size-4" /> {organization.name} 라이브러리
              </Link>
            ))}
            <Link
              className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-black/5 hover:text-foreground"
              to={linkTo("/notifications")}
            >
              <Bell className="size-4" /> 알림 작업함
            </Link>
            {isStaff ? (
              <Link
                className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-black/5 hover:text-foreground"
                to={linkTo("/staff/inquiries")}
              >
                <MessageSquareText className="size-4" /> 문의함
              </Link>
            ) : null}
            <div className="flex items-center gap-3 rounded-xl border p-3 dark:border-white/10">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#2925d9] text-xs font-bold text-white">
                {userInitial}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{email}</p>
                <p className="text-[11px] text-muted-foreground">내 계정</p>
              </div>
              <Link
                aria-label={previewMode ? "미리보기" : "로그아웃"}
                to={linkTo("/logout")}
              >
                <LogOut className="size-4 text-muted-foreground" />
              </Link>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 pb-24 lg:ml-64 lg:pb-10">
          <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center gap-3 border-b border-black/10 bg-white/95 px-4 py-3 backdrop-blur sm:px-7 lg:h-16 lg:flex-nowrap lg:px-10 lg:py-0 dark:border-white/10 dark:bg-[#19191c]/95">
            <Link
              className="flex items-center gap-2 lg:hidden"
              to={workspaceHref}
            >
              <span className="grid size-8 place-items-center rounded-lg bg-[#2925d9] text-xs font-black text-white">
                1H
              </span>
              <strong className="text-sm">도면 작업공간</strong>
            </Link>
            <div className="relative order-3 w-full lg:order-none lg:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="프로젝트와 파일 검색"
                className="h-10 rounded-xl border-transparent bg-[#f1f1f3] pl-9 focus-visible:border-ring dark:bg-white/5"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="프로젝트 또는 도면 검색"
                value={query}
              />
            </div>
            {previewMode ? (
              <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-900">
                로컬 미리보기
              </span>
            ) : (
              <NewProjectDialog actionError={actionError} />
            )}
          </header>

          <div className="mx-auto max-w-[1500px] px-4 py-7 sm:px-7 lg:px-10 lg:py-10">
            <section className="flex flex-col gap-5 border-b border-black/10 pb-8 dark:border-white/10 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#2925d9] dark:text-[#aaa7ff]">
                  Project home
                </p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
                  도면 프로젝트
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                  원본 도면을 중심으로 3D 모델, 수량, 검토와 참여자 작업을
                  이어갑니다.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[330px]">
                {[
                  ["프로젝트", projects.length],
                  ["도면 파일", fileCount],
                  ["검토 필요", reviewCount],
                ].map(([label, value]) => (
                  <div
                    className="rounded-xl border bg-white px-3 py-2.5 dark:border-white/10 dark:bg-white/5"
                    key={label}
                  >
                    <strong className="block text-lg tabular-nums">
                      {value}
                    </strong>
                    <span className="text-[11px] text-muted-foreground">
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section aria-labelledby="project-list-heading" className="mt-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold" id="project-list-heading">
                    {filter === "review"
                      ? "검토가 필요한 프로젝트"
                      : filter === "active"
                        ? "진행 중인 프로젝트"
                        : "최근 프로젝트"}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    프로젝트를 열면 가장 최근 도면 협업실로 이동합니다.
                  </p>
                </div>
                <div className="flex items-center gap-1 rounded-xl border bg-white p-1 dark:border-white/10 dark:bg-white/5">
                  <button
                    aria-label="격자로 보기"
                    className={cn(
                      "grid size-9 place-items-center rounded-lg",
                      view === "grid" && "bg-[#ecebff] text-[#2925d9]",
                    )}
                    onClick={() => setView("grid")}
                    type="button"
                  >
                    <Grid2X2 className="size-4" />
                  </button>
                  <button
                    aria-label="목록으로 보기"
                    className={cn(
                      "grid size-9 place-items-center rounded-lg",
                      view === "list" && "bg-[#ecebff] text-[#2925d9]",
                    )}
                    onClick={() => setView("list")}
                    type="button"
                  >
                    <List className="size-4" />
                  </button>
                </div>
              </div>
              {filteredProjects.length === 0 ? (
                <div className="mt-5 rounded-2xl border border-dashed bg-white p-10 text-center dark:border-white/10 dark:bg-white/5">
                  <FolderKanban className="mx-auto size-9 text-muted-foreground" />
                  <p className="mt-3 font-semibold">
                    조건에 맞는 프로젝트가 없습니다.
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    검색어 또는 필터를 바꾸거나 새 프로젝트를 만드세요.
                  </p>
                </div>
              ) : (
                <ul
                  className={cn(
                    "mt-5 grid gap-4",
                    view === "grid"
                      ? "sm:grid-cols-2 xl:grid-cols-3"
                      : "grid-cols-1",
                  )}
                >
                  {filteredProjects.map((project, index) => {
                    const metric = projectMetrics[project.id];
                    const openHref = previewMode
                      ? previewProjectHref(project.id, metric?.latestDrawingId)
                      : projectHref(project.id, metric);
                    return (
                      <li
                        className={cn(
                          "group overflow-hidden rounded-2xl border border-black/10 bg-white transition hover:-translate-y-0.5 hover:border-[#2925d9]/40 hover:shadow-lg dark:border-white/10 dark:bg-[#1b1b1e]",
                          view === "list" && "flex",
                        )}
                        key={project.id}
                      >
                        <Link
                          aria-label={`${project.name} 작업공간 열기`}
                          className={cn(
                            "relative flex items-center justify-center overflow-hidden",
                            previewColors[index % previewColors.length],
                            view === "grid"
                              ? "h-40 w-full"
                              : "h-auto min-h-36 w-40 shrink-0 sm:w-56",
                          )}
                          to={openHref}
                        >
                          <Box
                            className="size-12 opacity-70"
                            strokeWidth={1.35}
                          />
                          <span className="absolute bottom-3 left-3 rounded-lg bg-white/90 px-2.5 py-1 text-[11px] font-bold text-[#242428] shadow-sm">
                            {metric?.latestIfcId
                              ? "3D IFC"
                              : metric?.fileCount
                                ? "도면 파일"
                                : "새 프로젝트"}
                          </span>
                        </Link>
                        <div className="min-w-0 flex-1 p-4">
                          <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                              <Link
                                className="block truncate font-bold hover:text-[#2925d9]"
                                to={openHref}
                              >
                                {project.name}
                              </Link>
                              <p className="mt-1 truncate text-xs text-muted-foreground">
                                {metric?.latestFilename ??
                                  (project.description ||
                                    "아직 등록된 도면이 없습니다.")}
                              </p>
                            </div>
                            <span className="rounded-full bg-[#f1f1f3] px-2.5 py-1 text-[10px] font-bold dark:bg-white/5">
                              {workflowLabels[project.workflow_status] ??
                                project.workflow_status}
                            </span>
                          </div>
                          <div className="mt-4 h-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                            <div
                              className="h-full rounded-full bg-[#2925d9]"
                              style={{
                                width: `${workflowProgress[project.workflow_status] ?? 0}%`,
                              }}
                            />
                          </div>
                          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <Link
                              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 hover:border-[#2925d9]/40 hover:text-[#2925d9] dark:border-white/10"
                              to={
                                previewMode
                                  ? openHref
                                  : `/projects/${project.id}/files`
                              }
                            >
                              <FileBox className="size-3.5" /> 파일{" "}
                              {metric?.fileCount ?? 0}
                            </Link>
                            <Link
                              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 hover:border-[#2925d9]/40 hover:text-[#2925d9] dark:border-white/10"
                              to={
                                previewMode
                                  ? openHref
                                  : `/projects/${project.id}/drawings`
                              }
                            >
                              <MessageSquareText className="size-3.5" /> 미해결{" "}
                              {metric?.unresolvedDrawingCount ?? 0}
                            </Link>
                            <Link
                              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 hover:border-[#2925d9]/40 hover:text-[#2925d9] dark:border-white/10"
                              to={
                                previewMode
                                  ? openHref
                                  : `/projects/${project.id}/drawings`
                              }
                            >
                              <UserRound className="size-3.5" /> 내 담당{" "}
                              {metric?.assignedToMeCount ?? 0}
                            </Link>
                            <Link
                              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 hover:border-[#2925d9]/40 hover:text-[#2925d9] dark:border-white/10"
                              to={
                                previewMode
                                  ? openHref
                                  : `/projects/${project.id}/members`
                              }
                            >
                              <Users className="size-3.5" /> 참여{" "}
                              {metric?.memberCount ?? 0}
                            </Link>
                          </div>
                          <div className="mt-4 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground dark:border-white/10">
                            <span>수정 {formatDate(project.updated_at)}</span>
                            <Link
                              className="inline-flex items-center gap-1 font-bold text-[#2925d9] dark:text-[#aaa7ff]"
                              to={openHref}
                            >
                              열기 <ArrowUpRight className="size-3.5" />
                            </Link>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section
              aria-labelledby="activity-heading"
              className="mt-10 border-t border-black/10 pt-8 dark:border-white/10"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold" id="activity-heading">
                    최근 작업
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    실제 파일 업로드와 검토 기록입니다.
                  </p>
                </div>
                <CheckCircle2 className="size-5 text-emerald-600" />
              </div>
              {activities.length === 0 ? (
                <p className="mt-4 rounded-xl border border-dashed bg-white p-5 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/5">
                  프로젝트에 파일을 추가하거나 검토를 남기면 여기에 표시됩니다.
                </p>
              ) : (
                <ul className="mt-4 overflow-hidden rounded-2xl border bg-white dark:border-white/10 dark:bg-[#1b1b1e]">
                  {activities.map((activity) => (
                    <li
                      className="flex items-center gap-3 border-b p-4 last:border-b-0 dark:border-white/10"
                      key={activity.id}
                    >
                      <span
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-xl",
                          activity.kind === "file"
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                            : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
                        )}
                      >
                        {activity.kind === "file" ? (
                          <FileBox className="size-4" />
                        ) : (
                          <MessageSquareText className="size-4" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {activity.title}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {activity.projectName} · {activity.detail}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDate(activity.createdAt)}
                      </span>
                      <Link
                        aria-label={`${activity.projectName} 열기`}
                        className="grid size-9 place-items-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
                        to={
                          previewMode
                            ? previewProjectHref(activity.projectId)
                            : `/projects/${activity.projectId}`
                        }
                      >
                        <ArrowUpRight className="size-4" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </main>
      </div>
      <nav
        aria-label="모바일 작업공간 메뉴"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1 backdrop-blur lg:hidden dark:border-white/10 dark:bg-[#19191c]/95"
      >
        {[
          { label: "프로젝트", icon: FolderKanban, filter: "all" as const },
          { label: "진행 중", icon: Clock3, filter: "active" as const },
          { label: "검토", icon: MessageSquareText, filter: "review" as const },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button
              className="flex min-h-14 flex-col items-center justify-center gap-1 text-[10px] font-semibold text-muted-foreground"
              key={item.label}
              onClick={() => setFilter(item.filter)}
              type="button"
            >
              <Icon className="size-4" />
              {item.label}
            </button>
          );
        })}
        <Link
          className="flex min-h-14 flex-col items-center justify-center gap-1 text-[10px] font-semibold text-muted-foreground"
          to={linkTo("/notifications")}
        >
          <Bell className="size-4" />
          알림
        </Link>
        <Link
          className="flex min-h-14 flex-col items-center justify-center gap-1 text-[10px] font-semibold text-muted-foreground"
          to={linkTo("/logout")}
        >
          <LogOut className="size-4" />
          로그아웃
        </Link>
      </nav>
    </div>
  );
}
