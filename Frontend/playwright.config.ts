import { defineConfig, devices } from "@playwright/test"; // Playwright test runner config

export default defineConfig({ // WP10 smoke test settings
  testDir: "./e2e", // where the tests live
  timeout: 60_000, // dev-mode pages compile on first visit, so allow a minute per test
  expect: { timeout: 10_000 }, // live roster polls every 3 s; 10 s is plenty
  fullyParallel: false, // the test drives one shared terminal, so run one at a time
  workers: 1, // ditto
  reporter: [["list"]], // readable console output
  use: { // browser defaults for every test
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000", // the dashboard
    trace: "retain-on-failure", // keep a trace only when something breaks
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }], // Chrome only (the demo browser)
  webServer: { // start `npm run dev` unless it is already running (the backend must be started separately)
    command: "npm run dev", // Next dev server
    url: "http://localhost:3000/login", // ready when the login page answers
    reuseExistingServer: true, // use the server you already have open
    timeout: 120_000, // first compile can be slow
  },
});
