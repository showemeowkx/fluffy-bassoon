import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const promptPath = "skills/kahunas-export/assets/launch-prompt.txt";
const prompt = readFileSync(promptPath, "utf8").trim();

for (const requiredText of [
  "Assume every Kahunas list may be paginated or lazy-loaded",
  "Keep repeating this loop until I explicitly say the numbers are satisfactory",
  "My explicit confirmation is the only successful exit"
]) {
  if (!prompt.includes(requiredText)) {
    throw new Error(`Launch prompt is missing required guidance: ${requiredText}`);
  }
}

const installer = spawnSync(
  process.execPath,
  ["skills/kahunas-export/scripts/install-skill.mjs", "--dry-run", "--skip-browser-install"],
  { encoding: "utf8" }
);
if (installer.status !== 0) {
  throw new Error(installer.stderr || "Installer dry run failed.");
}

const installerOutput = JSON.parse(installer.stdout);
if (installerOutput.prompt !== prompt) {
  throw new Error("Installer output and the installed launch prompt do not match.");
}

for (const setupScript of [
  "scripts/setup-mac.sh",
  "scripts/setup-linux.sh",
  "scripts/setup-windows.ps1"
]) {
  const contents = readFileSync(setupScript, "utf8");
  if (!contents.includes("launch-prompt.txt")) {
    throw new Error(`${setupScript} does not load the shared launch prompt.`);
  }
  if (contents.includes("Tell me, in plain English, what was exported and how complete it looks")) {
    throw new Error(`${setupScript} still contains the previous embedded prompt.`);
  }
}

console.log("Installer and setup scripts use the same launch prompt.");
