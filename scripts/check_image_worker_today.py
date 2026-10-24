#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

DATA = Path("/srv/apps/recipes/data")
QUEUE = DATA / "image_queue.json"
RECIPES = DATA / "recipes"


def main() -> None:
    print("utc_now", datetime.now(timezone.utc).isoformat())
    data = json.loads(QUEUE.read_text())
    jobs = data.get("jobs") or []
    hosts = data.get("hosts") or {}
    print("jobs_remaining", len(jobs))
    print("remaining_by_host:")
    for host, count in Counter(
        urlparse(job.get("source_url", "")).netloc for job in jobs
    ).most_common(15):
        print(f"  {count:4d}  {host}")

    food52 = hosts.get("food52.com")
    print("food52_host", json.dumps(food52, indent=2))
    print("active_hosts:")
    for host, value in sorted(hosts.items()):
        if not isinstance(value, dict):
            continue
        if value.get("fetches_today") or value.get("blocked_day") or value.get("day"):
            print(
                f"  {host}: day={value.get('day')} fetches={value.get('fetches_today')} "
                f"blocked_day={value.get('blocked_day')}"
            )

    since = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")
    result = subprocess.run(
        ["docker", "logs", "recipes-image-worker", "--since", since],
        capture_output=True,
        text=True,
        check=False,
    )
    lines = (result.stdout or "").splitlines() + (result.stderr or "").splitlines()
    counts: Counter[str] = Counter()
    blocked_events: list[str] = []
    gave_up: list[str] = []
    fetched_examples: list[str] = []
    for line in lines:
        if "fetched " in line:
            counts["fetched"] += 1
            if len(fetched_examples) < 5:
                fetched_examples.append(line.strip()[-140:])
        if "trying Iframely" in line:
            counts["iframely"] += 1
        if "blocked host" in line:
            counts["host_blocked"] += 1
            blocked_events.append(line.strip())
        if "daily limit reached" in line:
            counts["daily_limit"] += 1
        if "giving up" in line:
            counts["gave_up"] += 1
            if len(gave_up) < 8:
                gave_up.append(line.strip()[-140:])
        if "processing " in line:
            counts["batches"] += 1
        if "starting worker" in line:
            counts["restarts"] += 1

    print("log_counts_since_utc_midnight", dict(counts))
    print("block_events:")
    for event in blocked_events[-10:]:
        print(" ", event)
    print("fetched_examples:")
    for example in fetched_examples:
        print(" ", example)
    print("gave_up_examples:")
    for example in gave_up:
        print(" ", example)

    recipe_counts: Counter[str] = Counter()
    for cook in RECIPES.glob("*/recipe.cook"):
        text = cook.read_text(encoding="utf-8", errors="replace")
        parts = text.split("---", 2)
        if len(parts) < 3:
            continue
        meta = parts[1]
        site_m = re.search(r"(?m)^site:\s*(.+)$", meta)
        site = site_m.group(1).strip().strip("\"'") if site_m else ""
        is_f52 = "food52" in site or "food52.com" in meta
        if not is_f52:
            continue
        has_image = bool(re.search(r"(?m)^image:\s*\S+", meta))
        pending = "image_pending: true" in meta
        if has_image:
            recipe_counts["has_image"] += 1
        elif pending:
            recipe_counts["pending"] += 1
        else:
            recipe_counts["no_image"] += 1
    print("food52_recipes", dict(recipe_counts))


if __name__ == "__main__":
    main()
