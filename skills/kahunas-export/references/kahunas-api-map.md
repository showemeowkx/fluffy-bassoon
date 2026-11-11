# Kahunas API Map

Mapped against the current Kahunas web app in November 2026. The old `kahunas.io` PHP pages (`/coach/clients`, `/coach/clients/edit/{uuid}`, `/coach/workout_programs/preview/{uuid}`, ...) no longer exist. `https://kahunas.io/login` still works as the entry point and redirects to the coach's workspace.

## How the app loads data

- Every coach has a workspace host: `https://<workspace>.kahunas.app`.
- The app is a TanStack Start single-page app. The router is exposed as `window.__TSR_ROUTER__`, and its TanStack Query client is at `window.__TSR_ROUTER__.options.context.queryClient`.
- Data comes from server functions at `/_serverFn/<sha256>`. The hashes change with every Kahunas deploy and the responses are seroval-encoded, so **never hard-code server-function URLs**.
- `scripts/kahunas-app-bridge.mjs` uses the app itself instead:
  1. It navigates with `router.navigate({ to, params, search })` and waits until `queryClient.isFetching() === 0`.
  2. It reads the decoded results from the query cache by query key.
  3. It paginates by temporarily wrapping `fetch` to rewrite `page` and `pageSize` inside the server-function payload. It then calls the cached query's `queryFn` again, so the app decodes each page itself. The server accepts `pageSize: 100`.

The seroval payload of a paginated query looks like:

```json
{"t":{"t":10,"i":0,"p":{"k":["data"],"v":[{"t":10,"i":1,"p":{"k":["page","pageSize","segment","sort"],"v":[{"t":0,"s":1},{"t":0,"s":25},{"t":1,"s":"all"},{"t":1,"s":"name_asc"}]},"o":3}]},"o":0},"f":127,"m":[]}
```

## Routes and query keys

| Domain | Route (router `to`) | Query key | Notes |
|---|---|---|---|
| Coach identity | any `/coach` route | `["coach-route-context","context"]` | `user.{firstName,lastName,email}`, `displayTimeZone` |
| Coach settings | `/coach/settings` | `["settings","detail"]` | `general.timezone`, `general.unitDefaults.{weightUnit,heightUnit,foodUnit,waterUnit}` |
| Client roster | `/coach/people/clients` with search `{page,pageSize,segment,sort}` | `["clients","list",{page,pageSize,segment,sort}]` | paginated `{rows,page,pageCount,pageSize,totalRows}`; segments include `all` and `archived` |
| Client summary | `/coach/people/clients/$clientId` | `["clients","detail",id,"deleted-inclusive"]` | `summary.{email,phone,birthDate,sex,status,clientStartDate}`, `assignedCheckInSchedule` |
| Assigned workout plans | same | `["clients","detail",id,"workout-plans","active"]` | full plan: `plans[].days[].blocks[].items[]` with `exerciseName`, `prescription` |
| Assigned meal plan | same | `["clients","detail",id,"meal-plan","active"]` | `plans[].days[].meals[]` with `effectiveMacros`, food `items[]` |
| Assigned forms | `/coach/people/clients/$clientId/plans` | `["forms","assigned","client",id]` | |
| Check-in history | `/coach/people/clients/$clientId/check-ins/` | `["clients","detail",id,"check-in-history",{clientId,page,pageSize,range}]` | paginated; page size is component state (default 6), not URL; `lifetime.submittedCount` is the total |
| Check-in detail | `/coach/people/clients/$clientId/check-ins/$checkInId` | new queries after navigation | answers are found with a generic question/answer walker |
| Initial Q&A | `/coach/people/clients/$clientId/initial-qa` | `["clients","detail",id,"initial-qa","submissions"]` | `submissions[]` |
| Form templates | `/coach/builder/forms/` | `["forms","list",{kind,page,pageSize,sort,status}]` | paginated |
| Form detail | `/coach/builder/forms/$formId` | `["forms","detail",formId]` | `schema.fields[].{key,label,type,required,options,position}` |
| Workout library | `/coach/builder/workouts/` | `["workouts","list",{mode,page,pageSize,segment,sort}]` | not exported (assigned plans only) |
| Nutrition library | `/coach/builder/nutrition/` | `["nutrition","plans","list",{...}]` | not exported (assigned plans only) |

You can list all route ids with `Object.keys(window.__TSR_ROUTER__.routesById)`.

## Raw output (export/raw/)

Next to the V1 package the exporter writes one JSON file per area with the app's own data, so importers can map fields V1 has no place for. Secret-looking keys (token, secret, api key, password, cookie, authorization, session) are dropped and URL query strings are stripped.

| File | Source |
|---|---|
| `clients.json` | roster row + `["clients","detail",id,"deleted-inclusive"]` (goal, package, weight, schedule) + assigned forms |
| `workout-plans.json`, `meal-plans.json`, `supplements.json` | `["clients","detail",id,"workout-plans"|"meal-plan"|"supplements","active"]` |
| `check-ins.json` | all check-in history rows + every query loaded on each check-in detail page |
| `initial-qa.json` | `["clients","detail",id,"initial-qa","submissions"]` |
| `workout-logs.json` | `workout-logs/latest` (no paging; recent logs only), `insights/strength`, `workouts/progress` with `range: "all"`, and the detail page of every listed log |
| `metrics.json` | `metric-graphs` with `preset: "all"`, plus weight series from the client summary |
| `habits.json`, `nutrition-logs.json` | weekly queries (`weekStart` rewritten), from the current week back to the client's start date, capped by `--history-weeks` (default 104) |
| `forms.json`, `library-exercises.json`, `recipes.json` | builder lists and form details |
| `coach.json` | coach user and `settings.general` |

Payload overrides are generic: `fetchWith(pattern, { field: value })` rewrites every payload object that contains all given fields. The run log records under `skipped` when an override could not be applied, and what was kept instead.

Coach notes: the client header "Notes" panel did not load anything into the query cache on an account without notes, so notes are not exported yet.

## Not verified yet

The pilot account had no submitted check-ins or initial Q&A answers. As a result:

- check-in row field names (`id`, `submittedAt`/`occurredAt`, `formId`/`formTitle`) are handled defensively, and
- answers are found by searching the detail data for lists of `{label|question|prompt, value|answer|response}`.

Prescription fields (`sets`, `reps`, `rpe`, `rir`, `restSeconds`, `tempo`, set arrays) are handled the same defensive way. Before trusting those counts on an account that has this data, check them against what the coach sees in Kahunas.

## Live extractor rules

1. Use the bridge (router plus query cache). Do not scrape DOM text, and do not hard-code `/_serverFn/` hashes.
2. Exhaust pagination for every paginated query and record per-page evidence in the run log under `pagination`.
3. Record failures and fallback reasons in the run log under `skipped`, not in the export package.

## Do not click destructive actions

- delete or archive client
- reset password or resend invites
- cancel membership or packages
- save buttons in builders or client edit screens
- billing, payments, or Stripe actions
