export function resolveDrawingPdfRasterSource({
  bundledPdf,
  fallbackSignedUrl,
  workspaceFile,
}: {
  bundledPdf: {
    id: string;
    kind: "pdf";
    sha256: string;
    signedUrl: string;
  } | null;
  fallbackSignedUrl: string | null;
  workspaceFile: { id: string; kind: "pdf" | "ifc"; sha256: string };
}) {
  if (bundledPdf) return bundledPdf;
  if (workspaceFile.kind !== "pdf" || !fallbackSignedUrl) return null;
  return {
    id: workspaceFile.id,
    kind: "pdf" as const,
    sha256: workspaceFile.sha256,
    signedUrl: fallbackSignedUrl,
  };
}
