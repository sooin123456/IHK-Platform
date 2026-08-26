export const P4_PERFORMANCE_EVIDENCE_PATH: string;
export function drawingP4SourceCommitSha(): string;
export function validateDrawingP4PerformanceEvidence(
  evidence: unknown,
  expectedSourceCommitSha?: string,
): unknown;
export function writeDrawingP4PerformanceEvidence(
  evidence: unknown,
): string;
