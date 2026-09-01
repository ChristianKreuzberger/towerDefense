import { defineConfig, devices } from "@playwright/test";

const TEST_PORT = 4173;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${TEST_PORT}`,
    trace: "on-first-retry",
    ...devices["Desktop Chrome"]
  },
  webServer: {
    command: "npm run dev:game",
    url: `http://127.0.0.1:${TEST_PORT}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(TEST_PORT),
      PORT_MAX: String(TEST_PORT)
    }
  }
});