# Kahunas Routes

Start here:

- Login: `https://kahunas.io/login`
- Dashboard: `https://kahunas.io/dashboard`
- Clients: `https://kahunas.io/coach/clients`
- Coach configuration: `https://kahunas.io/coach/configuration`
- Profile settings: `https://kahunas.io/profile/settings`

Client-specific:

- Client detail: `/coach/clients/view/{client_uuid}`
- Client edit wizard: `/coach/clients/edit/{client_uuid}`

Training:

- Workout programs: `/coach/workout_programs`
- Workout preview: `/coach/workout_programs/preview/{program_uuid}`
- Exercise library: `/coach/workout_exercises`

Nutrition:

- Diet plans: `/coach/diet_plans`
- Macro plan creation: `/coach/diet_plans/macro`
- Full meal plan creation: `/coach/diet_plans/new`

Notes:

- The dashboard is useful for route discovery and sanity checks.
- Client edit pages are useful for assignments.
- Workout preview pages may initially show loading text. Wait for content.
- The exercise library is mostly Kahunas' built-in library and should not be exported by default.
