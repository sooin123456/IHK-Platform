import {
  ArrowLeft,
  ArrowRight,
  Box,
  Calculator,
  ChevronRight,
  FileText,
  Files,
  FolderOpen,
  House,
  LayoutGrid,
  List,
  ListChecks,
  LockKeyhole,
  Menu,
  PackageCheck,
  Plus,
  Search,
  Upload,
  Users,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";

import { Button } from "~/core/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/core/components/ui/sheet";
import { cn } from "~/core/lib/utils";
import { drawingUploadPath } from "~/lukas/lib/drawing-entry";
import {
  drawingWorkspaceNewPath,
  drawingWorkspacePath,
} from "~/lukas/lib/drawing-workspace-paths";

export type ProjectDrawingSummary = {
  id: string;
  title: string;
  source_file_id: string | null;
  updated_at: string;
  thumbnailUrl?: string;
  previewStartKind?: "blank" | "office" | "house" | "pdf";
  previewPaper?: "A2" | "A3" | "A4";
};

export type ProjectDrawingFileSummary = {
  id: string;
  kind: string;
  original_filename: string;
  byte_size: number;
  created_at: string;
};

type ProjectDrawingsBrowserProps = {
  project: { id: string; name: string };
  documents: ProjectDrawingSummary[];
  files: ProjectDrawingFileSummary[];
  canCreateWorkspace: boolean;
  previewMode?: boolean;
  activeSection?: "drawings" | "reviews" | "resources" | "changes" | "sharing" | "quantities" | "materials" | "deliveries";
  children?: ReactNode;
};

const projectSections = [
  { key: "drawings", label: "도면", icon: Files },
  { key: "resources", label: "자료", icon: FolderOpen },
  { key: "reviews", label: "검토", icon: ListChecks },
  { key: "changes", label: "변경 이력", icon: ListChecks },
  { key: "quantities", label: "물량", icon: Calculator },
  { key: "materials", label: "자재", icon: PackageCheck },
  { key: "deliveries", label: "납품", icon: PackageCheck },
  { key: "sharing", label: "외부 공유", icon: Users },
] as const;

function dateValue(value: string) {
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : 0;
}

function displayDate(value: string) {
  return dateValue(value)
    ? new Date(value).toLocaleDateString("ko-KR", {
        month: "long",
        day: "numeric",
        timeZone: "Asia/Seoul",
      })
    : "날짜 정보 없음";
}

function fileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "크기 정보 없음";
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ProjectNavigation({
  project,
  previewMode = false,
  previewBase,
  onNavigate,
  activeSection = "drawings",
}: {
  project: ProjectDrawingsBrowserProps["project"];
  previewMode?: boolean;
  previewBase: string;
  onNavigate?: () => void;
  activeSection?: ProjectDrawingsBrowserProps["activeSection"];
}) {
  const base = `/projects/${project.id}`;
  const sectionHref = (section: string) =>
    previewMode
      ? section === "drawings"
        ? previewBase
        : `${previewBase}&panel=project-${section}`
      : section === "overview"
        ? base
        : `${base}/${section}`;
  return (
    <div className="flex h-full flex-col px-5 py-7">
      <Link
        className="flex min-h-10 items-center gap-3 px-2 text-sm"
        to={previewMode ? "/workspace-preview" : "/workspace"}
        onClick={onNavigate}
      >
        <House className="size-6" strokeWidth={1.6} />
        <strong>1HK Platform</strong>
      </Link>
      <Link
        className="mt-6 flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2"
        to={previewMode ? "/workspace-preview" : "/workspace"}
        onClick={onNavigate}
      >
        <ArrowLeft className="size-4" /> 모든 프로젝트
      </Link>
      <div className="mt-5 border-t px-2 pt-6">
        <p className="text-xs text-muted-foreground">프로젝트</p>
        <p className="mt-2 break-words text-sm font-semibold">{project.name}</p>
      </div>
      <nav aria-label="프로젝트 업무" className="mt-5 grid gap-2">
        {projectSections.filter(({key}) => previewMode || !["resources", "changes", "sharing", "deliveries"].includes(key)).map(({ key, label, icon: Icon }) => (
          <Link
            aria-current={key === activeSection ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
              key === activeSection
                ? "bg-[#ecebff] font-medium text-[#2925d9]"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            key={key}
            to={sectionHref(key)}
            onClick={onNavigate}
          >
            <Icon className="size-[18px]" strokeWidth={1.7} />
            {label}
          </Link>
        ))}
      </nav>
      <nav
        aria-label="프로젝트 관리"
        className="mt-auto grid gap-1 border-t pt-4"
      >
        <Link
          className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted"
          to={sectionHref("overview")}
          onClick={onNavigate}
        >
          <FolderOpen className="size-[18px]" />
          프로젝트 개요
        </Link>
        <Link
          className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted"
          to={sectionHref("members")}
          onClick={onNavigate}
        >
          <Users className="size-[18px]" />
          참여자
        </Link>
      </nav>
    </div>
  );
}

export function ProjectDrawingsBrowser({
  project,
  documents,
  files,
  canCreateWorkspace,
  previewMode = false,
  activeSection = "drawings",
  children,
}: ProjectDrawingsBrowserProps) {
  const [params] = useSearchParams();
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [sort, setSort] = useState(() =>
    params.get("sort") === "title" ? "title" : "updated",
  );
  const [view, setView] = useState(() =>
    params.get("view") === "list" ? "list" : "grid",
  );
  const [tab, setTab] = useState(() =>
    params.get("tab") === "files" ||
    (documents.length === 0 && files.length > 0)
      ? "files"
      : "drawings",
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const previewBase = `/workspace-preview?project=${project.id}${!canCreateWorkspace ? "&role=viewer" : ""}${params.get("empty") === "1" ? "&empty=1" : ""}`;
  const filesHref = previewMode
    ? `${previewBase}&tab=files`
    : `/projects/${project.id}/files`;
  const createHref = previewMode
    ? `${previewBase}&start=blank`
    : drawingWorkspaceNewPath(project.id);
  const uploadHref = previewMode
    ? `${previewBase}${tab === "files" ? "&tab=files" : ""}&start=file`
    : drawingUploadPath(project.id);
  const editorHref = (documentId: string) => {
    if (!previewMode) return drawingWorkspacePath(project.id, documentId);
    const document = documents.find((item) => item.id === documentId);
    return `/workspace-preview/drawing-workspace?${new URLSearchParams({
      layout: "pdf",
      screenDocument: documentId,
      startKind: document?.previewStartKind ?? (document?.thumbnailUrl?.endsWith("house-plan.png")
        ? "house"
        : document?.source_file_id
          ? "office"
          : "blank"),
      ...(document?.previewPaper ? {paper: document.previewPaper} : {}),
      title: document?.title ?? "새 도면",
      returnProject: project.id,
      ...(!canCreateWorkspace ? { role: "viewer" } : {}),
      ...(params.get("empty") === "1" ? { returnEmpty: "1" } : {}),
    })}`;
  };
  const orderedDocuments = [...documents].sort(
    (a, b) =>
      dateValue(b.updated_at) - dateValue(a.updated_at) ||
      b.id.localeCompare(a.id),
  );
  const sourceById = new Map(files.map((file) => [file.id, file]));
  const latestDocumentBySource = new Map<string, ProjectDrawingSummary>();
  for (const document of orderedDocuments) {
    if (
      document.source_file_id &&
      !latestDocumentBySource.has(document.source_file_id)
    ) {
      latestDocumentBySource.set(document.source_file_id, document);
    }
  }
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const matches = (...values: string[]) =>
    values.join(" ").toLocaleLowerCase("ko-KR").includes(normalizedQuery);
  const visibleDocuments = orderedDocuments.filter((document) =>
    matches(
      document.title,
      sourceById.get(document.source_file_id ?? "")?.original_filename ?? "",
    ),
  );
  const visibleFiles = files.filter((file) =>
    matches(file.original_filename, file.kind),
  );
  if (sort === "title") {
    visibleDocuments.sort((a, b) => a.title.localeCompare(b.title, "ko-KR"));
    visibleFiles.sort((a, b) =>
      a.original_filename.localeCompare(b.original_filename, "ko-KR"),
    );
  } else {
    visibleFiles.sort(
      (a, b) =>
        dateValue(b.created_at) - dateValue(a.created_at) ||
        b.id.localeCompare(a.id),
    );
  }
  const total = tab === "drawings" ? documents.length : files.length;
  const count =
    tab === "drawings" ? visibleDocuments.length : visibleFiles.length;
  const completelyEmpty = documents.length === 0 && files.length === 0;
  const sourceAction = (file: ProjectDrawingFileSummary) => {
    if (previewMode && file.kind === "pdf") {
      return {
        href: `/workspace-preview/drawing-workspace?layout=pdf&returnProject=${project.id}${!canCreateWorkspace ? "&role=viewer" : ""}${params.get("empty") === "1" ? "&returnEmpty=1" : ""}&returnTab=files`,
        label: "PDF 화면 열기",
      };
    }
    if (previewMode)
      return {
        href: `${previewBase}&tab=files&panel=project-files`,
        label: "파일 정보",
      };
    const document = latestDocumentBySource.get(file.id);
    return document
      ? { href: editorHref(document.id), label: "편집 도면 열기" }
      : canCreateWorkspace
        ? {
            href: previewMode
              ? `${previewBase}&start=file`
              : drawingWorkspaceNewPath(project.id, file.id),
            label: "작업실 만들기",
          }
        : {
            href: previewMode
              ? `${previewBase}&panel=project-files`
              : filesHref,
            label: "파일 보기",
          };
  };

  return (
    <div
      className="min-h-screen bg-[#fcfcfd] text-[#202124]"
      data-project-library={project.id}
    >
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-white md:block">
        <ProjectNavigation
          project={project}
          previewMode={previewMode}
          previewBase={previewBase}
          activeSection={activeSection}
        />
      </aside>
      <main className="min-w-0 md:ml-64">
        <header className="flex min-h-20 items-center gap-4 border-b bg-white px-5 sm:px-10">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button
                aria-label="프로젝트 메뉴 열기"
                className="shrink-0 md:hidden"
                size="icon"
                variant="ghost"
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>프로젝트 메뉴</SheetTitle>
                <SheetDescription>
                  도면, 검토, 물량과 프로젝트 관리로 이동합니다.
                </SheetDescription>
              </SheetHeader>
              <ProjectNavigation
                project={project}
                previewMode={previewMode}
                previewBase={previewBase}
                activeSection={activeSection}
                onNavigate={() => setMenuOpen(false)}
              />
            </SheetContent>
          </Sheet>
          <nav
            aria-label="현재 위치"
            className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground"
          >
            <Link
              className="hidden shrink-0 hover:text-foreground sm:inline"
              to={previewMode ? "/workspace-preview" : "/workspace"}
            >
              프로젝트
            </Link>
            <ChevronRight className="hidden size-4 shrink-0 sm:block" />
            <span className="truncate" title={project.name}>
              {project.name}
            </span>
          </nav>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <LockKeyhole className="size-3.5" />
            {canCreateWorkspace ? "편집 가능" : "보기 권한"}
          </span>
        </header>

        <div className="mx-auto max-w-[1440px] px-5 py-8 sm:px-10 sm:py-9">
          {children ?? <>
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">도면</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                작업할 도면을 열고, 원본 근거와 함께 관리하세요.
              </p>
            </div>
            {canCreateWorkspace ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  asChild
                  className="min-h-11 rounded-lg"
                  variant="outline"
                >
                  <Link to={uploadHref}>
                    <Upload className="size-4" />
                    {previewMode ? "파일로 시작" : "파일 추가"}
                  </Link>
                </Button>
                <Button
                  asChild
                  className="min-h-11 rounded-lg bg-[#2925d9] text-white hover:bg-[#231dc0]"
                >
                  <Link to={createHref}>
                    <Plus className="size-4" />새 도면
                  </Link>
                </Button>
              </div>
            ) : null}
          </div>

          <div aria-label="도면 분류" className="mt-8 flex gap-6 border-b">
            {[
              ["drawings", "편집 도면", documents.length],
              ["files", "원본 파일", files.length],
            ].map(([key, label, length]) => (
              <button
                aria-pressed={tab === key}
                className={cn(
                  "min-h-12 border-b-2 px-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
                  tab === key
                    ? "border-[#2925d9] font-semibold text-[#2925d9]"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
                key={key}
                onClick={() => {
                  setTab(String(key));
                  setQuery("");
                }}
                type="button"
              >
                {label}
                <span className="ml-2 text-xs tabular-nums">{length}</span>
              </button>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:mr-auto sm:w-72">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground"
              />
              <input
                aria-label="도면 검색"
                className="h-10 w-full rounded-lg border bg-white pl-9 pr-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#2925d9]/30"
                placeholder={
                  tab === "drawings"
                    ? "도면 이름 또는 원본 파일 검색"
                    : "원본 파일 검색"
                }
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
              {query ? (
                <button
                  aria-label="검색 초기화"
                  className="absolute right-1 top-1 grid size-8 place-items-center rounded-md hover:bg-muted"
                  onClick={() => setQuery("")}
                  type="button"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="sr-only">도면 정렬</span>
              <select
                aria-label="도면 정렬"
                className="h-10 rounded-lg border bg-white px-3 text-sm text-foreground"
                value={sort}
                onChange={(event) => setSort(event.currentTarget.value)}
              >
                <option value="updated">최근 수정순</option>
                <option value="title">이름순</option>
              </select>
            </label>
            <div aria-label="도면 표시 방식" className="flex gap-1">
              {[
                { key: "grid", label: "격자로 보기", icon: LayoutGrid },
                { key: "list", label: "목록으로 보기", icon: List },
              ].map(({ key, label, icon: Icon }) => (
                <Button
                  aria-label={label}
                  aria-pressed={view === key}
                  className={cn(
                    "size-10",
                    view === key && "bg-[#ecebff] text-[#2925d9]",
                  )}
                  key={key}
                  onClick={() => setView(key)}
                  size="icon"
                  variant="ghost"
                >
                  <Icon className="size-4" />
                </Button>
              ))}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <p role="status">
              {query
                ? `검색 결과 ${count}개 · 전체 ${total}개`
                : `${total}개 ${tab === "drawings" ? "도면" : "원본"}`}
            </p>
            {tab === "files" ? (
              <p>원본은 보존하고, 변경 사항은 편집 도면에 저장합니다.</p>
            ) : null}
          </div>

          {count === 0 ? (
            <section className="mt-4 rounded-xl border border-dashed bg-white px-6 py-16 text-center">
              <FolderOpen
                className="mx-auto size-9 text-muted-foreground"
                strokeWidth={1.4}
              />
              <h2 className="mt-5 text-base font-semibold">
                {query
                  ? "검색 결과가 없습니다"
                  : completelyEmpty
                    ? "아직 도면이 없습니다"
                    : tab === "files"
                      ? "원본 파일이 없습니다"
                      : "편집 도면이 없습니다"}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                {query
                  ? "다른 이름으로 검색하거나 검색어를 초기화하세요."
                  : tab === "files" && !completelyEmpty
                    ? "빈 도면은 원본 파일 없이 사용할 수 있습니다. 필요할 때 파일을 추가하세요."
                    : canCreateWorkspace
                      ? "파일 업로드 없이 빈 도면으로 시작할 수 있습니다."
                      : "프로젝트 편집자가 도면을 추가하면 이곳에서 확인할 수 있습니다."}
              </p>
              {query ? (
                <Button
                  className="mt-5"
                  variant="outline"
                  onClick={() => setQuery("")}
                >
                  검색 초기화
                </Button>
              ) : canCreateWorkspace ? (
                <Button asChild className="mt-5" variant="outline">
                  <Link
                    to={
                      tab === "files" && !completelyEmpty
                        ? uploadHref
                        : createHref
                    }
                  >
                    {tab === "files" && !completelyEmpty
                      ? "파일 추가"
                      : "새 도면"}
                  </Link>
                </Button>
              ) : (
                <Button asChild className="mt-5" variant="outline">
                  <Link
                    to={
                      previewMode
                        ? `${previewBase}&panel=project-overview`
                        : `/projects/${project.id}`
                    }
                  >
                    프로젝트 개요
                  </Link>
                </Button>
              )}
            </section>
          ) : (
            <ul
              className={cn(
                "mt-4 grid gap-4",
                view === "grid"
                  ? "sm:grid-cols-2 xl:grid-cols-3"
                  : "grid-cols-1",
              )}
              data-drawing-view={view}
            >
              {tab === "drawings"
                ? visibleDocuments.map((document) => {
                    const source = sourceById.get(
                      document.source_file_id ?? "",
                    );
                    return (
                      <li key={document.id}>
                        <Link
                          aria-label={`${document.title} 작업실 열기`}
                          className={cn(
                            "group flex h-full overflow-hidden rounded-xl border bg-white transition-colors hover:border-[#2925d9]/45 focus-visible:outline-2 focus-visible:outline-offset-2",
                            view === "grid" ? "flex-col" : "items-center",
                          )}
                          to={editorHref(document.id)}
                        >
                          <div
                            className={cn(
                              "flex shrink-0 items-center justify-center bg-[#fafafa]",
                              view === "grid"
                                ? "h-44 border-b p-4"
                                : "m-3 size-14 rounded-lg",
                            )}
                          >
                            {previewMode && document.thumbnailUrl ? (
                              <img
                                alt=""
                                className="h-full w-full object-contain"
                                src={document.thumbnailUrl}
                              />
                            ) : (
                              <FileText
                                aria-hidden="true"
                                className={cn(
                                  "text-[#8c8d99]",
                                  view === "grid" ? "size-10" : "size-6",
                                )}
                                strokeWidth={1.2}
                              />
                            )}
                          </div>
                          <div className="min-w-0 flex-1 p-4">
                            <div className="flex min-w-0 items-start justify-between gap-2">
                              <h2 className="break-words text-sm font-semibold group-hover:text-[#2925d9]">
                                {document.title}
                              </h2>
                              <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                            </div>
                            <p
                              className="mt-2 truncate text-xs text-muted-foreground"
                              title={source?.original_filename}
                            >
                              {source
                                ? source.original_filename
                                : document.source_file_id
                                  ? "원본 연결 도면"
                                  : document.previewStartKind === "pdf" ? "로컬 PDF · 다시 열 때 파일 재선택" : "빈 도면에서 시작"}
                            </p>
                            <p className="mt-3 text-xs text-muted-foreground">
                              {displayDate(document.updated_at)} 수정
                              {previewMode ? " · 화면 예시" : ""}
                            </p>
                          </div>
                        </Link>
                      </li>
                    );
                  })
                : visibleFiles.map((file) => {
                    const action = sourceAction(file);
                    const Icon = file.kind === "ifc" ? Box : FileText;
                    return (
                      <li key={file.id}>
                        <Link
                          aria-label={`${file.original_filename} ${action.label}`}
                          className={cn(
                            "group flex h-full gap-4 rounded-xl border bg-white p-5 transition-colors hover:border-[#2925d9]/45 focus-visible:outline-2 focus-visible:outline-offset-2",
                            view === "grid"
                              ? "min-h-48 flex-col"
                              : "items-center",
                          )}
                          to={action.href}
                        >
                          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                            <Icon className="size-6" strokeWidth={1.4} />
                            <span className="uppercase">{file.kind}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <h2 className="break-words text-sm font-semibold group-hover:text-[#2925d9]">
                              {file.original_filename}
                            </h2>
                            <p className="mt-2 text-xs text-muted-foreground">
                              {fileSize(file.byte_size)} ·{" "}
                              {displayDate(file.created_at)}
                            </p>
                          </div>
                          <span className="flex shrink-0 items-center gap-2 text-xs font-medium text-[#2925d9]">
                            {action.label}
                            <ArrowRight className="size-4" />
                          </span>
                        </Link>
                      </li>
                    );
                  })}
            </ul>
          )}
          <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <p>
              {previewMode
                ? "화면 미리보기 · 도면 카드는 이미지 예시입니다. 파일로 시작에서 PDF 또는 CAD 준비 화면을 선택하세요. 원본 파일은 업로드되지 않으며, 새로 만든 도면의 목록 정보만 이 탭에 보관됩니다."
                : "원본 파일과 편집 도면은 별도로 관리됩니다."}
            </p>
            {previewMode ? (
              <span>PDF · IFC · DXF 예시</span>
            ) : (
              <Link
                className="inline-flex min-h-10 items-center gap-1 hover:text-foreground"
                to={filesHref}
              >
                전체 파일 관리
                <ArrowRight className="size-3" />
              </Link>
            )}
          </footer>
          </>}
        </div>
      </main>
    </div>
  );
}
