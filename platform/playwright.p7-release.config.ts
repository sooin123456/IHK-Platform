import { defineConfig } from "@playwright/test";

import base from "./playwright.config";

const port = Number(process.env.P7_RELEASE_PORT ?? 4185);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  ...base,
  fullyParallel: false,
  reporter: "line",
  use: { ...base.use, baseURL, trace: "retain-on-failure" },
  webServer: {
    command: "npm run build && NODE_ENV=development npm run start",
    url: baseURL,
    reuseExistingServer: false,
    env: {
      ...(process.env as Record<string, string>),
      PORT: String(port),
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_ANON_KEY: "p7-release-local-browser-gate",
    },
  },
});
