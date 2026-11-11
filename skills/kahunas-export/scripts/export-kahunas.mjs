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
import { installKahunasBridge } from "./kahunas-app-bridge.mjs";

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

// ---------------------------------------------------------------------------
// Live extraction for the current Kahunas web app (https://<workspace>.kahunas.app).
// See references/kahunas-api-map.md for how the app exposes its data.
// ---------------------------------------------------------------------------

const CLIENT_ROUTE = "/coach/people/clients/$clientId";
const LIST_PAGE_SIZE = 100;

async function packageFromLiveBrowser() {
  if (!args["cdp-url"]) {
    throw new Error("Live extraction requires --cdp-url or --fixture for local tests.");
  }

  let browser;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.connectOverCDP(args["cdp-url"]);
    const pages = browser.contexts().flatMap((context) => context.pages());
    const page = pages.find((candidate) => /kahunas\.(app|io)/.test(candidate.url())) || pages[0];
    if (!page) {
      throw new Error("Connected to the browser but found no open pages.");
    }

    await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
    const loginState = await waitForKahunasLogin(page);

    const kx = createBridge(page);
    const runLog = {
      mode: "live",
      started_at: new Date().toISOString(),
      cdp_url: args["cdp-url"],
      workspace_host: loginState.host,
      notes: [
        "Live extraction reads the Kahunas web app's own decoded query cache after in-app navigation.",
        "Paginated lists are walked page by page; per-list page evidence is under `pagination`.",
        "Workout and nutrition plans are exported through client assignments, so unassigned library templates are skipped."
      ],
      pagination: {},
      skipped: []
    };

    const extracted = await extractLivePackage(kx, runLog);
    return { pkg: extracted, runLog };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

function createBridge(page) {
  const ensure = async () => {
    await page.evaluate(installKahunasBridge);
  };
  const call = async (method, ...callArgs) => {
    await ensure();
    return await page.evaluate(([name, list]) => window.__kx[name](...list), [method, callArgs]);
  };
  return {
    visit: (to, params = {}, search = undefined) => call("visit", to, params, search),
    find: (pattern) => call("find", pattern),
    findOne: async (pattern) => (await call("find", pattern))[0]?.data,
    fetchAll: (pattern, pageSize = LIST_PAGE_SIZE) => call("fetchAll", pattern, pageSize),
    routeIds: () => call("routeIds")
  };
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

    if (attempt === 1 && state.url && !/kahunas\.(app|io)/.test(state.url)) {
      await page.goto("https://kahunas.io/login", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    }

    let helper = "Still waiting for Kahunas login in the browser.";
    if (state.clientArea) {
      helper = "This browser is logged into a Kahunas client account. Please log in with your coach account instead.";
    } else if (state.needsHumanStep) {
      helper = "Kahunas looks like it needs a quick step from you in the browser, such as a code, captcha, or security check.";
    }
    console.log(`${helper} I will check again in 30 seconds.`);
    await page.waitForTimeout(intervalMs);
  }

  throw new Error("I could not confirm Kahunas login within 30 minutes. Please keep the browser window open and try the export again. If Kahunas is asking for a code, captcha, or payment/security step, complete that in the browser first.");
}

async function getKahunasLoginState(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
  return await page.evaluate(() => {
    const text = document.body?.innerText?.toLowerCase() || "";
    const onApp = /\.kahunas\.app$/i.test(location.host);
    const hasRouter = Boolean(window.__TSR_ROUTER__?.options?.context?.queryClient);
    const blockedWords = ["captcha", "verification code", "security check", "payment", "subscribe", "subscription"];
    return {
      url: location.href,
      host: location.host,
      loggedIn: onApp && hasRouter && location.pathname.startsWith("/coach"),
      clientArea: onApp && location.pathname.startsWith("/client"),
      needsHumanStep: blockedWords.some((word) => text.includes(word))
    };
  }).catch(() => ({ url: page.url(), host: "", loggedIn: false, clientArea: false, needsHumanStep: false }));
}

async function extractLivePackage(kx, runLog) {
  progress("Exporting coach profile.");
  await kx.visit("/coach/settings");
  const routeContext = await kx.findOne(["coach-route-context", "context"]);
  const settingsDetail = await kx.findOne(["settings", "detail"]);
  const profile = mapCoachProfile(routeContext);
  progress("Exporting coach settings.");
  const settings = mapCoachSettings(settingsDetail, routeContext);

  progress("Exporting form templates.");
  const { formTemplates, formTemplateBySourceId } = await extractFormTemplates(kx, runLog);

  const clientRows = await extractClientRows(kx, runLog);
  const clients = [];
  const clientAssignments = [];
  const checkIns = [];
  const formSubmissions = [];
  const workoutPlans = new Map();
  const mealPlans = new Map();
  const reconstructed = createReconstructedTemplates();

  for (const row of clientRows) {
    const clientId = sourceId("client", row.id);
    const label = row.name || row.email || "one client";
    progress(`Exporting ${label}.`);

    const visit = await kx.visit(CLIENT_ROUTE, { clientId: row.id });
    const detail = await kx.findOne(["clients", "detail", row.id, "deleted-inclusive"]);
    let workoutData = await kx.findOne(["clients", "detail", row.id, "workout-plans", "active"]);
    let mealData = await kx.findOne(["clients", "detail", row.id, "meal-plan", "active"]);
    if (!workoutData || !mealData) {
      await kx.visit(`${CLIENT_ROUTE}/plans`, { clientId: row.id });
      workoutData ||= await kx.findOne(["clients", "detail", row.id, "workout-plans", "active"]);
      mealData ||= await kx.findOne(["clients", "detail", row.id, "meal-plan", "active"]);
    } else {
      await kx.visit(`${CLIENT_ROUTE}/plans`, { clientId: row.id });
    }
    const assignedForms = await kx.findOne(["forms", "assigned", "client", row.id]);
    if (!visit.settled) {
      runLog.skipped.push({ area: "client_detail", client_id: clientId, reason: "page did not finish loading in time" });
    }

    clients.push(mapClient(row, detail?.summary));

    for (const plan of workoutData?.plans || []) {
      if (!workoutPlans.has(plan.id)) {
        progress(`Exporting workout plan: ${plan.title || "untitled"}.`);
        workoutPlans.set(plan.id, plan);
      }
      clientAssignments.push(compactObject({
        id: `assignment_workout_${clientAssignments.length + 1}`,
        client_id: clientId,
        assignment_type: "workout_plan",
        assigned_record_id: sourceId("workoutplan", plan.id),
        status: "active",
        starts_at: toIso(plan.assignedAt)
      }));
    }

    for (const plan of mealData?.plans || []) {
      if (!mealPlans.has(plan.id)) {
        progress(`Exporting meal plan: ${plan.title || "untitled"}.`);
        mealPlans.set(plan.id, plan);
      }
      clientAssignments.push(compactObject({
        id: `assignment_meal_${clientAssignments.length + 1}`,
        client_id: clientId,
        assignment_type: "meal_plan",
        assigned_record_id: sourceId("mealplan", plan.id),
        status: "active",
        starts_at: toIso(plan.assignedAt)
      }));
    }

    for (const assignment of mapFormAssignments(clientId, assignedForms, detail, formTemplateBySourceId, clientAssignments.length)) {
      clientAssignments.push(assignment);
    }

    const intake = await extractIntakeSubmissions(kx, row.id, clientId, formTemplateBySourceId, reconstructed, runLog);
    formSubmissions.push(...intake);

    const clientCheckIns = await extractClientCheckIns(kx, row, clientId, formTemplateBySourceId, reconstructed, runLog);
    for (const item of clientCheckIns) {
      checkIns.push(item.checkIn);
      if (item.submission) {
        formSubmissions.push(item.submission);
      }
    }
  }
  progress(`Exported ${clients.length} clients.`);

  progress("Preparing workout plans.");
  const training = mapWorkoutPlans([...workoutPlans.values()]);
  progress("Preparing meal plans.");
  const nutritionPlans = [...mealPlans.values()].map(mapMealPlan);

  const allFormTemplates = [...formTemplates, ...reconstructed.templates()];
  const counts = {
    coach_profiles: 1,
    coach_settings: 1,
    clients: clients.length,
    client_assignments: clientAssignments.length,
    form_templates: allFormTemplates.length,
    form_submissions: formSubmissions.length,
    check_ins: checkIns.length,
    workout_plans: training.workoutPlans.length,
    workout_sessions: training.workoutSessions.length,
    workout_session_exercises: training.workoutSessionExercises.length,
    meal_plans: nutritionPlans.length
  };

  const warnings = [
    {
      code: "media_not_included",
      severity: "info",
      message: "Photos and videos are not included in this version of the coaching data export."
    }
  ];
  if (runLog.skipped.length) {
    warnings.push({
      code: "partial_extraction",
      severity: "warning",
      message: `${runLog.skipped.length} item(s) could not be read completely from Kahunas. See the run log for details.`
    });
  }

  return {
    manifest: {
      schema_name: "open-coaching-data",
      schema_version: "1.0.0",
      package_id: `package_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_kahunas_live`,
      created_at: new Date().toISOString(),
      created_by_tool: {
        name: "assistantcoach-kahunas-codex-skill-exporter",
        version: "0.2.0"
      },
      source_platform: {
        name: "Kahunas",
        version: "kahunas.app"
      },
      coach_identity: compactObject({
        display_name: profile.display_name,
        email: profile.email
      }),
      included_domains: ["coach", "clients", "forms", "check_ins", "nutrition", "training"],
      record_counts: counts,
      warnings,
      validation_status: "not_validated"
    },
    coach: { profile, settings },
    clients: { clients, client_assignments: clientAssignments },
    forms: { form_templates: allFormTemplates, form_submissions: formSubmissions },
    check_ins: checkIns,
    nutrition: { meal_plans: nutritionPlans },
    training: {
      workout_plans: training.workoutPlans,
      workout_sessions: training.workoutSessions,
      workout_session_exercises: training.workoutSessionExercises
    }
  };
}

// ----- coach --------------------------------------------------------------

function mapCoachProfile(routeContext) {
  const user = routeContext?.user || {};
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Kahunas Coach";
  return compactObject({
    id: "coach_001",
    display_name: displayName,
    email: user.email || undefined,
    timezone: routeContext?.displayTimeZone || undefined,
    specialties: [],
    social_links: []
  });
}

function mapCoachSettings(settingsDetail, routeContext) {
  const general = settingsDetail?.general || {};
  const units = general.unitDefaults || {};
  const normalize = (raw) => {
    const value = String(raw || "").toLowerCase();
    const map = { kg: "kg", kgs: "kg", lb: "lb", lbs: "lb", cm: "cm", in: "in", inch: "in", inches: "in", g: "g", oz: "oz", ml: "ml", l: "l", floz: "fl_oz", fl_oz: "fl_oz" };
    return map[value] || raw || undefined;
  };
  return compactObject({
    id: "coach_settings_001",
    timezone: general.timezone || routeContext?.displayTimeZone || undefined,
    units: compactObject({
      weight: normalize(units.weightUnit),
      height: normalize(units.heightUnit),
      body_measurements: normalize(units.heightUnit),
      food_weight: normalize(units.foodUnit),
      water: normalize(units.waterUnit)
    })
  });
}

// ----- clients ------------------------------------------------------------

async function extractClientRows(kx, runLog) {
  progress("Exporting clients.");
  const rows = new Map();
  for (const segment of ["all", "archived"]) {
    const search = { page: 1, pageSize: LIST_PAGE_SIZE, segment, sort: "name_asc" };
    await kx.visit("/coach/people/clients", {}, search);
    const result = await kx.fetchAll(["clients", "list", { segment }]);
    runLog.pagination[`clients_${segment}`] = result.pages;
    for (const row of result.rows) {
      rows.set(row.id, row);
    }
    if (result.totalRows !== undefined && result.rows.length < result.totalRows) {
      runLog.skipped.push({ area: `clients_${segment}`, reason: `read ${result.rows.length} of ${result.totalRows} rows` });
    }
  }
  progress(`Found ${rows.size} clients.`);
  return [...rows.values()];
}

function mapClient(row, summary = {}) {
  const status = String(summary?.status || row.status || "").toLowerCase();
  const statusMap = { active: "active", archived: "archived", inactive: "inactive", paused: "inactive", invited: "prospect", pending: "prospect", lead: "prospect" };
  return compactObject({
    id: sourceId("client", row.id),
    display_name: row.name || summary?.name || [row.firstName, row.lastName].filter(Boolean).join(" ") || row.email || "Client",
    email: row.email || summary?.email || undefined,
    phone: summary?.phone || undefined,
    status: statusMap[status] || "unknown",
    date_of_birth: summary?.birthDate ? String(summary.birthDate).slice(0, 10) : undefined,
    gender: summary?.sex || undefined,
    joined_at: toIso(summary?.clientStartDate || summary?.clientSince || row.clientSince)
  });
}

function mapFormAssignments(clientId, assignedForms, detail, formTemplateBySourceId, offset) {
  const result = [];
  const items = Array.isArray(assignedForms) ? assignedForms : assignedForms?.items || assignedForms?.rows || [];
  const schedule = detail?.assignedCheckInSchedule;
  const candidates = [...items];
  if (schedule) {
    candidates.push({ ...schedule, __checkInSchedule: true });
  }
  for (const item of candidates) {
    const formSourceId = item.formId || item.form?.id || item.formTemplateId || (item.__checkInSchedule ? undefined : item.id);
    const template = formTemplateBySourceId.get(formSourceId);
    if (!template) {
      continue;
    }
    const isCheckIn = item.__checkInSchedule || template.form_type === "check_in";
    result.push(compactObject({
      id: `assignment_form_${offset + result.length + 1}`,
      client_id: clientId,
      assignment_type: isCheckIn ? "check_in_form" : template.form_type === "intake" ? "intake_form" : "form_template",
      assigned_record_id: template.id,
      status: "active",
      frequency: normalizeFrequency(item.cadence || item.frequency || item.recurrence) || (isCheckIn ? "unknown" : undefined),
      day_of_week: normalizeDay(item.dayOfWeek || item.weekday || (Array.isArray(item.days) ? item.days[0] : undefined))
    }));
  }
  return result;
}

// ----- forms --------------------------------------------------------------

async function extractFormTemplates(kx, runLog) {
  await kx.visit("/coach/builder/forms/");
  const result = await kx.fetchAll(["forms", "list"]);
  runLog.pagination.forms = result.pages;
  const formTemplates = [];
  const formTemplateBySourceId = new Map();
  for (const row of result.rows) {
    progress(`Exporting form: ${row.title || "untitled"}.`);
    await kx.visit("/coach/builder/forms/$formId", { formId: row.id });
    const detail = await kx.findOne(["forms", "detail", row.id]);
    const fields = (detail?.schema?.fields || [])
      .slice()
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((field, index) => compactObject({
        id: fieldId(row.id, field.key || field.id || String(index + 1)),
        label: field.label || field.key || `Question ${index + 1}`,
        field_type: mapFieldType(field.type) !== "unknown" ? mapFieldType(field.type) : mapFieldType(`${field.config?.profileField || ""} ${field.key || ""}`),
        required: Boolean(field.required),
        order: index + 1,
        options: optionLabels(field.options),
        source_label: field.key || undefined
      }));
    if (!detail) {
      runLog.skipped.push({ area: "form_template", form: row.title, reason: "form detail did not load" });
    }
    const template = compactObject({
      id: sourceId("form", row.id),
      name: row.title || detail?.title || "Untitled form",
      form_type: mapFormType(row.kind || detail?.kind),
      description: row.description || detail?.description || undefined,
      fields
    });
    template.__fieldsByKey = new Map((detail?.schema?.fields || []).map((field, index) => [field.key || field.id || String(index + 1), fieldId(row.id, field.key || field.id || String(index + 1))]));
    template.__fieldsByLabel = new Map(fields.map((field) => [normalizeNameKey(field.label), field.id]));
    formTemplates.push(template);
    formTemplateBySourceId.set(row.id, template);
  }
  progress(`Found ${formTemplates.length} form templates.`);
  return { formTemplates, formTemplateBySourceId };
}

function mapFormType(kind) {
  const value = String(kind || "").toLowerCase();
  if (/check.?in/.test(value)) {
    return "check_in";
  }
  if (/intake|onboard|initial|q.?a/.test(value)) {
    return "intake";
  }
  if (/questionnaire|survey|lead|habit/.test(value)) {
    return "questionnaire";
  }
  return "other";
}

function mapFieldType(type) {
  const value = String(type || "").toLowerCase();
  const rules = [
    [/section|heading|divider|statement|info/, "section"],
    [/multi|checkboxes/, "multiple_choice"],
    [/select|radio|choice|dropdown|single/, "single_choice"],
    [/rating|star/, "rating"],
    [/scale|slider|range/, "scale"],
    [/weight|measure|height|unit/, "measurement"],
    [/long|textarea|paragraph/, "textarea"],
    [/number|numeric|integer|decimal/, "number"],
    [/datetime|date/, "date"],
    [/time/, "time"],
    [/bool|yes.?no|toggle|checkbox/, "boolean"],
    [/text|short|email|phone|string/, "text"]
  ];
  for (const [pattern, mapped] of rules) {
    if (pattern.test(value)) {
      return mapped;
    }
  }
  return "unknown";
}

function optionLabels(options) {
  if (!Array.isArray(options) || !options.length) {
    return undefined;
  }
  return options.map((option) => String(option?.label ?? option?.value ?? option)).filter(Boolean);
}

function createReconstructedTemplates() {
  const byType = new Map();
  return {
    get(formType) {
      if (!byType.has(formType)) {
        const template = {
          id: `form_reconstructed_${formType}`,
          name: formType === "intake" ? "Initial Q&A" : "Check-in Form",
          form_type: formType,
          description: "Form reconstructed from submitted answers because its template was not in the forms builder.",
          fields: []
        };
        template.__fieldsByKey = new Map();
        template.__fieldsByLabel = new Map();
        byType.set(formType, template);
      }
      return byType.get(formType);
    },
    templates() {
      return [...byType.values()].filter((template) => template.fields.length);
    }
  };
}

function resolveTemplate(source, fallbackType, formTemplateBySourceId, reconstructed) {
  const formSourceId = source?.formId || source?.form?.id || source?.formTemplateId;
  if (formSourceId && formTemplateBySourceId.has(formSourceId)) {
    return formTemplateBySourceId.get(formSourceId);
  }
  const title = normalizeNameKey(source?.formTitle || source?.form?.title);
  if (title) {
    const byTitle = [...formTemplateBySourceId.values()].find((template) => normalizeNameKey(template.name) === title);
    if (byTitle) {
      return byTitle;
    }
  }
  return reconstructed.get(fallbackType);
}

function buildAnswers(rawAnswers, template) {
  return rawAnswers.map((answer) => {
    let id = (answer.key && template.__fieldsByKey.get(answer.key)) || template.__fieldsByLabel.get(normalizeNameKey(answer.label));
    if (!id) {
      id = `${template.id.replace(/^form_/, "field_")}_${template.fields.length + 1}`;
      template.fields.push({
        id,
        label: answer.label || answer.key || `Question ${template.fields.length + 1}`,
        field_type: typeof answer.value === "number" ? "number" : "textarea",
        required: false,
        order: template.fields.length + 1
      });
      if (answer.key) {
        template.__fieldsByKey.set(answer.key, id);
      }
      template.__fieldsByLabel.set(normalizeNameKey(answer.label), id);
    }
    return compactObject({
      field_id: id,
      label: answer.label || undefined,
      value: answer.value
    });
  });
}

// Finds the most likely list of question/answer pairs anywhere inside `data`.
function findAnswerList(data) {
  const questionKeys = ["label", "question", "questionLabel", "questionText", "prompt", "fieldLabel", "title"];
  const answerKeys = ["value", "answer", "response", "displayValue", "answerText", "formattedValue", "values", "text"];
  let best = [];
  const seen = new Set();
  const walk = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 12 || seen.has(node)) {
      return;
    }
    seen.add(node);
    if (Array.isArray(node)) {
      const pairs = node
        .filter((item) => item && typeof item === "object" && !Array.isArray(item))
        .map((item) => {
          const questionKey = questionKeys.find((key) => typeof item[key] === "string" && item[key].trim());
          const answerKey = answerKeys.find((key) => key in item && key !== questionKey);
          if (!questionKey || !answerKey) {
            return null;
          }
          return {
            key: item.key || item.fieldKey || item.questionKey || item.fieldId || item.questionId || undefined,
            label: item[questionKey].trim(),
            value: normalizeAnswer(item[answerKey])
          };
        })
        .filter(Boolean);
      if (pairs.length > best.length) {
        best = pairs;
      }
    }
    for (const child of Object.values(node)) {
      walk(child, depth + 1);
    }
  };
  walk(data, 0);
  return best.filter((pair) => pair.value !== undefined && pair.value !== null && pair.value !== "");
}

