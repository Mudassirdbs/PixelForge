import { defineConfig, devices } from "@playwright/test";

/**
 * Cross-browser smoke tests for the PixelForge image converter.
 * Runs the conversion / preview / download flows in Chromium, Firefox and
 * WebKit at both desktop and mobile viewport sizes.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:8080",
    trace: "retain-on-failure",
    video: "off",
  },
  webServer: {
    command: "bun run dev",
    url: "http://localhost:8080",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "firefox-desktop",  use: { ...devices["Desktop Firefox"], viewport: { width: 1280, height: 900 } } },
    { name: "webkit-desktop",   use: { ...devices["Desktop Safari"],  viewport: { width: 1280, height: 900 } } },
    { name: "chromium-mobile",  use: { ...devices["Pixel 5"] } },
    { name: "webkit-mobile",    use: { ...devices["iPhone 13"] } },
  ],
});
