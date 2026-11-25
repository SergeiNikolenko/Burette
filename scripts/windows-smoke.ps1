# Installs the NSIS build from build/windows for the current user, opens a
# protein and then a small molecule in the running app, saves a screenshot
# after each, and uninstalls. Screenshots go to build/windows-smoke.
#   pwsh scripts/windows-smoke.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$output = Join-Path $root 'build/windows-smoke'
New-Item -ItemType Directory -Force -Path $output | Out-Null

$installer = Get-ChildItem (Join-Path $root 'build/windows') -Filter '*-setup.exe' | Select-Object -First 1
if (-not $installer) { throw 'No NSIS installer in build/windows; run scripts/build-windows.sh first.' }
$installDir = Join-Path $env:LOCALAPPDATA 'Burette'
Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait
$app = Join-Path $installDir 'Burette.exe'
if (-not (Test-Path $app)) { throw "The installer did not create $app" }

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
function Save-Screen([string]$name) {
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
  $bitmap.Save((Join-Path $output $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}

$stderr = Join-Path $output 'burette-stderr.log'
# CI runners have no GPU, and WebView2 no longer falls back to software WebGL
# on its own; this only affects the app started by this script.
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist'
$shell = New-Object -ComObject WScript.Shell
# Escape dismisses the first-run welcome so the screenshots show the documents.
function Dismiss-Welcome {
  $process = Get-Process -Name 'Burette' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($process -and $shell.AppActivate($process.Id)) {
    Start-Sleep -Milliseconds 500
    $shell.SendKeys('{ESC}')
    Start-Sleep -Seconds 3
  }
}
function Assert-Running {
  $running = Get-Process -Name 'Burette' -ErrorAction SilentlyContinue
  if (-not $running) {
    if (Test-Path $stderr) { Get-Content $stderr -Tail 40 | Write-Host }
    throw 'Burette exited during the smoke test.'
  }
}

try {
  Start-Process -FilePath $app -ArgumentList "`"$(Join-Path $root 'samples/structures/proteins/1htb.pdb')`"" `
    -RedirectStandardError $stderr -RedirectStandardOutput (Join-Path $output 'burette-stdout.log')
  Start-Sleep -Seconds 40
  Assert-Running
  Dismiss-Welcome
  Save-Screen '01-protein.png'

  # A second launch hands the file to the running instance.
  Start-Process -FilePath $app -ArgumentList "`"$(Join-Path $root 'samples/collections/sdf/multi.sdf')`""
  Start-Sleep -Seconds 25
  Assert-Running
  if (@(Get-Process -Name 'Burette').Count -ne 1) { throw 'A second Burette process kept running.' }
  Save-Screen '02-molecules.png'
} finally {
  Get-Process -Name 'Burette' -ErrorAction SilentlyContinue | Stop-Process -Force
  $uninstaller = Join-Path $installDir 'uninstall.exe'
  if (Test-Path $uninstaller) { Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait }
}
Write-Host "Windows smoke screenshots: $output"
