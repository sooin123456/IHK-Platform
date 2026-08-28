export const P7_PERFORMANCE_EVIDENCE_PATH: string;
export const P7_DETERMINISTIC_HASHES: {
  fixture: string;
  renderOrder: string;
  projection: string;
};
export function drawingP7SourceCommitSha(): string;
export function validateDrawingP7PerformanceEvidence(
  evidence: unknown,
  expectedSourceCommitSha?: string,
): unknown;
export function writeDrawingP7PerformanceEvidence(evidence: unknown): string;
