# Installs the Airband desktop app on Windows and starts it:
#
#   irm https://airband.harshbaldaniya.com/install.ps1 | iex
#
# It fetches the installer from the newest GitHub release that has one (while a new release is
# still being built, that is the one before), checks it against the release's
# fingerprint, installs for this account (no admin rights) and starts Airband. Each step shows as
# one line: a spinner while it runs (with how much is downloaded), a tick after.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  # Windows Terminal and PowerShell 7 draw ticks and the spinner; the old console gets plain ones.
  $fancy = $env:WT_SESSION -or $PSVersionTable.PSVersion.Major -ge 7
  $tick = if ($fancy) { [string][char]0x2713 } else { '+' }
  $frames = if ($fancy) { [char[]]@(0x280B, 0x2819, 0x2839, 0x2838, 0x283C, 0x2834, 0x2826, 0x2827, 0x2807, 0x280F) } else { [char[]]'|/-\' }
  $width = try { [Math]::Max(40, [Console]::WindowWidth - 1) } catch { 79 }
  $dot = [char]0x00B7

  function Clear-Line { Write-Host -NoNewline ("`r" + (' ' * $width) + "`r") }
  function Done($label, $text) { Clear-Line; Write-Host "  " -NoNewline; Write-Host $tick -ForegroundColor Green -NoNewline; Write-Host (" {0,-12} {1}" -f $label, $text) }
  function Fail($text) { Clear-Line; Write-Host "  x $text" -ForegroundColor Red; Write-Host "" }
  $script:frame = 0
  function Spin($label, $text) {
    $c = $frames[$script:frame % $frames.Length]
    $script:frame++
    $line = (" {0,-12} {1}" -f $label, $text)
    if ($line.Length -gt $width - 4) { $line = $line.Substring(0, $width - 4) }
    Write-Host -NoNewline "`r  "
    Write-Host -NoNewline $c -ForegroundColor DarkYellow
    Write-Host -NoNewline ($line.PadRight($width - 3)) -ForegroundColor DarkGray
  }
  function MB($bytes) { '{0:N1} MB' -f ($bytes / 1MB) }

  Write-Host ""
  Write-Host "  " -NoNewline; Write-Host ([char]0x25CF) -ForegroundColor DarkYellow -NoNewline; Write-Host " Airband"
  Write-Host "    Installing Roger, who keeps an ear on your AI coding chats."
  Write-Host ""

  # Asked up to four times: GitHub can answer 502 or 504 for a moment.
  function Ask($uri, $headers) {
    for ($try = 1; $try -le 4; $try++) {
      try { return Invoke-RestMethod -Uri $uri -Headers $headers -TimeoutSec 20 } catch { if ($try -lt 4) { Start-Sleep -Seconds 2 } }
    }
    return $null
  }

  # GitHub's API first: it says which release has an installer, its size and fingerprint. If it
  # doesn't answer, or this network has used its hourly API allowance, the newest finished
  # release's update file names the version (it is published once every file is up).
  Spin 'Looking' 'for the newest Airband'
  $file = $null
  $version = $null
  $releases = Ask 'https://api.github.com/repos/HarshBaldaniya/airband/releases?per_page=20' @{ Accept = 'application/vnd.github+json'; 'User-Agent' = 'airband-install' }
  if ($releases) {
    # Newest first: the first release with a Windows installer.
    foreach ($r in $releases) {
      if ($r.draft -or $r.prerelease) { continue }
      $file = $r.assets | Where-Object { $_.name -like 'Airband-Setup-*.exe' } | Select-Object -First 1
      if ($file) { $version = $r.tag_name.TrimStart('v'); break }
    }
    if (-not $file) { Fail 'No release has a Windows installer yet.'; return }
  } else {
    Spin 'Looking' "on GitHub's download server"
    $latest = Ask 'https://github.com/HarshBaldaniya/airband/releases/latest/download/latest.json' @{ 'User-Agent' = 'airband-install' }
    if (-not $latest -or -not $latest.version) {
      Fail "Couldn't reach GitHub. Try again in a minute, or download it from https://airband.harshbaldaniya.com/download/"
      return
    }
    $version = $latest.version
    $name = "Airband-Setup-$version.exe"
    $file = [pscustomobject]@{ name = $name; size = 0; digest = $null; browser_download_url = "https://github.com/HarshBaldaniya/airband/releases/download/v$version/$name" }
  }
  Done 'Found' "Airband $version for Windows"

  # Downloaded in the background, so the line can say how much is in.
  $setup = Join-Path ([IO.Path]::GetTempPath()) $file.name
  $web = New-Object Net.WebClient
  $web.Headers.Add('User-Agent', 'airband-install')
  $task = $web.DownloadFileTaskAsync($file.browser_download_url, $setup)
  while (-not $task.IsCompleted) {
    $got = if (Test-Path $setup) { (Get-Item $setup).Length } else { 0 }
    $more = if ($file.size -gt 0) { '  {0} of {1} {2} {3}%' -f (MB $got), (MB $file.size), $dot, [Math]::Min(99, [int]($got * 100 / $file.size)) } else { '' }
    Spin 'Downloading' "Airband $version$more"
    Start-Sleep -Milliseconds 100
  }
  $web.Dispose()
  if ($task.IsFaulted) {
    Remove-Item $setup -Force -ErrorAction SilentlyContinue
    Fail 'The download stopped. Try again.'
    return
  }
  Done 'Downloaded' (MB (Get-Item $setup).Length)

  if ($file.digest) {
    $sum = (Get-FileHash -Algorithm SHA256 -Path $setup).Hash.ToLower()
    if ("sha256:$sum" -ne $file.digest) {
      Remove-Item $setup -Force
      Fail "The download doesn't match the release's fingerprint, so it wasn't installed."
      return
    }
    Done 'Checked' "it matches the release's fingerprint"
  }

  # /P: the installer shows its progress and asks nothing. It closes a running Airband itself.
  $run = Start-Process -FilePath $setup -ArgumentList '/P' -PassThru
  # Held now, so the exit code can be read once it ends.
  $null = $run.Handle
  while (-not $run.HasExited) {
    Spin 'Installing' 'for this account, no admin rights needed'
    Start-Sleep -Milliseconds 100
  }
  Remove-Item $setup -Force -ErrorAction SilentlyContinue
  $app = Join-Path $env:LOCALAPPDATA 'Airband\airband.exe'
  if ($run.ExitCode -ne 0 -or -not (Test-Path $app)) { Fail 'The installer stopped before it finished.'; return }
  Done 'Installed' $app

  Start-Process -FilePath $app
  Done 'Started' 'Roger is on his way to the corner of your screen'
  Write-Host ""
  Write-Host "  Done. Roger sets up the rest and says hello in a moment."
  Write-Host ""
}
