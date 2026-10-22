#!/usr/bin/env python3
"""Re-enqueue Food52 recipes missing images, deferred until next UTC midnight."""

from __future__ import annotations

import json
import re
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

DATA = Path("/srv/apps/recipes/data")
QUEUE = DATA / "image_queue.json"
RECIPES = DATA / "recipes"
SOURCE_HTTP_URL_RE = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)


def first_http_url(text: str) -> str | None:
    match = SOURCE_HTTP_URL_RE.search(text)
    if not match:
        return None
    return match.group(0).rstrip(".,);]>\"'").split("#", 1)[0]


def resolve_source_url(recipe_dir: Path, meta: str) -> str | None:
    for key in ("image_source", "source"):
        match = re.search(rf"(?m)^{key}:\s*(.+)$", meta)
        if match:
            val = match.group(1).strip().strip("\"'")
            if val.startswith("http"):
                return val.split("#", 1)[0]
    for path in sorted(recipe_dir.glob("source.*")):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        found = first_http_url(text)
        if found and "food52.com" in found:
            return found
        if found:
            return found
    match = re.search(r"https?://(?:www\.)?food52\.com/[^\s\"'<>]+", meta)
    if match:
        return match.group(0).rstrip(".,);]>\"'").split("#", 1)[0]
    return None


def is_food52(meta: str, text: str) -> bool:
    site_m = re.search(r"(?m)^site:\s*(.+)$", meta)
    site = site_m.group(1).strip().strip("\"'") if site_m else ""
    if "food52" in site:
        return True
    return "food52.com" in meta or "food52.com" in text[:4000]


def main() -> None:
    now = time.time()
    today = datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%d")
    midnight = datetime.fromtimestamp(now, timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    ) + timedelta(days=1)
    until = midnight.timestamp()
    print("utc_now", datetime.fromtimestamp(now, timezone.utc).isoformat())
    print("today", today)
    print("defer_until", midnight.isoformat())

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = DATA / f"image_queue.json.bak.{ts}"
    if QUEUE.exists():
        backup.write_text(QUEUE.read_text())
        print("backed_up", backup.name)

    missing: list[tuple[str, str, str, str, Path]] = []
    has_image = 0
    skipped_no_url = 0
    for cook in sorted(RECIPES.glob("*/recipe.cook")):
        text = cook.read_text(encoding="utf-8", errors="replace")
        parts = text.split("---", 2)
        if len(parts) < 3:
            continue
        meta = parts[1]
        body = parts[2]
        if not is_food52(meta, text):
            continue
        if re.search(r"(?m)^image:\s*\S+", meta):
            has_image += 1
            continue
        source = resolve_source_url(cook.parent, meta)
        if not source:
            skipped_no_url += 1
            continue
        missing.append((cook.parent.name, source, meta, body, cook))

    print("food52_with_image", has_image)
    print("food52_missing_image", len(missing))
    print("food52_missing_no_url", skipped_no_url)

    raw = (
        json.loads(QUEUE.read_text())
        if QUEUE.exists()
        else {"hosts": {}, "jobs": [], "version": 1}
    )
    hosts = dict(raw.get("hosts") or {})
    # Drop existing food52 jobs; rebuild from recipes.
    jobs = [
        job
        for job in (raw.get("jobs") or [])
        if "food52.com" not in (job.get("source_url") or "")
    ]

    hosts["food52.com"] = {
        "blocked_day": today,
        "day": today,
        "fetches_today": 0,
        "next_ok_at": until,
    }

    added = 0
    for slug, source, meta, body, cook in missing:
        lines = []
        for line in meta.splitlines():
            if re.match(r"^image_pending:\s*", line):
                continue
            if re.match(r"^image_source:\s*", line):
                continue
            lines.append(line)
        new_meta_lines = [line for line in lines if line.strip() != ""]
        insert_at = 1 if new_meta_lines else 0
        new_meta_lines[insert_at:insert_at] = [
            "image_pending: true",
            f"image_source: {source}",
        ]
        new_meta = "\n".join(new_meta_lines) + "\n"
        new_text = f"---\n{new_meta}---"
        new_text += body if body.startswith("\n") else "\n" + body
        if not new_text.endswith("\n"):
            new_text += "\n"
        cook.write_text(new_text, encoding="utf-8")

        jobs.append(
            {
                "slug": slug,
                "source_url": source,
                "attempts": 0,
                "last_error": None,
                "next_attempt_at": until,
            }
        )
        added += 1

    payload = {"hosts": hosts, "jobs": jobs, "version": 1}
    QUEUE.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")

    food52_jobs = [job for job in jobs if "food52.com" in (job.get("source_url") or "")]
    print("queue_jobs_total", len(jobs))
    print("food52_jobs", len(food52_jobs))
    print("food52_jobs_added", added)
    print("food52_host", hosts["food52.com"])
    print(
        "all_food52_deferred_to_tomorrow",
        bool(food52_jobs)
        and all(float(job.get("next_attempt_at") or 0) >= until for job in food52_jobs),
    )
    print(
        "remaining_by_host",
        Counter(urlparse(job.get("source_url", "")).netloc for job in jobs).most_common(10),
    )


if __name__ == "__main__":
    main()
