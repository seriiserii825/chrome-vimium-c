#!/usr/bin/env python3
"""Native messaging host: backs up Projects (bs-projects) to a git repo and pushes.

Runs when the user presses Ctrl+E in the Projects panel: Chrome starts this script
(chrome.runtime.sendNativeMessage from background.ts), passing {"projects": [...]}
on stdin in the native messaging framing (4-byte little-endian length + JSON).
It overwrites projects.json in BACKUP_DIR, commits if the content changed and
pushes, then replies with the result so the panel can show it.

Override the target with VIMIUM_PROJECTS_DIR. Log: ~/.cache/vimium-projects-backup.log
"""
import json
import os
import struct
import subprocess
import sys
from datetime import datetime

BACKUP_DIR = os.path.expanduser(os.environ.get("VIMIUM_PROJECTS_DIR", "~/Documents/vimium-tabs"))
FILE_NAME = "projects.json"
LOG_FILE = os.path.expanduser("~/.cache/vimium-projects-backup.log")


def log(msg: str) -> None:
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    with open(LOG_FILE, "a") as f:
        f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")


def read_message() -> dict:
    raw_len = sys.stdin.buffer.read(4)
    if len(raw_len) < 4:
        sys.exit(0)
    (length,) = struct.unpack("<I", raw_len)
    return json.loads(sys.stdin.buffer.read(length))


def send_message(obj: dict) -> None:
    data = json.dumps(obj).encode()
    sys.stdout.buffer.write(struct.pack("<I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", BACKUP_DIR, *args], capture_output=True, text=True)


def backup(projects: list) -> dict:
    os.makedirs(BACKUP_DIR, exist_ok=True)
    path = os.path.join(BACKUP_DIR, FILE_NAME)
    content = json.dumps(projects, ensure_ascii=False, indent=2) + "\n"

    try:
        with open(path) as f:
            changed = f.read() != content
    except FileNotFoundError:
        changed = True

    if changed:
        # Write to a temp file and rename, so a crash never leaves a half-written backup.
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            f.write(content)
        os.replace(tmp, path)

    if git("rev-parse", "--is-inside-work-tree").returncode != 0:
        log(f"saved {len(projects)} projects (not a git repo, no commit)")
        return {"ok": True, "changed": changed, "pushed": False}

    if changed:
        git("add", FILE_NAME)
        commit = git("commit", "-q", "-m", f"backup: {len(projects)} projects", "--", FILE_NAME)
        if commit.returncode != 0:
            log(f"commit failed: {commit.stderr.strip() or commit.stdout.strip()}")
            return {"ok": False, "error": "commit failed"}

    # Push even without changes: retries commits left behind by an earlier failed push.
    if not git("remote").stdout.strip():
        return {"ok": True, "changed": changed, "pushed": False}
    try:
        push = subprocess.run(["git", "-C", BACKUP_DIR, "push", "-q"], capture_output=True, text=True,
                              stdin=subprocess.DEVNULL, timeout=60)
    except subprocess.TimeoutExpired:
        log("push timed out")
        return {"ok": True, "changed": changed, "pushed": False, "pushError": "timeout"}
    if push.returncode != 0:
        err = (push.stderr or push.stdout).strip()
        log(f"push failed: {err}")
        lines = err.splitlines()
        reason = next((l for l in lines if l.startswith(("fatal:", "error:"))), lines[0] if lines else "push failed")
        return {"ok": True, "changed": changed, "pushed": False, "pushError": reason}
    log(f"backup {len(projects)} projects, changed={changed}, pushed")
    return {"ok": True, "changed": changed, "pushed": True}


def main() -> None:
    try:
        msg = read_message()
        projects = msg.get("projects")
        if not isinstance(projects, list):
            send_message({"ok": False, "error": "expected projects array"})
            return
        send_message(backup(projects))
    except Exception as e:  # never let Chrome see a crash without a reply
        log(f"error: {e!r}")
        send_message({"ok": False, "error": str(e)})


if __name__ == "__main__":
    main()
