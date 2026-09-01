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
