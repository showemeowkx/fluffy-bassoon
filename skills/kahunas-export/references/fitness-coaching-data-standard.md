# Fitness Coaching Data Standard Reference

This exporter targets the tight V1 coaching data import/export scope.

Expected top-level JSON keys:

- `manifest`
- `coach`
- `clients`
- `forms`
- `check_ins`
- `nutrition`
- `training`

Expected nested arrays:

- `clients.clients`
- `clients.client_assignments`
- `forms.form_templates`
- `forms.form_submissions`
- `check_ins`
- `nutrition.meal_plans`
- `training.workout_plans`
- `training.workout_sessions`
- `training.workout_session_exercises`

The open package should contain clean coaching data, not extractor debug evidence.

Do not put these in the package:

- platform-internal object IDs
- private Kahunas URLs
- CSS selectors
- screenshots
- cookies
- tokens
- auth headers
- confidence scores
- per-record extraction evidence

Those belong in local run logs only.
