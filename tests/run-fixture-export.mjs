#!/usr/bin/env node
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceLibPath = existsSync(join(root, "skills", "kahunas-export", "scripts", "lib.mjs"))
  ? "../skills/kahunas-export/scripts/lib.mjs"
  : "../scripts/lib.mjs";
const { readJson, repoRootFromScript } = await import(sourceLibPath);
const repoRoot = repoRootFromScript(import.meta.url);
const runDir = join(root, "runs", "fixture-test");
const fixture = join(repoRoot, "data", "examples", "standard-seed-package.v1.json");
const scriptPrefix = existsSync(join(root, "skills", "kahunas-export", "scripts", "export-kahunas.mjs"))
  ? "skills/kahunas-export/scripts"
  : "scripts";

rmSync(runDir, { recursive: true, force: true });

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
  return result.stdout.trim();
}

const exportOutput = JSON.parse(run("node", [
  `${scriptPrefix}/export-kahunas.mjs`,
  "--run-dir",
  runDir,
  "--fixture",
  fixture
]));

if (exportOutput.coach_confirmation_required !== true) {
  throw new Error("Expected export output to require coach count confirmation.");
}

if (exportOutput.confirmation_required_until_coach_approves !== true) {
  throw new Error("Expected coach approval to be the only successful confirmation exit.");
}

if (exportOutput.pagination_verification_required !== true) {
  throw new Error("Expected export output to require pagination verification.");
}

if (!exportOutput.confirmation_question?.includes("numbers look right")) {
  throw new Error("Expected export output to include the coach confirmation question.");
}

if (!existsSync(exportOutput.zip_file)) {
  throw new Error(`Expected ZIP to exist: ${exportOutput.zip_file}`);
}

if (!existsSync(exportOutput.data_file)) {
  throw new Error(`Expected data file to exist: ${exportOutput.data_file}`);
}

const validationPath = join(runDir, "validation.json");
const validation = JSON.parse(run("node", [
  `${scriptPrefix}/validate-export.mjs`,
  "--input",
  exportOutput.data_file,
  "--output",
  validationPath
]));

if (!validation.ok) {
  throw new Error(`Validation failed: ${validation.errors.join("; ")}`);
}

const redactedPath = join(runDir, "run-log.redacted.json");
run("node", [
  `${scriptPrefix}/redact-run-log.mjs`,
  "--input",
  join(runDir, "run-log.json"),
  "--output",
  redactedPath
]);

const pkg = readJson(exportOutput.data_file);
if (pkg.manifest.created_by_tool.name !== "assistantcoach-kahunas-codex-skill-exporter") {
  throw new Error("Unexpected created_by_tool name.");
}

const summary = readJson(join(runDir, "export", "export-summary.json"));
if (summary.coach_confirmation_required !== true) {
  throw new Error("Expected export summary to require coach count confirmation.");
}

if (summary.confirmation_required_until_coach_approves !== true) {
  throw new Error("Expected export summary to require confirmation until the coach approves.");
}

if (summary.pagination_verification_required !== true) {
  throw new Error("Expected export summary to require pagination verification.");
}

if (!summary.count_scope_note?.includes("client-assigned plans")) {
  throw new Error("Expected export summary to explain the scope of plan counts.");
}

console.log(JSON.stringify({
  ok: true,
  run_dir: runDir,
  zip_file: exportOutput.zip_file,
  data_file: exportOutput.data_file,
  validation: validationPath,
  redacted_log: redactedPath,
  counts: exportOutput.counts
}, null, 2));
