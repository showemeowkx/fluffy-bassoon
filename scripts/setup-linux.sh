#!/usr/bin/env bash
set -euo pipefail

DRY_RUN="${AC_KAHUNAS_SETUP_DRY_RUN:-0}"
SUPPORT_EMAIL="yashasvi@assistantcoach.fit"
ERROR_MESSAGE_PRINTED=0
PROMPT_FILE="${AC_KAHUNAS_PROMPT_FILE:-${CODEX_HOME:-$HOME/.codex}/skills/kahunas-export/assets/launch-prompt.txt}"
PROMPT=""

say() {
  printf "\n%s\n" "$1"
}

show_error_message() {
  if [ "$ERROR_MESSAGE_PRINTED" = "1" ]; then
    return
  fi
  ERROR_MESSAGE_PRINTED=1

  local message="${1:-The setup stopped before it finished.}"
  printf "\n%s\n" "Something went wrong while setting up the Kahunas export."
  printf "%s\n" "$message"
  printf "\n%s\n" "What to do next:"
  printf "%s\n" "1. Keep this Terminal window open."
  printf "%s\n" "2. Email $SUPPORT_EMAIL."
  printf "%s\n" "3. Include a screenshot or copy of the last few lines shown in Terminal."
  printf "\n%s\n" "Your Kahunas data was not changed by this setup error."
}

fail() {
  show_error_message "$1"
  exit 1
}

on_error() {
  local exit_code="$1"
  local line_number="$2"
  local command="$3"
  show_error_message "The last setup step failed near line $line_number: $command"
  exit "$exit_code"
}

trap 'on_error "$?" "$LINENO" "$BASH_COMMAND"' ERR

run() {
  if [ "$DRY_RUN" = "1" ]; then
    printf "[dry-run] %s\n" "$*"
  else
    "$@"
  fi
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

node_is_new_enough() {
  has_command node && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' >/dev/null 2>&1
}

install_node() {
  say "Helper software is needed for this setup. Installing it now."
  local os_name
  os_name="$(uname -s)"

  if [ "$os_name" != "Linux" ]; then
    fail "This setup is for Linux. If you are using Mac, use the Mac command. If you are using Windows, email $SUPPORT_EMAIL and we will help you."
  fi

  say "Installing the helper software into your home folder."
  say "This does not change system-wide Linux packages."

  local machine
  local arch
  machine="$(uname -m)"
  case "$machine" in
    x86_64|amd64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) fail "This Linux laptop uses an unsupported processor type: $machine. Email $SUPPORT_EMAIL and we will help you." ;;
  esac

  local base="https://nodejs.org/dist/latest-v22.x"
  local tar_name
  tar_name="$(curl -fsSL "$base/SHASUMS256.txt" | awk -v arch="$arch" '$2 ~ ("^node-.*-linux-" arch "[.]tar[.]xz$") {print $2; exit}')"
  if [ -z "$tar_name" ]; then
    fail "Could not find the helper software installer for this Linux laptop. Email $SUPPORT_EMAIL and we will help you."
  fi

  local install_root
  local tmp_dir
  local tmp_tar
  install_root="$HOME/.kahunas-export-helper"
  tmp_dir="$(mktemp -d "/tmp/node-installer.XXXXXX")"
  tmp_tar="$tmp_dir/$tar_name"

  run mkdir -p "$install_root"
  run curl -fL "$base/$tar_name" -o "$tmp_tar"
  if [ "$DRY_RUN" = "1" ]; then
    printf "[dry-run] tar -xJf %s -C %s\n" "$tmp_tar" "$install_root"
  else
    tar -xJf "$tmp_tar" -C "$install_root"
    rm -rf "$install_root/node"
    mv "$install_root/${tar_name%.tar.xz}" "$install_root/node"
    rm -rf "$tmp_dir"
    export PATH="$install_root/node/bin:$PATH"
    hash -r
  fi
}

