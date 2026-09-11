export type RestoreDigest = {
  count: number;
  digest: string;
  integrity?: boolean;
};
export type RestoreSnapshot = {
  systemIdentifier: string | null;
  schema: RestoreDigest;
  database: RestoreDigest;
  storage: RestoreDigest;
  yjs: RestoreDigest;
  approvals: RestoreDigest;
  lineage: RestoreDigest;
};

export const DRAWING_P7_RESTORE_EVIDENCE_PATH: string;
export function requireManagedRestoreAuthority(
  environment?: NodeJS.ProcessEnv,
): Record<string, string>;
export function buildUnexecutedRestoreEvidence(
  sourceCommit?: string | null,
  missing?: string[],
): Record<string, unknown>;
export function compareRestoreSnapshots(
  source: RestoreSnapshot,
  target: RestoreSnapshot,
): { status: "PASS" | "NOT MET"; mismatches: string[] };
export function classifyDrawingP7RestoreFailure(
  error: unknown,
  sourceCommit: string,
): {
  evidence: Record<string, unknown>;
  message: string;
  exitCode: 1 | 2;
};
export function inspectDrawingP7RestoreEvidence(evidence: unknown): {
  schemaVersion: 2;
  status: "UNEXECUTED" | "NOT MET";
  sourceCommit: string | null;
  requestId: string | null;
} & Record<string, unknown>;
export function runManagedRestoreComparison(
  authority: Record<string, string>,
  adapters: Record<string, (...args: any[]) => Promise<any>>,
): Promise<any>;
export const realRestoreAdapters: Record<
  string,
  (...args: any[]) => Promise<any>
>;
