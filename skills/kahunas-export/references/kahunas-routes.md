# Kahunas Routes

The current Kahunas app runs on a per-coach workspace host: `https://<workspace>.kahunas.app`.

Start here:

- Login: `https://kahunas.io/login`. After login it redirects to `https://<workspace>.kahunas.app/coach`.
- Dashboard: `/coach`
- Client roster: `/coach/people/clients?page=1&pageSize=100&segment=all&sort=name_asc`
- Settings: `/coach/settings`
- Profile: `/coach/profile`

Client-specific (`$clientId` is a UUID):

- Overview: `/coach/people/clients/$clientId`
- Plans and assigned forms: `/coach/people/clients/$clientId/plans`
- Check-ins: `/coach/people/clients/$clientId/check-ins/` and `/coach/people/clients/$clientId/check-ins/$checkInId`
- Initial Q&A: `/coach/people/clients/$clientId/initial-qa`
- Also available but not exported: `workouts/`, `nutrition/`, `metrics`, `habits`, `gallery`, `billing`

Builders (coach libraries):

- Forms: `/coach/builder/forms/` and `/coach/builder/forms/$formId`
- Workouts: `/coach/builder/workouts/` and `/coach/builder/workouts/plans/$planId`
- Nutrition: `/coach/builder/nutrition/` and `/coach/builder/nutrition/plans/$planId`

Notes:

- Login is detected when the host ends with `.kahunas.app`, the path starts with `/coach`, and `window.__TSR_ROUTER__` is present.
- A path starting with `/client` means the browser is logged into a client account, not a coach account.
- Navigate with the in-app router, not `page.goto`, so the query cache survives. See `kahunas-api-map.md`.
