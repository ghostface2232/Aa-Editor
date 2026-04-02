param(
  [switch]$Release
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$profile = if ($Release) { "release" } else { "debug" }
$maintenanceHelperDir = Join-Path $repoRoot "maintenance-helper"
$maintenanceHelperExe = Join-Path $repoRoot "maintenance-helper\target\$profile\maintenance-helper.exe"
$tauriResourcesDir = Join-Path $repoRoot "src-tauri\resources"
$tauriResourceHelperExe = Join-Path $tauriResourcesDir "maintenance-helper.exe"

$cargoArgs = @("build")
if ($Release) {
  $cargoArgs += "--release"
}

Write-Host "[prepare-helper] Building maintenance-helper ($profile)..."
Push-Location $maintenanceHelperDir
try {
  & cargo @cargoArgs
  if ($LASTEXITCODE -ne 0) {
    throw "maintenance-helper cargo build failed with exit code $LASTEXITCODE"
  }
}
finally {
  Pop-Location
}

if (-not (Test-Path -LiteralPath $maintenanceHelperExe)) {
  throw "maintenance-helper executable not found: $maintenanceHelperExe"
}

Write-Host "[prepare-helper] Copying maintenance-helper into Tauri resources..."
New-Item -ItemType Directory -Path $tauriResourcesDir -Force | Out-Null
Copy-Item -LiteralPath $maintenanceHelperExe -Destination $tauriResourceHelperExe -Force

Write-Host "[prepare-helper] Done: $tauriResourceHelperExe"
