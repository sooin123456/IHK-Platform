import type { Route } from "./+types/drawing-workspace-export";

import { z } from "zod";

import { drawingContext } from "~/lukas/lib/drawing-collaboration.server";
import {
  recordProjectExport,
  type ProjectExportArtifactType,
} from "~/lukas/lib/project-export-audit.server";

const Uuid = z.string().uuid();
const Kind = z.enum(["drawing_pdf", "drawing_png", "drawing_svg"]);
const Filename = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[^\\/:*?"<>|\u0000-\u001f]+$/);

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST")
    throw new Response("Method Not Allowed", { status: 405 });
  const projectId = Uuid.parse(params.projectId);
  const fileId = Uuid.parse(params.fileId);
  const { client, headers } = await drawingContext(request, projectId);
  const form = await request.formData();
  for (const key of form.keys())
    if (
      ![
        "artifact",
        "artifact_type",
        "filename",
        "request_id",
        "revision_id",
      ].includes(key)
    )
      throw new Response("허용되지 않은 내보내기 필드입니다.", { status: 400 });
  const artifact = form.get("artifact");
  const artifactType = Kind.parse(form.get("artifact_type"));
  const filename = Filename.parse(form.get("filename"));
  const requestId = Uuid.parse(form.get("request_id"));
  const revisionId = Uuid.parse(form.get("revision_id"));
  if (
    !(artifact instanceof File) ||
    artifact.size === 0 ||
    artifact.size > 100_000_000
  )
    throw new Response("내보내기 파일 크기가 올바르지 않습니다.", {
      status: 400,
    });
  const expectedContentType = {
    drawing_pdf: "application/pdf",
    drawing_png: "image/png",
    drawing_svg: "image/svg+xml",
  }[artifactType];
  if (artifact.type.split(";", 1)[0] !== expectedContentType)
    throw new Response("내보내기 파일 형식이 일치하지 않습니다.", {
      status: 400,
    });
  const scopeClient = client as any;
  const [{ data: file }, { data: revision }] = await Promise.all([
    scopeClient
      .from("lukas_qto_files")
      .select("id")
      .eq("id", fileId)
      .eq("project_id", projectId)
      .maybeSingle(),
    scopeClient
      .from("lukas_drawing_revisions")
      .select("id,document_id")
      .eq("id", revisionId)
      .eq("project_id", projectId)
      .maybeSingle(),
  ]);
  if (!file || !revision)
    throw new Response("내보내기 도면 범위를 찾을 수 없습니다.", {
      status: 404,
    });
  const { data: document } = await scopeClient
    .from("lukas_drawing_documents")
    .select("id,source_file_id")
    .eq("id", revision.document_id)
    .eq("project_id", projectId)
    .maybeSingle();
  if (
    !document ||
    (document.source_file_id && document.source_file_id !== fileId)
  )
    throw new Response("내보내기 도면 계보가 일치하지 않습니다.", {
      status: 404,
    });
  const bytes = new Uint8Array(await artifact.arrayBuffer());
  await recordProjectExport(
    client as any,
    projectId,
    artifactType as ProjectExportArtifactType,
    bytes,
    requestId,
  );
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  headers.set("Content-Type", artifact.type || "application/octet-stream");
  return new Response(bytes, { headers });
}
