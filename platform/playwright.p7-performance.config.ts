import { defineConfig } from "@playwright/test";

import base from "./playwright.config";

const port = process.env.PORT || 4177;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL },
  webServer: {
    command: "NODE_ENV=development npm run start",
    url: baseURL,
    reuseExistingServer: false,
    env: {
      ...(process.env as Record<string, string>),
      PORT: String(port),
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_ANON_KEY: "p7-local-browser-gate",
    },
  },
});
