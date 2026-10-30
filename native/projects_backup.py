#!/usr/bin/env python3
"""Native messaging host: backs up Projects (bs-projects) to a git repo and pushes.

Runs when the user presses Ctrl+E in the Projects panel: Chrome starts this script
(chrome.runtime.sendNativeMessage from background.ts), passing {"projects": [...]}
on stdin in the native messaging framing (4-byte little-endian length + JSON).
It overwrites projects.json in BACKUP_DIR, commits if the content changed and
pushes, then replies with the result so the panel can show it.

{"action": "restore"} (Ctrl+I) does the reverse: `git pull --ff-only` (to pick up a
backup pushed from another machine), then replies with the projects from projects.json.

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


def backup(projects: list, message: str | None) -> dict:
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
        # The extension names the last edit (e.g. "update: My Project"); falls back to a
        # generic message if it's missing or blank (e.g. an older client without this field).
        commit_message = message.strip() if message and message.strip() else f"backup: {len(projects)} projects"
        commit = git("commit", "-q", "-m", commit_message, "--", FILE_NAME)
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


# Chrome rejects host replies over 1 MB.
MAX_REPLY = 1024 * 1024 - 1024


def restore(local_projects: list) -> dict:
    path = os.path.join(BACKUP_DIR, FILE_NAME)
    pull_error = None
    if git("remote").stdout.strip():
        try:
            pull = subprocess.run(["git", "-C", BACKUP_DIR, "pull", "-q", "--ff-only"], capture_output=True,
                                  text=True, stdin=subprocess.DEVNULL, timeout=60)
            if pull.returncode != 0:
                lines = (pull.stderr or pull.stdout).strip().splitlines()
                pull_error = next((l for l in lines if l.startswith(("fatal:", "error:"))), lines[0] if lines else "pull failed")
        except subprocess.TimeoutExpired:
            pull_error = "pull timed out"
        if pull_error:
            log(f"pull failed: {pull_error}")
    try:
        with open(path) as f:
            projects = json.load(f)
    except FileNotFoundError:
        return {"ok": False, "error": f"no {FILE_NAME} in {BACKUP_DIR}"}

    # Nothing changed vs. what the extension already has: skip the merge/import prompt.
    if projects == local_projects:
        log("restore: already up to date")
        return {"ok": True, "upToDate": True, "pullError": pull_error}

    reply = {"ok": True, "projects": projects, "pullError": pull_error}
    if len(json.dumps(reply)) > MAX_REPLY:
        return {"ok": False, "error": "backup is over 1 MB, use Ctrl+O with the file"}
    log(f"restore: {len(projects)} projects")
    return reply


def main() -> None:
    try:
        msg = read_message()
        if msg.get("action") == "restore":
            local_projects = msg.get("projects")
            send_message(restore(local_projects if isinstance(local_projects, list) else []))
            return
        projects = msg.get("projects")
        if not isinstance(projects, list):
            send_message({"ok": False, "error": "expected projects array"})
            return
        send_message(backup(projects, msg.get("message")))
    except Exception as e:  # never let Chrome see a crash without a reply
        log(f"error: {e!r}")
        send_message({"ok": False, "error": str(e)})


if __name__ == "__main__":
    main()
