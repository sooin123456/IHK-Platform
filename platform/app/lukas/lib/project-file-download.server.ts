import type { DrawingClient } from "./drawing-collaboration.server";

/**
 * Revalidates the immutable project file immediately before minting the short
 * lived original-file capability. Callers must establish project membership
 * with drawingContext before invoking this function.
 */
export async function resolveProjectFileDownload(
  client: DrawingClient,
  input: { projectId: string; fileId: string },
) {
  const { data: file, error } = await client
    .from("lukas_qto_files")
    .select("id, project_id, storage_path, immutable")
    .eq("id", input.fileId)
    .eq("project_id", input.projectId)
    .eq("immutable", true)
    .maybeSingle();
  if (
    error ||
    !file ||
    file.project_id !== input.projectId ||
    file.immutable !== true ||
    typeof file.storage_path !== "string" ||
    file.storage_path.length === 0
  )
    throw new Response("다운로드할 수 있는 원본 파일을 찾을 수 없습니다.", {
      status: 404,
    });
  const { data: signed, error: signedError } = await client.storage
    .from("lukas-qto")
    .createSignedUrl(file.storage_path, 60);
  if (signedError || !signed?.signedUrl)
    throw new Response("다운로드 링크를 만들지 못했습니다.", { status: 500 });
  return signed.signedUrl;
}
