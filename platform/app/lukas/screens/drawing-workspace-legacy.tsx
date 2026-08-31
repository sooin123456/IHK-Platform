import type { Route } from "./+types/drawing-workspace-legacy";

import { redirect } from "react-router";
import { z } from "zod";

import { drawingContext } from "~/lukas/lib/drawing-collaboration.server";
import { drawingRoomPath } from "~/lukas/lib/drawing-entry";
import {
  drawingWorkspaceNewPath,
  drawingWorkspacePath,
} from "~/lukas/lib/drawing-workspace-paths";

const Uuid = z.string().uuid();

export async function resolveLegacyDrawingWorkspace(
  client: any,
  projectId: string,
  fileId?: string,
) {
  const parsedProjectId = Uuid.parse(projectId);
  const parsedFileId = fileId ? Uuid.parse(fileId) : undefined;
  let fileKind: "pdf" | "ifc" | undefined;
  if (parsedFileId) {
    const { data: file, error: fileError } = await client
      .from("lukas_qto_files")
      .select("id,project_id,kind,immutable")
      .eq("id", parsedFileId)
      .eq("project_id", parsedProjectId)
      .in("kind", ["pdf", "ifc"])
      .eq("immutable", true)
      .maybeSingle();
    if (fileError || !file)
      throw new Response("도면 원본을 찾을 수 없습니다.", { status: 404 });
    fileKind = file.kind;
  }
  let documents = client
    .from("lukas_drawing_documents")
    .select("id")
    .eq("project_id", parsedProjectId);
  if (parsedFileId) documents = documents.eq("source_file_id", parsedFileId);
  const { data: document, error: documentError } = await documents
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (documentError)
    throw new Response("도면 작업실을 찾지 못했습니다.", { status: 500 });
  if (document) return drawingWorkspacePath(parsedProjectId, document.id);
  if (parsedFileId && fileKind === "ifc")
    return drawingRoomPath(parsedProjectId, parsedFileId);
  return drawingWorkspaceNewPath(parsedProjectId, parsedFileId);
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { client, headers, project } = await drawingContext(
    request,
    params.projectId!,
  );
  const location = await resolveLegacyDrawingWorkspace(
    client,
    project.id,
    params.fileId,
  );
  return redirect(location, { headers });
}

export default function DrawingWorkspaceLegacy() {
  return null;
}
