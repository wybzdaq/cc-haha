[CmdletBinding()]
param(
  [ValidateSet('x64', 'arm64')]
  [string]$Arch = 'x64',

  [ValidateSet('installer', 'portable-dir')]
  [string]$Kind = 'installer',

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$BuilderArgs
)

# Environment:
#   SKIP_INSTALL=1        Skip root/desktop dependency installation.
#   REBUILD_NATIVE=1      Rebuild Electron native dependencies before packaging.
#   SKIP_PACKAGE_SMOKE=1  Skip static package-smoke verification after copying artifacts.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopDir = (Resolve-Path (Join-Path $scriptDir '..')).Path
$repoRoot = (Resolve-Path (Join-Path $desktopDir '..')).Path

$targetTriple = if ($Arch -eq 'arm64') { 'aarch64-pc-windows-msvc' } else { 'x86_64-pc-windows-msvc' }
$builderArch = if ($Arch -eq 'arm64') { 'arm64' } else { 'x64' }
$vsArch = if ($Arch -eq 'arm64') { 'arm64' } else { 'x64' }
$vcToolsRequirement = if ($Arch -eq 'arm64') { 'Microsoft.VisualStudio.Component.VC.Tools.ARM64' } else { 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64' }
$unpackedDirName = if ($Arch -eq 'arm64') { 'win-arm64-unpacked' } else { 'win-unpacked' }
$canonicalOutputDir = Join-Path $desktopDir "build-artifacts\windows-$Arch"
$electronOutputDir = Join-Path $desktopDir 'build-artifacts\electron'
$packageKind = if ($Kind -eq 'portable-dir') { 'dir' } else { 'release' }

function Write-Step {
  param([string]$Message)
  Write-Host "[build-windows] $Message"
}

function Assert-WindowsHost {
  if ($env:OS -ne 'Windows_NT') {
    throw '[build-windows] This script must run on Windows.'
  }
}

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "[build-windows] Missing required command: $Name"
  }
}

function Invoke-BunX {
  param([string[]]$CommandArgs)

  if (Get-Command bunx -ErrorAction SilentlyContinue) {
    & bunx @CommandArgs
  } else {
    & bun x @CommandArgs
  }
}

