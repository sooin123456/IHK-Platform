import type { Route } from "./+types/workspace";

import type { Database } from "database.types";
import {
  ArrowRight,
  Box,
  CheckCircle2,
  Clock3,
  FileBox,
  FolderKanban,
  LayoutGrid,
  MessageSquareText,
  Plus,
} from "lucide-react";
import { Form, Link, data, redirect } from "react-router";
import { z } from "zod";

import { Button } from "~/core/components/ui/button";
import { Input } from "~/core/components/ui/input";
import { Label } from "~/core/components/ui/label";
import makeServerClient from "~/core/lib/supa-client.server";

const newProjectSchema = z.object({
  name: z.string().trim().min(1, "프로젝트명을 입력하세요.").max(160),
  description: z.string().trim().max(2000).optional(),
  contactName: z.string().trim().max(80).optional(),
  contactPhone: z.string().trim().max(40).optional(),
});

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

type ProjectMetric = {
  fileCount: number;
  ifcCount: number;
  openReviewCount: number;
};

function projectNextStep(projectId: string, metric?: ProjectMetric) {
  if (!metric || metric.fileCount === 0) {
    return { href: `/projects/${projectId}/files`, label: "첫 도면 추가하기" };
  }
  if (metric.openReviewCount > 0) {
    return {
      href: `/projects/${projectId}/reviews`,
      label: `검토 ${metric.openReviewCount}건 확인하기`,
    };
  }
  return { href: `/projects/${projectId}`, label: "도면 작업공간 열기" };
}

export const meta: Route.MetaFunction = () => [
  { title: "고객 프로젝트 | 한길시스템" },
  {
    name: "description",
    content:
      "한길시스템 BIM 적산 프로젝트의 파일, 진행 상태와 검토 기록을 확인합니다.",
  },
];

export async function loader({ request }: Route.LoaderArgs) {
  const [client] = makeServerClient(request);
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user || user.is_anonymous) throw redirect("/login");

  const { data: projects, error } = await client
    .from("lukas_qto_projects")
    .select("id, name, description, workflow_status, created_at, updated_at")
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Response("프로젝트 목록을 불러오지 못했습니다.", { status: 500 });
  }

  const projectIds = (projects ?? []).map((project) => project.id);
  const [
    { data: files, error: filesError },
    { data: reviews, error: reviewsError },
  ] =
    projectIds.length === 0
      ? [
          { data: [], error: null },
          { data: [], error: null },
        ]
      : await Promise.all([
          client
            .from("lukas_qto_files")
            .select("id, project_id, kind")
            .in("project_id", projectIds),
          client
            .from("lukas_qto_reviews")
            .select("id, project_id, status")
            .in("project_id", projectIds),
        ]);

  if (filesError || reviewsError) {
    throw new Response("프로젝트 현황을 불러오지 못했습니다.", { status: 500 });
  }

  const projectMetrics = Object.fromEntries(
    projectIds.map((projectId) => {
      const projectFiles = (files ?? []).filter(
        (file) => file.project_id === projectId,
      );
      return [
        projectId,
        {
          fileCount: projectFiles.length,
          ifcCount: projectFiles.filter((file) => file.kind === "ifc").length,
          openReviewCount: (reviews ?? []).filter(
            (review) =>
              review.project_id === projectId && review.status !== "resolved",
          ).length,
        },
      ];
    }),
  );

  return {
    projects: projects ?? [],
    projectMetrics,
    email: user.email ?? "",
    isStaff: user.app_metadata.role === "hangil_staff",
  };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const parsed = newProjectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return data(
      { error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." },
      { status: 400 },
    );
  }

  const [client, headers] = makeServerClient(request);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || user.is_anonymous)
    return data(
      { error: "이메일 로그인이 필요합니다." },
      { status: 401, headers },
    );

  // organization_id is filled by the protected before-insert trigger that
  // creates/uses the owner's personal organization. Generated PostgREST types
  // cannot infer that trigger contract, so keep the omission explicit here.
  const projectInsert = {
    owner_id: user.id,
    name: parsed.data.name,
    description: parsed.data.description ?? "",
    contact_name: parsed.data.contactName ?? "",
    contact_phone: parsed.data.contactPhone ?? "",
    workflow_status: "inquiry_received",
  } as Omit<
    Database["public"]["Tables"]["lukas_qto_projects"]["Insert"],
    "organization_id"
  >;

  const { data: project, error } = await client
    .from("lukas_qto_projects")
    .insert(
      projectInsert as Database["public"]["Tables"]["lukas_qto_projects"]["Insert"],
    )
    .select("id")
    .single();
  if (error || !project) {
    return data(
      { error: error?.message ?? "프로젝트를 만들지 못했습니다." },
      { status: 400, headers },
    );
  }

  return redirect(`/projects/${project.id}`, { headers });
}