function normalizeAnswer(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return normalizeAnswerValue(value.trim());
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeAnswer(item)).filter((item) => item !== undefined && item !== null && item !== "").join(", ");
  }
  if (typeof value === "object") {
    for (const key of ["label", "value", "text", "displayValue", "formatted"]) {
      if (value[key] !== undefined && typeof value[key] !== "object") {
        return normalizeAnswer(value[key]);
      }
    }
    return JSON.stringify(value);
  }
  return String(value);
}

async function extractIntakeSubmissions(kx, clientSourceId, clientId, formTemplateBySourceId, reconstructed, runLog) {
  await kx.visit(`${CLIENT_ROUTE}/initial-qa`, { clientId: clientSourceId });
  const data = await kx.findOne(["clients", "detail", clientSourceId, "initial-qa", "submissions"]);
  const submissions = [];
  for (const submission of data?.submissions || []) {
    const rawAnswers = findAnswerList(submission);
    if (!rawAnswers.length) {
      runLog.skipped.push({ area: "intake_submission", client_id: clientId, reason: "no question/answer pairs found" });
      continue;
    }
    const template = resolveTemplate(submission, "intake", formTemplateBySourceId, reconstructed);
    submissions.push({
      id: sourceId("submission", submission.id || `${clientSourceId}_intake_${submissions.length + 1}`),
      client_id: clientId,
      form_template_id: template.id,
      submitted_at: toIso(submission.submittedAt || submission.completedAt || submission.createdAt) || new Date().toISOString(),
      answers: buildAnswers(rawAnswers, template)
    });
  }
  if (submissions.length) {
    progress(`Exported intake form answers (${submissions.length}).`);
  }
  return submissions;
}

