#!/usr/bin/env python3
"""Backfill app-owned `site` metadata from recipe URLs / source files."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app import cooklang  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.page_fetch import first_http_url  # noqa: E402
from app.sources import RECIPE_FILENAME  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--recipe-root",
        type=Path,
        default=None,
        help="Directory of recipe folders (default: settings.recipe_root)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without writing recipe.cook files",
    )
    parser.add_argument(
        "--slug",
        action="append",
        default=[],
        help="Only process this slug (repeatable)",
    )
    args = parser.parse_args()

    settings = get_settings()
    recipe_root = args.recipe_root or settings.recipe_root
    if not recipe_root.is_dir():
        print(f"Recipe root not found: {recipe_root}", file=sys.stderr)
        return 1

    slugs = sorted(
        path.name
        for path in recipe_root.iterdir()
        if path.is_dir() and (path / RECIPE_FILENAME).is_file()
    )
    if args.slug:
        wanted = set(args.slug)
        slugs = [slug for slug in slugs if slug in wanted]

    updated = 0
    skipped = 0
    for slug in slugs:
        path = recipe_root / slug / RECIPE_FILENAME
        content = path.read_text(encoding="utf-8")
        metadata, body = cooklang.parse_document(content)
        site = _resolve_site(recipe_root / slug, metadata)
        if not site:
            skipped += 1
            continue

        existing = metadata.get("site")
        if isinstance(existing, str) and existing.strip().casefold() == site:
            skipped += 1
            continue

        metadata["site"] = site
        next_content = cooklang.render_document(metadata, body)
        if not next_content.endswith("\n"):
            next_content += "\n"
        print(f"{slug}: site={site}")
        if not args.dry_run:
            path.write_text(next_content, encoding="utf-8")
        updated += 1

    print(f"Done. updated={updated} skipped={skipped} dry_run={args.dry_run}")
    return 0


def _resolve_site(recipe_dir: Path, metadata: dict) -> str | None:
    for key in ("source", "image_source"):
        value = metadata.get(key)
        if isinstance(value, str) and cooklang.is_ref_url(value):
            site = cooklang.site_from_url(value)
            if site:
                return site

    for path in sorted(recipe_dir.glob("source.*")):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        found = first_http_url(text)
        if found:
            site = cooklang.site_from_url(found)
            if site:
                return site
    return None


if __name__ == "__main__":
    raise SystemExit(main())
