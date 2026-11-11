$ErrorActionPreference = "Stop"

$DryRun = $env:AC_KAHUNAS_SETUP_DRY_RUN -eq "1"
$SupportEmail = "yashasvi@assistantcoach.fit"
$CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
$PromptFile = if ($env:AC_KAHUNAS_PROMPT_FILE) { $env:AC_KAHUNAS_PROMPT_FILE } else { Join-Path $CodexHome "skills/kahunas-export/assets/launch-prompt.txt" }
$PromptText = ""

function Say($Message) {
  Write-Host ""
  Write-Host $Message
}

function Show-SetupError($Message) {
  Write-Host ""
  Write-Host "Something went wrong while setting up the Kahunas export."
  Write-Host $Message
  Write-Host ""
  Write-Host "What to do next:"
  Write-Host "1. Keep this PowerShell window open."
  Write-Host "2. Email $SupportEmail."
  Write-Host "3. Include a screenshot or copy of the last few lines shown in PowerShell."
  Write-Host ""
  Write-Host "Your Kahunas data was not changed by this setup error."
}

function Run-Command($FilePath, $Arguments) {
  if ($DryRun) {
    Write-Host "[dry-run] $FilePath $Arguments"
    return
  }
  $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "$FilePath failed with exit code $($process.ExitCode)"
  }
}

function Refresh-Path {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

function Has-Command($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Node-Is-New-Enough {
  if (-not (Has-Command "node")) {
    return $false
  }
  $major = (& node -p "process.versions.node.split('.')[0]") 2>$null
  return [int]$major -ge 20
}

function Install-Node {
  Say "Helper software is needed for this setup. Installing it now."
  Say "Windows may ask for permission. Please approve it."

  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
  $base = "https://nodejs.org/dist/latest-v22.x"
  $checksums = (Invoke-WebRequest "$base/SHASUMS256.txt" -UseBasicParsing).Content
  $msiName = ($checksums -split "`n" | Where-Object { $_ -match "-$arch\.msi\s*$" } | Select-Object -First 1) -split "\s+" | Select-Object -Last 1

  if (-not $msiName) {
    throw "Could not find the helper software installer for this Windows laptop."
  }

  $msiPath = Join-Path $env:TEMP $msiName
  if ($DryRun) {
    Write-Host "[dry-run] Download $base/$msiName to $msiPath"
  } else {
    Invoke-WebRequest "$base/$msiName" -OutFile $msiPath -UseBasicParsing
  }

  if ($DryRun) {
    Write-Host "[dry-run] Start helper software installer"
  } else {
    Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /passive /norestart" -Wait -Verb RunAs
  }

  Refresh-Path
}

function Ensure-Node-And-Npm {
  Refresh-Path
  if ((Has-Command "npm") -and (Node-Is-New-Enough)) {
    Say "The helper software is already installed."
    return
  }

  Install-Node

  if ((-not (Has-Command "npm")) -or (-not (Node-Is-New-Enough))) {
    throw "The helper software did not install correctly."
  }
}

function Install-Codex {
  Refresh-Path
  if (Has-Command "codex") {
    Say "Codex is already installed."
    return
  }

  Say "Installing Codex."
  if ($DryRun) {
    Write-Host "[dry-run] npm install -g @openai/codex"
    return
  }

  & npm install -g "@openai/codex"
  if ($LASTEXITCODE -ne 0) {
    throw "Codex install failed."
  }
  Refresh-Path
}

function Install-Exporter {
  Say "Installing the Kahunas export tool."
  if ($DryRun) {
    Write-Host "[dry-run] npx --yes @assistantcoach/kahunas-exporter"
    return
  }

  & npx --yes "@assistantcoach/kahunas-exporter"
  if ($LASTEXITCODE -ne 0) {
    throw "Kahunas export tool install failed."
  }
}

function Load-Prompt {
  if (-not (Test-Path $PromptFile)) {
    if ($DryRun) {
      Write-Host "[dry-run] load Codex prompt from $PromptFile"
      $script:PromptText = "Dry-run Kahunas export prompt"
      return
    }
    throw "The Kahunas export instructions were not installed correctly."
  }

  $script:PromptText = (Get-Content $PromptFile -Raw).Trim()
  if (-not $script:PromptText) {
    throw "The Kahunas export instructions were empty."
  }
}

function Start-Codex {
  Say "Opening Codex and starting the Kahunas export."
  Say "Codex will run in this PowerShell window."
  Say "This setup gives Codex permission to open a browser and save the export ZIP on this laptop."
  Say "If Codex asks you to sign in, sign in with your ChatGPT account and then continue."
  Say "After Kahunas opens, log in in the browser. Codex will keep checking automatically."
  if ($DryRun) {
    Write-Host "[dry-run] codex --ask-for-approval never --sandbox danger-full-access `"$PromptText`""
    return
  }

  & codex --ask-for-approval never --sandbox danger-full-access $PromptText
}

try {
  Say "Kahunas export setup"
  Say "This will install what is needed on this laptop, then open Codex to start the export."

  Ensure-Node-And-Npm
  Install-Codex
  Install-Exporter
  Load-Prompt
  Start-Codex
} catch {
  Show-SetupError $_.Exception.Message
  exit 1
}
