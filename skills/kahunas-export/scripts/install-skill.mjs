#!/usr/bin/env node
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDir, parseArgs, repoRootFromScript } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`Usage: kahunas-exporter [--target DIR] [--dry-run] [--skip-browser-install]\n\nInstalls the Kahunas export Codex skill and the local browser helper it needs.\n\nOptions:\n  --target DIR             Install directory. Defaults to ~/.codex/skills/kahunas-export.\n  --dry-run                Show what would happen without copying files.\n  --skip-browser-install   Skip browser helper download. Useful for CI only.\n  --help                   Show this help text.\n`);
  process.exit(0);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const skillRoot = resolve(scriptDir, "..");
const packageRoot = repoRootFromScript(import.meta.url);
const defaultCodexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
const defaultTarget = join(defaultCodexHome, "skills", "kahunas-export");
const target = resolve(args.target || defaultTarget);
const launchPrompt = readFileSync(join(skillRoot, "assets", "launch-prompt.txt"), "utf8").trim();

function cleanOutput(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function runChecked(label, command, commandArgs, options) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: "pipe",
    shell: process.platform === "win32" && command === "npm",
    ...options
  });

  if (result.error || result.status !== 0) {
    const parts = [];
    if (result.error) {
      parts.push(`Could not start ${label}: ${result.error.message}`);
    } else {
      parts.push(`${label} exited with code ${result.status ?? "unknown"}.`);
    }
    if (result.signal) {
      parts.push(`${label} stopped with signal ${result.signal}.`);
    }
    const stdout = cleanOutput(result.stdout);
    const stderr = cleanOutput(result.stderr);
    if (stdout) {
      parts.push(`Output:\n${stdout}`);
    }
    if (stderr) {
      parts.push(`Error:\n${stderr}`);
    }
    throw new Error(`${label} failed.\n${parts.join("\n\n")}`);
  }

  return result;
}

const result = {
  skill: "kahunas-export",
  source: packageRoot,
  target,
  installed: false,
  dependencies_installed: false,
  browser_installed: false,
  prompt: launchPrompt
};

if (args["dry-run"]) {
  console.log(JSON.stringify({ ...result, dry_run: true }, null, 2));
  process.exit(0);
}

try {
  if (existsSync(target)) {
    result.note = "Target already existed, so it was replaced with the latest exporter.";
    rmSync(target, { recursive: true, force: true });
  }
  ensureDir(target);
  cpSync(skillRoot, target, { recursive: true });
  cpSync(join(packageRoot, "data"), join(target, "data"), { recursive: true });
  if (existsSync(join(packageRoot, "tests"))) {
    cpSync(join(packageRoot, "tests"), join(target, "tests"), { recursive: true });
  }
  writeFileSync(join(target, "package.json"), `${JSON.stringify({
    name: "@assistantcoach/kahunas-export-skill",
    version: "0.1.0",
    private: true,
    type: "module",
    description: "Installed local Codex skill for exporting Kahunas coaching data.",
    scripts: {
      check: "node --check scripts/install-skill.mjs && node --check scripts/start-browser.mjs && node --check scripts/export-kahunas.mjs && node --check scripts/validate-export.mjs && node --check scripts/redact-run-log.mjs && node --check tests/run-fixture-export.mjs",
      "test:fixture": "node tests/run-fixture-export.mjs"
    },
    dependencies: {
      ajv: "^8.20.0",
      playwright: "^1.59.1"
    },
    engines: {
      node: ">=20"
    }
  }, null, 2)}\n`);

  runChecked("Skill dependency install", "npm", ["install", "--omit=dev"], {
    cwd: target,
    env: process.env
  });
  result.dependencies_installed = true;

  if (!args["skip-browser-install"]) {
    const playwrightCli = join(target, "node_modules", "playwright", "cli.js");
    const browserPath = join(target, ".playwright-browsers");
    runChecked("Browser helper install", process.execPath, [playwrightCli, "install", "chromium"], {
      cwd: target,
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: browserPath
      }
    });
    result.browser_installed = true;
    result.browser_path = browserPath;
  }

  result.installed = true;
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`Could not install the skill automatically: ${error.message}`);
  console.error("Please rerun `npx --yes @assistantcoach/kahunas-exporter`. If it fails again, email yashasvi@assistantcoach.fit and include a screenshot or copy of the last few lines shown in Terminal.");
  process.exit(1);
}
