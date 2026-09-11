import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

export type ProjectExportArtifactType =
  | "drawing_pdf"
  | "drawing_png"
  | "drawing_svg"
  | "boq_csv"
  | "boq_xlsx"
  | "boq_manifest"
  | "boq_template_csv"
  | "material_csv"
  | "suggestion_feedback_json"
  | "ids_bcfzip";

export type DrawingExportLineage = {
  workspaceId: string;
  revisionId: string;
  revisionVersion: number;
  operationCheckpoint: number;
  checkpointSha256: string;
};

export class ProjectExportAuditError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

function artifactBytes(value: string | ArrayBuffer | Uint8Array) {
  return typeof value === "string"
    ? new TextEncoder().encode(value)
    : value instanceof Uint8Array
      ? value
      : new Uint8Array(value);
}

export async function recordProjectExport(
  client: SupabaseClient<any>,
  projectId: string,
  artifactType: ProjectExportArtifactType,
  artifact: string | ArrayBuffer | Uint8Array,
  requestId: string = randomUUID(),
  drawingLineage?: DrawingExportLineage,
) {
  const bytes = artifactBytes(artifact);
  if (bytes.byteLength === 0)
    throw new Error("빈 내보내기는 기록할 수 없습니다.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const legacyArguments = {
    p_project_id: projectId,
    p_artifact_type: artifactType,
    p_artifact_sha256: sha256,
    p_artifact_byte_size: bytes.byteLength,
    p_request_id: requestId,
  };
  const drawing = artifactType.startsWith("drawing_");
  if (drawing && !drawingLineage)
    throw new Error("도면 내보내기 계보가 필요합니다.");
  if (!drawing && drawingLineage)
    throw new Error("도면이 아닌 내보내기에는 도면 계보를 기록할 수 없습니다.");
  let { data, error } = drawingLineage
    ? await client.rpc("lukas_qto_record_drawing_export", {
        ...legacyArguments,
        p_workspace_id: drawingLineage.workspaceId,
        p_revision_id: drawingLineage.revisionId,
        p_revision_version: drawingLineage.revisionVersion,
        p_operation_checkpoint: drawingLineage.operationCheckpoint,
        p_checkpoint_sha256: drawingLineage.checkpointSha256,
      })
    : await client.rpc("lukas_qto_record_project_export", legacyArguments);
  if (drawingLineage && error?.code === "PGRST202")
    ({ data, error } = await client.rpc(
      "lukas_qto_record_project_export",
      legacyArguments,
    ));
  if (error)
    throw new ProjectExportAuditError(
      `내보내기 감사 기록 실패: ${error.message}`,
      error.code,
    );
  return { bytes, evidence: data, sha256 };
}
