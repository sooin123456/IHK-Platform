export const P4_FUNCTIONAL_PORT: 4173;
export const P4_FUNCTIONAL_BASE_URL: "http://127.0.0.1:4173";

export type P4FunctionalBrowserAuthority = {
  port: 4173;
  baseURL: "http://127.0.0.1:4173";
  reuseExistingServer: false;
  environment: Record<string, string> & { PORT: "4173" };
};

export function p4FunctionalBrowserAuthority(
  environment?: NodeJS.ProcessEnv,
): P4FunctionalBrowserAuthority;
export function assertP4FunctionalBrowserAuthority(
  authority: P4FunctionalBrowserAuthority,
): P4FunctionalBrowserAuthority;
