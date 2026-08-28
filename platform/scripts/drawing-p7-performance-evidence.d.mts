export const P7_PERFORMANCE_EVIDENCE_PATH: string;
export const P7_PERFORMANCE_PLAYWRIGHT_CAPTURE_PATH: string;
export const P7_DETERMINISTIC_HASHES: {
  fixture: string;
  renderOrder: string;
  projection: string;
};
export function drawingP7CaptureSha256(evidence: unknown): string;
export function drawingP7PlaywrightCaptureSha256(capture: unknown): string;
export function drawingP7DirectorySha256(path: string): string;
export function drawingP7FileSha256(path: string): string;
export function drawingP7SourceCommitSha(): string;
export function drawingP7SourceTreeSha256(): string;
export function validateDrawingP7PerformanceEvidence(
  evidence: unknown,
  expectedSourceCommitSha?: string,
): never;
export function inspectDrawingP7PerformanceEvidence(
  evidence: unknown,
  expectedSourceCommitSha?: string,
): { status: "MET" | "NOT MET" };
export function drawingP7EvidenceFromPlaywrightCapture(
  capture: unknown,
): unknown;
export function removeDrawingP7FailedRunArtifacts(
  status: number,
  paths?: string[],
): void;
export function finalizeDrawingP7PerformanceEvidence(
  provenance: unknown,
  options?: { capturePath?: string; targetPath?: string },
): { status: "MET" | "NOT MET" };
