type RevitDownloadAuditClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
};

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
