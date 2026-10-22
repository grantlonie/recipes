#!/usr/bin/env python3
from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

root = Path("/srv/apps/recipes/data/recipes")
c: Counter[str] = Counter()
samples: list[tuple] = []
blocked_note: list[str] = []
no_image_site_f52: list[str] = []

for cook in root.glob("*/recipe.cook"):
    text = cook.read_text(encoding="utf-8", errors="replace")
    parts = text.split("---", 2)
    if len(parts) < 3:
        continue
    meta = parts[1]
    has_image = bool(re.search(r"(?m)^image:\s*\S+", meta))
    site_m = re.search(r"(?m)^site:\s*(.+)$", meta)
    site = site_m.group(1).strip().strip("\"'") if site_m else ""
    pending = "image_pending: true" in meta
    note_blocked = (
        "Image scrape blocked for food52" in meta
        or "host food52.com is blocked" in meta
    )
    is_f52 = "food52" in site or "food52.com" in meta or "food52.com" in text[:3000]
    if is_f52:
        key = ("has_image" if has_image else "no_image") + (
            "_pending" if pending else "_notpending"
        )
        c[key] += 1
        if not has_image and len(samples) < 8:
            samples.append((cook.parent.name, site, pending, meta[:400]))
    if note_blocked:
        blocked_note.append(cook.parent.name)
    if site.endswith("food52.com") and not has_image:
        no_image_site_f52.append(cook.parent.name)

print("counts", dict(c))
print("blocked_note_count", len(blocked_note))
print("site_food52_no_image", len(no_image_site_f52))
print("sample no-image food52-ish:")
for slug, site, pending, meta in samples:
    print("---", slug, "site=", site, "pending=", pending)
    print(meta)
