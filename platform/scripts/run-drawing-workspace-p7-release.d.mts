export type P7ProductionIdentity = { id: string; email: string };
export type P7ProductionAuthority = {
  baseUrl: URL;
  supabaseUrl: URL;
  postgresUrl: URL;
  collaborationUrl: URL;
  telemetryUrl: URL;
  telemetryToken: string;
  anonKey: string;
  serviceRoleKey: string;
  commit: string;
  deploymentId: string;
  region: string;
  runId: string;
  project: string;
  document: string;
  revision: string;
  file: string;
  layer: string;
  identities: P7ProductionIdentity[];
};

export const P7_RELEASE_GATES: ReadonlyArray<{
  id: string;
  argv: string[];
}>;
export function assertExactP7GateManifest(gates: unknown): void;
export function requireP7ProductionAuthorities(
  environment?: Record<string, string | undefined>,
): P7ProductionAuthority;
export function validateP7ProductionReceipt(
  receipt: unknown,
  authority: P7ProductionAuthority,
  invocationId: string,
): any;
export function buildP7ProductionGateEnvironment(
  authority: P7ProductionAuthority,
  environment: Record<string, string | undefined>,
  rawPath: string,
  invocationId: string,
): Record<string, string | undefined>;
export function providerTelemetry(
  authority: P7ProductionAuthority,
): Promise<never>;
export function runP7Gates(
  gates: Array<{ id: string; argv: string[] }>,
  runner?: (gate: { id: string; argv: string[] }) => Promise<number>,
): Promise<Array<{ id: string; status: "PASS" | "NOT_MET"; exitCode: number }>>;
export function p7CombinedReleaseExitCode(
  evidence: { overall: P7ReleaseStatus; externalInputs: number },
  productionResults: Array<{ status: P7ReleaseStatus }>,
): 0 | 1;
export function p7ProductionGateStatus(
  gateId: string,
  exitCode: number,
  providerEvidence?: unknown,
  expectedRestoreIdentity?: {
    expectedSourceCommit?: string;
    expectedRequestId?: string;
  },
): P7ReleaseStatus;
export function classifyDrawingP7RestoreEvidence(
  evidence: unknown,
  expectedRestoreIdentity?: {
    expectedSourceCommit?: string;
    expectedRequestId?: string;
  },
): P7ReleaseStatus;
export function p7LocalGateStatus(
  gateId: string,
  exitCode: number,
  environment: Record<string, string | undefined>,
): P7ReleaseStatus;
export function p7LocalGatePreflight(
  gateId: string,
  environment: Record<string, string | undefined>,
): { status: "UNEXECUTED"; missing: string[] } | null;
export function buildReleaseEvidenceFromResults(
  results: Array<{
    id: string;
    status: P7ReleaseStatus;
    exitCode: number;
    receiptPath?: string;
  }>,
  performance: any,
  restore: any,
  invocationId?: string,
  environment?: Record<string, string | undefined>,
): any;
