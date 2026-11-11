#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import {
  countRecords,
  createZip,
  defaultRunDir,
  ensureDir,
  packageFileName,
  parseArgs,
  readJson,
  relativeForJson,
  repoRootFromScript,
  resolveFixturePath,
  validatePackageShape,
  writeCoachReadme,
  writeJson,
  zipFileName
} from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`Usage: node skills/kahunas-export/scripts/export-kahunas.mjs [--run-dir DIR] [--fixture FILE] [--cdp-url URL]\n\nCreates a local Kahunas coaching data export package.\n\nOptions:\n  --run-dir DIR  Run folder. Defaults to ~/KahunasExports/kahunas/runs/<timestamp>.\n  --fixture FILE Use an existing standard package JSON as input for local testing.\n  --cdp-url URL  Connect to a local browser launched by start-browser.mjs.\n  --help         Show this help text.\n`);
  process.exit(0);
}

const repoRoot = repoRootFromScript(import.meta.url);
const runDir = resolve(args["run-dir"] || defaultRunDir());
const exportDir = join(runDir, "export");
ensureDir(exportDir);

function progress(message) {
  console.log(message);
}

function openFileWithDefaultApp(filePath) {
  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const argsForCommand = platform === "win32" ? ["/c", "start", "", filePath] : [filePath];
  const opened = spawnSync(command, argsForCommand, {
    stdio: "ignore",
    detached: true
  });
  return opened.status === 0;
}

function updatePackageForKahunasPilot(pkg, mode) {
  const copy = structuredClone(pkg);
  copy.manifest = {
    ...copy.manifest,
    created_at: new Date().toISOString(),
    created_by_tool: {
      name: "assistantcoach-kahunas-codex-skill-exporter",
      version: "0.1.0"
    },
    source_platform: {
      name: mode === "fixture" ? "Kahunas fixture test" : "Kahunas"
    },
    validation_status: "pending"
  };
  copy.manifest.record_counts = {
    ...(copy.manifest.record_counts || {}),
    ...countRecords(copy)
  };
  return copy;
}

async function packageFromFixture() {
  const fixturePath = resolveFixturePath(repoRoot, args.fixture);
  const fixture = readJson(fixturePath);
  return {
    pkg: updatePackageForKahunasPilot(fixture, "fixture"),
    runLog: {
      mode: "fixture",
      started_at: new Date().toISOString(),
      source_fixture: fixturePath,
      notes: [
        "Fixture extraction verifies package creation, validation, ZIP creation, and coach summary mechanics.",
        "It does not prove live Kahunas API extraction."
      ],
      artifacts: []
    }
  };
}

