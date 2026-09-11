type PendingLocalPdf = { token: string; file: File };

// ponytail: One pending slot is the per-tab local-preview ceiling.
let pending: PendingLocalPdf | null = null;

export async function localPdfFingerprint(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function isSameLocalPdf(file: File, fingerprint: string | null): Promise<boolean> {
  return Boolean(fingerprint && /^[a-f0-9]{64}$/.test(fingerprint) && await localPdfFingerprint(file) === fingerprint);
}

export function localPdfSelectionError(file: { name: string; size: number }) {
  if (!/\.pdf$/i.test(file.name))
    return "화면 미리보기에서는 PDF 파일을 열어 주세요.";
  if (file.size <= 0)
    return "내용이 없는 파일입니다. 다른 PDF를 선택해 주세요.";
  if (file.size > 50 * 1024 * 1024)
    return "화면 미리보기는 50MB 이하의 PDF를 지원합니다.";
  return null;
}

export function stageLocalPdf(file: File): string {
  const error = localPdfSelectionError(file);
  if (error) throw new Error(error);

  const token = crypto.randomUUID();
  pending = { token, file };
  return token;
}

export function peekLocalPdf(token: string | null | undefined): File | null {
  return token && pending?.token === token ? pending.file : null;
}

export function releaseLocalPdf(token: string | null | undefined): void {
  if (pending?.token === token) pending = null;
}
