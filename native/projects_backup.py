#!/usr/bin/env python3
"""Native messaging host: backs up Projects (bs-projects) to a git repo and pushes.

Chrome starts this script once per message (chrome.runtime.sendNativeMessage from
background.ts) in the native messaging framing (4-byte little-endian length + JSON).
Every action starts with `git pull --ff-only`; a pull failure is reported back but
never blocks the action. Replies carry `head` (the repo's HEAD afterwards), which the
extension stores as "last synced" for the next check.

Actions (Ctrl+E runs check, then backup; Ctrl+I runs restore):
  {"action": "check", "projects": [...], "since": sha}
      Did projects.json change in git since `since` (this machine's last backup/restore),
      i.e. was something pushed from another machine? If so, replies with the remote
      projects so the panel can offer merge / overwrite.
  {"projects": [...], "message": str}
      Backup: overwrite projects.json, commit if the content changed (message = the
      extension's description of the edit), push (also retries unpushed commits).
  {"action": "restore", "projects": [...]}
      Replies with projects.json, unless it already equals the extension's projects
      (ignoring updated_at, which changes on every open).

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

# Chrome rejects host replies over 1 MB.
MAX_REPLY = 1024 * 1024 - 1024


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


def is_repo() -> bool:
    return os.path.isdir(BACKUP_DIR) and git("rev-parse", "--is-inside-work-tree").returncode == 0


def has_remote() -> bool:
    return bool(git("remote").stdout.strip())


def head() -> str | None:
    res = git("rev-parse", "HEAD")
    return res.stdout.strip() if res.returncode == 0 else None


def git_error(res: subprocess.CompletedProcess, fallback: str) -> str:
    lines = (res.stderr or res.stdout).strip().splitlines()
    return next((l for l in lines if l.startswith(("fatal:", "error:"))), lines[0] if lines else fallback)


def network_git(*args: str) -> str | None:
    """Runs a pull/push; returns an error line, or None on success."""
    try:
        res = subprocess.run(["git", "-C", BACKUP_DIR, *args], capture_output=True, text=True,
                             stdin=subprocess.DEVNULL, timeout=60)
    except subprocess.TimeoutExpired:
        log(f"git {args[0]} timed out")
        return "timeout"
    if res.returncode != 0:
        err = git_error(res, f"{args[0]} failed")
        log(f"git {args[0]} failed: {err}")
        return err
    return None


def pull() -> str | None:
    if not is_repo() or not has_remote():
        return None
    return network_git("pull", "-q", "--ff-only")


def read_backup() -> list | None:
    try:
        with open(os.path.join(BACKUP_DIR, FILE_NAME)) as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def same_content(a: list, b: list) -> bool:
    """Equal ignoring updated_at, which the extension bumps every time a project is opened."""
    strip = lambda ps: [{k: v for k, v in p.items() if k != "updated_at"} if isinstance(p, dict) else p for p in ps]
    return strip(a) == strip(b)


def with_projects(reply: dict, projects: list) -> dict:
    reply["projects"] = projects
    if len(json.dumps(reply)) > MAX_REPLY:
        return {"ok": False, "error": "backup is over 1 MB, use Ctrl+O with the file"}
    return reply


def check(local_projects: list, since: str | None) -> dict:
    if not is_repo():
        # No git history to compare against — never claim "changed on another machine".
        return {"ok": False, "error": f"{BACKUP_DIR} is not a git repo (fix with native/install.sh <dir>)"}
    pull_error = pull()
    reply = {"ok": True, "remoteChanged": False, "head": head(), "pullError": pull_error}
    remote = read_backup()
    if remote is None or same_content(remote, local_projects):
        return reply
    # Known last sync: changed only if a commit since then touched projects.json.
    # Unknown (first backup from this machine, or the sha is gone): the file differs,
    # so treat it as changed and let the user decide once.
    if since and git("cat-file", "-e", f"{since}^{{commit}}").returncode == 0:
        if git("diff", "--quiet", since, "HEAD", "--", FILE_NAME).returncode == 0:
            return reply
    reply["remoteChanged"] = True
    log(f"check: backup changed since {since or 'never synced'}")
    return with_projects(reply, remote)


def backup(projects: list, message: str | None) -> dict:
    os.makedirs(BACKUP_DIR, exist_ok=True)
    path = os.path.join(BACKUP_DIR, FILE_NAME)
    repo = is_repo()
    pull_error = pull()

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

    if not repo:
        log(f"saved {len(projects)} projects (not a git repo, no commit)")
        return {"ok": True, "changed": changed, "pushed": False}

    if changed:
        git("add", FILE_NAME)
        commit_message = message.strip() if message and message.strip() else f"backup: {len(projects)} projects"
        commit = git("commit", "-q", "-m", commit_message, "--", FILE_NAME)
        if commit.returncode != 0:
            log(f"commit failed: {git_error(commit, 'commit failed')}")
            return {"ok": False, "error": "commit failed", "pullError": pull_error}

    reply = {"ok": True, "changed": changed, "pushed": False, "head": head(), "pullError": pull_error}
    # Push even without changes: retries commits left behind by an earlier failed push.
    if not has_remote():
        return reply
    push_error = network_git("push", "-q")
    if push_error:
        reply["pushError"] = push_error
        return reply
    log(f"backup {len(projects)} projects, changed={changed}, pushed")
    reply["pushed"] = True
    return reply


def restore(local_projects: list) -> dict:
    pull_error = pull()
    remote = read_backup()
    if remote is None:
        return {"ok": False, "error": f"no {FILE_NAME} in {BACKUP_DIR}"}
    reply = {"ok": True, "head": head(), "pullError": pull_error}
    # Nothing changed vs. what the extension already has: skip the merge/import prompt.
    if same_content(remote, local_projects):
        log("restore: already up to date")
        reply["upToDate"] = True
        return reply
    log(f"restore: {len(remote)} projects")
    return with_projects(reply, remote)


def main() -> None:
    try:
        msg = read_message()
        projects = msg.get("projects")
        if not isinstance(projects, list):
            send_message({"ok": False, "error": "expected projects array"})
            return
        action = msg.get("action")
        if action == "check":
            send_message(check(projects, msg.get("since")))
        elif action == "restore":
            send_message(restore(projects))
        else:
            send_message(backup(projects, msg.get("message")))
    except Exception as e:  # never let Chrome see a crash without a reply
        log(f"error: {e!r}")
        send_message({"ok": False, "error": str(e)})


if __name__ == "__main__":
    main()
