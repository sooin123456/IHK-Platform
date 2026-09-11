import assert from "node:assert/strict";

export const P4_FUNCTIONAL_PORT = 4173;
export const P4_FUNCTIONAL_BASE_URL = `http://127.0.0.1:${P4_FUNCTIONAL_PORT}`;
const p4FunctionalViteCacheDir = "node_modules/.vite-p4-functional";

const localSupabaseUrl = "http://127.0.0.1:54321";
const localSupabaseKey = "p4-local-browser-gate";
const localSupabaseServiceRoleKey = "p4-local-browser-gate-service-role";

export function p4FunctionalBrowserAuthority(environment = process.env) {
  const {
    E2E_BASE_URL: _target,
    PORT: _port,
    VITE_SUPABASE_SERVICE_ROLE_KEY: _viteServiceRole,
    ...inherited
  } = environment;
  const cleanEnvironment = Object.fromEntries(
    Object.entries(inherited).filter((entry) => typeof entry[1] === "string"),
  );
  return {
    port: P4_FUNCTIONAL_PORT,
    baseURL: P4_FUNCTIONAL_BASE_URL,
    reuseExistingServer: false,
    environment: {
      ...cleanEnvironment,
      PORT: String(P4_FUNCTIONAL_PORT),
      SUPABASE_URL: localSupabaseUrl,
      SUPABASE_ANON_KEY: localSupabaseKey,
      SUPABASE_SERVICE_ROLE_KEY: localSupabaseServiceRoleKey,
      VITE_SUPABASE_URL: localSupabaseUrl,
      VITE_SUPABASE_ANON_KEY: localSupabaseKey,
      P4_FUNCTIONAL_VITE_CACHE_DIR: p4FunctionalViteCacheDir,
    },
  };
}

export function assertP4FunctionalBrowserAuthority(authority) {
  assert.equal(authority.port, P4_FUNCTIONAL_PORT);
  assert.equal(authority.baseURL, P4_FUNCTIONAL_BASE_URL);
  assert.equal(authority.reuseExistingServer, false);
  assert.equal("E2E_BASE_URL" in authority.environment, false);
  assert.equal(authority.environment.PORT, String(P4_FUNCTIONAL_PORT));
  assert.equal(authority.environment.SUPABASE_URL, localSupabaseUrl);
  assert.equal(authority.environment.SUPABASE_ANON_KEY, localSupabaseKey);
  assert.equal(
    authority.environment.SUPABASE_SERVICE_ROLE_KEY,
    localSupabaseServiceRoleKey,
  );
  assert.equal(
    "VITE_SUPABASE_SERVICE_ROLE_KEY" in authority.environment,
    false,
  );
  assert.equal(authority.environment.VITE_SUPABASE_URL, localSupabaseUrl);
  assert.equal(authority.environment.VITE_SUPABASE_ANON_KEY, localSupabaseKey);
  assert.equal(
    authority.environment.P4_FUNCTIONAL_VITE_CACHE_DIR,
    p4FunctionalViteCacheDir,
  );
  return authority;
}
