export type ReleaseGate = {
  label: string;
  argv: string[];
  environment?: Record<string, string>;
};
export type P6ProductionAuthority = {
  phase: "local" | "production";
  baseUrl: URL;
  supabaseUrl: URL;
  postgresUrl: string;
  freshPostgresUrl: string;
  upgradePostgresUrl: string;
  restorePostgresUrl: string;
  managementApiUrl: URL;
  managementAccessToken: string;
  projectRef: string;
  storageCorsOrigin: string;
  deploymentId: string;
  commit: string;
  backupId: string;
  restoreOperationId: string;
  restoreResultSha256: string;
  restoreManifestSha256: string;
  region: string;
  makerEmail: string;
  approverEmail: string;
  attackerEmail: string;
  viewerEmail: string;
  projectId: string;
  drawingRevisionId: string;
  boqVersionId: string;
  materialPlanId: string;
};
export declare const P6_LOCAL_RELEASE_GATES: ReleaseGate[];
export declare function p6LocalReleaseManifest(): ReleaseGate[];
export declare function assertExactP6LocalGateManifest(
  gates: ReleaseGate[],
): void;
export declare function requireP6ProductionAuthorities(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
): P6ProductionAuthority & { phase: "production" };
export declare function requireP6LocalAuthorities(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
): P6ProductionAuthority & { phase: "local" };
export declare function runP6ReleaseGates(
  gates: ReleaseGate[],
  options: {
    phase: "LOCAL" | "PRODUCTION";
    runner?: (gate: ReleaseGate) => Promise<number>;
    log?: (message: string) => void;
  },
): Promise<void>;
