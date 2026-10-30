# Kiln Suite — creates Windows shortcuts for Gesso and Cutline.
#
# Each shortcut opens the app in Chrome or Edge as its own window (--app mode: no tabs or address bar, its own
# taskbar entry) with the app's icon. Run it by double-clicking "Create Desktop Shortcuts.bat" next to this file,
# or from PowerShell:  powershell -ExecutionPolicy Bypass -File ".\Create Desktop Shortcuts.ps1" [-StartMenu] [-Browser edge]
#
# Nothing is installed and no registry keys are written: the shortcuts point at the index.html files in this
# folder, so moving the folder means running this again.
param(
  [switch]$StartMenu,                 # also add the shortcuts to the Start menu
  [ValidateSet('auto', 'chrome', 'edge')] [string]$Browser = 'auto'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)   # repository root (parent of tools\)

function Find-Browser {
  $chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")
  $edge = @("$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe")
  $order = switch ($Browser) { 'chrome' { $chrome + $edge } 'edge' { $edge + $chrome } default { $chrome + $edge } }
  foreach ($p in $order) { if (Test-Path $p) { return $p } }
  foreach ($cmd in 'chrome.exe', 'msedge.exe') { $c = Get-Command $cmd -ErrorAction SilentlyContinue; if ($c) { return $c.Source } }
  return $null
}

$browser = Find-Browser
if (-not $browser) { Write-Host "Chrome or Edge was not found. Install one of them, then run this again." -ForegroundColor Yellow; exit 1 }
$shell = New-Object -ComObject WScript.Shell
$targets = @(
  @{ Name = 'Gesso';   Html = Join-Path $root 'Gesso\index.html';   Icon = Join-Path $root 'Gesso\gesso.ico';     Desc = 'Gesso — layered image editor (Kiln Suite)' },
  @{ Name = 'Cutline'; Html = Join-Path $root 'Cutline\index.html'; Icon = Join-Path $root 'Cutline\cutline.ico'; Desc = 'Cutline — video editor (Kiln Suite)' }
)
$folders = @([Environment]::GetFolderPath('Desktop'))
if ($StartMenu) { $folders += (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs') }

foreach ($t in $targets) {
  if (-not (Test-Path $t.Html)) { Write-Host "Missing $($t.Html) — is this script still inside the Kiln Suite folder?" -ForegroundColor Yellow; continue }
  $url = 'file:///' + ($t.Html -replace '\\', '/')
  foreach ($dir in $folders) {
    $lnk = Join-Path $dir ($t.Name + '.lnk')
    $s = $shell.CreateShortcut($lnk)
    $s.TargetPath = $browser
    # --app: own window, no browser chrome.  --user-data-dir is NOT set on purpose: the app shares the normal profile,
    # so saved layouts, recent files and granted file handles keep working between the shortcut and a normal tab.
    $s.Arguments = "--app=`"$url`""
    $s.WorkingDirectory = Split-Path -Parent $t.Html
    $s.IconLocation = $t.Icon + ',0'
    $s.Description = $t.Desc
    $s.Save()
    Write-Host "Created $lnk"
  }
}
Write-Host "Done. Shortcuts open with: $browser"
