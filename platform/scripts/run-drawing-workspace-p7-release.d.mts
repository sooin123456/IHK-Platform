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
  providerEvidence?: { status?: P7ReleaseStatus } | null,
): P7ReleaseStatus;
