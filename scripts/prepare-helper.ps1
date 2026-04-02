param(
  [switch]$Release
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$profile = if ($Release) { "release" } else { "debug" }
$maintenanceHelperExe = Join-Path $repoRoot "target\$profile\maintenance-helper.exe"
$tauriResourcesDir = Join-Path $repoRoot "src-tauri\resources"
$tauriResourceHelperExe = Join-Path $tauriResourcesDir "maintenance-helper.exe"

$cargoArgs = @("build", "-p", "maintenance-helper")
if ($Release) {
  $cargoArgs += "--release"
}

Write-Host "[prepare-helper] Building maintenance-helper ($profile)..."
Push-Location $repoRoot
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
