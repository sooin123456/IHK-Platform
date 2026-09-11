import type { Route } from "./+types/project-drawings";

import { data } from "react-router";

import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
import { ProjectDrawingsBrowser } from "~/lukas/components/project-drawings-browser";
import {
  drawingContext,
  listDrawingFiles,
} from "~/lukas/lib/drawing-collaboration.server";
import { loadDrawingWorkspaceCapability } from "~/lukas/lib/drawing-workspace.server";

export const meta: Route.MetaFunction = ({ data }) => [
  {
    title: data?.project
      ? `${data.project.name} 도면 | 1HK Platform`
      : "도면 파일함 | 1HK Platform",
  },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const { client, headers, project, role, user } = await drawingContext(
    request,
    params.projectId!,
  );
  try {
    const [files, { data: documents, error: documentsError }, capability] =
      await Promise.all([
        listDrawingFiles(client, project.id),
        (client as any)
          .from("lukas_drawing_documents")
          .select("id,project_id,title,source_file_id,updated_at")
          .eq("project_id", project.id)
          .order("updated_at", { ascending: false })
          .order("id", { ascending: false }),
        loadDrawingWorkspaceCapability(
          client as any,
          project.id,
          user.id,
          project.owner_id,
          role,
        ),
      ]);
    if (documentsError)
      throw new Response("도면 작업실을 불러오지 못했습니다.", { status: 500 });
    return data(
      {
        project,
        files,
        documents: documents ?? [],
        canCreateWorkspace: capability === "admin" || capability === "editor",
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof Response) throw mergeResponseHeaders(error, headers);
    throw error;
  }
}

export default function ProjectDrawings({ loaderData }: Route.ComponentProps) {
  return <ProjectDrawingsBrowser {...loaderData} />;
}