// ----- check-ins ----------------------------------------------------------

async function extractClientCheckIns(kx, row, clientId, formTemplateBySourceId, reconstructed, runLog) {
  await kx.visit(`${CLIENT_ROUTE}/check-ins/`, { clientId: row.id });
  const history = await kx.fetchAll(["clients", "detail", row.id, "check-in-history"]);
  runLog.pagination[`check_ins_${clientId}`] = history.pages;
  const lifetime = (await kx.findOne(["clients", "detail", row.id, "check-in-history"]))?.lifetime;
  if (lifetime?.submittedCount !== undefined && history.rows.length < lifetime.submittedCount) {
    runLog.skipped.push({ area: "check_ins", client_id: clientId, reason: `read ${history.rows.length} of ${lifetime.submittedCount} check-ins` });
  }
  if (history.rows.length) {
    progress(`Exporting ${history.rows.length} check-ins for ${row.name || "this client"}.`);
  }

  const results = [];
  let number = 0;
  const ordered = history.rows.slice().sort((a, b) => String(checkInDate(a) || "").localeCompare(String(checkInDate(b) || "")));
  for (const checkInRow of ordered) {
    number += 1;
    const checkInSourceId = checkInRow.id || checkInRow.checkInId || checkInRow.submissionId;
    const checkedInAt = toIso(checkInDate(checkInRow));
    if (!checkInSourceId || !checkedInAt) {
      runLog.skipped.push({ area: "check_in", client_id: clientId, reason: "row without id or date" });
      continue;
    }
    const checkIn = {
      id: sourceId("checkin", checkInSourceId),
      client_id: clientId,
      check_in_number: number,
      checked_in_at: checkedInAt
    };

    const visit = await kx.visit(`${CLIENT_ROUTE}/check-ins/$checkInId`, { clientId: row.id, checkInId: checkInSourceId });
    const related = [
      ...visit.added.map((entry) => entry.data),
      ...(await kx.find(["clients", "detail", row.id])).filter((entry) => JSON.stringify(entry.key).includes(checkInSourceId)).map((entry) => entry.data)
    ];
    let rawAnswers = findAnswerList(related);
    if (!rawAnswers.length) {
      rawAnswers = findAnswerList(checkInRow);
    }
    let submission;
    if (rawAnswers.length) {
      const template = resolveTemplate(checkInRow, "check_in", formTemplateBySourceId, reconstructed);
      submission = {
        id: sourceId("submission", checkInSourceId),
        client_id: clientId,
        form_template_id: template.id,
        submitted_at: checkedInAt,
        answers: buildAnswers(rawAnswers, template)
      };
      checkIn.form_submission_id = submission.id;
    } else {
      runLog.skipped.push({ area: "check_in_answers", client_id: clientId, check_in_id: checkIn.id, reason: "no question/answer pairs found" });
    }
    results.push({ checkIn, submission });
  }
  return results;
}