async function packageFromLiveBrowser() {
  if (!args["cdp-url"]) {
    throw new Error("Live extraction requires --cdp-url or --fixture for local tests.");
  }

  let browser;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.connectOverCDP(args["cdp-url"]);
    const pages = browser.contexts().flatMap((context) => context.pages());
    const page = pages.find((candidate) => candidate.url().includes("kahunas.io")) || pages[0];
    if (!page) {
      throw new Error("Connected to the browser but found no open pages.");
    }

    await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
    await waitForKahunasLogin(page);

    const extracted = await extractLivePackage(page);
    const discovery = await page.evaluate(() => {
      const absolute = (href) => {
        try {
          return new URL(href, location.href).href;
        } catch {
          return href;
        }
      };
      const resourceNames = performance.getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => name.includes("kahunas.io"))
        .slice(-250);
      return {
        current_url: location.href,
        title: document.title,
        body_text: document.body ? document.body.innerText.slice(0, 30000) : "",
        links: Array.from(document.querySelectorAll("a[href]")).slice(0, 300).map((link) => ({
          text: (link.innerText || link.getAttribute("aria-label") || "").trim().slice(0, 160),
          href: absolute(link.getAttribute("href"))
        })),
        forms: Array.from(document.querySelectorAll("form")).map((form) => ({
          action: absolute(form.getAttribute("action") || location.href),
          method: form.getAttribute("method") || "get",
          fields: Array.from(form.querySelectorAll("input, select, textarea")).map((field) => ({
            name: field.getAttribute("name") || "",
            type: field.getAttribute("type") || field.tagName.toLowerCase(),
            label: field.getAttribute("aria-label") || field.getAttribute("placeholder") || ""
          }))
        })),
        local_storage_keys: Object.keys(localStorage || {}),
        session_storage_keys: Object.keys(sessionStorage || {}),
        resource_names: resourceNames
      };
    });

    const rawDir = join(runDir, "raw");
    ensureDir(rawDir);
    writeFileSync(join(rawDir, "current-page.txt"), discovery.body_text || "");
    writeJson(join(rawDir, "browser-discovery.json"), {
      ...discovery,
      body_text: undefined
    });

    const runLog = {
      mode: "live-discovery",
      started_at: new Date().toISOString(),
      cdp_url: args["cdp-url"],
      current_url: discovery.current_url,
      page_title: discovery.title,
      notes: [
        "Live browser connection succeeded.",
        "Live V1 extraction completed for coach profile, settings, clients, assignments, intake Q&A, check-ins, check-in answers, meal plans, and workout plans.",
        "Workout and nutrition plans are exported through client assignments first, so unassigned library templates may be skipped.",
        "A raw current-page text snapshot and sanitized browser discovery report were captured locally for extractor development."
      ],
      artifacts: [join(rawDir, "current-page.txt"), join(rawDir, "browser-discovery.json")]
    };

    return {
      pkg: extracted,
      runLog
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

async function waitForKahunasLogin(page, options = {}) {
  const intervalMs = options.intervalMs || 30000;
  const timeoutMs = options.timeoutMs || 30 * 60 * 1000;
  const startedAt = Date.now();
  let attempt = 0;

  console.log("Kahunas browser is open. Please log in there.");
  console.log("I will check every 30 seconds, so you do not need to type anything here after logging in.");
  console.log("Your export stays on this laptop. Nothing is uploaded by this tool.");

  while (Date.now() - startedAt < timeoutMs) {
    attempt += 1;
    const state = await getKahunasLoginState(page);
    if (state.loggedIn) {
      console.log("Kahunas login detected. Starting the export now.");
      return state;
    }

    if (attempt === 1 && state.url && !state.url.includes("kahunas.io")) {
      await page.goto("https://kahunas.io/login", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    }

    const helper = state.needsHumanStep
      ? "Kahunas looks like it needs a quick step from you in the browser, such as a code, captcha, or security check."
      : "Still waiting for Kahunas login in the browser.";
    console.log(`${helper} I will check again in 30 seconds.`);
    await page.waitForTimeout(intervalMs);
  }

  throw new Error("I could not confirm Kahunas login within 30 minutes. Please keep the browser window open and try the export again. If Kahunas is asking for a code, captcha, or payment/security step, complete that in the browser first.");
}

async function getKahunasLoginState(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
  return await page.evaluate(() => {
    const text = document.body?.innerText?.toLowerCase() || "";
    const url = location.href;
    const loginUrl = /kahunas[.]io\/(login|register|forgot|password)/i.test(url);
    const dashboardUrl = /kahunas[.]io\/(dashboard|coach\/|profile\/settings)/i.test(url);
    const hasLoginForm = Boolean(document.querySelector('input[type="password"], input[name*="password" i]'));
    const hasCoachNav = text.includes("clients") && (text.includes("workout") || text.includes("check-in") || text.includes("meal"));
    const blockedWords = ["captcha", "verification code", "security check", "payment", "subscribe", "subscription"];
    return {
      url,
      loggedIn: dashboardUrl || (!loginUrl && !hasLoginForm && hasCoachNav),
      needsHumanStep: blockedWords.some((word) => text.includes(word))
    };
  }).catch(() => ({
    url: page.url(),
    loggedIn: /kahunas[.]io\/(dashboard|coach\/|profile\/settings)/i.test(page.url()),
    needsHumanStep: false
  }));
}

async function extractLivePackage(page) {
  progress("Exporting coach profile.");
  const profile = await extractCoachProfile(page);
  progress("Exporting coach settings.");
  const settings = await extractCoachSettings(page);
  const { clients, clientDetails } = await extractClients(page);
  const assignmentInfo = await extractClientAssignmentInfo(page, clientDetails);
  const { checkIns, checkInDetails } = await extractCheckIns(page, clients);
  const { formTemplates, formSubmissions } = await extractCheckInFormSubmissions(page, checkInDetails);
  const { formTemplates: intakeTemplates, formSubmissions: intakeSubmissions } = await extractIntakeFormSubmissions(page, clientDetails);
  const allFormTemplates = [...intakeTemplates, ...formTemplates];
  const allFormSubmissions = [...intakeSubmissions, ...formSubmissions];
  for (const checkIn of checkIns) {
    const submission = formSubmissions.find((candidate) => candidate.check_in_id === checkIn.id);
    if (submission) {
      checkIn.form_submission_id = submission.id;
      delete submission.check_in_id;
    }
  }
  const { mealPlans, mealPlanIdByName } = await extractMealPlans(page, assignmentInfo.mealPlanRefs);
  const { workoutPlans, workoutSessions, workoutSessionExercises, workoutPlanIdByName } = await extractWorkoutPlans(page, assignmentInfo.workoutPlanRefs);
  const clientAssignments = buildClientAssignments({
    assignmentInfo,
    mealPlanIdByName,
    workoutPlanIdByName,
    checkInFormTemplateId: formTemplates[0]?.id
  });
  const counts = {
    coach_profiles: 1,
    coach_settings: 1,
    clients: clients.length,
    client_assignments: clientAssignments.length,
    form_templates: allFormTemplates.length,
    form_submissions: allFormSubmissions.length,
    check_ins: checkIns.length,
    workout_plans: workoutPlans.length,
    workout_sessions: workoutSessions.length,
    workout_session_exercises: workoutSessionExercises.length,
    meal_plans: mealPlans.length
  };

  return {
    manifest: {
      schema_name: "open-coaching-data",
      schema_version: "1.0.0",
      package_id: `package_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_kahunas_live`,
      created_at: new Date().toISOString(),
      created_by_tool: {
        name: "assistantcoach-kahunas-codex-skill-exporter",
        version: "0.1.0"
      },
      source_platform: {
        name: "Kahunas"
      },
      coach_identity: {
        display_name: profile.display_name,
        email: profile.email
      },
      included_domains: ["coach", "clients", "forms", "check_ins", "nutrition", "training"],
      record_counts: counts,
      warnings: [
        {
          code: "media_not_included",
          severity: "info",
          message: "Photos and videos are not included in this version of the coaching data export."
        }
      ],
      validation_status: "pending"
    },
    coach: {
      profile,
      settings
    },
    clients: {
      clients,
      client_assignments: clientAssignments
    },
    forms: {
      form_templates: allFormTemplates,
      form_submissions: allFormSubmissions
    },
    check_ins: checkIns,
    nutrition: {
      meal_plans: mealPlans
    },
    training: {
      workout_plans: workoutPlans,
      workout_sessions: workoutSessions,
      workout_session_exercises: workoutSessionExercises
    }
  };
}

async function extractCoachProfile(page) {
  await page.goto("https://kahunas.io/profile/settings", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1000);
  const data = await page.evaluate(() => {
    const value = (selector) => document.querySelector(selector)?.value?.trim() || "";
    const selected = (selector) => Array.from(document.querySelector(selector)?.selectedOptions || []).map((option) => option.textContent.trim()).filter(Boolean);
    return {
      first_name: value('input[name="first_name"]'),
      last_name: value('input[name="last_name"]'),
      username: value('input[name="username"]'),
      email: value('input[name="email"]'),
      phone: value('input[name="phone"]'),
      web_address: value('input[name="web_address"]'),
      facebook: value('input[name="social_profile[facebook]"]'),
      instagram: value('input[name="social_profile[instagram]"]'),
      bio: document.querySelector('textarea[name="about_text"]')?.value?.trim() || "",
      services: selected('select[name="services[]"]'),
      target_customers: selected('select[name="target_cutomers[]"]')
    };
  });
  const displayName = [data.first_name, data.last_name].filter(Boolean).join(" ") || data.username || data.email || "Kahunas Coach";
  const socialLinks = [];
  if (data.facebook) {
    socialLinks.push({ platform: "facebook", url: data.facebook });
  }
  if (data.instagram) {
    socialLinks.push({ platform: "instagram", url: data.instagram });
  }
  if (data.web_address) {
    socialLinks.push({ platform: "website", url: data.web_address });
  }
  return {
    id: "coach_001",
    display_name: displayName,
    email: data.email || undefined,
    phone: data.phone || undefined,
    timezone: undefined,
    bio: data.bio || undefined,
    specialties: [...data.services, ...data.target_customers].filter(Boolean),
    social_links: socialLinks
  };
}

async function extractCoachSettings(page) {
  await page.goto("https://kahunas.io/coach/configuration", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1500);
  return await page.evaluate(() => {
    const value = (selector) => document.querySelector(selector)?.value || "";
    const checked = (selector) => Boolean(document.querySelector(selector)?.checked);
    const unitMap = {
      kg: "kg",
      lbs: "lb",
      lb: "lb",
      inches: "in",
      cm: "cm",
      g: "g",
      oz: "oz",
      l: "l",
      ml: "ml"
    };
    const normalize = (raw) => unitMap[String(raw || "").toLowerCase()] || raw || undefined;
    return {
      id: "coach_settings_001",
      timezone: value('select[name="timzone"]') || undefined,
      units: {
        weight: normalize(value('select[name="defaultWeight"]')),
        height: normalize(value('select[name="defaultHeight"]')),
        body_measurements: normalize(value('select[name="defaultHeight"]')),
        food_weight: normalize(value('select[name="defaultFood"]')),
        water: normalize(value('select[name="water_tracker_unit"]'))
      },
      brand: {
        primary_color: value('input[name="brand_color"]') || undefined
      }
    };
  });
}

async function extractClients(page) {
  progress("Exporting clients.");
  await page.goto("https://kahunas.io/coach/clients", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  const rows = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("table tr"))
      .map((tr) => {
        const textLines = tr.innerText.split("\n").map((line) => line.trim()).filter(Boolean);
        const viewLink = Array.from(tr.querySelectorAll('a[href*="/coach/clients/view/"]'))[0];
        const editLink = Array.from(tr.querySelectorAll('a[href*="/coach/clients/edit/"]'))[0];
        return {
          textLines,
          view_href: viewLink?.href || "",
          edit_href: editLink?.href || ""
        };
      })
      .filter((row) => row.view_href && row.textLines.length >= 6);
  });

  const clientDetails = [];
  const clients = rows.map((row, index) => {
    const emailIndex = row.textLines.findIndex((line) => line.includes("@"));
    const displayName = emailIndex > 0 ? row.textLines[emailIndex - 1] : row.textLines[1] || `Client ${index + 1}`;
    const email = emailIndex >= 0 ? row.textLines[emailIndex] : undefined;
    const checkInDay = emailIndex >= 0 ? row.textLines[emailIndex + 3] : undefined;
    const status = row.textLines.includes("Active") ? "active" : "inactive";
    const client = {
      id: `client_${String(index + 1).padStart(3, "0")}`,
      display_name: displayName,
      email,
      status,
      check_in_day: normalizeDay(checkInDay)
    };
    clientDetails.push({
      id: client.id,
      display_name: displayName,
      email,
      view_href: row.view_href,
      edit_href: row.edit_href
    });
    return client;
  });
  progress(`Found ${clients.length} clients.`);
  return { clients, clientDetails };
}

