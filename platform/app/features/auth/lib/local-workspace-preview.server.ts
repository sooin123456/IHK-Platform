function isLoopback(hostname: string) {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

export function localWorkspacePreviewTarget(
  requestUrl: string,
  nodeEnvironment = process.env.NODE_ENV,
) {
  if (nodeEnvironment !== "development") return null;
  return isLoopback(new URL(requestUrl).hostname) ? "/workspace-preview" : null;
}
