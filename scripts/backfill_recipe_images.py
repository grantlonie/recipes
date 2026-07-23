#!/usr/bin/env python3
"""Backfill missing recipe image URLs by scraping source pages."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app import cooklang  # noqa: E402
from app.config import Settings, get_settings  # noqa: E402
from app.page_fetch import fetch_page_image_url, first_http_url  # noqa: E402
from app.sources import RECIPE_FILENAME  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--recipe-root",
        type=Path,
        default=None,
        help="Directory of recipe folders (default: settings.recipe_root or data/recipes)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without writing recipe.cook files",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Stop after N successful image updates (0 = no limit)",
    )
    parser.add_argument(
        "--slug",
        action="append",
        default=[],
        help="Only process this slug (repeatable)",
    )
    args = parser.parse_args()

    settings = get_settings()
    recipe_root = args.recipe_root or _default_recipe_root(settings)
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
    failed = 0
    for slug in slugs:
        recipe_path = recipe_root / slug / RECIPE_FILENAME
        try:
            result = backfill_recipe_image(recipe_path, settings=settings, dry_run=args.dry_run)
        except Exception as error:  # noqa: BLE001 - script should continue
            failed += 1
            print(f"FAIL {slug}: {error}")
            continue

        if result == "updated":
            updated += 1
            print(f"{'DRY ' if args.dry_run else ''}OK   {slug}")
            if args.limit and updated >= args.limit:
                break
        elif result == "skipped":
            skipped += 1
        else:
            failed += 1
            print(f"MISS {slug}: could not scrape image")

    print(f"Done. updated={updated} skipped={skipped} failed={failed} dry_run={args.dry_run}")
    return 1 if failed and not updated else 0


def backfill_recipe_image(recipe_path: Path, *, settings: Settings, dry_run: bool = False) -> str:
    content = recipe_path.read_text(encoding="utf-8")
    metadata, body = cooklang.parse_document(content)
    if cooklang.metadata_image_url(metadata) or cooklang.metadata_image_file(metadata):
        return "skipped"

    source_url = _source_url_for_recipe(recipe_path.parent, metadata)
    if not source_url:
        return "skipped"

    image_url = fetch_page_image_url(source_url, settings=settings)
    if not image_url:
        return "missing"

    metadata["image"] = image_url
    next_content = cooklang.render_document(metadata, body)
    if not next_content.endswith("\n"):
        next_content += "\n"
    if not dry_run:
        recipe_path.write_text(next_content, encoding="utf-8")
    return "updated"


def _source_url_for_recipe(recipe_dir: Path, metadata: dict) -> str | None:
    source = cooklang.metadata_source_url(metadata)
    if source:
        return source

    for path in sorted(recipe_dir.glob("source.*")):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        found = first_http_url(text)
        if found:
            return found
    return None


def _default_recipe_root(settings: Settings) -> Path:
    configured = settings.recipe_root
    if configured.exists():
        return configured
    local = ROOT / "data" / "recipes"
    return local


if __name__ == "__main__":
    raise SystemExit(main())
