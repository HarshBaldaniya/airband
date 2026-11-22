#!/bin/sh
# Installs the Airband desktop app on a Mac and opens it:
#
#   curl -fsSL https://airband.harshbaldaniya.com/install.sh | sh
#
# It picks the file for this Mac (Apple silicon or Intel) from the latest GitHub release, checks it
# against the release's fingerprint, copies Airband to Applications and starts it. A file fetched
# this way isn't marked as downloaded by a browser, so the app opens without a second click.
set -eu

say() { printf '  %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

main() {
  [ "$(uname -s)" = Darwin ] || fail "This installs the Mac app. On Windows: irm https://airband.harshbaldaniya.com/install.ps1 | iex · Anywhere: npx airband"

  # hw.optional.arm64 is 1 on Apple silicon, even in a terminal running under Rosetta.
  if [ "$(sysctl -in hw.optional.arm64 2>/dev/null)" = 1 ]; then kind=Apple-Silicon; else kind=Intel; fi

  tmp=$(mktemp -d)
  trap 'hdiutil detach "$tmp/mnt" -quiet >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT

  printf '\n  \033[1mAirband\033[0m  installing the desktop app\n\n'

  curl -fsSL -H "Accept: application/vnd.github+json" \
    https://api.github.com/repos/HarshBaldaniya/airband/releases/latest -o "$tmp/release.json" \
    || fail "Couldn't reach GitHub. Try again, or download it from https://airband.harshbaldaniya.com/download/"

  # tag, file URL and fingerprint of this Mac's file, read with the JavaScript every Mac has.
  found=$(osascript -l JavaScript - "$tmp/release.json" "$kind" <<'JS'
function run(argv) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null).js;
  const release = JSON.parse(text);
  const file = (release.assets || []).find((a) => a.name.endsWith(`-${argv[1]}.dmg`));
  return file ? [release.tag_name, file.browser_download_url, file.digest || ""].join(" ") : "";
}
JS
  )
  [ -n "$found" ] || fail "The latest release has no file for this Mac yet."
  set -- $found
  tag=$1 url=$2 digest=${3:-}

  curl -fsSL "$url" -o "$tmp/Airband.dmg" || fail "The download stopped. Try again."
  if [ -n "$digest" ]; then
    sum=$(shasum -a 256 "$tmp/Airband.dmg" | cut -d' ' -f1)
    [ "sha256:$sum" = "$digest" ] || fail "The download doesn't match the release's fingerprint, so it wasn't installed."
  fi
  say "✓ Downloaded   Airband ${tag#v} for $(echo "$kind" | tr '-' ' ') Macs"

  hdiutil attach "$tmp/Airband.dmg" -nobrowse -readonly -noautoopen -mountpoint "$tmp/mnt" -quiet \
    || fail "Couldn't open the download."

  # Quit a running copy so the new one replaces it.
  osascript -e 'if application id "dev.airband.app" is running then tell application id "dev.airband.app" to quit' >/dev/null 2>&1 || true
  sleep 1
  pkill -f "/Airband.app/Contents/MacOS/" >/dev/null 2>&1 || true

  # Applications if this account can write there, otherwise the Applications folder in home.
  dir=/Applications
  [ -w "$dir" ] || { dir="$HOME/Applications"; mkdir -p "$dir"; }
  rm -rf "$dir/Airband.app"
  ditto "$tmp/mnt/Airband.app" "$dir/Airband.app" || fail "Couldn't copy Airband to $dir."
  xattr -dr com.apple.quarantine "$dir/Airband.app" 2>/dev/null || true
  say "✓ Installed    $dir/Airband.app"

  open "$dir/Airband.app"
  say "✓ Opened       Roger sets up the rest"
  printf '\n'
}

main "$@"
