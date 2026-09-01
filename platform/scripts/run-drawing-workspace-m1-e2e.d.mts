export function assertM1LoopbackEnvironment(environment: NodeJS.ProcessEnv): {
  databaseUrl: string;
  projectId: string;
  supabaseUrl: string;
  workdir: string;
};

export function assertDisposableCleanupTarget(input: {
  projectId: string;
  root: string;
}): {
  configPath: string;
  markerPath: string;
  resolved: string;
};

export function renderDisposableSupabaseConfig(input: {
  projectId: string;
  portBase: number;
  repositoryConfig: string;
}): string;

export function parseSupabaseStatus(raw: string): {
  anonKey: string;
  databaseUrl: string;
  serviceRoleKey: string;
  supabaseUrl: string;
};

export function verifyDisposableSupabaseAuthority(
  environment: NodeJS.ProcessEnv,
  options?: {
    statusRunner?: (
      command: string,
      args: string[],
      environment: NodeJS.ProcessEnv,
    ) => string;
  },
): ReturnType<typeof assertM1LoopbackEnvironment>;

type TrackedChild = {
  pid?: number;
  kill(signal?: NodeJS.Signals): boolean;
};

export function createProcessLifecycle(options?: {
  escalationMilliseconds?: number;
}): {
  readonly signal: NodeJS.Signals | null;
  assertCanStart(allowAfterSignal?: boolean): void;
  requestSignal(signal: NodeJS.Signals): void;
  track(child: TrackedChild, options?: { processGroup?: boolean }): () => void;
  terminateTracked(): Promise<void>;
  waitForTermination(): Promise<void>;
};

export function interruptedError<T extends Error>(
  error: T | unknown,
  signal: NodeJS.Signals,
): T & { signal: NodeJS.Signals };

export function runChildProcess(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  options?: {
    allowAfterSignal?: boolean;
    capture?: boolean;
    cwd?: string;
    lifecycle?: ReturnType<typeof createProcessLifecycle>;
    sensitive?: boolean;
  },
): Promise<string | undefined>;

export function cleanupDisposableProject(input: {
  projectId: string;
  root: string;
  projectReady: boolean;
  remove?: (target: string) => void;
  startAttempted: boolean;
  stop?: () => Promise<unknown>;
}): Promise<{ removed: boolean; stopped: boolean }>;