ensure_node_and_npm() {
  if has_command npm && node_is_new_enough; then
    say "The helper software is already installed."
    return
  fi

  install_node

  if [ "$DRY_RUN" = "1" ]; then
    return
  fi

  if ! has_command npm || ! node_is_new_enough; then
    fail "The helper software did not install correctly."
  fi
}

install_codex() {
  if has_command codex; then
    say "Codex is already installed."
    return
  fi

  say "Installing Codex."
  if [ "$DRY_RUN" = "1" ]; then
    printf "[dry-run] npm install -g @openai/codex\n"
    return
  fi

  if npm_global_install_needs_user_prefix; then
    say "This laptop needs a user-only Codex install. Continuing with that now."
    install_codex_user_only
    return
  fi

  local log_file
  log_file="$(mktemp "/tmp/codex-install.XXXXXX.log")"
  if npm install -g @openai/codex >"$log_file" 2>&1; then
    rm -f "$log_file"
    hash -r
    return
  fi

  if grep -Eqi 'EACCES|permission denied' "$log_file"; then
    rm -f "$log_file"
    say "This laptop needs a user-only Codex install. Continuing with that now."
    install_codex_user_only
    return
  fi

  cat "$log_file"
  rm -f "$log_file"
  fail "Codex did not install correctly."
}

npm_global_install_needs_user_prefix() {
  local root
  root="$(npm root -g 2>/dev/null || true)"
  if [ -z "$root" ]; then
    return 1
  fi

  if [ -d "$root" ]; then
    [ ! -w "$root" ]
    return
  fi

  local parent="$root"
  while [ ! -d "$parent" ] && [ "$parent" != "/" ]; do
    parent="$(dirname "$parent")"
  done

  [ "$parent" != "/" ] && [ ! -w "$parent" ]
}

install_codex_user_only() {
  local prefix="$HOME/.npm-global"
  mkdir -p "$prefix"
  npm config set prefix "$prefix" >/dev/null
  export PATH="$prefix/bin:$PATH"
  if ! grep -qs 'export PATH="$HOME/.npm-global/bin:$PATH"' "$HOME/.zshrc" 2>/dev/null; then
    printf '\nexport PATH="$HOME/.npm-global/bin:$PATH"\n' >> "$HOME/.zshrc"
  fi
  npm install -g @openai/codex
  hash -r
}

install_exporter() {
  say "Installing the Kahunas export tool."
  if [ "$DRY_RUN" = "1" ]; then
    printf "[dry-run] npx --yes @assistantcoach/kahunas-exporter\n"
    return
  fi
  npx --yes @assistantcoach/kahunas-exporter
}

load_prompt() {
  if [ ! -f "$PROMPT_FILE" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      printf "[dry-run] load Codex prompt from %s\n" "$PROMPT_FILE"
      PROMPT="Dry-run Kahunas export prompt"
      return
    fi
    fail "The Kahunas export instructions were not installed correctly."
  fi
  PROMPT="$(cat "$PROMPT_FILE")"
  if [ -z "$PROMPT" ]; then
    fail "The Kahunas export instructions were empty."
  fi
}

start_codex() {
  say "Opening Codex and starting the Kahunas export."
  say "Codex will run in this Terminal window."
  say "This setup gives Codex permission to open a browser and save the export ZIP on this laptop."
  say "If Codex asks you to sign in, sign in with your ChatGPT account and then continue."
  say "After Kahunas opens, log in in the browser. Codex will keep checking automatically."
  if [ "$DRY_RUN" = "1" ]; then
    printf "[dry-run] codex --ask-for-approval never --sandbox danger-full-access %q\n" "$PROMPT"
    return
  fi
  exec codex --ask-for-approval never --sandbox danger-full-access "$PROMPT"
}

say "Kahunas export setup"
say "This will install what is needed on this laptop, then open Codex to start the export."

ensure_node_and_npm
install_codex
install_exporter
load_prompt
start_codex
