#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defaultRunDir, ensureDir, parseArgs, repoRootFromScript, writeJson } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`Usage: node skills/kahunas-export/scripts/start-browser.mjs [--run-dir DIR] [--port PORT] [--url URL]\n\nOpens a local browser window for Kahunas login and keeps it running until this process is stopped.\n\nOptions:\n  --run-dir DIR  Run folder. Defaults to ~/KahunasExports/kahunas/runs/<timestamp>.\n  --port PORT    Local connection port. Defaults to 9333.\n  --url URL      Initial URL. Defaults to https://kahunas.io/login.\n  --help         Show this help text.\n`);
  process.exit(0);
}

const runDir = resolve(args["run-dir"] || defaultRunDir());
const port = Number(args.port || 9333);
const url = args.url || "https://kahunas.io/login";
const profileDir = join(runDir, "browser-profile");
const skillRoot = repoRootFromScript(import.meta.url);
process.env.PLAYWRIGHT_BROWSERS_PATH ||= join(skillRoot, ".playwright-browsers");
ensureDir(profileDir);

let context;
try {
  const { chromium } = await import("playwright");
  const launchOptions = {
    headless: false,
    args: [
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--password-store=basic",
      "--use-mock-keychain"
    ],
    viewport: null
  };
  // Prefer the bundled browser; fall back to an installed Chrome or Edge (still with the
  // isolated profile above) when the bundled download is missing, e.g. low disk space.
  const candidates = [];
  if (existsSync(chromium.executablePath())) {
    candidates.push({ label: "bundled browser", options: {} });
  }
  candidates.push({ label: "Google Chrome", options: { channel: "chrome" } });
  candidates.push({ label: "Microsoft Edge", options: { channel: "msedge" } });
  const failures = [];
  for (const candidate of candidates) {
    try {
      context = await chromium.launchPersistentContext(profileDir, { ...launchOptions, ...candidate.options });
      break;
    } catch (error) {
      failures.push(`${candidate.label}: ${error.message.split("\n")[0]}`);
    }
  }
  if (!context) {
    throw new Error(`No browser could be started. Please rerun \`npx --yes @assistantcoach/kahunas-exporter\` and try again.\n${failures.join("\n")}`);
  }
  const page = context.pages()[0] || await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
} catch (error) {
  console.error(`Could not start the Kahunas browser: ${error.message}`);
  process.exit(1);
}

const session = {
  browser_pid: process.pid,
  cdp_url: `http://127.0.0.1:${port}`,
  run_dir: runDir,
  profile_dir: profileDir,
  started_at: new Date().toISOString(),
  login_url: url
};

writeJson(join(runDir, "browser-session.json"), session);
writeFileSync(join(runDir, "README.txt"), "This folder contains local Kahunas export run files. Do not share browser-profile or raw logs.\n");
console.log(JSON.stringify(session, null, 2));

const shutdown = async () => {
  if (context) {
    await context.close().catch(() => {});
  }
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await new Promise(() => {});
