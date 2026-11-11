# Export Your Kahunas Data

This tool helps fitness coaches export their own coaching data from Kahunas.

The export runs on your own laptop. You log into Kahunas yourself in a browser window, and the final ZIP file is saved on your computer. Nothing is uploaded anywhere by this tool.

Fitness coaches should have full control over their own coaching data. This tool was built to help make that easier, while keeping the export local on your laptop.

## Important

This is an independent local data portability tool. It is not made by, affiliated with, sponsored by, or endorsed by Kahunas.

Use it only with your own Kahunas coach account, for data you are allowed to access. The tool does not ask for your Kahunas password, does not bypass captchas or security checks, and does not export Kahunas' built-in exercise library or other Kahunas-owned template libraries.

## What You Need

- a laptop
- your Kahunas login
- the Terminal app on your laptop, explained below

## What Terminal Means

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

## One Command Setup

Open Terminal, paste the command below, then press `Enter`.

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

## After The Setup Starts

1. Codex will run in Terminal.
2. If Codex asks you to sign in, sign in with your ChatGPT account.
3. Codex will open a browser window for Kahunas.
4. Log into Kahunas yourself in that browser window.
5. If Kahunas asks for a captcha, code, or other check, complete it yourself.
6. Codex will keep checking the browser automatically, usually every 30 seconds. You do not need to type "done" in Terminal after logging in.
7. Codex will collect your data, open the exported coaching data file, and tell you what was exported.

The export ZIP should be saved somewhere under:

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

## Who Maintains This

I'm [Yashasvi Girdhar](https://www.linkedin.com/in/yashgirdhar/), a fitness coach and software builder. I made this exporter because I believe coaches should be able to keep, export, and move their own coaching data.

You can find me on [LinkedIn](https://www.linkedin.com/in/yashgirdhar/) and [Instagram](https://www.instagram.com/fit_with_yg/). I am also building [Assistant Coach](https://assistantcoach.fit/?utm_source=npm&utm_medium=referral&utm_campaign=kahunas_exporter), a coaching app shaped by the same data-control principle.

You do not need to use Assistant Coach to use this exporter.

## If The One Command Does Not Work

Try running the same command once more. If it still fails, email `yashasvi@assistantcoach.fit` and include a screenshot or copy of the last few lines shown in Terminal.

Common things that can happen:

- Your laptop asks for permission to install helper software. Approve it.
- Codex asks you to sign in. Sign in with your ChatGPT account and continue.
- Kahunas asks for a captcha, code, or other security check. Complete it yourself in the browser.
- The export finishes with warnings. Read the summary first. Some warnings may simply mean photos, videos, or unsupported items were not included.

<details>
<summary>Manual setup steps</summary>

Use this only if the one-command setup does not work.

1. Install the helper software if the setup says it is missing. Its technical name is Node.js, and it includes the installer tool used by this exporter.

Mac:

```bash
open https://nodejs.org/en/download
```

2. Install Codex:

```bash
npm install -g @openai/codex
```

3. Install the Kahunas export tool:

```bash
npx --yes @assistantcoach/kahunas-exporter
```

4. Open Codex:

```bash
codex
```

5. Paste this message into Codex:

```text
Use the Kahunas export skill to export my Kahunas coaching data into a local coaching data package.

Please treat me like a busy nontechnical fitness coach. Keep every instruction simple, friendly, and practical. Do not ask me to type messages in Terminal unless there is no other option.

Open the Kahunas browser window and wait while I log in. Check the browser every 30 seconds to see whether I am logged in instead of asking me to tell you. If Kahunas asks for a captcha, code, payment/security check, or anything only I can complete, explain simply what I should do in the browser and then keep checking again.

Keep reassuring me throughout the run that my data is staying on this laptop. Nothing is being uploaded by this tool, nothing is leaving this laptop unless I approve it, and the export ZIP will be saved locally. Do not include passwords, cookies, payment details, browser secrets, Kahunas built-in exercise libraries, or Kahunas-owned template libraries in the export. Do not bypass captchas, payment screens, or security checks.

While the export is running, keep giving short friendly progress updates in Terminal. Translate what is happening into simple messages like "Exporting clients", "Exporting workout plans", "Exporting meal plans", and "Exporting check-ins" so I know work is still happening.

When the export is done, open the main exported coaching data JSON file using whatever app is already installed on this laptop. Then inspect the generated export summary and coaching data package. Tell me, in plain English, what was exported and how complete it looks: clients, form templates, submitted forms, check-ins, meal plans, workout plans, workout sessions, and prescribed exercises. Give counts when available. If some data was not included, explain that simply. Tell me where the ZIP file was saved and what to do next. Do not focus on validation reports, run logs, redacted logs, browser files, or internal folders unless something goes wrong.
```

</details>
