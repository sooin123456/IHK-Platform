export type P7ReleaseStatus = "PASS" | "NOT_MET" | "UNEXECUTED";
export const P7_RELEASE_EVIDENCE_PATH: string;
export const P7_REQUIREMENTS: ReadonlyArray<{
  id: string;
  scope: "local" | "production";
}>;
export function drawingP7ReleaseCommit(): string;
export function drawingP7ReleaseTreeSha256(): string;
export function drawingP7ReceiptPath(path: string): string;
export function validateDrawingP7ReleaseEvidence(
  evidence: unknown,
  options?: {
    expectedCommit?: string;
    expectedTreeSha256?: string | null;
    verifyReceipts?: boolean;
  },
): unknown;
export function assertDrawingP7ProgramComplete(
  evidence: unknown,
  options?: Record<string, unknown>,
): unknown;
export function writeDrawingP7ReleaseEvidence(evidence: unknown): string;
