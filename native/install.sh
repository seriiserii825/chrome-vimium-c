#!/usr/bin/env bash
# Registers the native messaging hosts for Chrome / Chromium / Brave:
#   com.bs.vimium_projects  — Projects backup  (projects_backup.py)
#   com.bs.vimium_timecodes — YouTube timecodes (timecodes_backup.py)
# Usage: native/install.sh [projects-dir]   (default: ~/Documents/vimium-tabs)
# Without an argument an existing projects_backup.local.sh (custom dir) is kept.
# Timecodes go to ~/Documents/youtube-timecodes (override: VIMIUM_TIMECODES_DIR=<dir> native/install.sh).
set -euo pipefail

# Fixed by the "key" in manifest.json — the same on every machine and path.
EXTENSION_ID="ecpabanjdgnmfemepdgoimbhlbdmmhnh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECTS_SCRIPT="$SCRIPT_DIR/projects_backup.py"
TIMECODES_SCRIPT="$SCRIPT_DIR/timecodes_backup.py"
chmod +x "$PROJECTS_SCRIPT" "$TIMECODES_SCRIPT"

# Chrome passes no custom args/env to hosts, so a non-default dir goes into a wrapper.
PROJECTS_PATH="$PROJECTS_SCRIPT"
PROJECTS_WRAPPER="$SCRIPT_DIR/projects_backup.local.sh"
if [[ $# -ge 1 ]]; then
  PROJECTS_DIR="$(realpath -m "$1")"
  printf '#!/usr/bin/env bash\nVIMIUM_PROJECTS_DIR=%q exec %q "$@"\n' "$PROJECTS_DIR" "$PROJECTS_SCRIPT" > "$PROJECTS_WRAPPER"
  chmod +x "$PROJECTS_WRAPPER"
  PROJECTS_PATH="$PROJECTS_WRAPPER"
elif [[ -x "$PROJECTS_WRAPPER" ]]; then
  PROJECTS_PATH="$PROJECTS_WRAPPER"
fi

TIMECODES_PATH="$TIMECODES_SCRIPT"
if [[ -n "${VIMIUM_TIMECODES_DIR:-}" ]]; then
  TIMECODES_PATH="$SCRIPT_DIR/timecodes_backup.local.sh"
  printf '#!/usr/bin/env bash\nVIMIUM_TIMECODES_DIR=%q exec %q "$@"\n' "$(realpath -m "$VIMIUM_TIMECODES_DIR")" "$TIMECODES_SCRIPT" > "$TIMECODES_PATH"
  chmod +x "$TIMECODES_PATH"
fi

write_manifest() { # dir name description path
  cat > "$1/$2.json" <<EOF
{
  "name": "$2",
  "description": "$3",
  "path": "$4",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF
  echo "installed: $1/$2.json"
}

installed=0
for dir in \
  "$HOME/.config/google-chrome/NativeMessagingHosts" \
  "$HOME/.config/chromium/NativeMessagingHosts" \
  "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"; do
  [[ -d "$(dirname "$dir")" ]] || continue
  mkdir -p "$dir"
  write_manifest "$dir" com.bs.vimium_projects "chrome-vimium-c Projects backup to git" "$PROJECTS_PATH"
  write_manifest "$dir" com.bs.vimium_timecodes "chrome-vimium-c YouTube timecodes backup to git" "$TIMECODES_PATH"
  installed=1
done

[[ $installed -eq 1 ]] || { echo "no Chrome/Chromium/Brave profile found" >&2; exit 1; }
echo "projects host: $PROJECTS_PATH"
echo "timecodes host: $TIMECODES_PATH"
echo "logs: ~/.cache/vimium-projects-backup.log, ~/.cache/vimium-timecodes-backup.log"
