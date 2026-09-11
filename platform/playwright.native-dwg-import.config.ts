import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "drawing-native-dwg-import-control.spec.ts",
  outputDir: "./test-results/native-dwg-import-control",
  workers: 1,
  use: {
    browserName: "chromium",
    screenshot: "on",
    trace: "retain-on-failure",
  },
});
