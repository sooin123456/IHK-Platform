export const P7_PERFORMANCE_EVIDENCE_PATH: string;
export const P7_DETERMINISTIC_HASHES: {
  fixture: string;
  renderOrder: string;
  projection: string;
};
export function drawingP7CaptureSha256(evidence: unknown): string;
export function drawingP7DirectorySha256(path: string): string;
export function drawingP7FileSha256(path: string): string;
export function drawingP7SourceCommitSha(): string;
export function drawingP7SourceTreeSha256(): string;
export function validateDrawingP7PerformanceEvidence(
  evidence: unknown,
  expectedSourceCommitSha?: string,
): unknown;
export function writeDrawingP7PerformanceEvidence(
  evidence: unknown,
  targetPath?: string,
): string;
