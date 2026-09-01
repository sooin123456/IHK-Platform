import { defineConfig } from "@playwright/test";

import base from "./playwright.config";
import { verifyDisposableSupabaseAuthority } from "./scripts/run-drawing-workspace-m1-e2e.mjs";

const authority = verifyDisposableSupabaseAuthority(process.env);

const value = (name: string) => {
  const result = process.env[name]?.trim();
  if (!result) throw new Error(`M1 E2E requires ${name}`);
  return result;
};
const anonKey = value("SUPABASE_ANON_KEY");
const serviceRoleKey = value("SUPABASE_SERVICE_ROLE_KEY");
if (
  value("VITE_SUPABASE_URL") !== authority.supabaseUrl ||
  value("VITE_SUPABASE_ANON_KEY") !== anonKey
)
  throw new Error("M1 E2E requires exact build-time Supabase variables");
if (value("VITE_DRAWING_COLLABORATION_URL") !== "ws://127.0.0.1:12349")
  throw new Error("M1 E2E requires the canonical loopback collaboration URL");
const internalSecret = value("COLLABORATION_INTERNAL_SECRET");
const freezeSecret = value("COLLABORATION_FREEZE_SECRET");
if (
  internalSecret.length < 32 ||
  freezeSecret.length < 32 ||
  internalSecret === freezeSecret
)
  throw new Error(
    "M1 E2E requires distinct 32-character collaboration secrets",
  );

const commonEnvironment = {
  ...(process.env as Record<string, string>),
  DATABASE_URL: authority.databaseUrl,
  SUPABASE_URL: authority.supabaseUrl,
  SUPABASE_ANON_KEY: anonKey,
  SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
};

export default defineConfig({
  ...base,
  fullyParallel: false,
  forbidOnly: true,
  reporter: "line",
  retries: 0,
  workers: 1,
  use: {
    ...base.use,
    baseURL: "http://127.0.0.1:4000",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "node collaboration/dist/collaboration/src/server.js",
      url: "http://127.0.0.1:12349/healthz",
      reuseExistingServer: false,
      env: {
        ...commonEnvironment,
        NODE_ENV: "production",
        PORT: "12349",
        COLLABORATION_DATABASE_URL: authority.databaseUrl,
        COLLABORATION_ALLOWED_ORIGINS: "http://127.0.0.1:4000",
        COLLABORATION_INSTANCE_ID: "m1-e2e-disposable",
        COLLABORATION_INTERNAL_SECRET: internalSecret,
        COLLABORATION_FREEZE_SECRET: freezeSecret,
      },
    },
    {
      command: "npm run start",
      url: "http://127.0.0.1:4000",
      reuseExistingServer: false,
      env: {
        ...commonEnvironment,
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "4000",
        VITE_SUPABASE_URL: authority.supabaseUrl,
        VITE_SUPABASE_ANON_KEY: anonKey,
        VITE_DRAWING_COLLABORATION_URL: "ws://127.0.0.1:12349",
        COLLABORATION_INTERNAL_URL: "http://127.0.0.1:12349",
        COLLABORATION_INTERNAL_SECRET: internalSecret,
        COLLABORATION_FREEZE_SECRET: freezeSecret,
      },
    },
  ],
});