function normalizeDay(value) {
  const day = String(value || "").toLowerCase();
  const match = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].find((candidate) => day.startsWith(candidate.slice(0, 3)) || day === candidate);
  return match || undefined;
}

async function extractCheckIns(page, clients) {
  progress("Exporting check-ins.");
  await page.goto("https://kahunas.io/coach/clients/all-checkins", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  const clientByEmail = new Map(clients.map((client) => [String(client.email || "").toLowerCase(), client]));
  const rows = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("table tr"))
      .map((tr) => {
        const textLines = tr.innerText.split("\n").map((line) => line.trim()).filter(Boolean);
        const viewLink = Array.from(tr.querySelectorAll('a[href*="/client/checkin/view/"]'))[0];
        return {
          textLines,
          view_href: viewLink?.href || ""
        };
      })
      .filter((row) => row.view_href && row.textLines.some((line) => line.includes("@")));
  });

  const details = [];
  const checkIns = rows.map((row, index) => {
    const emailIndex = row.textLines.findIndex((line) => line.includes("@"));
    const email = emailIndex >= 0 ? row.textLines[emailIndex] : "";
    const client = clientByEmail.get(email.toLowerCase());
    const checkedInLabel = emailIndex >= 0 ? row.textLines[emailIndex + 1] : "";
    const checkIn = {
      id: `checkin_${String(index + 1).padStart(3, "0")}`,
      client_id: client?.id,
      form_submission_id: undefined,
      check_in_number: undefined,
      checked_in_at: parseKahunasDateTime(checkedInLabel)
    };
    if (checkIn.client_id && checkIn.checked_in_at) {
      details.push({
        check_in_id: checkIn.id,
        client_id: checkIn.client_id,
        href: row.view_href,
        submitted_at: checkIn.checked_in_at
      });
      return checkIn;
    }
    return null;
  }).filter(Boolean);
  progress(`Found ${checkIns.length} check-ins.`);
  return { checkIns, checkInDetails: details };
}

