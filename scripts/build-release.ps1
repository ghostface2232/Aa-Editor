$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$nsisBundlePath = Join-Path $repoRoot "src-tauri\target\release\bundle\nsis\Noten_0.1.0_x64-setup.exe"
$payloadPath = Join-Path $repoRoot "bootstrapper\assets\nsis-payload.exe"
$bootstrapperDir = Join-Path $repoRoot "bootstrapper"
$bootstrapperExe = Join-Path $repoRoot "bootstrapper\target\release\noten-setup.exe"
$distDir = Join-Path $repoRoot "dist"
$distExe = Join-Path $distDir "Noten-Setup.exe"

Write-Host "[1/4] Looking for NSIS bundle..."
if (-not (Test-Path -LiteralPath $nsisBundlePath)) {
  throw "NSIS bundle not found: $nsisBundlePath"
}

Write-Host "[2/4] Copying NSIS bundle into bootstrapper assets..."
Copy-Item -LiteralPath $nsisBundlePath -Destination $payloadPath -Force

Write-Host "[3/4] Building bootstrapper in release mode..."
Push-Location $bootstrapperDir
try {
  cargo build --release
  if ($LASTEXITCODE -ne 0) {
    throw "bootstrapper cargo build failed with exit code $LASTEXITCODE"
  }
}
finally {
  Pop-Location
}

Write-Host "[4/4] Copying final bootstrapper to dist..."
if (-not (Test-Path -LiteralPath $bootstrapperExe)) {
  throw "Bootstrapper executable not found: $bootstrapperExe"
}

if (-not (Test-Path -LiteralPath $distDir)) {
  New-Item -ItemType Directory -Path $distDir | Out-Null
}

Copy-Item -LiteralPath $bootstrapperExe -Destination $distExe -Force
Write-Host "Done: $distExe"
