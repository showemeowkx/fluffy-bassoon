#!/usr/bin/env node
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { countRecords, parseArgs, readJson, repoRootFromScript, validatePackageShape, writeJson } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.input) {
  console.log(`Usage: node skills/kahunas-export/scripts/validate-export.mjs --input FILE [--output FILE]\n\nValidates the coaching data package shape expected by the V1 coaching data format.\n\nOptions:\n  --input FILE   Package JSON to validate.\n  --output FILE  Optional validation report path.\n  --help         Show this help text.\n`);
  process.exit(args.help ? 0 : 2);
}

const input = resolve(args.input);
const pkg = readJson(input);
const schema = readJson(resolve(repoRootFromScript(import.meta.url), "data/schema/open-coaching-data.v1.schema.json"));
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const validate = ajv.compile(schema);
const shapeErrors = validatePackageShape(pkg);
const schemaOk = validate(pkg);
const schemaErrors = schemaOk ? [] : (validate.errors || []).map((error) => `${error.instancePath || "/"} ${error.message}`);
const errors = [...shapeErrors, ...schemaErrors];
const counts = countRecords(pkg);
const report = {
  ok: errors.length === 0,
  input,
  checked_at: new Date().toISOString(),
  counts,
  errors
};

if (args.output) {
  writeJson(resolve(args.output), report);
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