async function extractClientAssignmentInfo(page, clientDetails) {
  progress("Checking which plans and forms are assigned to each client.");
  const assignments = [];
  const mealPlanRefs = [];
  const workoutPlanRefs = [];

  for (const detail of clientDetails.filter((client) => client.edit_href)) {
    progress(`Checking assignments for ${detail.display_name || detail.email || "one client"}.`);
    await page.goto(detail.edit_href, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1200);
    const extracted = await page.evaluate(() => {
      const selected = (name) => {
        const element = document.querySelector(`select[name="${name}"]`);
        if (!element) {
          return undefined;
        }
        const text = Array.from(element.selectedOptions || [])
          .map((option) => option.textContent.trim())
          .filter(Boolean)
          .join(", ");
        return {
          value: element.value || "",
          text
        };
      };
      const selectedMany = (name) => Array.from(document.querySelectorAll(`select[name="${name}"] option:checked`))
        .map((option) => ({
          value: option.value || "",
          text: option.textContent.trim()
        }))
        .filter((option) => option.value && option.text && option.text.toLowerCase() !== "none");

      return {
        diet_plan: selected("diet_plan"),
        workout_plans: selectedMany("workout_plan[]"),
        check_in_form: selected("check_in_form"),
        check_in_frequency: selected("check_in_frequency"),
        check_in_days: Array.from(document.querySelectorAll('input[name="check_in_day[]"]:checked')).map((input) => input.value),
        questionnaire_form: selected("questionnaire_form")
      };
    });

    const mealPlan = usableSelection(extracted.diet_plan);
    if (mealPlan) {
      mealPlanRefs.push(mealPlan);
    }
    for (const workoutPlan of extracted.workout_plans || []) {
      const usable = usableSelection(workoutPlan);
      if (usable) {
        workoutPlanRefs.push(usable);
      }
    }
    assignments.push({
      client_id: detail.id,
      check_in_form: usableSelection(extracted.check_in_form),
      check_in_frequency: normalizeFrequency(extracted.check_in_frequency?.text),
      check_in_day: normalizeDay((extracted.check_in_days || [])[0]),
      meal_plan: mealPlan,
      workout_plans: (extracted.workout_plans || []).map(usableSelection).filter(Boolean),
      questionnaire_form: usableSelection(extracted.questionnaire_form)
    });
  }

  progress(`Found assigned meal plans and workout plans for ${assignments.length} clients.`);
  return {
    assignments,
    mealPlanRefs: uniqueRefs(mealPlanRefs),
    workoutPlanRefs: uniqueRefs(workoutPlanRefs)
  };
}

