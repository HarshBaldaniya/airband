# Installs the Airband desktop app on Windows and starts it:
#
#   irm https://airband.harshbaldaniya.com/install.ps1 | iex
#
# It fetches the installer from the latest GitHub release, checks it against the release's
# fingerprint, installs for this account (no admin rights) and starts Airband.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  function Say($text) { Write-Host "  $text" }
  function Fail($text) { Write-Host "  x $text" -ForegroundColor Red }

  Write-Host ""
  Write-Host "  Airband  installing the desktop app"
  Write-Host ""

  try {
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/HarshBaldaniya/airband/releases/latest' -Headers @{ Accept = 'application/vnd.github+json' }
  } catch {
    Fail "Couldn't reach GitHub. Try again, or download it from https://airband.harshbaldaniya.com/download/"
    return
  }
  $file = $release.assets | Where-Object { $_.name -like 'Airband-Setup-*.exe' } | Select-Object -First 1
  if (-not $file) { Fail 'The latest release has no Windows installer yet.'; return }

  $setup = Join-Path ([IO.Path]::GetTempPath()) $file.name
  try {
    Invoke-WebRequest -Uri $file.browser_download_url -OutFile $setup -UseBasicParsing
  } catch {
    Fail 'The download stopped. Try again.'
    return
  }
  if ($file.digest) {
    $sum = (Get-FileHash -Algorithm SHA256 -Path $setup).Hash.ToLower()
    if ("sha256:$sum" -ne $file.digest) {
      Remove-Item $setup -Force
      Fail "The download doesn't match the release's fingerprint, so it wasn't installed."
      return
    }
  }
  Say "+ Downloaded   Airband $($release.tag_name.TrimStart('v'))"

  # /P: the installer shows its progress and asks nothing. It closes a running Airband itself.
  $run = Start-Process -FilePath $setup -ArgumentList '/P' -Wait -PassThru
  Remove-Item $setup -Force -ErrorAction SilentlyContinue
  $app = Join-Path $env:LOCALAPPDATA 'Airband\airband.exe'
  if ($run.ExitCode -ne 0 -or -not (Test-Path $app)) { Fail 'The installer stopped before it finished.'; return }
  Say "+ Installed    $app"

  Start-Process -FilePath $app
  Say '+ Started      Roger sets up the rest'
  Write-Host ""
}
