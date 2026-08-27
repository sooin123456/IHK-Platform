import { defineConfig } from "@playwright/test";

import base from "./playwright.config";

const port = process.env.PORT || 4176;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL },
  webServer: {
    command: `npm run dev -- --port ${port} --host 127.0.0.1`,
    url: `${baseURL}/workspace-preview/drawing-workspace?p5IfcTest=1`,
    reuseExistingServer: false,
    env: {
      ...(process.env as Record<string, string>),
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_ANON_KEY: "p5-local-browser-gate",
    },
  },
});
