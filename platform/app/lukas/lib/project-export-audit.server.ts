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
) {
  const bytes = artifactBytes(artifact);
  if (bytes.byteLength === 0)
    throw new Error("빈 내보내기는 기록할 수 없습니다.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { data, error } = await client.rpc("lukas_qto_record_project_export", {
    p_project_id: projectId,
    p_artifact_type: artifactType,
    p_artifact_sha256: sha256,
    p_artifact_byte_size: bytes.byteLength,
    p_request_id: requestId,
  });
  if (error) throw new Error(`내보내기 감사 기록 실패: ${error.message}`);
  return { bytes, evidence: data, sha256 };
}