function buildClientAssignments({ assignmentInfo, mealPlanIdByName, workoutPlanIdByName, checkInFormTemplateId }) {
  const result = [];
  const counters = {
    check_in_form: 0,
    meal_plan: 0,
    workout_plan: 0
  };

  for (const assignment of assignmentInfo.assignments) {
    if (checkInFormTemplateId && assignment.check_in_form) {
      counters.check_in_form += 1;
      result.push(compactObject({
        id: `assignment_checkin_${String(counters.check_in_form).padStart(3, "0")}`,
        client_id: assignment.client_id,
        assignment_type: "check_in_form",
        assigned_record_id: checkInFormTemplateId,
        status: "active",
        frequency: assignment.check_in_frequency || "unknown",
        day_of_week: assignment.check_in_day
      }));
    }

    const mealPlanId = mealPlanIdByName.get(normalizeNameKey(assignment.meal_plan?.text));
    if (mealPlanId) {
      counters.meal_plan += 1;
      result.push({
        id: `assignment_meal_${String(counters.meal_plan).padStart(3, "0")}`,
        client_id: assignment.client_id,
        assignment_type: "meal_plan",
        assigned_record_id: mealPlanId,
        status: "active"
      });
    }

    for (const workoutPlan of assignment.workout_plans || []) {
      const workoutPlanId = workoutPlanIdByName.get(normalizeNameKey(workoutPlan.text));
      if (!workoutPlanId) {
        continue;
      }
      counters.workout_plan += 1;
      result.push({
        id: `assignment_workout_${String(counters.workout_plan).padStart(3, "0")}`,
        client_id: assignment.client_id,
        assignment_type: "workout_plan",
        assigned_record_id: workoutPlanId,
        status: "active"
      });
    }
  }

  return result;
}

function usableSelection(selection) {
  if (!selection?.value || !selection?.text || selection.text.toLowerCase() === "none") {
    return undefined;
  }
  return {
    value: selection.value,
    text: selection.text
  };
}

