# Kahunas API Map

This file is intentionally a working map. Prefer authenticated browser-context API data over DOM scraping whenever possible.

Current known reliable surfaces from pilot runs:

- `/coach/clients` for roster counters, active/archive status, client rows, packages, last check-in, check-in day, and client detail links.
- `/coach/clients/edit/{client_uuid}` for assignment metadata, including nutrition plan, workout plans, check-in form, check-in frequency, and weekdays.
- `/coach/clients/view/{client_uuid}` for client detail tabs: check-ins, Q&A, nutrition, workout, and logs.
- `/coach/configuration` for general settings after selecting the General settings tab.
- `/profile/settings` and `/profile/overview` for coach profile fields.
- `/coach/diet_plans/macro` and nutrition preview routes for macro meal plan data.
- `/coach/workout_programs/preview/{program_uuid}` for workout plan sessions and prescribed exercises.

Live extractor rule:

1. Inspect network/API responses available from the logged-in browser context.
2. Prefer JSON API responses.
3. Use DOM text only when API data is not available.
4. Record failures and fallback reasons in the local run log, not in the export package.

Do not click destructive actions:

- delete client
- reset password
- resend login details
- cancel membership
- submit edit-client wizard
- billing/Stripe management actions
