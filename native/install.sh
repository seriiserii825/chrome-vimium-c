#!/usr/bin/env bash
# Registers the Projects backup native messaging host for Chrome / Chromium.
# Usage: native/install.sh [backup-dir]   (default: ~/Documents/vimium-tabs)
set -euo pipefail

HOST_NAME="com.bs.vimium_projects"
# Fixed by the "key" in manifest.json — the same on every machine and path.
EXTENSION_ID="ecpabanjdgnmfemepdgoimbhlbdmmhnh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_SCRIPT="$SCRIPT_DIR/projects_backup.py"
chmod +x "$HOST_SCRIPT"

# Chrome passes no custom args/env to hosts, so a non-default dir goes into a wrapper.
HOST_PATH="$HOST_SCRIPT"
if [[ $# -ge 1 ]]; then
  BACKUP_DIR="$(realpath -m "$1")"
  HOST_PATH="$SCRIPT_DIR/projects_backup.local.sh"
  printf '#!/usr/bin/env bash\nVIMIUM_PROJECTS_DIR=%q exec %q "$@"\n' "$BACKUP_DIR" "$HOST_SCRIPT" > "$HOST_PATH"
  chmod +x "$HOST_PATH"
fi

installed=0
for dir in \
  "$HOME/.config/google-chrome/NativeMessagingHosts" \
  "$HOME/.config/chromium/NativeMessagingHosts" \
  "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"; do
  [[ -d "$(dirname "$dir")" ]] || continue
  mkdir -p "$dir"
  cat > "$dir/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "chrome-vimium-c Projects backup to git",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF
  echo "installed: $dir/$HOST_NAME.json"
  installed=1
done

[[ $installed -eq 1 ]] || { echo "no Chrome/Chromium/Brave profile found" >&2; exit 1; }
echo "backup dir: ${BACKUP_DIR:-$HOME/Documents/vimium-tabs}"
echo "log: ~/.cache/vimium-projects-backup.log"
