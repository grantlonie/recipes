#!/usr/bin/env python3
"""Convert recipe ingredient amounts to grams using the ingredient catalog.

Copies originals to <data-root>/recipes-original/ before mutating recipes.
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app import cooklang  # noqa: E402
from app.ingredients import IngredientRepository, SEED_PATH  # noqa: E402
from app.units import format_grams_value, is_mass_unit, is_volume_unit, to_grams  # noqa: E402

INGREDIENT_RE = cooklang.INGREDIENT_RE


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data-root",
        type=Path,
        default=ROOT / "data",
        help="Data root containing recipes/ (default: ./data)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report changes without writing files",
    )
    args = parser.parse_args()

    data_root: Path = args.data_root
    recipe_root = data_root / "recipes"
    original_root = data_root / "recipes-original"
    ingredients_path = data_root / "ingredients.json"

    if not recipe_root.exists():
        print(f"No recipes directory at {recipe_root}")
        return 1

    repository = IngredientRepository(catalog_path=ingredients_path)
    catalog = repository.get_catalog()
    print(f"Loaded {len(catalog.ingredients)} ingredients from {ingredients_path}")
    print(f"Seed source: {SEED_PATH}")

    if not args.dry_run and not original_root.exists():
        print(f"Copying originals to {original_root}")
        shutil.copytree(recipe_root, original_root)
    elif original_root.exists():
        print(f"Originals already present at {original_root} (not overwriting)")

    unconverted: list[str] = []
    converted_files = 0

    for path in sorted(recipe_root.rglob("*.cook")):
        content = path.read_text(encoding="utf-8")
        metadata, body = cooklang.parse_document(content)
        next_body, file_issues = convert_body(body, repository)
        if next_body == body:
            if file_issues:
                unconverted.extend(f"{path.relative_to(recipe_root)}: {issue}" for issue in file_issues)
            continue

        converted_files += 1
        unconverted.extend(f"{path.relative_to(recipe_root)}: {issue}" for issue in file_issues)
        rendered = cooklang.render_document(metadata, next_body)
        if args.dry_run:
            print(f"Would update {path.relative_to(recipe_root)}")
        else:
            path.write_text(rendered, encoding="utf-8")
            print(f"Updated {path.relative_to(recipe_root)}")

    print(f"\nConverted {converted_files} recipe file(s)")
    if unconverted:
        print("\nUnconverted / skipped markers:")
        for issue in unconverted:
            print(f"  - {issue}")
    return 0


def convert_body(body: str, repository: IngredientRepository) -> tuple[str, list[str]]:
    issues: list[str] = []

    def replacer(match: re.Match[str]) -> str:
        name = (match.group("name_braced") or match.group("name") or "").strip()
        amount = match.group("amount")
        if amount is None:
            return match.group(0)

        quantity_text, unit, fixed = cooklang.split_amount(amount)
        if not quantity_text or not unit:
            return match.group(0)

        note = cooklang.ingredient_note_from_match(match)

        number = cooklang.parse_quantity_to_fraction(quantity_text)
        if number is None:
            issues.append(f"@{name}{{{amount}}} non-numeric quantity")
            return match.group(0)

        quantity = float(number)
        catalog_item = repository.find_by_name(name)
        density = catalog_item.density_kg_m3 if catalog_item else None
        canonical_name = catalog_item.name if catalog_item else name

        if is_mass_unit(unit):
            grams = to_grams(quantity, unit)
        elif is_volume_unit(unit):
            if density is None:
                issues.append(f"@{name}{{{amount}}} volume needs density")
                return match.group(0)
            grams = to_grams(quantity, unit, density_kg_m3=density)
        else:
            issues.append(f"@{name}{{{amount}}} unsupported unit")
            return match.group(0)

        if grams is None:
            issues.append(f"@{name}{{{amount}}} could not convert")
            return match.group(0)

        grams_text = format_grams_value(grams)
        prefix = "=" if fixed else ""
        return cooklang.format_ingredient_markup(canonical_name, f"{prefix}{grams_text}%g", note)

    return INGREDIENT_RE.sub(replacer, body), issues


if __name__ == "__main__":
    raise SystemExit(main())
