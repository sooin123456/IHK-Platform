import { z } from "zod";

import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
import { drawingContext } from "~/lukas/lib/drawing-collaboration.server";
import {
  ProjectExportAuditError,
  recordProjectExport,
  type ProjectExportArtifactType,
} from "~/lukas/lib/project-export-audit.server";

const Uuid = z.string().uuid();
const canonicalDecimal = (pattern: RegExp) =>
  z
    .string()
    .regex(pattern)
    .transform((value) => Number(value))
    .pipe(z.number().int().max(Number.MAX_SAFE_INTEGER));
const RevisionVersion = canonicalDecimal(/^[1-9]\d*$/);
const OperationCheckpoint = canonicalDecimal(/^(?:0|[1-9]\d*)$/);
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const Kind = z.enum(["drawing_pdf", "drawing_png", "drawing_svg"]);
const Filename = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[^\\/:*?"<>|\u0000-\u001f]+$/);
const requiredExportFields = [
  "artifact",
  "artifact_type",
  "filename",
  "request_id",
  "revision_id",
  "revision_version",
  "operation_checkpoint",
  "checkpoint_sha256",
] as const;

function exactlyOneFormValue(
  form: FormData,
  name: (typeof requiredExportFields)[number],
) {
  const values = form.getAll(name);
  if (values.length !== 1)
    throw new Response("내보내기 필드는 정확히 하나여야 합니다.", {
      status: 400,
    });
  return values[0];
}

function contentDisposition(filename: string) {
  const fallback = filename
    .replace(/["\\\r\n]/g, "_")
    .replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function validateDrawingExportScope(
  scopeClient: any,
  input: {
    projectId: string;
    revisionId: string;
    revisionVersion: number;
    workspaceId: string;
  },
) {
  const { data: revision } = await scopeClient
    .from("lukas_drawing_revisions")
    .select("id,document_id,version")
    .eq("id", input.revisionId)
    .eq("project_id", input.projectId)
    .maybeSingle();
  if (!revision)
    throw new Response("내보내기 도면 범위를 찾을 수 없습니다.", {
      status: 404,
    });
  const { data: document } = await scopeClient
    .from("lukas_drawing_documents")
    .select("id")
    .eq("id", input.workspaceId)
    .eq("project_id", input.projectId)
    .maybeSingle();
  if (!document || revision.document_id !== document.id)
    throw new Response("내보내기 도면 계보가 일치하지 않습니다.", {
      status: 404,
    });
  if (revision.version !== input.revisionVersion)
    throw new Response("도면 리비전이 변경되어 다시 내보내야 합니다.", {
      status: 409,
    });
}

export async function handleDrawingExportRequest({
  client,
  headers,
  projectId,
  request,
  workspaceId,
}: {
  client: any;
  headers: Headers;
  projectId: string;
  request: Request;
  workspaceId: string;
}) {
  if (request.method !== "POST")
    throw new Response("Method Not Allowed", { status: 405 });
  const form = await request.formData();
  for (const key of form.keys())
    if (
      !requiredExportFields.includes(
        key as (typeof requiredExportFields)[number],
      )
    )
      throw new Response("허용되지 않은 내보내기 필드입니다.", {
        status: 400,
      });
  let artifact: FormDataEntryValue;
  let artifactType: ProjectExportArtifactType;
  let filename: string;
  let requestId: string;
  let revisionId: string;
  let revisionVersion: number;
  let operationCheckpoint: number;
  let checkpointSha256: string;
  try {
    artifact = exactlyOneFormValue(form, "artifact");
    artifactType = Kind.parse(exactlyOneFormValue(form, "artifact_type"));
    filename = Filename.parse(exactlyOneFormValue(form, "filename"));
    requestId = Uuid.parse(exactlyOneFormValue(form, "request_id"));
    revisionId = Uuid.parse(exactlyOneFormValue(form, "revision_id"));
    revisionVersion = RevisionVersion.parse(
      exactlyOneFormValue(form, "revision_version"),
    );
    operationCheckpoint = OperationCheckpoint.parse(
      exactlyOneFormValue(form, "operation_checkpoint"),
    );
    checkpointSha256 = Sha256.parse(
      exactlyOneFormValue(form, "checkpoint_sha256"),
    );
  } catch (error) {
    if (error instanceof z.ZodError)
      throw new Response("내보내기 필드가 올바르지 않습니다.", { status: 400 });
    throw error;
  }
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
  const bytes = new Uint8Array(await artifact.arrayBuffer());
  try {
    await recordProjectExport(
      client,
      projectId,
      artifactType as ProjectExportArtifactType,
      bytes,
      requestId,
      {
        workspaceId,
        revisionId,
        revisionVersion,
        operationCheckpoint,
        checkpointSha256,
      },
    );
  } catch (error) {
    if (error instanceof ProjectExportAuditError && error.code === "P7R04")
      throw new Response(error.message, { status: 403 });
    if (error instanceof ProjectExportAuditError && error.code === "P7R05")
      throw new Response(error.message, { status: 409 });
    throw error;
  }
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Disposition", contentDisposition(filename));
  headers.set("Content-Type", artifact.type || "application/octet-stream");
  return new Response(bytes, { headers });
}

export async function drawingWorkspaceExportAction({
  request,
  params,
}: {
  request: Request;
  params: { projectId?: string; workspaceId?: string };
}) {
  const { client, headers } = await drawingContext(request, params.projectId!);
  try {
    const projectId = Uuid.parse(params.projectId);
    const workspaceId = Uuid.parse(params.workspaceId);
    return await handleDrawingExportRequest({
      client,
      headers,
      projectId,
      request,
      workspaceId,
    });
  } catch (error) {
    if (error instanceof Response) throw mergeResponseHeaders(error, headers);
    throw error;
  }
}