function Import-VsDevEnvironment {
  $vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
  if (-not (Test-Path $vswhere)) {
    throw '[build-windows] Could not find vswhere.exe. Install Visual Studio 2022 Build Tools with the C++ workload.'
  }

  $installationPath = & $vswhere `
    -products * `
    -requires $vcToolsRequirement `
    -property installationPath |
    Select-Object -First 1

  if (-not $installationPath) {
    throw "[build-windows] Missing Visual C++ build tools for $Arch. Install the Desktop development with C++ workload first."
  }

  $vsDevCmd = Join-Path $installationPath 'Common7\Tools\VsDevCmd.bat'
  if (-not (Test-Path $vsDevCmd)) {
    throw "[build-windows] Could not find VsDevCmd.bat under $installationPath"
  }

  Write-Step "Importing MSVC environment from $vsDevCmd for $vsArch"
  $env:VSCMD_SKIP_SENDTELEMETRY = '1'
  $envDump = & cmd.exe /d /s /c "`"$vsDevCmd`" -arch=$vsArch -host_arch=x64 >nul && set"
  if ($LASTEXITCODE -ne 0) {
    throw "[build-windows] Failed to initialize Visual Studio build environment (exit $LASTEXITCODE)"
  }

  foreach ($line in $envDump) {
    if ($line -match '^(.*?)=(.*)$') {
      [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
    }
  }
}

function Clear-Directory {
  param([string]$Path)
  if (Test-Path $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

Assert-WindowsHost
Assert-Command bun
Import-VsDevEnvironment

if ($env:SKIP_INSTALL -ne '1') {
  Write-Step 'Installing root dependencies...'
  Push-Location $repoRoot
  try {
    & bun install
    if ($LASTEXITCODE -ne 0) {
      throw "[build-windows] bun install failed in repo root (exit $LASTEXITCODE)"
    }
  } finally {
    Pop-Location
  }

  Write-Step 'Installing desktop dependencies...'
  Push-Location $desktopDir
  try {
    & bun install
    if ($LASTEXITCODE -ne 0) {
      throw "[build-windows] bun install failed in desktop (exit $LASTEXITCODE)"
    }
  } finally {
    Pop-Location
  }
}

Write-Step 'Cleaning stale Electron outputs...'
Remove-Item -LiteralPath (Join-Path $desktopDir 'dist') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $desktopDir 'electron-dist') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $electronOutputDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path (Join-Path $desktopDir 'src-tauri\binaries\claude-sidecar-*') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $desktopDir 'tsconfig.tsbuildinfo') -Force -ErrorAction SilentlyContinue

Write-Step "Building sidecars for $targetTriple..."
Push-Location $desktopDir
try {
  $env:SIDECAR_TARGET_TRIPLE = $targetTriple
  & bun run build:sidecars
  if ($LASTEXITCODE -ne 0) {
    throw "[build-windows] build:sidecars failed (exit $LASTEXITCODE)"
  }

  Write-Step 'Building renderer and Electron main/preload bundles...'
  & bun run build
  if ($LASTEXITCODE -ne 0) {
    throw "[build-windows] renderer build failed (exit $LASTEXITCODE)"
  }
  & bun run build:electron
  if ($LASTEXITCODE -ne 0) {
    throw "[build-windows] Electron build failed (exit $LASTEXITCODE)"
  }

  if ($env:REBUILD_NATIVE -eq '1') {
    Write-Step 'Rebuilding native dependencies for Electron ABI...'
    Invoke-BunX @('electron-builder', 'install-app-deps')
    if ($LASTEXITCODE -ne 0) {
      throw "[build-windows] electron-builder install-app-deps failed (exit $LASTEXITCODE)"
    }
    & bun run prepare:node-pty
    if ($LASTEXITCODE -ne 0) {
      throw "[build-windows] prepare:node-pty failed (exit $LASTEXITCODE)"
    }
  }

  if ($Kind -eq 'portable-dir') {
    $args = @('electron-builder', '--win', "--$builderArch", '--dir', '--publish', 'never')
    Write-Step "Packaging Electron app as Windows $Arch no-install directory..."
  } else {
    $args = @('electron-builder', '--win', 'nsis', "--$builderArch", '--publish', 'never')
    Write-Step "Packaging Electron app as Windows $Arch installer..."
  }

  if ($BuilderArgs.Count -gt 0) {
    $args += $BuilderArgs
  }

  Invoke-BunX $args
  if ($LASTEXITCODE -ne 0) {
    throw "[build-windows] electron-builder failed (exit $LASTEXITCODE)"
  }
} finally {
  Pop-Location
}

Clear-Directory -Path $canonicalOutputDir

Get-ChildItem -Path $electronOutputDir -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '\.(exe|blockmap|yml)$' } |
  ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $canonicalOutputDir $_.Name) -Force }

$winUnpackedDir = Join-Path $electronOutputDir $unpackedDirName
if (Test-Path $winUnpackedDir) {
  Copy-Item -LiteralPath $winUnpackedDir -Destination (Join-Path $canonicalOutputDir $unpackedDirName) -Recurse -Force
} else {
  Write-Step "Warning: $unpackedDirName was not found under $electronOutputDir; package-smoke will fail if it is required."
}

Set-Content -Path (Join-Path $canonicalOutputDir 'BUILD_INFO.txt') -Value @"
Target triple: $targetTriple
Windows arch: $Arch
Package kind: $Kind
Builder output: $electronOutputDir
Canonical output: $canonicalOutputDir
Built at: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')
"@ -Encoding UTF8

if ($env:SKIP_PACKAGE_SMOKE -eq '1') {
  Write-Step 'Skipping package-smoke because SKIP_PACKAGE_SMOKE=1.'
} else {
  Write-Step "Running package-smoke against canonical Windows $Arch $Kind artifacts..."
  Push-Location $repoRoot
  try {
    & bun run test:package-smoke --platform windows --arch $Arch --package-kind $packageKind --artifacts-dir "desktop/build-artifacts/windows-$Arch"
    if ($LASTEXITCODE -ne 0) {
      throw "[build-windows] package-smoke failed (exit $LASTEXITCODE)"
    }
  } finally {
    Pop-Location
  }
}

Write-Step 'Build finished.'
Write-Step "Canonical output: $canonicalOutputDir"