function uniqueRefs(refs) {
  const seen = new Set();
  return refs.filter((ref) => {
    const key = normalizeNameKey(ref.text || ref.value);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function parseKahunasDateTime(value) {
  const cleaned = String(value || "")
    .replace(/Late Check-in/gi, "")
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return undefined;
  }
  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

async function extractCheckInFormSubmissions(page, checkInDetails) {
  progress("Exporting check-in answers.");
  const submissions = [];
  const fieldByLabel = new Map();
  const fields = [];

  for (const detail of checkInDetails) {
    progress(`Exporting one check-in from ${formatDateForProgress(detail.submitted_at)}.`);
    await page.goto(detail.href, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    const extracted = await page.evaluate(() => {
      const body = document.body.innerText;
      const submittedMatch = body.match(/Submitted on:\s*([^\n]+)/i);
      const answers = [];
      const seen = new Set();
      for (const tr of Array.from(document.querySelectorAll("table tr"))) {
        const parts = tr.innerText.split(/\t|\n/).map((part) => part.trim()).filter(Boolean);
        if (parts.length < 2) {
          continue;
        }
        const label = parts[0].replace(/\s+/g, " ").trim();
        const value = parts.slice(1).join(" ").replace(/\s+/g, " ").trim();
        if (!label || seen.has(label)) {
          continue;
        }
        if (["Start", "End", "Average", "Current"].includes(label)) {
          continue;
        }
        seen.add(label);
        answers.push({ label, value });
      }
      return {
        submitted_label: submittedMatch?.[1]?.trim() || "",
        answers
      };
    });

    if (!extracted.answers.length) {
      continue;
    }

    for (const answer of extracted.answers) {
      if (!fieldByLabel.has(answer.label)) {
        const id = `field_checkin_${String(fields.length + 1).padStart(3, "0")}`;
        fieldByLabel.set(answer.label, id);
        fields.push({
          id,
          label: answer.label,
          field_type: inferFieldType(answer.label, answer.value),
          required: false,
          order: fields.length + 1
        });
      }
    }

    submissions.push({
      id: `submission_checkin_${String(submissions.length + 1).padStart(3, "0")}`,
      check_in_id: detail.check_in_id,
      client_id: detail.client_id,
      form_template_id: "form_checkin_001",
      submitted_at: parseSubmittedLabel(extracted.submitted_label) || detail.submitted_at,
      answers: extracted.answers.map((answer) => ({
        field_id: fieldByLabel.get(answer.label),
        label: answer.label,
        value: normalizeAnswerValue(answer.value)
      }))
    });
  }

  const formTemplates = fields.length
    ? [{
        id: "form_checkin_001",
        name: "Check-in Form",
        form_type: "check_in",
        description: "Check-in form reconstructed from submitted check-ins.",
        fields
      }]
    : [];

  progress(`Exported ${submissions.length} check-in form submissions.`);
  return { formTemplates, formSubmissions: submissions };
}

function inferFieldType(label, value) {
  if (/\?/.test(label)) {
    return "text";
  }
  if (value !== "" && !Number.isNaN(Number(value))) {
    return "number";
  }
  return "textarea";
}

function normalizeAnswerValue(value) {
  if (value === "") {
    return "";
  }
  const asNumber = Number(value);
  return Number.isNaN(asNumber) ? value : asNumber;
}

function parseSubmittedLabel(value) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  const withoutWeekday = cleaned.replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+/i, "");
  return parseKahunasDateTime(withoutWeekday);
}

async function extractIntakeFormSubmissions(page, clientDetails) {
  progress("Exporting client intake forms.");
  const submissions = [];
  const fieldByLabel = new Map();
  const fields = [];

  for (const detail of clientDetails.filter((client) => client.view_href)) {
    progress(`Exporting intake form for ${detail.display_name || detail.email || "one client"}.`);
    await page.goto(detail.view_href, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500);
    const activitySubmittedLabel = await page.evaluate(() => {
      const body = document.body.innerText;
      return body.match(/Initial Q&A completed\s+([^\n]+)/i)?.[1]?.trim() || "";
    });
    await page.getByText("Q&A", { exact: true }).click().catch(() => {});
    await page.waitForTimeout(2000);
    const extracted = await page.evaluate((fallbackSubmittedLabel) => {
      const body = document.body.innerText;
      const completedMatch = body.match(/Initial Q&A completed\s+([^\n]+)/i);
      const answers = [];
      const seen = new Set();
      for (const tr of Array.from(document.querySelectorAll("table tr"))) {
        const cells = Array.from(tr.children)
          .map((cell) => cell.innerText.replace(/\s+/g, " ").trim())
          .filter(Boolean);
        if (cells.length < 2 || !cells[0].includes("?")) {
          continue;
        }
        const label = cells[0];
        const value = cells.slice(1).join(" ").trim();
        if (!label || !value || seen.has(label)) {
          continue;
        }
        seen.add(label);
        answers.push({ label, value });
      }
      return {
        submitted_label: completedMatch?.[1]?.trim() || fallbackSubmittedLabel || "",
        answers
      };
    }, activitySubmittedLabel);

    if (!extracted.answers.length) {
      continue;
    }

    for (const answer of extracted.answers) {
      if (!fieldByLabel.has(answer.label)) {
        const id = `field_intake_${String(fields.length + 1).padStart(3, "0")}`;
        fieldByLabel.set(answer.label, id);
        fields.push({
          id,
          label: answer.label,
          field_type: "textarea",
          required: false,
          order: fields.length + 1
        });
      }
    }

    submissions.push({
      id: `submission_intake_${String(submissions.length + 1).padStart(3, "0")}`,
      client_id: detail.id,
      form_template_id: "form_intake_001",
      submitted_at: parseSubmittedLabel(extracted.submitted_label) || new Date().toISOString(),
      answers: extracted.answers.map((answer) => ({
        field_id: fieldByLabel.get(answer.label),
        label: answer.label,
        value: answer.value
      }))
    });
  }

  const formTemplates = fields.length
    ? [{
        id: "form_intake_001",
        name: "Initial Q&A",
        form_type: "intake",
        description: "Initial questionnaire reconstructed from completed client Q&A responses.",
        fields
      }]
    : [];

  progress(`Exported ${submissions.length} intake form submissions.`);
  return { formTemplates, formSubmissions: submissions };
}

async function extractMealPlans(page, mealPlanRefs) {
  if (!mealPlanRefs.length) {
    progress("No assigned meal plans found to export.");
    return { mealPlans: [], mealPlanIdByName: new Map() };
  }

  progress(`Exporting ${mealPlanRefs.length} assigned meal plans.`);
  await page.goto("https://kahunas.io/coach/diet_plans", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll("table tr"))
    .map((tr) => {
      const lines = tr.innerText.split("\n").map((line) => line.trim()).filter(Boolean);
      const preview = tr.querySelector('a[href*="/coach/diet_plans/preview/"]');
      return {
        title: preview?.innerText?.trim() || lines[0] || "",
        preview_href: preview?.href || "",
        lines
      };
    })
    .filter((row) => row.title && row.preview_href));

  const rowByName = new Map(rows.map((row) => [normalizeNameKey(row.title), row]));
  const mealPlans = [];
  const mealPlanIdByName = new Map();

  for (const ref of mealPlanRefs) {
    progress(`Exporting meal plan: ${ref.text}.`);
    const row = rowByName.get(normalizeNameKey(ref.text));
    if (!row) {
      continue;
    }
    const id = `mealplan_${String(mealPlans.length + 1).padStart(3, "0")}`;
    const targets = parseNutritionTargets(row.lines.join("\n"));
    if (!Object.keys(targets).length) {
      continue;
    }
    const status = row.lines.some((line) => /^active$/i.test(line)) ? "active" : "unknown";
    mealPlanIdByName.set(normalizeNameKey(ref.text), id);
    mealPlans.push({
      id,
      name: row.title,
      status,
      targets
    });
  }

  progress(`Exported ${mealPlans.length} meal plans.`);
  return { mealPlans, mealPlanIdByName };
}

async function extractWorkoutPlans(page, workoutPlanRefs) {
  if (!workoutPlanRefs.length) {
    progress("No assigned workout plans found to export.");
    return {
      workoutPlans: [],
      workoutSessions: [],
      workoutSessionExercises: [],
      workoutPlanIdByName: new Map()
    };
  }

  progress(`Exporting ${workoutPlanRefs.length} assigned workout plans.`);
  await page.goto("https://kahunas.io/coach/workout_programs", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll("table tr"))
    .map((tr) => {
      const lines = tr.innerText.split("\n").map((line) => line.trim()).filter(Boolean);
      const preview = tr.querySelector('a[href*="/coach/workout_programs/preview/"]');
      return {
        title: preview?.innerText?.trim() || lines[0] || "",
        preview_href: preview?.href || "",
        lines
      };
    })
    .filter((row) => row.title && row.preview_href));

  const rowByName = new Map(rows.map((row) => [normalizeNameKey(row.title), row]));
  const workoutPlans = [];
  const workoutSessions = [];
  const workoutSessionExercises = [];
  const workoutPlanIdByName = new Map();

  for (const ref of workoutPlanRefs) {
    progress(`Exporting workout plan: ${ref.text}.`);
    const row = rowByName.get(normalizeNameKey(ref.text));
    if (!row) {
      continue;
    }
    const planId = `workoutplan_${String(workoutPlans.length + 1).padStart(3, "0")}`;
    await page.goto(row.preview_href, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);
    const parsed = await page.evaluate((planName) => {
      const lines = document.body.innerText.split("\n").map((line) => line.trim()).filter(Boolean);
      const start = lines.findIndex((line) => line === planName);
      const scoped = start >= 0 ? lines.slice(start) : lines;
      return {
        lines: scoped
      };
    }, row.title);
    const preview = parseWorkoutPreview(row.title, parsed.lines);
    progress(`Found ${preview.sessions.length} workout sessions in ${row.title}.`);
    workoutPlanIdByName.set(normalizeNameKey(ref.text), planId);
    workoutPlans.push(compactObject({
      id: planId,
      name: row.title,
      description: preview.description,
      notes: preview.plan_notes
    }));

    for (const session of preview.sessions) {
      const sessionId = `session_${String(workoutSessions.length + 1).padStart(3, "0")}`;
      workoutSessions.push(compactObject({
        id: sessionId,
        workout_plan_id: planId,
        name: session.name,
        day_index: session.day_index,
        order: session.order,
        notes: session.notes
      }));

      for (const exercise of session.exercises) {
        progress(`Exporting exercise: ${exercise.name}.`);
        workoutSessionExercises.push(compactObject({
          id: `session_exercise_${String(workoutSessionExercises.length + 1).padStart(3, "0")}`,
          workout_session_id: sessionId,
          order: exercise.order,
          section: "main",
          prescription: exercise.prescription,
          exercise: {
            name: exercise.name,
            exercise_type: inferExerciseType(exercise.name)
          },
          notes: exercise.notes
        }));
      }
    }
  }

  progress(`Exported ${workoutPlans.length} workout plans.`);
  return { workoutPlans, workoutSessions, workoutSessionExercises, workoutPlanIdByName };
}

