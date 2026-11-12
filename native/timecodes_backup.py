#!/usr/bin/env python3
"""Native messaging host: backs up YouTube timecodes (bs-timecodes) to a git repo and pushes.

Same framing and git flow as projects_backup.py, but one file per video:
<dir>/<transliterated-title>.json = {"videoId", "title", "url", "timecodes": [{"seconds", "name"}]}.
The file for a video is found by its videoId (so a renamed video keeps its file); a new
video gets a slug of its title (Cyrillic → Latin, same table as go-scripts cyr-to-lat).

Actions (`ve` runs check, then backup; `vi` runs restore):
  {"action": "check", "videoId", "timecodes": [...], "since": sha}
      Did this video's file change in git since `since` (this machine's last sync)?
      If so, replies with the remote timecodes so the extension can offer merge / overwrite.
  {"action": "backup", "videoId", "title", "timecodes": [...]}
      Writes the video's file, commits it if it changed, pushes (also retries unpushed commits).
  {"action": "restore"}
      Replies with the timecodes of every *.json in the folder (also the old export format:
      an array of {videoId, seconds, name}).

Override the folder with VIMIUM_TIMECODES_DIR. Log: ~/.cache/vimium-timecodes-backup.log
"""
import glob
import json
import os
import re
import struct
import subprocess
import sys
from datetime import datetime

BACKUP_DIR = os.path.expanduser(os.environ.get("VIMIUM_TIMECODES_DIR", "~/Documents/youtube-timecodes"))
LOG_FILE = os.path.expanduser("~/.cache/vimium-timecodes-backup.log")

# Chrome rejects host replies over 1 MB.
MAX_REPLY = 1024 * 1024 - 1024

# go-scripts/scripts/cyr_to_lat.go
CYR_TO_LAT = {
    "Ё": "YO", "Й": "I", "Ц": "TS", "У": "U", "К": "K", "Е": "E", "Н": "N",
    "Г": "G", "Ш": "SH", "Щ": "SCH", "З": "Z", "Х": "H", "Ъ": "I", "Ф": "F",
    "Ы": "I", "В": "V", "А": "A", "П": "P", "Р": "R", "О": "O", "Л": "L",
    "Д": "D", "Ж": "ZH", "Э": "E", "Я": "Ya", "Ч": "CH", "С": "S", "М": "M",
    "И": "I", "Т": "T", "Ь": "I", "Б": "B", "Ю": "YU",
    "ё": "yo", "й": "i", "ц": "ts", "у": "u", "к": "k", "е": "e", "н": "n",
    "г": "g", "ш": "sh", "щ": "sch", "з": "z", "х": "h", "ъ": "i", "ф": "f",
    "ы": "i", "в": "v", "а": "a", "п": "p", "р": "r", "о": "o", "л": "l",
    "д": "d", "ж": "zh", "э": "e", "я": "ya", "ч": "ch", "с": "s", "м": "m",
    "и": "i", "т": "t", "ь": "i", "б": "b", "ю": "yu",
}


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


# --- git (same as projects_backup.py) ---

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


# --- files ---

def slugify(title: str) -> str:
    latin = "".join(CYR_TO_LAT.get(ch, ch) for ch in title).lower()
    slug = re.sub(r"[^a-z0-9]+", "-", latin).strip("-")
    return slug[:80].rstrip("-")


def load_json(path: str):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def json_files() -> list[str]:
    return sorted(glob.glob(os.path.join(BACKUP_DIR, "*.json")))


def find_video_file(video_id: str) -> str | None:
    for path in json_files():
        data = load_json(path)
        if isinstance(data, dict) and data.get("videoId") == video_id:
            return path
    return None


def new_video_file(video_id: str, title: str) -> str:
    slug = slugify(title) or video_id
    path = os.path.join(BACKUP_DIR, f"{slug}.json")
    if os.path.exists(path):  # another video (or an old export) with the same name
        path = os.path.join(BACKUP_DIR, f"{slug}-{video_id}.json")
    return path


def clean(timecodes) -> list[dict]:
    """[{seconds, name}] sorted by time, without duplicates or junk."""
    seen = {}
    for t in timecodes if isinstance(timecodes, list) else []:
        if isinstance(t, dict) and isinstance(t.get("seconds"), (int, float)):
            seen.setdefault(int(t["seconds"]), t.get("name") if isinstance(t.get("name"), str) else "")
    return [{"seconds": s, "name": n} for s, n in sorted(seen.items())]


def file_timecodes(path: str | None) -> list[dict] | None:
    data = load_json(path) if path else None
    return clean(data.get("timecodes")) if isinstance(data, dict) else None


