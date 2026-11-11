import fs from "node:fs";

const files = ["README.md", "docs/pilot-call-runbook.md"];
const pinnedSetupUrl = /@assistantcoach\/kahunas-exporter@\d+\.\d+\.\d+\/scripts\/setup-(?:mac|linux)\.sh/;

for (const file of files) {
  const contents = fs.readFileSync(file, "utf8");
  if (pinnedSetupUrl.test(contents)) {
    throw new Error(`${file} pins a setup command to a package version; use @latest instead.`);
  }
}

console.log("Public setup commands follow the latest published package.");
