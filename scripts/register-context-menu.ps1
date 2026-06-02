# Optional: register a "Process with Veloxa Watermark Studio" right-click menu
# entry for PDF/DOCX/PPTX files. Run as the current user (no admin required).
#
# Usage (after installing the app to its default location):
#   powershell -ExecutionPolicy Bypass -File register-context-menu.ps1
#
# To remove:
#   powershell -ExecutionPolicy Bypass -File register-context-menu.ps1 -Uninstall

param([switch]$Uninstall)

$AppName  = 'Veloxa Watermark Studio'
$ExeGuess = Join-Path $env:LOCALAPPDATA "Programs\Veloxa Watermark Studio\Veloxa Watermark Studio.exe"

if (-not (Test-Path $ExeGuess)) {
  Write-Warning "App executable not found at $ExeGuess — pass the path manually if needed."
}

$Targets = @('SystemFileAssociations\.pdf', 'SystemFileAssociations\.docx', 'SystemFileAssociations\.pptx')

foreach ($t in $Targets) {
  $key = "HKCU:\Software\Classes\$t\shell\VeloxaWatermarkStudio"
  if ($Uninstall) {
    if (Test-Path $key) { Remove-Item $key -Recurse -Force }
    continue
  }
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name '(default)' -Value "Process with $AppName"
  Set-ItemProperty -Path $key -Name 'Icon' -Value "`"$ExeGuess`""
  $cmd = "$key\command"
  New-Item -Path $cmd -Force | Out-Null
  Set-ItemProperty -Path $cmd -Name '(default)' -Value "`"$ExeGuess`" `"%1`""
}

if ($Uninstall) { Write-Host "Removed Veloxa context menu entries." }
else { Write-Host "Registered Veloxa context menu for PDF/DOCX/PPTX." }
