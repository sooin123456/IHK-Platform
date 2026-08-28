export type IfcRenderDerivativeDescriptor = {
  status: "ready";
  version: number;
  sourceSha256: string;
  manifestSha256: string;
  geometrySha256: string;
  manifestByteSize: number;
  geometryByteSize: number;
  manifestSignedUrl: string;
  geometrySignedUrl: string;
};

export type IfcRenderBundleDescriptor = {
  source: { fileId: string; sha256: string };
  derivative: IfcRenderDerivativeDescriptor;
};

export function adaptIfcRenderBundleDescriptor(
  source:
    | {
        id: string;
        sha256: string;
        derivative?: IfcRenderDerivativeDescriptor;
      }
    | null
    | undefined,
): IfcRenderBundleDescriptor | undefined {
  if (!source || source.derivative?.status !== "ready") return undefined;
  return {
    source: { fileId: source.id, sha256: source.sha256 },
    derivative: source.derivative,
  };
}
