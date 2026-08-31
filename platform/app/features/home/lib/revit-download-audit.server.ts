import { createHash } from "node:crypto";

type RevitDownloadAuditClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
};

export async function assertReleaseArtifactSha256(
  url: string,
  expectedSha256: string,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error("릴리스 파일을 확인하지 못했습니다.");
  const actual = createHash("sha256")
    .update(Buffer.from(await response.arrayBuffer()))
    .digest("hex")
    .toUpperCase();
  if (actual !== expectedSha256.trim().toUpperCase())
    throw new Error("공개 파일이 등록된 확인번호와 다릅니다.");
}

export async function recordRevitDownloadAudit(
  client: RevitDownloadAuditClient,
  userId: string | null,
  release: { version: string; sha256: string },
) {
  const { error } = await client.rpc("lukas_qto_record_revit_download", {
    p_user_id: userId,
    p_release_version: release.version,
    p_release_sha256: release.sha256,
  });
  if (error) throw new Error(`다운로드 기록 실패: ${error.message}`);
}
