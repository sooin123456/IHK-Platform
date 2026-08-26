import { defineConfig } from "@playwright/test";

import base from "./playwright.config";
import {
  assertP4FunctionalBrowserAuthority,
  p4FunctionalBrowserAuthority,
} from "./scripts/drawing-p4-browser-authority.mjs";

const authority = assertP4FunctionalBrowserAuthority(
  p4FunctionalBrowserAuthority(process.env),
);

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: authority.baseURL },
  webServer: {
    command: `npm run dev -- --port ${authority.port} --host 127.0.0.1`,
    url: authority.baseURL,
    reuseExistingServer: authority.reuseExistingServer,
    env: authority.environment,
  },
});
