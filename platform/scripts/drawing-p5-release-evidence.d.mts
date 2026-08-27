export const P5_RELEASE_EVIDENCE_PATH: string;
export const P5_SOURCE_FIXTURES: ReadonlyArray<{
  kind: "pdf" | "ifc";
  file?: string;
  url?: string;
  byteSize: number;
  sha256: string;
}>;
export function drawingP5SourceCommitSha(): string;
export function validateDrawingP5ReleaseEvidence(
  evidence: unknown,
  expectedSourceCommitSha?: string,
): unknown;
export function writeDrawingP5ReleaseEvidence(evidence: unknown): string;
