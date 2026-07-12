#!/usr/bin/env python3
"""Batch-import recipe source files into Cooklang recipe.cook files."""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.config import get_settings  # noqa: E402
from app.extract import DEFAULT_EXTENSIONS, SUPPORTED_EXTENSIONS, extract_text_from_path  # noqa: E402
from app.importer import ImportError, import_from_file, import_from_text, slugify  # noqa: E402
from app.ingredients import IngredientRepository  # noqa: E402
from app.sources import RECIPE_FILENAME, metadata_asset_path, recipe_dir  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_dir", type=Path, help="Directory of source files to import")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=ROOT / "data" / "recipes",
        help="Directory for recipe folders (default: data/recipes)",
    )
    parser.add_argument(
        "--data-root",
        type=Path,
        default=ROOT / "data",
        help="Data root for ingredients.json (default: data)",
    )
    parser.add_argument(
        "--extensions",
        type=str,
        default="",
        help="Comma-separated extensions to process (default: all supported)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing files")
    parser.add_argument("--overwrite", action="store_true", help="Replace existing recipes")
    parser.add_argument(
        "--copy-source",
        action="store_true",
        help="Copy each source file to recipes/{slug}/source.{ext}",
    )
    parser.add_argument("--fail-fast", action="store_true", help="Stop on first failure")
    parser.add_argument("--model", type=str, default="", help="Override Fireworks model id")
    args = parser.parse_args()

    input_dir = args.input_dir.expanduser()
    if not input_dir.is_dir():
        print(f"Input directory not found: {input_dir}", file=sys.stderr)
        return 1

    extensions = _parse_extensions(args.extensions)
    settings = get_settings()
    if args.model:
        settings = settings.model_copy(
            update={
                "import_model_text": args.model,
                "import_model_bulk": args.model,
            }
        )

    ingredients = IngredientRepository(catalog_path=args.data_root / "ingredients.json")
    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    files = sorted(
        path
        for path in input_dir.iterdir()
        if path.is_file() and path.suffix.lower() in extensions
    )
    if not files:
        print(f"No matching files found in {input_dir}")
        return 1

    failures: list[str] = []
    for path in files:
        slug = slugify(path.stem)
        destination = output_dir / slug / RECIPE_FILENAME
        if destination.exists() and not args.overwrite:
            print(f"skip: {path.name} -> {destination.relative_to(output_dir)} (exists)")
            continue

        if args.dry_run:
            print(f"would import: {path.name} -> {destination.relative_to(output_dir)}")
            continue

        try:
            source_path = None
            if args.copy_source:
                source_path = _copy_source(path, output_dir, slug)
            if source_path:
                preview = import_from_file(
                    output_dir / slug / Path(source_path).name,
                    settings=settings,
                    ingredients=ingredients,
                    source_path=source_path,
                )
            else:
                extracted = extract_text_from_path(path)
                preview = import_from_text(
                    extracted,
                    settings=settings,
                    ingredients=ingredients,
                )
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(preview.content, encoding="utf-8")
            unmatched = ", ".join(preview.unmatched_ingredients) or "none"
            print(f"ok: {path.name} -> {destination.relative_to(output_dir)} (unmatched: {unmatched})")
        except (ImportError, OSError) as error:
            message = f"fail: {path.name}: {error}"
            print(message, file=sys.stderr)
            failures.append(message)
            if args.fail_fast:
                return 1

    if failures:
        print(f"\n{len(failures)} failure(s)", file=sys.stderr)
        return 1
    return 0


def _parse_extensions(value: str) -> set[str]:
    if not value.strip():
        return set(DEFAULT_EXTENSIONS)
    extensions = {f".{part.strip().lstrip('.').lower()}" for part in value.split(",") if part.strip()}
    invalid = extensions - SUPPORTED_EXTENSIONS
    if invalid:
        raise SystemExit(f"Unsupported extensions: {', '.join(sorted(invalid))}")
    return extensions


def _copy_source(path: Path, recipe_root: Path, slug: str) -> str:
    assets_dir = recipe_dir(recipe_root, slug)
    assets_dir.mkdir(parents=True, exist_ok=True)
    for existing in assets_dir.glob("source.*"):
        existing.unlink()
    destination = assets_dir / f"source{path.suffix.lower()}"
    shutil.copy2(path, destination)
    return metadata_asset_path(slug, "source", path.suffix)


if __name__ == "__main__":
    raise SystemExit(main())
