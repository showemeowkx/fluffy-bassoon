# Export Your Kahunas Data

This guide helps you export your own coaching data from Kahunas on your own laptop.

The export runs locally. You log into Kahunas yourself in a browser window, and the final ZIP file is saved on your computer. Nothing is uploaded anywhere by this tool.

Fitness coaches should have full control over their own coaching data. This tool was built to help make that easier, while keeping the export local on your laptop.

## Important

This is an independent local data portability tool. It is not made by, affiliated with, sponsored by, or endorsed by Kahunas.

Use it only with your own Kahunas coach account, for data you are allowed to access. The tool does not ask for your Kahunas password, does not bypass captchas or security checks, and does not export Kahunas' built-in exercise library or other Kahunas-owned template libraries.

Package page: https://www.npmjs.com/package/@assistantcoach/kahunas-exporter

## Before You Start

You need:

- a laptop
- your Kahunas login
- the Terminal app on your laptop, explained below

## Step 1: Open Terminal

Terminal is the app where you paste one setup command.

On Mac:

1. Press `Command + Space`.
2. Type `Terminal`.
3. Press `Enter`.

On Linux:

1. Open your apps menu.
2. Search for `Terminal`.
3. Open `Terminal`.

On Windows, email `yashasvi@assistantcoach.fit` and we will help you directly.

## Step 2: Run The One Command Setup

The setup will:

- check whether the helper software is installed
- install the helper software if it is missing
- install Codex
- install the Kahunas export tool
- open Codex in Terminal and start the Kahunas export
- give Codex permission to open a browser and save the export ZIP on this laptop

If your laptop asks for your password or permission to install helper software, approve it. That is expected. On Mac, your password may not appear while you type it; that is normal.

### Mac

Paste this into Terminal and press `Enter`:

```bash
/bin/bash -c "$(curl -fsSL https://cdn.jsdelivr.net/npm/@assistantcoach/kahunas-exporter@latest/scripts/setup-mac.sh)"
```

### Linux

Paste this into Terminal and press `Enter`:

```bash
/bin/bash -c "$(curl -fsSL https://cdn.jsdelivr.net/npm/@assistantcoach/kahunas-exporter@latest/scripts/setup-linux.sh)"
```

If you are using Windows, email `yashasvi@assistantcoach.fit`. We can guide you personally.

## Step 3: Sign In And Export

1. Codex will run in Terminal.
2. If Codex asks you to sign in, sign in with your ChatGPT account.
3. Codex will open a browser window for Kahunas.
4. Log into Kahunas yourself in that browser window.
5. If Kahunas asks for a captcha, code, or other check, complete it yourself.
6. Codex will keep checking the browser automatically, usually every 30 seconds. You do not need to type "done" in Terminal after logging in.
7. Codex will show simple progress updates while it exports your clients, forms, check-ins, meal plans, and workout plans.
8. Codex will open the exported coaching data file, then tell you what was exported, how complete it looks, and where the ZIP file was saved.

The ZIP should be saved somewhere under:

```text
~/KahunasExports/kahunas/runs/
```

## What Should Be Included

The export focuses on coaching data from your account, such as:

- clients
- forms and form responses
- check-ins
- meal plans
- workout plans
- workout sessions and prescribed exercises from assigned workout plans

It does not include passwords, payment details, cookies, tokens, raw browser data, Kahunas' built-in exercise library, Kahunas-owned template libraries, photos, or videos.

## What To Do Next

Use the ZIP file wherever you plan to import or store your coaching data.

## If The One Command Does Not Work

Try running the same command once more. If it still fails, email `yashasvi@assistantcoach.fit` and include a screenshot or copy of the last few lines shown in Terminal.
