# Troubleshooting

## Browser Does Not Open

Run:

```bash
node skills/kahunas-export/scripts/start-browser.mjs --help
```

Check:

- The installer completed successfully.
- The installed skill folder exists at `~/.codex/skills/kahunas-export`.
- The browser dependency was installed by the package installer.
- The run folder is writable.

## Coach Cannot Log In

Ask the coach to complete login manually in the opened browser. Do not ask for their password.

If captcha or 2FA appears, wait. The exporter should not try to bypass it.

## Kahunas Requires Subscription Or Payment Step

Stop and explain that the export can only continue after the coach has normal dashboard access. Do not enter payment details for the coach.

## Validation Fails

Read `references/fitness-coaching-data-standard.md`, inspect `validation.json`, fix the mapping issue, and rerun validation.

## Too Much Data In Terminal Output

Use output files. Do not paste raw client data into the chat. Summarize counts and file paths.

## Support Bundle Requested

Create a redacted support bundle only after the coach asks. Warn that support files may still include coaching data.
