import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) {
      continue;
    }
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJson(path, data) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

export function repoRootFromScript(scriptUrl) {
  let dir = dirname(fileURLToPath(scriptUrl));
  while (dir && dir !== dirname(dir)) {
    if (
      existsSync(join(dir, "package.json")) &&
      existsSync(join(dir, "data", "schema", "open-coaching-data.v1.schema.json"))
    ) {
      return dir;
    }
    dir = dirname(dir);
  }
  throw new Error("Could not find the Kahunas exporter package root.");
}

export function defaultRunDir() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  return join(process.env.HOME || process.cwd(), "KahunasExports", "kahunas", "runs", stamp);
}

export function countRecords(pkg) {
  return {
    clients: pkg.clients?.clients?.length || 0,
    client_assignments: pkg.clients?.client_assignments?.length || 0,
    form_templates: pkg.forms?.form_templates?.length || 0,
    form_submissions: pkg.forms?.form_submissions?.length || 0,
    check_ins: Array.isArray(pkg.check_ins) ? pkg.check_ins.length : 0,
    meal_plans: pkg.nutrition?.meal_plans?.length || 0,
    workout_plans: pkg.training?.workout_plans?.length || 0,
    workout_sessions: pkg.training?.workout_sessions?.length || 0,
    workout_session_exercises: pkg.training?.workout_session_exercises?.length || 0
  };
}

export function coachSlug(pkg) {
  const name = pkg.manifest?.coach_identity?.display_name || pkg.coach?.profile?.display_name || "coach";
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "coach";
}

export function todayString() {
  return new Date().toISOString().slice(0, 10);
}

export function createZip(sourceDir, zipPath) {
  const zipBinary = spawnSync("which", ["zip"], { encoding: "utf8" }).stdout.trim();
  if (!zipBinary) {
    throw new Error("The `zip` command was not found. Install zip or create the archive manually from the export folder.");
  }
  rmSync(zipPath, { force: true });
  const result = spawnSync(zipBinary, ["-qr", resolve(zipPath), "."], {
    cwd: sourceDir,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`zip failed: ${result.stderr || result.stdout || "unknown error"}`);
  }
}

export function writeCoachReadme(path, counts, warnings = []) {
  const needsAttention = warnings.length
    ? warnings.map((warning) => `- ${warning.message || warning.code || String(warning)}`).join("\n")
    : "- Nothing needs attention from this test export.";

  const text = `# Your Kahunas Export\n\nThis folder contains a coaching data export that can be imported into a coaching platform.\n\nIncluded:\n\n- ${counts.clients} clients\n- ${counts.form_templates} form templates\n- ${counts.form_submissions} submitted forms\n- ${counts.check_ins} check-ins\n- ${counts.meal_plans} meal plans assigned to clients\n- ${counts.workout_plans} workout plans assigned to clients\n- ${counts.workout_sessions} workout sessions\n- ${counts.workout_session_exercises} prescribed exercises\n\nPlease confirm these numbers\n\nDo these numbers look right for your Kahunas account? If anything looks too low or too high, say which number and roughly what you expected. The export will keep checking and correcting the counts until you say they are satisfactory.\n\nNeeds attention:\n\n${needsAttention}\n\nNothing has been uploaded or sent anywhere.\n`;
  writeFileSync(path, text);
}

export function validatePackageShape(pkg) {
  const errors = [];
  const requiredTopLevel = ["manifest", "coach", "clients", "forms", "check_ins", "nutrition", "training"];
  for (const key of requiredTopLevel) {
    if (!pkg[key]) {
      errors.push(`Missing top-level section: ${key}`);
    }
  }

  const arrays = [
    ["clients.clients", pkg.clients?.clients],
    ["clients.client_assignments", pkg.clients?.client_assignments],
    ["forms.form_templates", pkg.forms?.form_templates],
    ["forms.form_submissions", pkg.forms?.form_submissions],
    ["check_ins", pkg.check_ins],
    ["nutrition.meal_plans", pkg.nutrition?.meal_plans],
    ["training.workout_plans", pkg.training?.workout_plans],
    ["training.workout_sessions", pkg.training?.workout_sessions],
    ["training.workout_session_exercises", pkg.training?.workout_session_exercises]
  ];

  for (const [label, value] of arrays) {
    if (!Array.isArray(value)) {
      errors.push(`Expected ${label} to be an array.`);
    }
  }

  if (!pkg.manifest?.schema_name) {
    errors.push("Manifest is missing schema_name.");
  }
  if (!pkg.manifest?.schema_version) {
    errors.push("Manifest is missing schema_version.");
  }

  return errors;
}

export function packageFileName(pkg) {
  return `kahunas-${coachSlug(pkg)}-${todayString()}-coaching-data.json`;
}

export function zipFileName(pkg) {
  return `kahunas-${coachSlug(pkg)}-${todayString()}-export.zip`;
}

export function resolveFixturePath(repoRoot, maybePath) {
  if (maybePath) {
    return resolve(maybePath);
  }
  return join(repoRoot, "data", "examples", "standard-seed-package.v1.json");
}

export function relativeForJson(path) {
  return basename(path);
}

export function assertExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} does not exist: ${path}`);
  }
}
