export type DrawingP6GateStatus = "PASS" | "NOT MET" | "UNEXECUTED";
export type DrawingP6PerformanceEvidence = {
  schemaVersion: 1;
  authority:
    | "LOCAL_REAL_POSTGRES_PRODUCTION_BUILD_CHROMIUM"
    | "HOSTED_SUPABASE_DEPLOYED_CHROMIUM";
  commit: string;
  generatedAt: string;
  runtime: Record<
    | "node"
    | "browser"
    | "postgres"
    | "machine"
    | "region"
    | "resourceAuthority"
    | "resourceEvidenceSha256",
    string
  >;
  workload: {
    drawingQuantityLinks: 10000;
    allocationLinks: 10000;
    boqLines: 2000;
    legacyMappings: 200;
    approvedSnapshots: 1;
    priceBooks: 1;
    materialComponents: 2000;
  };
  operations: Record<
    string,
    {
      coldMs: number;
      warmMs: number;
      cpuMs: number;
      peakRssMiB: number;
      rows: number;
      bytes: number;
      plan: string;
    }
  >;
  metrics: {
    calculationManifestP95Ms: number;
    comparisonP95Ms: number;
    lineageP95Ms: number;
    peakRssMiB: number;
    repeatedRuns: 100;
  };
  repeatedHashes: Record<string, string[]>;
  sourceHashes: { before: string[]; after: string[] };
  status: Exclude<DrawingP6GateStatus, "UNEXECUTED">;
};
export declare const P6_PERFORMANCE_EVIDENCE_PATH: string;
export declare const P6_PRODUCTION_PERFORMANCE_EVIDENCE_PATH: string;
export declare const P6_PURE_PERFORMANCE_EVIDENCE_PATH: string;
export declare function buildDrawingP6LocalWorkload(): unknown;
export declare function measureDrawingP6LocalPureWorkload(
  repeatedRuns?: number,
): {
  workload: {
    drawingQuantityLinks: 10000;
    allocationLinks: 10000;
    boqLines: 2000;
    legacyMappings: 200;
    approvedSnapshots: 1;
    priceBooks: 1;
    materialComponents: 2000;
  };
  calculationManifestP95Ms: number;
  comparisonP95Ms: number;
  diagnosticNodeRssMiB: number;
  repeatedRuns: 100;
  resultHashes: string[];
  comparisonHashes: string[];
  result: unknown;
};
export declare function assertDrawingP6LocalPureWorkloadPass(
  measurement: ReturnType<typeof measureDrawingP6LocalPureWorkload>,
): ReturnType<typeof measureDrawingP6LocalPureWorkload>;
export declare function writeDrawingP6LocalPureWorkloadEvidence(
  measurement: ReturnType<typeof measureDrawingP6LocalPureWorkload>,
): string;
export declare function drawingP6SourceCommitSha(): string;
export declare function deriveDrawingP6GateStatus(
  evidence: DrawingP6PerformanceEvidence,
): "PASS" | "NOT MET";
export declare function validateDrawingP6PerformanceEvidence(
  evidence: DrawingP6PerformanceEvidence,
  expectedCommit?: string,
): DrawingP6PerformanceEvidence;
export declare function assertDrawingP6PerformancePass(
  evidence: DrawingP6PerformanceEvidence,
  expectedCommit?: string,
): DrawingP6PerformanceEvidence;
export declare function writeDrawingP6PerformanceEvidence(
  evidence: DrawingP6PerformanceEvidence,
): string;