function checkInDate(row) {
  return row.submittedAt || row.occurredAt || row.recordedAt || row.completedAt || row.createdAt || row.date;
}

// ----- training -----------------------------------------------------------

function mapWorkoutPlans(plans) {
  const workoutPlans = [];
  const workoutSessions = [];
  const workoutSessionExercises = [];

  for (const plan of plans) {
    const planId = sourceId("workoutplan", plan.id);
    workoutPlans.push(compactObject({
      id: planId,
      name: plan.title || "Untitled workout plan",
      description: plan.description || undefined,
      notes: typeof plan.simpleProgramBody === "string" ? plan.simpleProgramBody : undefined
    }));

    const days = (plan.days || []).slice().sort((a, b) => (a.weekPosition ?? 0) - (b.weekPosition ?? 0) || (a.position ?? 0) - (b.position ?? 0));
    let order = 0;
    for (const day of days) {
      if (day.isRestDay && !(day.blocks || []).length) {
        continue;
      }
      order += 1;
      const sessionId = sourceId("session", day.id);
      const weekPrefix = days.some((candidate) => (candidate.weekPosition ?? 0) > 0) ? `Week ${(day.weekPosition ?? 0) + 1} · ` : "";
      workoutSessions.push(compactObject({
        id: sessionId,
        workout_plan_id: planId,
        name: day.title || `${weekPrefix}Day ${(day.position ?? order - 1) + 1}`,
        day_index: order,
        order
      }));

      let exerciseOrder = 0;
      for (const block of day.blocks || []) {
        const section = mapSection(block.blockType, (block.items || []).length);
        for (const item of block.items || []) {
          exerciseOrder += 1;
          progress(`Exporting exercise: ${item.exerciseName || "exercise"}.`);
          workoutSessionExercises.push(compactObject({
            id: sourceId("session_exercise", item.id),
            workout_session_id: sessionId,
            order: exerciseOrder,
            section,
            prescription: mapPrescription(item.prescription),
            exercise: compactObject({
              name: item.exerciseName || "Exercise",
              exercise_type: inferExerciseType(item.exerciseName)
            }),
            notes: [block.title, item.notes, item.prescription?.notes].filter((value) => typeof value === "string" && value.trim()).join(" · ") || undefined
          }));
        }
      }
    }
  }

  return { workoutPlans, workoutSessions, workoutSessionExercises };
}