function formatDateForProgress(value) {
  if (!value) {
    return "Kahunas";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Kahunas";
  }
  return parsed.toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });
}

function parseNutritionTargets(text) {
  return compactObject({
    protein_g: numberFromMatch(text.match(/(\d+(?:\.\d+)?)\s*g\s+Protein/i)),
    carbohydrates_g: numberFromMatch(text.match(/(\d+(?:\.\d+)?)\s*g\s+Carbs/i)),
    fat_g: numberFromMatch(text.match(/(\d+(?:\.\d+)?)\s*g\s+Fat/i)),
    calories_kcal: numberFromMatch(text.match(/(\d+(?:\.\d+)?)\s*Kcal/i))
  });
}

function parseWorkoutPreview(planName, lines) {
  const sessions = [];
  const planIndex = lines.findIndex((line) => line === planName);
  const overviewIndex = lines.findIndex((line) => line === "Program Overview");
  const description = overviewIndex >= 0 ? lines[overviewIndex + 1] : undefined;
  let index = Math.max(overviewIndex + 2, planIndex + 1, 0);
  let order = 0;

  while (index < lines.length) {
    if (lines[index + 1] !== "Workout") {
      index += 1;
      continue;
    }
    order += 1;
    const session = {
      name: lines[index],
      day_index: order,
      order,
      notes: undefined,
      exercises: []
    };
    index += 2;
    let exerciseOrder = 0;
    while (index < lines.length) {
      if (lines[index + 1] === "Workout") {
        break;
      }
      if (lines[index] === "Instructions") {
        session.notes = lines[index + 1];
        index += 2;
        continue;
      }
      if (isExerciseMarker(lines[index]) && lines[index + 1]) {
        exerciseOrder += 1;
        const exercise = {
          name: lines[index + 1],
          order: exerciseOrder,
          prescription: {},
          notes: undefined
        };
        index += 2;
        while (index < lines.length && !isExerciseMarker(lines[index]) && lines[index] !== "Instructions" && lines[index + 1] !== "Workout") {
          const line = lines[index];
          if (/^Sets:/i.test(line)) {
            exercise.prescription.sets = numberFromText(line);
          } else if (/^Reps:/i.test(line)) {
            exercise.prescription.reps = line.replace(/^Reps:\s*/i, "").trim();
          } else if (/^RIR:/i.test(line)) {
            const rir = numberFromText(line);
            if (rir !== undefined) {
              exercise.prescription.rir = rir;
            }
          } else if (/^RPE:/i.test(line)) {
            const rpe = numberFromText(line);
            if (rpe !== undefined) {
              exercise.prescription.rpe = rpe;
            }
          } else if (/^REST:/i.test(line)) {
            exercise.prescription.rest = parseDuration(line.replace(/^REST:\s*/i, ""));
          } else if (/^Notes:/i.test(line)) {
            exercise.notes = line.replace(/^Notes:\s*/i, "").trim();
          }
          index += 1;
        }
        session.exercises.push(exercise);
        continue;
      }
      index += 1;
    }
    sessions.push(session);
  }

  return {
    description,
    plan_notes: undefined,
    sessions
  };
}

