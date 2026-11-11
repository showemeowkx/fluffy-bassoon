# Extraction Checklist

Before finalizing a Kahunas export, verify that every V1 domain was attempted.

Included domains:

- Coach profile
- Coach settings
- Clients
- Client assignments
- Form templates
- Form submissions, including intake and check-in forms
- Check-ins
- Macro-only meal plans
- Workout plans
- Workout sessions
- Prescribed exercises inside workout sessions

V1 does not include:

- Photos and videos
- Billing and payment details
- Passwords, cookies, tokens, or OAuth data
- Messages
- Standalone exercise library
- Workout logs
- Coach notes
- Goals
- Content library
- Packages and offers

Final checks:

- The export ZIP exists.
- The primary JSON exists.
- Validation passed or unresolved issues are clearly summarized.
- The coach-facing summary avoids technical jargon.
- The run log has a redacted copy.
- No files were uploaded by default.
- The coach was shown every exported domain count and asked whether each number looks correct.
- Any disputed count was rechecked against Kahunas, re-extracted where possible, validated, and shown to the coach again.
- The check, repair, validation, and confirmation loop continued until the coach explicitly said the numbers were satisfactory.
- A blocked verification paused the reconciliation; it was never treated as approval or completion.
- Every list-like domain was checked for numbered pagination, next links, load-more controls, infinite scrolling, total-count metadata, and API page/offset/cursor fields.
- Extraction continued until no next page or cursor remained and another load produced no new stable record IDs.
- Records from multiple pages or batches were deduplicated by stable source ID.
- The first visible page or DOM row count was never treated as the complete total without pagination evidence.