def rel(path: str) -> str:
    return os.path.basename(path)


# --- actions ---

def check(video_id: str, local: list, since: str | None) -> dict:
    pull_error = pull()
    path = find_video_file(video_id)
    reply = {"ok": True, "remoteChanged": False, "head": head(), "pullError": pull_error,
             "file": rel(path) if path else None}
    remote = file_timecodes(path)
    if remote is None or remote == clean(local):
        return reply
    # Known last sync: changed only if a commit since then touched this file.
    # Unknown (never synced, or the sha is gone): the file differs, let the user decide.
    if since and git("cat-file", "-e", f"{since}^{{commit}}").returncode == 0:
        if git("diff", "--quiet", since, "HEAD", "--", rel(path)).returncode == 0:
            return reply
    log(f"check: {rel(path)} changed since {since or 'never synced'}")
    reply["remoteChanged"] = True
    reply["timecodes"] = remote
    return reply


def backup(video_id: str, title: str, timecodes: list) -> dict:
    os.makedirs(BACKUP_DIR, exist_ok=True)
    repo = is_repo()
    pull_error = pull()
    path = find_video_file(video_id) or new_video_file(video_id, title)
    entries = clean(timecodes)
    content = json.dumps({
        "videoId": video_id,
        "title": title,
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "timecodes": entries,
    }, ensure_ascii=False, indent=2) + "\n"
    try:
        with open(path) as f:
            changed = f.read() != content
    except FileNotFoundError:
        changed = True

    if changed:
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            f.write(content)
        os.replace(tmp, path)

    reply = {"ok": True, "changed": changed, "pushed": False, "file": rel(path), "pullError": pull_error}
    if not repo:
        log(f"saved {rel(path)} (not a git repo, no commit)")
        return reply

    if changed:
        git("add", "--", rel(path))
        commit = git("commit", "-q", "-m", f"timecodes: {title} ({len(entries)})", "--", rel(path))
        if commit.returncode != 0:
            log(f"commit failed: {git_error(commit, 'commit failed')}")
            return {"ok": False, "error": "commit failed", "pullError": pull_error}

    reply["head"] = head()
    # Push even without changes: retries commits left behind by an earlier failed push.
    if not has_remote():
        return reply
    push_error = network_git("push", "-q")
    if push_error:
        reply["pushError"] = push_error
        return reply
    log(f"backup {rel(path)}: {len(entries)} timecodes, changed={changed}, pushed")
    reply["pushed"] = True
    return reply


def restore() -> dict:
    pull_error = pull()
    if not os.path.isdir(BACKUP_DIR):
        return {"ok": False, "error": f"no folder {BACKUP_DIR}"}
    entries = []
    for path in json_files():
        data = load_json(path)
        if isinstance(data, dict) and isinstance(data.get("videoId"), str):
            entries += [{"videoId": data["videoId"], **t} for t in clean(data.get("timecodes"))]
        elif isinstance(data, list):  # old export: [{videoId, seconds, name}]
            for e in data:
                if isinstance(e, dict) and isinstance(e.get("videoId"), str) and isinstance(e.get("seconds"), (int, float)):
                    entries.append({"videoId": e["videoId"], "seconds": int(e["seconds"]),
                                    "name": e.get("name") if isinstance(e.get("name"), str) else ""})
    reply = {"ok": True, "head": head(), "pullError": pull_error, "timecodes": entries}
    if len(json.dumps(reply)) > MAX_REPLY:
        return {"ok": False, "error": "backup is over 1 MB"}
    log(f"restore: {len(entries)} timecodes")
    return reply


def main() -> None:
    try:
        msg = read_message()
        action = msg.get("action")
        if action == "restore":
            send_message(restore())
            return
        video_id = msg.get("videoId")
        timecodes = msg.get("timecodes")
        if not isinstance(video_id, str) or not re.fullmatch(r"[\w-]+", video_id) or not isinstance(timecodes, list):
            send_message({"ok": False, "error": "expected videoId and timecodes"})
        elif action == "check":
            send_message(check(video_id, timecodes, msg.get("since")))
        elif action == "backup":
            title = msg.get("title") if isinstance(msg.get("title"), str) and msg["title"].strip() else video_id
            send_message(backup(video_id, title.strip(), timecodes))
        else:
            send_message({"ok": False, "error": f"unknown action {action!r}"})
    except Exception as e:  # never let Chrome see a crash without a reply
        log(f"error: {e!r}")
        send_message({"ok": False, "error": str(e)})


if __name__ == "__main__":
    main()
