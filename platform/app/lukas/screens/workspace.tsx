import type { Route } from "./+types/workspace";

import type { Database } from "database.types";
import { data, redirect } from "react-router";
import { z } from "zod";

import makeServerClient from "~/core/lib/supa-client.server";
import { WorkspaceDashboard } from "~/lukas/components/workspace-dashboard";
import {
  listDrawingIssueMetrics,
  type DrawingClient,
} from "~/lukas/lib/drawing-collaboration.server";
import { drawingWorkspaceCapabilityForRole } from "~/lukas/lib/drawing-workspace.server";

const newProjectSchema = z.object({
  name: z.string().trim().min(1, "프로젝트명을 입력하세요.").max(160),
  description: z.string().trim().max(2000).optional(),
  contactName: z.string().trim().max(80).optional(),
  contactPhone: z.string().trim().max(40).optional(),
});

export const meta: Route.MetaFunction = () => [
  { title: "도면 작업공간 | 1HK Platform" },
  {
    name: "description",
    content:
      "도면, IFC 3D, 수량과 검토 참여자를 연결하는 1HK 프로젝트 작업공간입니다.",
  },
];

export async function loader({ request }: Route.LoaderArgs) {
  const [client] = makeServerClient(request);
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user || user.is_anonymous) throw redirect("/login");

  const [
    { data: projects, error },
    { data: organizationMemberships, error: organizationMembershipError },
  ] = await Promise.all([
    client
      .from("lukas_qto_projects")
      .select(
        "id, name, owner_id, description, workflow_status, created_at, updated_at",
      )
      .is("archived_at", null)
      .order("updated_at", { ascending: false }),
    client
      .from("lukas_qto_organization_members")
      .select("organization_id,role")
      .order("created_at")
      .limit(100),
  ]);

  if (error || organizationMembershipError) {
    throw new Response("프로젝트 목록을 불러오지 못했습니다.", {
      status: 500,
    });
  }
  const organizationIds = (organizationMemberships ?? []).map(
    (membership) => membership.organization_id,
  );
  const { data: organizations, error: organizationsError } =
    organizationIds.length === 0
      ? { data: [], error: null }
      : await client
          .from("lukas_qto_organizations")
          .select("id,name,owner_id")
          .in("id", organizationIds)
          .order("name")
          .limit(100);
  if (organizationsError)
    throw new Response("회사 작업공간을 불러오지 못했습니다.", { status: 500 });
  const organizationRoles = new Map(
    (organizationMemberships ?? []).map((membership) => [
      membership.organization_id,
      membership.role,
    ]),
  );
  const isStaff = user.app_metadata.role === "hangil_staff";
  const visibleOrganizations = (organizations ?? []).map((organization) => ({
    id: organization.id,
    name: organization.name,
    can_manage:
      isStaff ||
      organization.owner_id === user.id ||
      ["owner", "admin"].includes(organizationRoles.get(organization.id) ?? ""),
  }));

  const projectIds = (projects ?? []).map((project) => project.id);
  const [filesResult, documentsResult, reviewsResult, membersResult] =
    projectIds.length === 0
      ? [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ]
      : await Promise.all([
          client
            .from("lukas_qto_files")
            .select("id, project_id, kind, original_filename, created_at")
            .in("project_id", projectIds)
            .order("created_at", { ascending: false }),
          (client as any)
            .from("lukas_drawing_documents")
            .select("id,project_id,updated_at")
            .in("project_id", projectIds)
            .order("updated_at", { ascending: false })
            .order("id", { ascending: false }),
          client
            .from("lukas_qto_reviews")
            .select("id, project_id, status, note, created_at")
            .in("project_id", projectIds)
            .order("created_at", { ascending: false }),
          client
            .from("lukas_qto_project_members")
            .select("project_id, user_id, role")
            .in("project_id", projectIds),
        ]);

  if (
    filesResult.error ||
    documentsResult.error ||
    reviewsResult.error ||
    membersResult.error
  ) {
    throw new Response("프로젝트 작업 현황을 불러오지 못했습니다.", {
      status: 500,
    });
  }

  const files = filesResult.data ?? [];
  const documents = documentsResult.data ?? [];
  const reviews = reviewsResult.data ?? [];
  const members = membersResult.data ?? [];
  const drawingMetrics = await listDrawingIssueMetrics(
    client as unknown as DrawingClient,
    projectIds,
    user.id,
  );
  const projectMetrics = Object.fromEntries(
    projectIds.map((projectId) => {
      const project = (projects ?? []).find(
        (candidate) => candidate.id === projectId,
      );
      const projectFiles = files.filter(
        (file) => file.project_id === projectId,
      );
      const latestIfc = projectFiles.find((file) => file.kind === "ifc");
      const latestDrawing = documents.find(
        (document: { id: string; project_id: string }) =>
          document.project_id === projectId,
      );
      const membershipRole = members.find(
        (member) =>
          member.project_id === projectId && member.user_id === user.id,
      )?.role;
      const capability = drawingWorkspaceCapabilityForRole(
        isStaff
          ? "staff"
          : project?.owner_id === user.id
            ? "owner"
            : membershipRole,
      );
      return [
        projectId,
        {
          canCreateWorkspace: capability === "admin" || capability === "editor",
          fileCount: projectFiles.length,
          ifcCount: projectFiles.filter((file) => file.kind === "ifc").length,
          openReviewCount: reviews.filter(
            (review) =>
              review.project_id === projectId && review.status !== "resolved",
          ).length,
          memberCount: members.filter(
            (member) => member.project_id === projectId,
          ).length,
          latestIfcId: latestIfc?.id ?? null,
          latestDrawingId: latestDrawing?.id ?? null,
          unresolvedDrawingCount:
            drawingMetrics[projectId]?.unresolvedCount ?? 0,
          assignedToMeCount: drawingMetrics[projectId]?.assignedToMeCount ?? 0,
          latestFilename: projectFiles[0]?.original_filename ?? null,
        },
      ];
    }),
  );

  const projectNames = new Map(
    (projects ?? []).map((project) => [project.id, project.name]),
  );
  const activities = [
    ...files.slice(0, 8).map((file) => ({
      id: `file-${file.id}`,
      projectId: file.project_id,
      projectName: projectNames.get(file.project_id) ?? "프로젝트",
      kind: "file" as const,
      title: file.original_filename,
      detail:
        file.kind === "ifc"
          ? "IFC 3D 모델이 추가되었습니다."
          : "새 파일이 추가되었습니다.",
      createdAt: file.created_at,
    })),
    ...reviews.slice(0, 8).map((review) => ({
      id: `review-${review.id}`,
      projectId: review.project_id,
      projectName: projectNames.get(review.project_id) ?? "프로젝트",
      kind: "review" as const,
      title:
        review.status === "resolved"
          ? "검토가 완료되었습니다."
          : "새 검토가 등록되었습니다.",
      detail: review.note || "검토 내용을 확인하세요.",
      createdAt: review.created_at,
    })),
  ]
    .sort(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
    )
    .slice(0, 8);

  return {
    projects: projects ?? [],
    projectMetrics,
    activities,
    email: user.email ?? "",
    isStaff,
    organizations: visibleOrganizations,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const parsed = newProjectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return data(
      {
        error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요.",
      },
      { status: 400 },
    );
  }

  const [client, headers] = makeServerClient(request);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || user.is_anonymous) {
    return data(
      { error: "이메일 로그인이 필요합니다." },
      { status: 401, headers },
    );
  }

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

  return redirect(`/projects/${project.id}/workspace`, { headers });
}

export default function Workspace({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return (
    <WorkspaceDashboard
      actionError={
        actionData && "error" in actionData ? actionData.error : undefined
      }
      activities={loaderData.activities}
      email={loaderData.email}
      isStaff={loaderData.isStaff}
      organizations={loaderData.organizations}
      projectMetrics={loaderData.projectMetrics}
      projects={loaderData.projects}
    />
  );
}
