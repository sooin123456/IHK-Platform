export type IfcRenderReadyDerivativeDescriptor = {
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

export type IfcRenderDerivativeDescriptor =
  | {
      status: "not_applicable";
      version: null;
      sourceSha256: null;
      manifestSha256: null;
      geometrySha256: null;
      manifestSignedUrl: null;
      geometrySignedUrl: null;
    }
  | {
      status: "pending" | "failed";
      version: number | null;
      sourceSha256: string;
      manifestSha256: null;
      geometrySha256: null;
      manifestSignedUrl: null;
      geometrySignedUrl: null;
    }
  | IfcRenderReadyDerivativeDescriptor;

export type IfcRenderBundleDescriptor = {
  source: { fileId: string; sha256: string };
  derivative: IfcRenderReadyDerivativeDescriptor;
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
  const derivative = source?.derivative;
  if (
    !source ||
    derivative?.status !== "ready" ||
    !Number.isSafeInteger(derivative.manifestByteSize) ||
    derivative.manifestByteSize <= 0 ||
    !Number.isSafeInteger(derivative.geometryByteSize) ||
    derivative.geometryByteSize <= 0
  )
    return undefined;
  return {
    source: { fileId: source.id, sha256: source.sha256 },
    derivative,
  };
}
