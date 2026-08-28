export type RestoreDigest = {
  count: number;
  digest: string;
  integrity?: boolean;
};
export type RestoreSnapshot = {
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
export function runManagedRestoreComparison(
  authority: Record<string, string>,
  adapters: Record<string, (...args: any[]) => Promise<any>>,
): Promise<any>;
export const realRestoreAdapters: Record<
  string,
  (...args: any[]) => Promise<any>
>;
