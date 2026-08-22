import type { Route } from "./+types/workspace-preview";

import { WorkspaceDashboard } from "~/lukas/components/workspace-dashboard";

const now = "2026-08-23T09:00:00.000Z";
const projects = [
  {
    id: "preview-community-center",
    name: "근린생활시설 도면 협업",
    description: "IFC 3D와 건축 도면을 함께 검토하는 예시 프로젝트",
    workflow_status: "expert_review",
    created_at: now,
    updated_at: now,
  },
  {
    id: "preview-kindergarten",
    name: "유치원 물량 검토",
    description: "설계 변경 전후 물량과 검토 의견을 비교하는 예시",
    workflow_status: "quantity_takeoff",
    created_at: now,
    updated_at: now,
  },
];

const projectMetrics = {
  "preview-community-center": {
    fileCount: 6,
    ifcCount: 2,
    openReviewCount: 3,
    memberCount: 5,
    latestIfcId: "preview-ifc",
    latestDrawingId: "preview-drawing",
    unresolvedDrawingCount: 3,
    assignedToMeCount: 1,
    latestFilename: "근린생활시설_260504.ifc",
  },
  "preview-kindergarten": {
    fileCount: 9,
    ifcCount: 1,
    openReviewCount: 2,
    memberCount: 4,
    latestIfcId: "preview-kindergarten-ifc",
    latestDrawingId: "preview-kindergarten-drawing",
    unresolvedDrawingCount: 2,
    assignedToMeCount: 2,
    latestFilename: "유치원_구조도_R2.pdf",
  },
};

const activities = [
  {
    id: "preview-activity-file",
    projectId: "preview-community-center",
    projectName: "근린생활시설 도면 협업",
    kind: "file" as const,
    title: "근린생활시설_260504.ifc",
    detail: "IFC 3D 모델이 추가되었습니다.",
    createdAt: now,
  },
  {
    id: "preview-activity-review",
    projectId: "preview-kindergarten",
    projectName: "유치원 물량 검토",
    kind: "review" as const,
    title: "새 검토가 등록되었습니다.",
    detail: "구조 평면도 개정 내용을 확인하세요.",
    createdAt: now,
  },
];

export const meta: Route.MetaFunction = () => [
  { title: "로컬 미리보기 | 1HK Platform" },
];

export default function WorkspacePreview() {
  return (
    <WorkspaceDashboard
      activities={activities}
      email="local-preview@1hk.local"
      isStaff={false}
      previewMode
      projectMetrics={projectMetrics}
      projects={projects}
    />
  );
}