export default function Workspace({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const activeProjectCount = loaderData.projects.filter(
    (project) => project.workflow_status !== "delivered",
  ).length;
  const deliveredProjectCount = loaderData.projects.length - activeProjectCount;
  const pendingReviewCount = Object.values(loaderData.projectMetrics).reduce(
    (sum, metric) => sum + metric.openReviewCount,
    0,
  );
  const newProjectSection = (
    <details
      className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
      open={
        loaderData.projects.length === 0 ||
        Boolean(actionData && "error" in actionData)
      }
    >
      <summary className="cursor-pointer list-none rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="block text-lg font-semibold">새 프로젝트 시작</span>
        <span className="mt-1 block text-sm text-muted-foreground">
          프로젝트명만 입력해도 됩니다. 담당자가 범위를 확인해 안내합니다.
        </span>
      </summary>
      <Form className="mt-5 grid gap-4 sm:grid-cols-2" method="post">
        <div className="grid gap-2">
          <Label htmlFor="name">프로젝트명</Label>
          <Input
            id="name"
            name="name"
            placeholder="예: 건우설계 근린생활시설"
            required
            maxLength={160}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="description">설명 (선택)</Label>
          <Input
            id="description"
            name="description"
            placeholder="검토 범위 또는 발행 차수"
            maxLength={2000}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="contactName">담당자 (선택)</Label>
          <Input id="contactName" name="contactName" maxLength={80} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="contactPhone">연락처 (선택)</Label>
          <Input id="contactPhone" name="contactPhone" maxLength={40} />
        </div>
        <Button
          className="min-h-11 self-end sm:col-span-2 sm:w-fit"
          type="submit"
        >
          프로젝트 만들기
        </Button>
      </Form>
      {actionData && "error" in actionData ? (
        <p
          aria-live="assertive"
          className="mt-3 text-sm text-destructive"
          role="alert"
        >
          {actionData.error}
        </p>
      ) : null}
    </details>
  );
  const projectListSection = (
    <section aria-labelledby="projects-heading">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
            Project rooms
          </p>
          <h2 className="mt-1 text-2xl font-bold" id="projects-heading">
            내 프로젝트
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          최근 수정된 순서로 표시됩니다.
        </p>
      </div>
      {loaderData.projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground">
          아직 프로젝트가 없습니다. 새 프로젝트 이름을 입력하면 바로 시작할 수
          있습니다.
        </div>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {loaderData.projects.map((project) => (
            <li key={project.id}>
              <Link
                className="group block overflow-hidden rounded-3xl border bg-card transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                to={
                  projectNextStep(
                    project.id,
                    loaderData.projectMetrics[project.id],
                  ).href
                }
              >
                <div className="flex h-28 items-center justify-center border-b bg-indigo-50 dark:bg-slate-900">
                  <div className="grid size-14 place-items-center rounded-2xl border border-white/70 bg-white/80 text-primary shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/10">
                    <Box className="size-7" />
                  </div>
                </div>
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-lg font-bold">
                        {project.name}
                      </h3>
                      <p className="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">
                        {project.description ||
                          "도면과 산출 자료를 한 작업공간에서 관리합니다."}
                      </p>
                    </div>
                    <ArrowRight className="mt-1 size-5 shrink-0 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" />
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-primary/10 px-3 py-1 font-bold text-primary">
                      {workflowLabels[project.workflow_status] ??
                        project.workflow_status}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
                      <FileBox className="size-3.5" />
                      파일{" "}
                      {loaderData.projectMetrics[project.id]?.fileCount ?? 0}
                    </span>
                    {(loaderData.projectMetrics[project.id]?.ifcCount ?? 0) >
                    0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
                        <Box className="size-3.5" />
                        3D 모델 {loaderData.projectMetrics[project.id].ifcCount}
                      </span>
                    ) : null}
                    {(loaderData.projectMetrics[project.id]?.openReviewCount ??
                      0) > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                        <MessageSquareText className="size-3.5" />
                        확인 필요{" "}
                        {loaderData.projectMetrics[project.id].openReviewCount}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      aria-label={`진행률 ${workflowProgress[project.workflow_status] ?? 0}%`}
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${workflowProgress[project.workflow_status] ?? 0}%`,
                      }}
                    />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                      <LayoutGrid className="size-3.5" />
                      {
                        projectNextStep(
                          project.id,
                          loaderData.projectMetrics[project.id],
                        ).label
                      }
                    </span>
                    <span>
                      수정{" "}
                      {new Intl.DateTimeFormat("ko-KR", {
                        dateStyle: "medium",
                      }).format(new Date(project.updated_at))}
                    </span>
                  </div>
                  <span className="sr-only">
                    생성{" "}
                    {new Intl.DateTimeFormat("ko-KR", {
                      dateStyle: "medium",
                    }).format(new Date(project.created_at))}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  return (
    <main className="mx-auto w-full max-w-[1180px] px-5 py-8 sm:px-8 sm:py-10">
      <header className="overflow-hidden rounded-3xl border border-indigo-400/20 bg-[#2820bd] p-6 text-white shadow-xl shadow-indigo-950/10 sm:p-8">
        <div className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-200">
              1HK Platform
            </p>
            <h1 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
              도면에서 검토와 수량까지,
              <br className="hidden sm:block" /> 한 작업공간에서 이어가세요.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-indigo-100 sm:text-base">
              프로젝트를 열면 원본 도면, 3D 모델, 물량, 검토 기록과 자재 현황을
              같은 기준으로 확인할 수 있습니다.
            </p>
          </div>
          <Button
            asChild
            className="min-h-11 bg-white text-[#2419bd] hover:bg-indigo-50"
          >
            <a href="#new-project">
              <Plus className="size-4" /> 새 프로젝트
            </a>
          </Button>
        </div>
      </header>

      <section
        aria-label="프로젝트 요약"
        className="my-7 grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        {[
          {
            label: "전체 프로젝트",
            value: loaderData.projects.length,
            icon: FolderKanban,
          },
          { label: "진행 중", value: activeProjectCount, icon: Clock3 },
          {
            label: "확인 필요",
            value: pendingReviewCount,
            icon: MessageSquareText,
          },
          { label: "완료", value: deliveredProjectCount, icon: CheckCircle2 },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div
              className="rounded-2xl border bg-card p-4 shadow-sm"
              key={item.label}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  {item.label}
                </span>
                <Icon className="size-4 text-primary" />
              </div>
              <strong className="mt-2 block text-2xl">{item.value}</strong>
            </div>
          );
        })}
      </section>

      <div className="grid gap-8">
        {loaderData.projects.length > 0 ? (
          <>
            {projectListSection}
            <div id="new-project">{newProjectSection}</div>
          </>
        ) : (
          <>
            <div id="new-project">{newProjectSection}</div>
            {projectListSection}
          </>
        )}
      </div>
      {loaderData.isStaff ? (
        <section className="mt-10 rounded-2xl border bg-[#07152d] p-6 text-white shadow-sm">
          <p className="text-sm font-bold text-[#aebdff]">한길시스템 담당자</p>
          <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold">웹 문의함을 확인하세요.</h2>
              <p className="mt-1 text-sm text-slate-300">
                새 상담 요청의 연락처와 처리 상태를 관리합니다.
              </p>
            </div>
            <Button asChild variant="secondary">
              <Link to="/staff/inquiries">문의함 열기</Link>
            </Button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
