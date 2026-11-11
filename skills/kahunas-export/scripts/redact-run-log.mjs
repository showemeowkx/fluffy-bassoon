#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs, readJson, writeJson } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.input || !args.output) {
  console.log(`Usage: node skills/kahunas-export/scripts/redact-run-log.mjs --input FILE --output FILE\n\nWrites a redacted copy of a Kahunas exporter run log.\n\nOptions:\n  --input FILE   Raw run log JSON.\n  --output FILE  Redacted run log JSON.\n  --help         Show this help text.\n`);
  process.exit(args.help ? 0 : 2);
}

const SECRET_KEYS = new Set([
  "password",
  "cookie",
  "cookies",
  "authorization",
  "auth",
  "token",
  "access_token",
  "refresh_token",
  "csrf",
  "session",
  "session_id",
  "auth_header"
]);

function redact(value, key = "") {
  const lower = key.toLowerCase();
  if (SECRET_KEYS.has(lower) || lower.includes("token") || lower.includes("cookie") || lower.includes("password")) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
  }
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
      .replace(/(password=)[^&\s]+/gi, "$1[REDACTED]")
      .replace(/(token=)[^&\s]+/gi, "$1[REDACTED]");
  }
  return value;
}

const input = resolve(args.input);
const output = resolve(args.output);
const raw = readJson(input);
const redacted = {
  ...redact(raw),
  redacted_at: new Date().toISOString(),
  redaction_note: "Passwords, cookies, tokens, auth headers, and session-like fields were redacted."
};
writeJson(output, redacted);
console.log(JSON.stringify({ ok: true, output }, null, 2));
