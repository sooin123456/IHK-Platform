import { defineConfig, devices } from "@playwright/test";
import "dotenv/config";

import { requireDrawingP3ProductionCredentials } from "./e2e/utils/drawing-collaboration-fixture";

const p3ProductionGate =
  process.env.npm_lifecycle_event ===
    "test:e2e:drawing-workspace-p3:production" ||
  process.argv.some((argument) =>
    argument.includes("drawing-workspace-p3.spec.ts"),
  );
if (p3ProductionGate) requireDrawingP3ProductionCredentials(process.env);

const PORT = process.env.PORT || 4000;
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const remote = Boolean(process.env.E2E_BASE_URL);

export default defineConfig({
  metadata: {
    p3DeterministicRun: process.env.P3_E2E_RUN_ID
      ? "configured"
      : "unconfigured",
  },
  timeout: 60000 * 10,
  testDir: "./e2e",
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: "html",
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: BASE_URL,
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",

    video: "on-first-retry",

    viewport: { width: 1280 * 2, height: 800 * 2 },
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },

    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },

    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],

  /* Run the local dev server before starting the tests */
  webServer: remote
    ? undefined
    : {
        command: `npm run dev -- --port ${PORT} --host 127.0.0.1`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        env: {
          ...(process.env as Record<string, string>),
        },
      },
});
