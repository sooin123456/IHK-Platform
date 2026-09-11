export interface PublicReleaseConfig {
  ready: boolean;
  url?: string;
  sha256?: string;
  version: string;
}

export function readPublicReleaseConfig(input: {
  url?: string;
  sha256?: string;
  version?: string;
  allowLoopback?: boolean;
}): PublicReleaseConfig {
  const version = input.version?.trim() || "현장 베타";
  const sha256 = input.sha256?.trim().toUpperCase();
  let url: string | undefined;

  try {
    const parsed = new URL(input.url?.trim() || "");
    const isLoopback =
      input.allowLoopback === true &&
      parsed.protocol === "http:" &&
      ["127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
    if (parsed.protocol === "https:" || isLoopback) url = parsed.toString();
  } catch {
    url = undefined;
  }

  const validSha = Boolean(sha256 && /^[A-F0-9]{64}$/.test(sha256));
  if (!url || !validSha) return { ready: false, version };
  return { ready: true, url, sha256, version };
}
