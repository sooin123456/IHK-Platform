import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

import {
  drawingContext,
  listDrawingAssignees,
  loadDrawingRoom,
  type DrawingClient,
} from "~/lukas/lib/drawing-collaboration.server";
import { loadDrawingActivityPage } from "~/lukas/lib/drawing-history.server";
import {
  loadAllDrawingRows,
  loadDrawingWorkspaceCapability,
} from "~/lukas/lib/drawing-workspace.server";
import { assertProjectOrganizationFeature } from "~/lukas/lib/organization-administration.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const projectId = params.projectId!;
  const context = await drawingContext(request, projectId);
  const client = context.client as unknown as DrawingClient;
  const [, capability] = await Promise.all([
    assertProjectOrganizationFeature(
      client as any,
      context.project.id,
      "drawing_workspace",
      context.project.organization_id,
    ),
    loadDrawingWorkspaceCapability(
      client as any,
      context.project.id,
      context.user.id,
      context.project.owner_id,
      context.role,
    ),
  ]);
  if (!capability)
    throw new Response("도면 작업 권한이 없습니다.", { status: 403 });
  const url = new URL(request.url);
  const revisionId = url.searchParams.get("revision");
  const fileId = params.fileId ?? url.searchParams.get("file");
  const loadHistory =
    url.searchParams.get("history") != null ||
    url.searchParams.get("historyCursor") != null;
  const [activityPage, collaborationRoom, assignees, checkpoints] =
    await Promise.all([
      revisionId
        ? loadDrawingActivityPage(client as any, projectId, revisionId, {
            cursor: url.searchParams.get("historyCursor"),
          })
        : Promise.resolve(null),
      fileId
        ? loadDrawingRoom(client, projectId, fileId)
        : Promise.resolve(null),
      listDrawingAssignees(client, projectId, context.project.owner_id),
      loadHistory && revisionId
        ? loadAllDrawingRows<{
            id: string;
            created_at: string;
            canonical_json: unknown;
          }>(client as any, {
            table: "lukas_drawing_snapshots",
            projectId,
            revisionId,
            order: [
              { column: "created_at", direction: "desc" },
              { column: "id", direction: "asc" },
            ],
            select: "id,created_at,canonical_json",
          }).then((rows) =>
            rows.map((checkpoint) => ({
              id: checkpoint.id,
              createdAt: checkpoint.created_at,
              canonicalJson: checkpoint.canonical_json,
            })),
          )
        : Promise.resolve([]),
    ]);
  return data(
    { activityPage, collaborationRoom, assignees, checkpoints },
    { headers: context.headers },
  );
}
