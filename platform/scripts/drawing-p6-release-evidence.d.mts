export type DrawingP6GateStatus = "PASS" | "NOT MET" | "UNEXECUTED";
export type DrawingP6ReleaseEvidence = {
  schemaVersion: 1;
  phase: "local" | "production";
  commit: string;
  migrationIds: string[];
  generatedAt: string;
  authorities: Record<string, DrawingP6GateStatus>;
  hashes: Record<string, string>;
  metrics: {
    calculationManifestP95Ms: number | null;
    comparisonP95Ms: number | null;
    lineageP95Ms: number | null;
    peakRssMiB: number | null;
    repeatedRuns: number;
  };
  gates: Record<string, DrawingP6GateStatus>;
};
export declare const P6_RELEASE_EVIDENCE_PATH: string;
export declare const P6_LOCAL_RELEASE_EVIDENCE_PATH: string;
export declare const P6_PRODUCTION_RELEASE_EVIDENCE_PATH: string;
export declare const P6_RELEASE_RELEVANT_PATHS: readonly string[];
export declare const P6_RELEASE_MIGRATION_IDS: readonly string[];
export declare function buildDrawingP6UnexecutedReleaseEvidence(
  phase: "local" | "production",
  commit?: string,
): DrawingP6ReleaseEvidence;
export declare function drawingP6ReleaseCommit(): string;
export declare function assertDrawingP6RelevantTreeClean(status: string): void;
export declare function assertDrawingP6CurrentTreeClean(): void;
export declare function validateDrawingP6ReleaseEvidence(
  evidence: DrawingP6ReleaseEvidence,
  expectedCommit?: string,
): DrawingP6ReleaseEvidence;
export declare function assertDrawingP6ReleasePass(
  evidence: DrawingP6ReleaseEvidence,
  expectedCommit?: string,
): DrawingP6ReleaseEvidence;
export declare function writeDrawingP6ReleaseEvidence(
  evidence: DrawingP6ReleaseEvidence,
): string;
