import {
  ChevronDown,
  House,
  FileText,
  Bell,
  BookOpen,
  FolderKanban,
  Grid2X2,
  List,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  Star,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/core/components/ui/sheet";
import { cn } from "~/core/lib/utils";
import {
  type QuickStartFailure,
  type QuickStartRequests,
  WorkspaceQuickStart,
} from "~/lukas/components/workspace-quick-start";
import { drawingWorkspacePath } from "~/lukas/lib/drawing-workspace-paths";

type ProjectMetric = {
  canCreateWorkspace: boolean;
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
  shared?: boolean;
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

type WorkspaceOrganization = {
  id: string;
  name: string;
  can_manage: boolean;
  is_personal?: boolean;
};

type WorkspaceScope =
  | {
      key: string;
      kind: "organization";
      name: string;
      organizationId: string;
      can_manage: boolean;
      is_personal?: boolean;
    }
  | {
      key: "shared";
      kind: "shared";
      name: string;
      can_manage: false;
    };

type WorkspaceDashboardProps = {
  projects: WorkspaceProject[];
  projectMetrics: Record<string, ProjectMetric>;
  activities: WorkspaceActivity[];
  email: string;
  isStaff: boolean;
  organizations?: WorkspaceOrganization[];
  activeScope?: WorkspaceScope;
  hasSharedProjects?: boolean;
  actionError?: string;
  quickStartRequests?: QuickStartRequests;
  quickStartFailure?: QuickStartFailure;
  drawings?: Array<{
    id: string;
    project_id: string;
    title: string;
    updated_at: string;
    previewStartKind?: "blank" | "office" | "house" | "pdf";
    previewPaper?: "A2" | "A3" | "A4";
  }>;
  previewMode?: boolean;
  hasAccessibleProjects?: boolean;
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("ko-KR", {
        month: "short",
        day: "numeric",
        timeZone: "Asia/Seoul",
      }).format(date)
    : "수정일 없음";
}

function NewProjectDialog({ actionError }: { actionError?: string }) {
  const [open, setOpen] = useState(Boolean(actionError));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className="min-h-10 w-full justify-start rounded-lg px-3"
        >
          <Plus className="size-4" /> 새 프로젝트
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-2xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl">새 도면 프로젝트</DialogTitle>
          <DialogDescription>
            새 프로젝트는 내 개인 공간에 저장됩니다. 프로젝트를 만든 뒤
            Revit·IFC·도면 파일과 검토 참여자를 추가할 수 있습니다.
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

type ProjectListView = {query: string; filter: "all" | "mine" | "shared" | "favorites"; view: "grid" | "list"};
export function parseProjectListView(raw: string): ProjectListView | null {
  try {
    const value = JSON.parse(raw);
    return value && typeof value.query === "string" && value.query.length <= 500 && ["all","mine","shared","favorites"].includes(value.filter) && ["grid","list"].includes(value.view) ? {query:value.query,filter:value.filter,view:value.view} : null;
  } catch { return null; }
}

export function WorkspaceDashboard({
  projects,
  projectMetrics,
  email,
  isStaff,
  organizations = [],
  activeScope,
  hasSharedProjects = false,
  hasAccessibleProjects,
  actionError,
  quickStartRequests,
  quickStartFailure,
  drawings = [],
  previewMode = false,
}: WorkspaceDashboardProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "mine" | "shared" | "favorites">("all");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favoriteNotice, setFavoriteNotice] = useState("");
  useEffect(() => {
    if (!previewMode) return;
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem("1hk:preview:project-favorites") ?? "[]");
      if (Array.isArray(stored)) setFavorites(stored.filter((id): id is string => typeof id === "string"));
    } catch {
      setFavoriteNotice("즐겨찾기를 복원하지 못했습니다. 이 화면에서 다시 선택할 수 있습니다.");
    }
  }, [previewMode]);
  function toggleFavorite(id: string) {
    const next = favorites.includes(id) ? favorites.filter((item) => item !== id) : [...favorites, id];
    setFavorites(next);
    try {
      sessionStorage.setItem("1hk:preview:project-favorites", JSON.stringify(next));
      setFavoriteNotice("즐겨찾기가 이 브라우저 탭에 반영되었습니다. 실제 계정에는 저장되지 않습니다.");
    } catch {
      setFavoriteNotice("즐겨찾기는 현재 화면에서만 유지됩니다. 브라우저 저장 공간을 사용할 수 없습니다.");
    }
  }
  const [view, setView] = useState<"grid" | "list">("grid");
  const [listRestored, setListRestored] = useState(false);
  const [listStorageFailed, setListStorageFailed] = useState(false);
  useEffect(() => {
    if (!previewMode) return;
    try {
      const raw = sessionStorage.getItem("1hk:preview:project-list-view");
      const saved = raw ? parseProjectListView(raw) : null;
      if (saved) { setQuery(saved.query); setFilter(saved.filter); setView(saved.view); }
    } catch { setListStorageFailed(true); }
    setListRestored(true);
  }, [previewMode]);
  useEffect(() => {
    if (!previewMode || !listRestored || listStorageFailed) return;
    try { sessionStorage.setItem("1hk:preview:project-list-view", JSON.stringify({query:query.slice(0,500),filter,view})); }
    catch { setListStorageFailed(true); }
  }, [previewMode,listRestored,listStorageFailed,query,filter,view]);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const workspaceHref = previewMode ? "/workspace-preview" : "/workspace";
  const fallbackOrganization =
    organizations.find((item) => item.is_personal) ?? organizations[0];
  const resolvedActiveScope: WorkspaceScope =
    activeScope ??
    (fallbackOrganization
      ? {
          key: fallbackOrganization.id,
          kind: "organization",
          name: fallbackOrganization.name,
          organizationId: fallbackOrganization.id,
          can_manage: fallbackOrganization.can_manage,
          is_personal: fallbackOrganization.is_personal,
        }
      : {
          key: "shared",
          kind: "shared",
          name: "공유받은 항목",
          can_manage: false,
        });
  const organization =
    resolvedActiveScope.kind === "organization"
      ? organizations.find(
          (item) => item.id === resolvedActiveScope.organizationId,
        )
      : undefined;
  const scopedWorkspaceHref = previewMode
    ? workspaceHref
    : `${workspaceHref}?space=${encodeURIComponent(resolvedActiveScope.key)}`;
  const isFirstUse = !(
    hasAccessibleProjects ??
    (projects.length > 0 || hasSharedProjects || drawings.length > 0)
  );
  const userName = email.split("@")[0] || "내 계정";
  const quickStartProps = {
    requests: quickStartRequests,
    failure: quickStartFailure,
    previewMode,
  };
  const projectListHref = (id: string) =>
    previewMode
      ? `/workspace-preview?project=${encodeURIComponent(id)}`
      : `/projects/${id}/drawings`;
  const drawingHref = (projectId: string, drawingId: string) => {
    if (!previewMode) return drawingWorkspacePath(projectId, drawingId);
    const drawing = drawings.find((item) => item.id === drawingId);
    return `/workspace-preview/drawing-workspace?${new URLSearchParams({
      layout: "pdf",
      screenDocument: drawingId,
      startKind:
        drawing?.previewStartKind ?? (projects.findIndex((item) => item.id === projectId) === 1
          ? "house"
          : "office"),
      ...(drawing?.previewPaper ? {paper: drawing.previewPaper} : {}),
      title:
        drawing?.title ??
        projectMetrics[projectId]?.latestFilename ??
        "최근 도면",
      returnProject: projectId,
      ...(projectMetrics[projectId]?.canCreateWorkspace === false
        ? { role: "viewer" }
        : {}),
    })}`;
  };
  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    return [...projects]
      .filter((project) => {
        const shared = previewMode
          ? Boolean(project.shared)
          : resolvedActiveScope.kind === "shared";
        return (
          (filter === "all" || (filter === "favorites" ? favorites.includes(project.id) : filter === "shared" ? shared : !shared)) &&
          [
            project.name,
            project.description,
            projectMetrics[project.id]?.latestFilename ?? "",
            ...drawings.filter(drawing=>drawing.project_id===project.id).map(drawing=>drawing.title),
          ].some((value) =>
            value.toLocaleLowerCase("ko-KR").includes(normalized),
          )
        );
      })
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [
    projects,
    projectMetrics,
    drawings,
    query,
    filter,
    favorites,
    previewMode,
    resolvedActiveScope.kind,
  ]);
  const accessibleDrawings = drawings.filter((drawing) =>
    projects.some((project) => project.id === drawing.project_id),
  );
  const latestDrawing =
    [...accessibleDrawings].sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at),
    )[0] ??
    [...projects]
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .flatMap((project) => {
        const metric = projectMetrics[project.id];
        return metric?.latestDrawingId
          ? [
              {
                id: metric.latestDrawingId,
                project_id: project.id,
                title: metric.latestFilename ?? "최근 도면",
                updated_at: project.updated_at,
              },
            ]
          : [];
      })[0];
  const latestProject = projects.find(
    (project) => project.id === latestDrawing?.project_id,
  );
  const navigationItem =
    "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm transition hover:bg-muted focus-visible:outline-2 focus-visible:outline-[#2925d9]";
  function projectImage(index: number, large = false) {
    if (previewMode)
      return (
        <img
          alt=""
          className={cn("h-full w-full object-contain p-5", large && "p-6")}
          src={`/images/workspace-start/${index === 1 ? "house-plan.png" : "office-plan.png"}`}
        />
      );
    return (
      <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 bg-[#fafafa] text-muted-foreground dark:bg-white/5">
        <FileText className="size-8" strokeWidth={1.25} />
        <span className="text-xs">도면 미리보기 준비 중</span>
      </div>
    );
  }
  const navigationContent = (mobile: boolean) => (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-2">
        <Link
          className="flex min-h-11 flex-1 items-center gap-3"
          to={scopedWorkspaceHref}
        >
          <House className="size-7" strokeWidth={1.5} />
          <strong className="text-sm tracking-tight">1HK Platform</strong>
        </Link>
        {mobile ? (
          <SheetClose asChild>
            <Button aria-label="작업공간 메뉴 닫기" size="icon" variant="ghost">
              <X className="size-4" />
            </Button>
          </SheetClose>
        ) : null}
      </div>
      <form action={workspaceHref} method="get" className="mt-7">
        <select
          aria-label="작업 공간 선택"
          className="min-h-10 w-full rounded-lg border bg-background px-3 text-sm"
          defaultValue={resolvedActiveScope.key}
          key={resolvedActiveScope.key}
          disabled={previewMode}
          name="space"
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        >
          {organizations.map((item) => (
            <option key={item.id} value={item.id}>
              {item.is_personal ? "개인 작업공간" : item.name}
            </option>
          ))}
          <option value="shared">공유받은 항목</option>
        </select>
        <button type="submit" className="sr-only">
          선택한 공간 열기
        </button>
      </form>
      <nav className="mt-7 flex-1 space-y-2" aria-label="작업공간 메뉴">
        <Link
          className={cn(
            navigationItem,
            "bg-[#ecebff] text-[#2925d9] dark:bg-[#2925d9]/20 dark:text-[#b9b7ff]",
          )}
          aria-current="page"
          to={scopedWorkspaceHref}
        >
          <FolderKanban className="size-5" strokeWidth={1.5} />
          작업공간
        </Link>
        {organization || previewMode ? (
          <Link
            aria-label={
              organization ? `${organization.name} 라이브러리` : "라이브러리"
            }
            className={cn(navigationItem, "text-muted-foreground")}
            to={
              previewMode
                ? `/workspace-preview?state=${isFirstUse ? "empty" : "default"}&panel=library`
                : `/organizations/${organization!.id}/drawing-library`
            }
          >
            <BookOpen className="size-5" strokeWidth={1.5} />
            라이브러리
          </Link>
        ) : null}
      </nav>
      <div className="space-y-3">
        <details className="group">
          <summary
            className={cn(
              navigationItem,
              "cursor-pointer list-none text-muted-foreground",
            )}
          >
            <Settings className="size-5" strokeWidth={1.5} />
            <span>설정</span>
          </summary>
          <div className="ml-4 border-l pl-2">
            {organization?.can_manage ? (
              <Link
                className={navigationItem}
                to={
                  previewMode
                    ? `/workspace-preview?state=${isFirstUse ? "empty" : "default"}&panel=settings`
                    : `/organizations/${organization.id}/settings`
                }
              >
                {organization.is_personal ? "공간 관리" : "회사 관리"}
              </Link>
            ) : null}
            {organization ? (
              <Link
                className={navigationItem}
                to={
                  previewMode
                    ? `/workspace-preview?state=${isFirstUse ? "empty" : "default"}&panel=settings`
                    : `/organizations/${organization.id}/retention`
                }
              >
                보존 관리
              </Link>
            ) : null}
            {isStaff ? (
              <Link className={navigationItem} to="/staff/inquiries">
                문의함
              </Link>
            ) : null}
            {!organization && !isStaff ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                공간을 선택하면 관리 메뉴가 표시됩니다.
              </p>
            ) : null}
          </div>
        </details>
        <details className="relative border-t pt-3">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-2">
            <UserRound className="size-7 rounded-full bg-[#ecebff] p-1.5 text-[#2925d9]" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {previewMode ? "김민준" : userName}
            </span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </summary>
          <div className="absolute bottom-14 left-0 w-full rounded-xl border bg-background p-3 shadow-md">
            <p className="truncate text-xs text-muted-foreground">{email}</p>
            {previewMode ? (
              <p className="mt-3 text-xs">저장되지 않는 화면 미리보기입니다.</p>
            ) : (
              <Link className={cn(navigationItem, "mt-2")} to="/logout">
                <LogOut className="size-4" />
                로그아웃
              </Link>
            )}
          </div>
        </details>
      </div>
    </div>
  );

  return (
    <div
      data-workspace-state={isFirstUse ? "start" : "projects"}
      className="min-h-screen bg-[#fdfdfd] text-[#202024] dark:bg-[#121214] dark:text-white"
    >
      <aside
        aria-label="작업공간 탐색"
        id="workspace-navigation"
        className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r bg-background px-5 py-6 lg:flex"
      >
        {navigationContent(false)}
      </aside>
      <main className="min-w-0 lg:ml-64">
        <header className="flex min-h-20 items-center gap-4 border-b bg-background px-5 sm:px-10">
          <Sheet
            open={mobileNavigationOpen}
            onOpenChange={setMobileNavigationOpen}
          >
            <SheetTrigger asChild>
              <Button
                aria-label="작업공간 메뉴 열기"
                className="lg:hidden"
                size="icon"
                variant="ghost"
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent
              id="workspace-navigation-mobile"
              side="left"
              className="w-72 p-5 [&>button:last-child]:hidden"
            >
              <SheetHeader className="sr-only">
                <SheetTitle>작업공간 메뉴</SheetTitle>
                <SheetDescription>
                  작업 공간과 설정을 탐색합니다.
                </SheetDescription>
              </SheetHeader>
              {navigationContent(true)}
            </SheetContent>
          </Sheet>
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="프로젝트와 파일 검색"
              disabled={previewMode && !listRestored}
              placeholder="프로젝트·도면 검색"
              className="h-10 rounded-lg bg-background pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-4">
            {previewMode ? (
              <Link
                className="hidden text-xs text-muted-foreground underline underline-offset-4 sm:block"
                to={
                  isFirstUse
                    ? "/workspace-preview"
                    : "/workspace-preview?state=empty"
                }
              >
                {isFirstUse ? "프로젝트 화면 보기" : "처음 화면 보기"}
              </Link>
            ) : null}
            <Link
              aria-label="알림 작업함"
              className="grid size-10 place-items-center rounded-lg hover:bg-muted"
              to={
                previewMode
                  ? `/workspace-preview?state=${isFirstUse ? "empty" : "default"}&panel=notifications`
                  : "/notifications"
              }
            >
              <Bell className="size-5" strokeWidth={1.5} />
            </Link>
          </div>
        </header>
        <div className="mx-auto max-w-[1320px] px-5 py-8 sm:px-10 lg:py-9">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {isFirstUse ? "첫 도면을 시작해보세요" : "프로젝트"}
              </h1>
              {isFirstUse ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  빈 도면, 템플릿, 내 파일 중에서 시작하세요.
                </p>
              ) : null}
            </div>
            {previewMode ? <Button asChild variant="outline"><Link to={`/workspace-preview?state=${isFirstUse ? "empty" : "default"}&panel=new-project`}><Plus className="size-4" />새 프로젝트</Link></Button> : null}
            {!isFirstUse ? (
              <WorkspaceQuickStart
                {...quickStartProps}
                footer={
                  !previewMode ? (
                    <NewProjectDialog actionError={actionError} />
                  ) : undefined
                }
              />
            ) : null}
          </div>
          {isFirstUse ? (
            <WorkspaceQuickStart {...quickStartProps} presentation="start" />
          ) : (
            <>
              {latestDrawing && latestProject && !query && filter === "all" ? (
                <section aria-label="이어서 작업" className="mt-7">
                  <h2 className="text-base font-semibold">이어서 작업</h2>
                  <div className="mt-4 grid overflow-hidden rounded-xl border bg-background sm:grid-cols-[1.2fr_1fr]">
                    <Link
                      tabIndex={-1}
                      aria-hidden="true"
                      className="h-48 sm:h-56"
                      to={drawingHref(
                        latestDrawing.project_id,
                        latestDrawing.id,
                      )}
                    >
                      {projectImage(projects.indexOf(latestProject), true)}
                    </Link>
                    <div className="flex flex-col items-start justify-center px-7 pb-6 sm:py-6">
                      <h3 className="max-w-full truncate text-lg font-semibold">
                        {latestProject.name}
                      </h3>
                      <p className="mt-3 max-w-full truncate text-sm text-muted-foreground">
                        {latestDrawing.title}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDate(latestDrawing.updated_at)} 수정
                      </p>
                      <Link
                        className="mt-6 inline-flex min-h-10 items-center justify-center rounded-lg bg-[#2925d9] px-7 text-sm font-semibold text-white hover:bg-[#211dc0] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2925d9]"
                        to={drawingHref(
                          latestDrawing.project_id,
                          latestDrawing.id,
                        )}
                      >
                        이어하기
                      </Link>
                    </div>
                  </div>
                </section>
              ) : null}
              <section aria-labelledby="project-list-heading" className="mt-8">
                <div className="flex items-center justify-between gap-4">
                  <h2
                    id="project-list-heading"
                    className="text-base font-semibold"
                  >
                    전체 프로젝트
                  </h2>
                  <div className="flex items-center gap-1">
                    {[
                      ["grid", Grid2X2, "격자로 보기"],
                      ["list", List, "목록으로 보기"],
                    ].map(([kind, Icon, label]) => {
                      const ViewIcon = Icon as typeof Grid2X2;
                      return (
                        <button
                          key={kind as string}
                          type="button"
                          aria-label={label as string}
                          aria-pressed={view === kind}
                          className={cn(
                            "grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted",
                            view === kind && "bg-[#ecebff] text-[#2925d9]",
                          )}
                          disabled={previewMode && !listRestored}
                          onClick={() => setView(kind as "grid" | "list")}
                        >
                          <ViewIcon className="size-4" />
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2" aria-label="프로젝트 필터">
                  {(
                    [
                      ["all", "전체"],
                      ["mine", "내 작업"],
                      ["shared", "공유받음"],
                      ...(previewMode ? [["favorites", "즐겨찾기"] as const] : []),
                    ] as const
                  ).map(([kind, label]) => {
                    const needsScope =
                      !previewMode &&
                      ((kind === "shared" &&
                        resolvedActiveScope.kind !== "shared") ||
                        (kind === "mine" &&
                          resolvedActiveScope.kind === "shared" &&
                          fallbackOrganization));
                    const className = cn(
                      "inline-flex min-h-8 items-center rounded-full border px-3 text-xs hover:bg-muted",
                      filter === kind &&
                        "border-[#dedaef] bg-[#ecebff] text-[#2925d9]",
                    );
                    return needsScope ? (
                      <Link
                        className={className}
                        key={kind}
                        to={`/workspace?space=${kind === "shared" ? "shared" : fallbackOrganization!.id}`}
                      >
                        {label}
                      </Link>
                    ) : (
                      <button
                        className={className}
                        key={kind}
                        type="button"
                        aria-pressed={filter === kind}
                        disabled={previewMode && !listRestored}
                        onClick={() => setFilter(kind)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {favoriteNotice ? <p role="status" className="mt-2 text-xs text-muted-foreground">{favoriteNotice}</p> : null}
                {previewMode && !listRestored && <p role="status" className="mt-2 text-xs text-muted-foreground">목록 설정을 복원하고 있습니다.</p>}
                {listStorageFailed && <p role="status" className="mt-2 text-xs text-muted-foreground">목록 설정은 현재 화면에서만 유지됩니다. 브라우저 보관을 사용할 수 없습니다.</p>}
                {filteredProjects.length === 0 ? (
                  <div className="mt-5 rounded-xl border border-dashed p-10 text-center">
                    <FolderKanban
                      className="mx-auto size-8 text-muted-foreground"
                      strokeWidth={1.5}
                    />
                    <p className="mt-4 text-sm font-medium">
                      {filter === "favorites" && !query
                        ? "즐겨찾는 프로젝트가 없습니다."
                        : query || filter !== "all"
                        ? "조건에 맞는 프로젝트가 없습니다."
                        : "이 공간에는 아직 프로젝트가 없습니다."}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      검색 조건을 바꾸거나 다른 작업공간을 선택하세요.
                    </p>
                    {hasSharedProjects ? (
                      <Link
                        className="mt-4 inline-block text-sm font-medium text-[#2925d9] underline"
                        to={
                          previewMode
                            ? "/workspace-preview"
                            : "/workspace?space=shared"
                        }
                      >
                        공유받은 프로젝트 보기
                      </Link>
                    ) : null}
                    {query || filter !== "all" ? (
                      <button
                        className="mt-4 block w-full text-sm font-medium text-[#2925d9]"
                        onClick={() => {
                          setQuery("");
                          setFilter("all");
                        }}
                      >
                        검색 초기화
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <ul
                    className={cn(
                      "mt-4 grid gap-4",
                      view === "grid"
                        ? "sm:grid-cols-2 xl:grid-cols-3"
                        : "grid-cols-1",
                    )}
                  >
                    {filteredProjects.map((project) => {
                      const count = accessibleDrawings.filter(
                        (drawing) => drawing.project_id === project.id,
                      ).length;
                      const metric = projectMetrics[project.id];
                      return (
                        <li key={project.id} className="relative">
                          <Link
                            aria-label={`${project.name} 도면 목록 열기`}
                            className={cn(
                              "group block h-full overflow-hidden rounded-xl border bg-background transition hover:border-[#2925d9]/40 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-[#2925d9]",
                              view === "list" && "flex items-center",
                            )}
                            to={projectListHref(project.id)}
                          >
                            <div
                              className={cn(
                                "bg-[#fdfdfd]",
                                view === "grid" ? "h-44" : "h-24 w-32 shrink-0",
                              )}
                            >
                              {projectImage(projects.indexOf(project))}
                            </div>
                            <div className="min-w-0 p-5 pr-12">
                              <h3 className="truncate text-sm font-semibold">
                                {project.name}
                              </h3>
                              <p className="mt-3 truncate text-xs text-muted-foreground">
                                {count > 0
                                  ? `도면 ${count}개`
                                  : metric?.latestDrawingId
                                    ? "도면 있음"
                                    : "도면 없음"}{" "}
                                · {formatDate(project.updated_at)}
                              </p>
                              {previewMode && project.shared ? (
                                <span className="mt-2 inline-block text-[11px] text-[#2925d9]">
                                  공유받은 프로젝트
                                </span>
                              ) : null}
                            </div>
                          </Link>
                          {previewMode ? (
                            <button
                              type="button"
                              aria-label={`${project.name} 즐겨찾기 ${favorites.includes(project.id) ? "해제" : "추가"}`}
                              aria-pressed={favorites.includes(project.id)}
                              onClick={() => toggleFavorite(project.id)}
                              className="absolute right-2 top-2 grid size-10 place-items-center rounded-full border bg-background text-[#2925d9] shadow-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-[#2925d9]"
                            >
                              <Star className={cn("size-4", favorites.includes(project.id) && "fill-current")} />
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          )}
          {previewMode ? (
            <p className="mt-7 text-[11px] text-muted-foreground">
              화면 미리보기 · 예시 프로젝트이며 실제 계정에 저장되지 않습니다.
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