function mapSection(blockType, itemCount) {
  const value = String(blockType || "").toLowerCase();
  if (/warm/.test(value)) {
    return "warmup";
  }
  if (/cool/.test(value)) {
    return "cooldown";
  }
  if (/circuit|superset|giant/.test(value) || (/group/.test(value) && itemCount > 1)) {
    return "circuit";
  }
  return "main";
}

function mapPrescription(raw) {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const num = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    return numberFromText(value);
  };
  const setList = Array.isArray(raw.sets) ? raw.sets : Array.isArray(raw.setList) ? raw.setList : undefined;
  const first = setList?.[0] || {};
  const repsMin = raw.repsMin ?? raw.minReps ?? first.repsMin;
  const repsMax = raw.repsMax ?? raw.maxReps ?? first.repsMax;
  const reps = raw.reps ?? raw.repRange ?? first.reps ?? (repsMin !== undefined ? (repsMax !== undefined && repsMax !== repsMin ? `${repsMin}-${repsMax}` : `${repsMin}`) : undefined);
  const rpe = num(raw.rpe ?? first.rpe);
  const restSeconds = num(raw.restSeconds ?? raw.restSec ?? first.restSeconds);
  const durationSeconds = num(raw.durationSeconds ?? raw.timeSeconds ?? first.durationSeconds);
  const load = num(raw.weight ?? raw.load ?? first.weight ?? first.load);
  return compactObject({
    sets: setList ? setList.length : num(raw.sets ?? raw.setCount),
    reps: reps !== undefined && reps !== null && reps !== "" ? String(reps) : undefined,
    rir: num(raw.rir ?? first.rir),
    rpe: rpe !== undefined && rpe >= 0 && rpe <= 10 ? rpe : undefined,
    tempo: typeof raw.tempo === "string" && raw.tempo ? raw.tempo : undefined,
    rest: restSeconds !== undefined ? { value: restSeconds, unit: "seconds" } : typeof raw.rest === "number" ? { value: raw.rest, unit: "seconds" } : parseDuration(raw.rest),
    duration: durationSeconds !== undefined ? { value: durationSeconds, unit: "seconds" } : undefined,
    load: load !== undefined ? { value: load, unit: String(raw.weightUnit || raw.loadUnit || first.weightUnit || "kg") } : undefined
  });
}

