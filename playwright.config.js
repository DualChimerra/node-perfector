import { defineConfig } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

// Reuse a locally installed browser when available. No personal paths are stored.
let executablePath;
const browserRoot = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "ms-playwright");
if (browserRoot && existsSync(browserRoot)) {
    for (const folder of readdirSync(browserRoot).filter(name => /^chromium-\d+$/.test(name)).sort().reverse()) {
        const candidate = path.join(browserRoot, folder, "chrome-win64", "chrome.exe");
        if (existsSync(candidate)) { executablePath = candidate; break; }
    }
}
export default defineConfig({
    testDir: "./tests", testMatch: "*.spec.js", workers: 1,
    use: { baseURL: "http://127.0.0.1:8189", headless: true, viewport: { width: 1450, height: 1280 },
        launchOptions: executablePath ? { executablePath } : {} },
    webServer: { command: "node tests/server.mjs", url: "http://127.0.0.1:8189", reuseExistingServer: false },
});
