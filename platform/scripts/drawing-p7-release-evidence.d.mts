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
    completionAuthority?: {
      envelope: unknown;
      trust: {
        publicKey: string;
        issuer: string;
        keyId: string;
        nonce: string;
      };
    } | null;
  },
): unknown;
export function validateP7ExternalCompletionReceipt(
  envelope: unknown,
  evidence: unknown,
  trust: {
    publicKey: string;
    issuer: string;
    keyId: string;
    nonce: string;
  },
): unknown;
export function loadP7CompletionAuthority(
  environment?: Record<string, string | undefined>,
): {
  envelope: unknown;
  trust: {
    publicKey: string;
    issuer: string;
    keyId: string;
    nonce: string;
  };
};
export function assertDrawingP7ProgramComplete(
  evidence: unknown,
  options?: Record<string, unknown>,
): unknown;
export function writeDrawingP7ReleaseEvidence(evidence: unknown): string;
