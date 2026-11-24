#!/bin/sh
# Installs the Airband desktop app on a Mac and opens it:
#
#   curl -fsSL https://airband.harshbaldaniya.com/install.sh | sh
#
# It picks the file for this Mac (Apple silicon or Intel) from the newest GitHub release that has
# one (while a new release is still being built, that is the one before), checks it
# against the release's fingerprint, copies Airband to Applications and starts it. A file fetched
# this way isn't marked as downloaded by a browser, so the app opens without a second click.
# Each step shows as one line: a spinner while it runs (with how much is downloaded), a tick after.
set -eu

if [ -t 1 ]; then
  tty=1 bold='\033[1m' dim='\033[2m' warm='\033[38;5;209m' ok='\033[32m' bad='\033[31m' off='\033[0m' clear='\r\033[K'
else
  tty=0 bold='' dim='' warm='' ok='' bad='' off='' clear=''
fi

done_line() { printf "${clear}  ${ok}✓${off} %-12s %s\n" "$1" "$2"; }
fail() { printf "${clear}  ${bad}✗${off} %s\n\n" "$*" >&2; exit 1; }

# Runs a command in the background while one line says what is happening. With $want (bytes) and
# $into (a file) set, the line also says how much of the file is in.
want='' into=''
# curl, quiet (these lines say what happened), failing on an error page, and trying again when
# GitHub answers a moment's error.
get='-fsL --retry 3 --retry-all-errors --retry-delay 2 --connect-timeout 15'
spin() {
  label=$1 what=$2
  shift 2
  "$@" &
  pid=$!
  if [ "$tty" = 1 ]; then
    i=0
    while kill -0 "$pid" 2>/dev/null; do
      case $i in 0) c=⠋ ;; 1) c=⠙ ;; 2) c=⠹ ;; 3) c=⠸ ;; 4) c=⠼ ;; 5) c=⠴ ;; 6) c=⠦ ;; 7) c=⠧ ;; 8) c=⠇ ;; *) c=⠏ ;; esac
      i=$(((i + 1) % 10))
      more=''
      if [ -n "$want" ] && [ -f "$into" ]; then
        got=$(wc -c <"$into" | tr -d ' ')
        more=$(awk -v g="$got" -v w="$want" 'BEGIN { p = int(g * 100 / w); if (p > 99) p = 99; printf "  %.1f of %.1f MB · %d%%", g / 1048576, w / 1048576, p }')
      fi
      printf "${clear}  ${warm}%s${off} %-12s ${dim}%s%s${off}" "$c" "$label" "$what" "$more"
      sleep 0.1
    done
  fi
  wait "$pid"
}