function isExerciseMarker(value) {
  return /^[A-Z](?:\d+)?$/.test(String(value || "").trim());
}

function parseDuration(value) {
  const text = String(value || "");
  const minutes = numberFromMatch(text.match(/(\d+(?:\.\d+)?)\s*min/i)) || 0;
  const seconds = numberFromMatch(text.match(/(\d+(?:\.\d+)?)\s*sec/i)) || 0;
  if (minutes && seconds) {
    return { value: minutes * 60 + seconds, unit: "seconds", original: { value: text.trim() } };
  }
  if (minutes) {
    return { value: minutes, unit: "minutes", original: { value: text.trim() } };
  }
  if (seconds) {
    return { value: seconds, unit: "seconds", original: { value: text.trim() } };
  }
  return undefined;
}

function inferExerciseType(name) {
  const lower = String(name || "").toLowerCase();
  if (/\brun\b|cardio|zone 2|bike|row|walk/.test(lower)) {
    return "cardio";
  }
  if (/stretch|mobility|dead bug|breathing/.test(lower)) {
    return "mobility";
  }
  return "strength";
}

function normalizeFrequency(value) {
  const lower = String(value || "").toLowerCase();
  if (lower.includes("week")) {
    return "weekly";
  }
  if (lower.includes("day")) {
    return "daily";
  }
  if (lower.includes("month")) {
    return "monthly";
  }
  if (lower.includes("once")) {
    return "once";
  }
  return undefined;
}

function normalizeNameKey(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function numberFromMatch(match) {
  if (!match?.[1]) {
    return undefined;
  }
  const value = Number(match[1]);
  return Number.isNaN(value) ? undefined : value;
}

function numberFromText(value) {
  return numberFromMatch(String(value || "").match(/(\d+(?:\.\d+)?)/));
}

function compactObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== ""));
}

let result;
try {
  result = args.fixture || !args["cdp-url"] ? await packageFromFixture() : await packageFromLiveBrowser();
} catch (error) {
  const failedLog = error.runLog || {
    mode: args["cdp-url"] ? "live" : "fixture",
    started_at: new Date().toISOString(),
    error: error.message
  };
  writeJson(join(runDir, "run-log.json"), failedLog);
  console.error(error.message);
  process.exit(20);
}

const pkg = result.pkg;
const errors = validatePackageShape(pkg);
if (errors.length) {
  const runLog = {
    ...result.runLog,
    completed_at: new Date().toISOString(),
    validation_errors: errors
  };
  writeJson(join(runDir, "run-log.json"), runLog);
  console.error(`Package validation failed before writing export: ${errors.join("; ")}`);
  process.exit(10);
}

pkg.manifest.validation_status = "valid";
const counts = countRecords(pkg);
pkg.manifest.record_counts = {
  ...(pkg.manifest.record_counts || {}),
  ...counts
};

const dataFile = packageFileName(pkg);
const dataPath = join(exportDir, dataFile);
const readmePath = join(exportDir, "README.md");
const summaryPath = join(exportDir, "export-summary.json");
const zipPath = join(runDir, zipFileName(pkg));

writeJson(dataPath, pkg);
writeCoachReadme(readmePath, counts, pkg.manifest.warnings || []);
writeJson(summaryPath, {
  source_platform: pkg.manifest.source_platform?.name || "Kahunas",
  created_at: pkg.manifest.created_at,
  counts,
  coach_confirmation_required: true,
  confirmation_required_until_coach_approves: true,
  pagination_verification_required: true,
  count_scope_note: "Meal and workout plan counts include client-assigned plans, not unassigned Kahunas library templates.",
  data_file: relativeForJson(dataPath),
  warnings: pkg.manifest.warnings || []
});
createZip(exportDir, zipPath);

let openedDataFile = false;
if (!args.fixture && args["cdp-url"] && process.env.AC_KAHUNAS_EXPORT_OPEN_JSON !== "0") {
  progress("Opening the exported coaching data file now.");
  openedDataFile = openFileWithDefaultApp(dataPath);
  if (!openedDataFile) {
    progress("I could not open the file automatically, but the export was still saved successfully.");
  }
}

const runLog = {
  ...result.runLog,
  completed_at: new Date().toISOString(),
  export_dir: exportDir,
  data_file: dataPath,
  zip_file: zipPath,
  counts
};
writeJson(join(runDir, "run-log.json"), runLog);

console.log(JSON.stringify({
  ok: true,
  run_dir: runDir,
  export_dir: exportDir,
  data_file: dataPath,
  zip_file: zipPath,
  opened_data_file: openedDataFile,
  counts,
  coach_confirmation_required: true,
  confirmation_required_until_coach_approves: true,
  pagination_verification_required: true,
  confirmation_question: "Do these numbers look right for your Kahunas account?"
}, null, 2));