// ----- nutrition ----------------------------------------------------------

function mapMealPlan(plan) {
  const day = (plan.days || [])[0];
  let macros = day?.coachGuidelineMacros;
  if (!macros) {
    macros = (day?.meals || []).reduce((sum, meal) => {
      const source = meal.targetMacros || meal.effectiveMacros || meal.prescribedFoodMacros || {};
      for (const key of ["calories", "protein", "carbs", "fat"]) {
        if (typeof source[key] === "number") {
          sum[key] = (sum[key] || 0) + source[key];
        }
      }
      return sum;
    }, {});
  }
  const round = (value) => (typeof value === "number" ? Math.round(value * 10) / 10 : undefined);
  return compactObject({
    id: sourceId("mealplan", plan.id),
    name: plan.title || "Untitled meal plan",
    status: "active",
    starts_at: toIso(plan.assignedAt),
    targets: compactObject({
      calories_kcal: round(macros?.calories),
      protein_g: round(macros?.protein),
      carbohydrates_g: round(macros?.carbs),
      fat_g: round(macros?.fat)
    })
  });
}

// ----- shared helpers -----------------------------------------------------

function sourceId(prefix, raw) {
  const cleaned = String(raw || "").toLowerCase().replace(/[^a-z0-9_:-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${prefix}_${cleaned || "unknown"}`.slice(0, 128);
}

function fieldId(formSourceId, key) {
  return sourceId("field", `${String(formSourceId).slice(0, 8)}_${key}`);
}

function toIso(value) {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function normalizeDay(value) {
  const day = String(value || "").toLowerCase();
  if (!day) {
    return undefined;
  }
  return ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].find((candidate) => day.startsWith(candidate.slice(0, 3)));
}

function normalizeAnswerValue(value) {
  if (value === "") {
    return "";
  }
  const asNumber = Number(value);
  return Number.isNaN(asNumber) ? value : asNumber;
}

function parseDuration(value) {
  const text = String(value || "");
  const minutes = numberFromMatch(text.match(/(\d+(?:\.\d+)?)\s*m(?:in)?/i)) || 0;
  const seconds = numberFromMatch(text.match(/(\d+(?:\.\d+)?)\s*s(?:ec)?/i)) || 0;
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
  if (/\brun\b|cardio|zone 2|bike|row(ing)? machine|walk|treadmill|elliptical/.test(lower)) {
    return "cardio";
  }
  if (/stretch/.test(lower)) {
    return "stretching";
  }
  if (/mobility|dead bug|breathing/.test(lower)) {
    return "mobility";
  }
  return "strength";
}

function normalizeFrequency(value) {
  const lower = String(value || "").toLowerCase();
  if (!lower) {
    return undefined;
  }
  if (lower.includes("week")) {
    return "weekly";
  }
  if (lower.includes("day") || lower.includes("daily")) {
    return "daily";
  }
  if (lower.includes("month")) {
    return "monthly";
  }
  if (lower.includes("once")) {
    return "once";
  }
  return "custom";
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
  return numberFromMatch(String(value ?? "").match(/(\d+(?:\.\d+)?)/));
}

function compactObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== ""));
}

function stripInternalFields(pkg) {
  for (const template of pkg.forms?.form_templates || []) {
    delete template.__fieldsByKey;
    delete template.__fieldsByLabel;
  }
  return pkg;
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

const pkg = stripInternalFields(result.pkg);
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