main() {
  [ "$(uname -s)" = Darwin ] || fail "This installs the Mac app. On Windows: irm https://airband.harshbaldaniya.com/install.ps1 | iex · Anywhere: npx airband"

  # hw.optional.arm64 is 1 on Apple silicon, even in a terminal running under Rosetta.
  # The release files are named in desktop/downloads.json; scripts/check-release.mjs checks this
  # script still names them the same.
  if [ "$(sysctl -in hw.optional.arm64 2>/dev/null)" = 1 ]; then kind=Apple-Silicon; else kind=Intel; fi
  chip=$(echo "$kind" | tr '-' ' ')

  tmp=$(mktemp -d)
  trap 'hdiutil detach "$tmp/mnt" -quiet >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT

  printf "\n  ${warm}●${off} ${bold}Airband${off}\n"
  printf "    Installing Roger, who keeps an ear on your AI coding chats.\n\n"

  # GitHub's API first: it says which release has a file for this Mac, its size and fingerprint.
  # It is tried four times (it can answer 502 or 504 for a moment), quietly: these lines say what
  # happened. If it still doesn't answer, or this network has used its hourly API allowance, the
  # newest finished release's update file names the version (it is published once every file is up).
  found=''
  if spin "Looking" "for the newest Airband" curl $get -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/HarshBaldaniya/airband/releases?per_page=20" -o "$tmp/release.json"; then
    # tag, file URL, size and fingerprint of this Mac's file, read with the JavaScript every Mac has.
    found=$(osascript -l JavaScript - "$tmp/release.json" "$kind" <<'JS'
function run(argv) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null).js;
  // Newest first: the first release with a file for this Mac.
  for (const release of JSON.parse(text)) {
    if (release.draft || release.prerelease) continue;
    const file = (release.assets || []).find((a) => a.name.endsWith(`-${argv[1]}.dmg`));
    if (file) return [release.tag_name, file.browser_download_url, file.size || 0, file.digest || ""].join(" ");
  }
  return "";
}
JS
    ) || found=''
    [ -n "$found" ] || fail "No release has a file for this Mac yet."
  elif spin "Looking" "on GitHub's download server" curl $get \
    https://github.com/HarshBaldaniya/airband/releases/latest/download/latest.json -o "$tmp/latest.json"; then
    v=$(osascript -l JavaScript - "$tmp/latest.json" <<'JS'
function run(argv) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null).js;
  return JSON.parse(text).version || "";
}
JS
    ) || v=''
    [ -n "$v" ] || fail "Couldn't read which version is newest. Try again in a minute."
    found="v$v https://github.com/HarshBaldaniya/airband/releases/download/v$v/Airband-$v-$kind.dmg 0"
  else
    fail "Couldn't reach GitHub. Try again in a minute, or download it from https://airband.harshbaldaniya.com/download/"
  fi
  set -- $found
  tag=$1 url=$2 size=${3:-0} digest=${4:-}
  done_line "Found" "Airband ${tag#v} for $chip Macs"

  if [ "$size" -gt 0 ] 2>/dev/null; then want=$size; fi
  into="$tmp/Airband.dmg"
  spin "Downloading" "Airband ${tag#v}" curl $get "$url" -o "$tmp/Airband.dmg" || fail "The download stopped. Try again."
  want='' into=''
  done_line "Downloaded" "$(awk -v b="$(wc -c <"$tmp/Airband.dmg" | tr -d ' ')" 'BEGIN { printf "%.1f MB", b / 1048576 }')"

  if [ -n "$digest" ]; then
    sum=$(shasum -a 256 "$tmp/Airband.dmg" | cut -d' ' -f1)
    [ "sha256:$sum" = "$digest" ] || fail "The download doesn't match the release's fingerprint, so it wasn't installed."
    done_line "Checked" "it matches the release's fingerprint"
  fi

  spin "Installing" "opening the download" hdiutil attach "$tmp/Airband.dmg" -nobrowse -readonly -noautoopen -mountpoint "$tmp/mnt" -quiet \
    || fail "Couldn't open the download."

  # Quit a running copy so the new one replaces it.
  osascript -e 'if application id "dev.airband.app" is running then tell application id "dev.airband.app" to quit' >/dev/null 2>&1 || true
  sleep 1
  pkill -f "/Airband.app/Contents/MacOS/" >/dev/null 2>&1 || true

  # Applications if this account can write there, otherwise the Applications folder in home.
  dir=/Applications
  [ -w "$dir" ] || { dir="$HOME/Applications"; mkdir -p "$dir"; }
  rm -rf "$dir/Airband.app"
  spin "Installing" "into $dir" ditto "$tmp/mnt/Airband.app" "$dir/Airband.app" || fail "Couldn't copy Airband to $dir."
  xattr -dr com.apple.quarantine "$dir/Airband.app" 2>/dev/null || true
  done_line "Installed" "$dir/Airband.app"

  open "$dir/Airband.app"
  done_line "Opened" "Roger is on his way to the corner of your screen"
  printf "\n  Done. Roger sets up the rest and says hello in a moment.\n\n"
}

main "$@"
