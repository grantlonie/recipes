#!/usr/bin/env python3
"""Convert ChefTap plain-text exports to Cooklang files."""

from __future__ import annotations

import argparse
import html
import json
import re
import subprocess
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urldefrag, urlparse
from urllib.request import Request, urlopen


DEFAULT_SOURCE = Path("/Users/grantlonie/Downloads/cheftap_export[5]")
DEFAULT_DESTINATION = Path("data/recipes")
SECTION_NAMES = {
    "garnish",
    "how to make",
    "ingredients",
    "directions",
    "method",
    "preparation",
    "instructions",
}
STEP_SECTIONS = {"directions", "method", "preparation", "instructions"}
INGREDIENT_SECTIONS = {"ingredients", "garnish"}
TRAILING_JUNK_RE = re.compile(
    r"^(?:loading\.\.\..*|read about cocktail measures.*|per serving|nutrition|nutritional information|similar recipes|related|trending on cooking)$",
    re.IGNORECASE,
)
TIME_RE = re.compile(r"^(?P<label>prep time|cook time|total time):\s*(?P<value>.+)$", re.IGNORECASE)
SERVES_RE = re.compile(r"^(?P<label>serves|serves:|makes|yield|yields):?\s*(?P<value>.+)$", re.IGNORECASE)
URL_RE = re.compile(r"https?://\S+")
META_IMAGE_RE = re.compile(
    r"""<meta\b(?=[^>]*(?:property|name)=["'](?:og:image|og:image:url|twitter:image|twitter:image:src)["'])(?=[^>]*content=["'](?P<url>[^"']+)["'])[^>]*>""",
    re.IGNORECASE,
)
JSON_LD_RE = re.compile(
    r"""<script\b[^>]*type=["']application/ld\+json["'][^>]*>(?P<json>.*?)</script>""",
    re.IGNORECASE | re.DOTALL,
)
FRONT_MATTER_RE = re.compile(r"\A---\s*\n(?P<front_matter>.*?)\n---\s*\n?", re.DOTALL)
MARKER_RE = re.compile(r"@[^{]+{[^}]*}")
QUANTITY_RE = re.compile(
    r"^(?P<quantity>\d+\s+to\s+\d+|(?:\d+\s+)?\d+/\d+|\d+(?:\.\d+)?|[1-9]\d*\s+[1-9]/[1-9]|[1-9]/[1-9])(?:\s+|$)",
    re.IGNORECASE,
)

UNICODE_FRACTIONS = {
    "¼": "1/4",
    "½": "1/2",
    "¾": "3/4",
    "⅐": "1/7",
    "⅑": "1/9",
    "⅒": "1/10",
    "⅓": "1/3",
    "⅔": "2/3",
    "⅕": "1/5",
    "⅖": "2/5",
    "⅗": "3/5",
    "⅘": "4/5",
    "⅙": "1/6",
    "⅚": "5/6",
    "⅛": "1/8",
    "⅜": "3/8",
    "⅝": "5/8",
    "⅞": "7/8",
}
UNIT_ALIASES = {
    "bag": "bag",
    "bags": "bags",
    "bottle": "bottle",
    "bottles": "bottles",
    "box": "box",
    "boxes": "boxes",
    "bunch": "bunch",
    "bunches": "bunches",
    "can": "can",
    "cans": "cans",
    "clove": "clove",
    "cloves": "cloves",
    "cup": "cup",
    "cups": "cups",
    "dash": "dash",
    "dashes": "dashes",
    "g": "g",
    "gallon": "gallon",
    "gallons": "gallons",
    "gram": "g",
    "grams": "g",
    "kg": "kg",
    "lb": "lb",
    "lbs": "lb",
    "ml": "ml",
    "milliliter": "ml",
    "milliliters": "ml",
    "millilitre": "ml",
    "millilitres": "ml",
    "l": "l",
    "liter": "l",
    "liters": "l",
    "litre": "l",
    "litres": "l",
    "ounce": "oz",
    "ounces": "oz",
    "oz": "oz",
    "package": "package",
    "packages": "packages",
    "packet": "packet",
    "packets": "packets",
    "piece": "piece",
    "pieces": "pieces",
    "pinch": "pinch",
    "pinches": "pinches",
    "pint": "pint",
    "pints": "pints",
    "pound": "lb",
    "pounds": "lb",
    "quart": "quart",
    "quarts": "quarts",
    "slice": "slice",
    "slices": "slices",
    "shot": "shot",
    "shots": "shots",
    "sprig": "sprig",
    "sprigs": "sprigs",
    "stick": "stick",
    "sticks": "sticks",
    "tablespoon": "Tbsp",
    "tablespoons": "Tbsp",
    "tbsp": "Tbsp",
    "teaspoon": "tsp",
    "teaspoons": "tsp",
    "tsp": "tsp",
}
NUMBER_WORDS = {
    "1": ("one", "a", "an"),
    "2": ("two",),
    "3": ("three",),
    "4": ("four",),
    "5": ("five",),
    "6": ("six",),
    "7": ("seven",),
    "8": ("eight",),
    "9": ("nine",),
    "10": ("ten",),
    "11": ("eleven",),
    "12": ("twelve",),
}


@dataclass(frozen=True)
class ConvertedRecipe:
    source_path: Path
    destination_path: Path
    title: str
    slug: str
    content: str
    warnings: list[str]


@dataclass
class IngredientEntry:
    original: str
    name: str
    quantity: str | None
    unit: str | None
    used: bool = False

    @property
    def marker(self) -> str:
        if self.quantity and self.unit:
            return f"@{self.name}{{{self.quantity}%{self.unit}}}"
        if self.quantity:
            return f"@{self.name}{{{self.quantity}}}"
        return f"@{self.name}{{}}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--destination", type=Path, default=DEFAULT_DESTINATION)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--validate", action="store_true")
    parser.add_argument("--fetch-images", action="store_true")
    parser.add_argument("--prefer-url-import", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    source = args.source.expanduser()
    destination = args.destination.expanduser()
    files = sorted(source.glob("*.txt"), key=lambda path: path.name.casefold())
    if args.offset:
        files = files[args.offset :]
    if args.limit is not None:
        files = files[: args.limit]

    if not files:
        print(f"No .txt files found in {source}", file=sys.stderr)
        return 1

    converted: list[ConvertedRecipe] = []
    used_slugs: set[str] = set()
    for source_path in files:
        recipe = convert_file(
            source_path,
            destination,
            used_slugs,
            fetch_images=args.fetch_images,
            prefer_url_import=args.prefer_url_import,
        )
        used_slugs.add(recipe.slug)
        converted.append(recipe)

    if not args.dry_run:
        destination.mkdir(parents=True, exist_ok=True)
        for recipe in converted:
            recipe.destination_path.write_text(recipe.content, encoding="utf-8")

    for recipe in converted:
        status = "dry-run" if args.dry_run else "written"
        print(f"{status}: {recipe.destination_path} <- {recipe.source_path.name}")
        for warning in recipe.warnings:
            print(f"  warning: {warning}")

    if args.validate and not args.dry_run:
        errors = validate_files([recipe.destination_path for recipe in converted])
        if errors:
            print("\nValidation failed:", file=sys.stderr)
            for error in errors:
                print(f"- {error}", file=sys.stderr)
            return 1
        print(f"\nValidated {len(converted)} Cooklang files.")

    return 0


def convert_file(
    source_path: Path,
    destination: Path,
    used_slugs: set[str],
    *,
    fetch_images: bool = False,
    prefer_url_import: bool = False,
) -> ConvertedRecipe:
    content = source_path.read_text(encoding="utf-8-sig")
    lines = [normalize_spaces(line.rstrip()) for line in content.splitlines()]
    lines = trim_blank_edges(lines)
    warnings: list[str] = []

    title = first_non_empty(lines) or source_path.stem.replace("_", " ")
    source_url = first_url(lines)
    metadata, body_start = extract_metadata(lines, title, source_url)
    slug = unique_slug(slugify(title), used_slugs)
    destination_path = destination / f"{slug}.cook"
    existing_image = existing_metadata_value(destination_path, "image")
    if fetch_images and source_url:
        image_url, image_warning = scrape_image_url(canonical_source_url(source_url))
        if image_url:
            metadata["image"] = image_url
        elif image_warning:
            warnings.append(image_warning)
    if "image" not in metadata and existing_image:
        metadata["image"] = existing_image

    if prefer_url_import and source_url:
        imported_content = import_with_cooklang(source_url, metadata, warnings)
        if imported_content:
            return ConvertedRecipe(
                source_path=source_path,
                destination_path=destination_path,
                title=title,
                slug=slug,
                content=imported_content,
                warnings=warnings,
            )

    sections = split_sections(lines[body_start:])
    ingredients = sections.get("ingredients", []) + sections.get("garnish", [])
    steps = first_section(sections, STEP_SECTIONS)
    if steps:
        steps, step_ingredients = split_step_ingredients(steps)
        ingredients.extend(step_ingredients)

    if not steps:
        warnings.append("no directions/method/preparation section found")
        steps = fallback_steps(lines[body_start:])

    ingredient_entries = parse_ingredient_entries(ingredients, warnings)
    body_lines: list[str] = []
    if ingredients:
        body_lines.extend(inline_ingredients(convert_steps(steps), ingredient_entries))
    else:
        warnings.append("no ingredients section found")
        body_lines.extend(convert_steps(steps))

    body = "\n\n".join(body_lines).strip() + "\n"
    return ConvertedRecipe(
        source_path=source_path,
        destination_path=destination_path,
        title=title,
        slug=slug,
        content=render_document(metadata, body),
        warnings=warnings,
    )


def extract_metadata(lines: list[str], title: str, source_url: str | None) -> tuple[dict[str, Any], int]:
    metadata: dict[str, Any] = {"title": title}
    if source_url:
        metadata["source"] = source_url

    body_start = 1
    for index, line in enumerate(lines[1:], start=1):
        stripped = line.strip()
        if not stripped:
            continue
        section = normalize_section_name(stripped)
        if section in SECTION_NAMES:
            body_start = index
            break
        time_match = TIME_RE.match(stripped)
        if time_match:
            metadata[time_match.group("label").lower()] = time_match.group("value").strip()
            continue
        serves_match = SERVES_RE.match(stripped)
        if serves_match:
            for label, value in extract_times(stripped).items():
                metadata[label] = value
            yield_value = re.split(r"\s+(?:prep|cook|total) time:", serves_match.group("value"), maxsplit=1, flags=re.IGNORECASE)[
                0
            ].strip()
            metadata["yield"] = yield_value
            servings = first_number(yield_value)
            if servings is not None:
                metadata["servings"] = servings
            continue
        if URL_RE.search(stripped):
            continue
        if re.match(r"^calories:\s*", stripped, re.IGNORECASE):
            continue
        body_start = index
        break
    else:
        body_start = 1

    return metadata, body_start


def split_sections(lines: list[str]) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for line in lines:
        stripped = line.strip()
        section = normalize_section_name(stripped)
        if section in SECTION_NAMES:
            current = "directions" if section == "how to make" else section
            sections.setdefault(current, [])
            continue
        if current is not None:
            sections[current].append(line)
    sections = {key: clean_section(key, value) for key, value in sections.items()}
    if not sections:
        sections = infer_sections(lines)
    elif not any(sections.get(name) for name in INGREDIENT_SECTIONS):
        inferred = infer_sections(lines)
        if inferred.get("ingredients"):
            sections["ingredients"] = inferred["ingredients"]
    return sections


def clean_section(name: str, lines: list[str]) -> list[str]:
    cleaned = trim_blank_edges(lines)
    if name in INGREDIENT_SECTIONS:
        return [
            line
            for line in cleaned
            if not re.fullmatch(r"\s*(?:nutrition|featured video|advertisement)\s*", line, re.IGNORECASE)
        ]
    return trim_recipe_tail(cleaned)


def infer_sections(lines: list[str]) -> dict[str, list[str]]:
    blocks: list[list[str]] = []
    current: list[str] = []
    for line in trim_blank_edges(lines):
        stripped = line.strip()
        if URL_RE.fullmatch(stripped) or re.fullmatch(r"cook time:\s*", stripped, re.IGNORECASE):
            continue
        if not stripped:
            if current:
                blocks.append(current)
                current = []
            continue
        current.append(line)
    if current:
        blocks.append(current)
    if not blocks:
        return {}

    split_at = None
    first_block = blocks[0]
    for index, line in enumerate(first_block):
        if not looks_like_ingredient(line):
            split_at = index
            break

    if split_at is None or split_at == 0:
        return {"directions": [line for block in blocks for line in [*block, ""]]}
    return {
        "ingredients": first_block[:split_at],
        "directions": trim_recipe_tail(first_block[split_at:] + [""] + [line for block in blocks[1:] for line in [*block, ""]]),
    }


def first_section(sections: dict[str, list[str]], names: set[str]) -> list[str]:
    for name in ("directions", "method", "preparation", "instructions"):
        if name in names and sections.get(name):
            return sections[name]
    return []


def fallback_steps(lines: list[str]) -> list[str]:
    body: list[str] = []
    for line in lines:
        if line.strip().casefold() == "ingredients":
            body.clear()
            continue
        body.append(line)
    return trim_recipe_tail(trim_blank_edges(body))


def split_step_ingredients(lines: list[str]) -> tuple[list[str], list[str]]:
    steps: list[str] = []
    ingredients: list[str] = []
    for line in trim_recipe_tail(lines):
        if looks_like_ingredient(line):
            ingredients.append(line)
        else:
            steps.append(line)
    return trim_blank_edges(steps), trim_blank_edges(ingredients)


def normalize_section_name(value: str) -> str:
    return value.strip().rstrip(":").casefold()


def extract_times(value: str) -> dict[str, str]:
    matches = re.finditer(
        r"(?P<label>prep time|cook time|total time):\s*(?P<value>.*?)(?=\s+(?:prep time|cook time|total time):|$)",
        value,
        re.IGNORECASE,
    )
    return {
        match.group("label").casefold(): match.group("value").strip()
        for match in matches
        if match.group("value").strip()
    }


def convert_ingredients(lines: list[str], warnings: list[str]) -> list[str]:
    converted: list[str] = []
    for line in lines:
        stripped = strip_bullet(line.strip())
        if not stripped:
            converted.append("")
            continue
        if looks_like_heading(stripped):
            converted.append(f"### {stripped.rstrip(':')}")
            continue

        ingredient = convert_ingredient_line(stripped)
        if ingredient is None:
            warnings.append(f"could not mark ingredient: {stripped}")
            converted.append(stripped)
        else:
            converted.append(ingredient)
    return trim_blank_edges(converted)


def parse_ingredient_entries(lines: list[str], warnings: list[str]) -> list[IngredientEntry]:
    entries: list[IngredientEntry] = []
    for line in lines:
        stripped = strip_bullet(line.strip())
        if not stripped or looks_like_heading(stripped):
            continue
        quantity, unit, name = split_ingredient(stripped)
        cook_name = normalize_cook_name(name)
        if not cook_name:
            warnings.append(f"could not parse ingredient: {stripped}")
            continue
        entries.append(
            IngredientEntry(
                original=stripped,
                name=cook_name,
                quantity=quantity,
                unit=unit,
            )
        )
    return entries


def inline_ingredients(steps: list[str], ingredients: list[IngredientEntry]) -> list[str]:
    inlined: list[str] = []
    for step in steps:
        updated = step
        for ingredient in ingredients:
            if ingredient.used:
                continue
            updated, used = replace_ingredient_once(updated, ingredient)
            ingredient.used = used
        inlined.append(updated)

    unused = [ingredient for ingredient in ingredients if not ingredient.used]
    if unused:
        inlined.insert(0, f"Have {format_ingredient_series(unused)} ready.")
        for ingredient in unused:
            ingredient.used = True
    return inlined


def replace_ingredient_once(step: str, ingredient: IngredientEntry) -> tuple[str, bool]:
    for alias in ingredient_aliases(ingredient.name):
        pattern = ingredient_pattern(alias, ingredient)
        updated, used = replace_outside_markers(step, pattern, ingredient.marker)
        if used:
            return updated, True
    return step, False


def ingredient_pattern(alias: str, ingredient: IngredientEntry) -> re.Pattern[str]:
    amount_prefix = amount_prefix_pattern(ingredient)
    prefix = rf"(?P<amount>{amount_prefix})?" if amount_prefix else ""
    return re.compile(rf"(?<![@A-Za-z0-9]){prefix}{re.escape(alias)}(?![A-Za-z0-9])", re.IGNORECASE)


def amount_prefix_pattern(ingredient: IngredientEntry) -> str:
    if not ingredient.quantity or not ingredient.unit:
        return ""

    quantity_pattern = quantity_phrase_pattern(ingredient.quantity)
    unit_pattern = unit_phrase_pattern(ingredient.unit)
    return rf"(?:{quantity_pattern})\s+(?:{unit_pattern})(?:\s+of)?\s+"


def quantity_phrase_pattern(quantity: str) -> str:
    variants = [quantity]
    variants.extend(NUMBER_WORDS.get(quantity, ()))
    return "|".join(re.escape(variant) for variant in variants)


def unit_phrase_pattern(unit: str) -> str:
    variants = {unit}
    normalized = unit.casefold()
    variants.update(alias for alias, canonical in UNIT_ALIASES.items() if canonical.casefold() == normalized)
    if normalized.endswith("s"):
        variants.add(normalized.removesuffix("s"))
    else:
        variants.add(f"{normalized}s")
    return "|".join(re.escape(variant) for variant in sorted(variants, key=len, reverse=True))


def replace_outside_markers(step: str, pattern: re.Pattern[str], marker: str) -> tuple[str, bool]:
    parts: list[str] = []
    cursor = 0
    used = False
    for match in MARKER_RE.finditer(step):
        plain = step[cursor : match.start()]
        if not used and pattern.search(plain):
            plain = pattern.sub(lambda match: replacement_marker(match, marker), plain, count=1)
            used = True
        parts.append(plain)
        parts.append(match.group(0))
        cursor = match.end()
    plain = step[cursor:]
    if not used and pattern.search(plain):
        plain = pattern.sub(lambda match: replacement_marker(match, marker), plain, count=1)
        used = True
    parts.append(plain)
    return "".join(parts), used


def replacement_marker(match: re.Match[str], marker: str) -> str:
    amount = match.groupdict().get("amount")
    if not amount:
        return marker
    amount = re.sub(r"\s+of\s+$", " ", amount, flags=re.IGNORECASE)
    return f"{amount}{marker}"


def ingredient_aliases(name: str) -> list[str]:
    words = [word for word in re.split(r"[\s/]+", name) if word]
    aliases = []
    if len(words) == 2 and words[-1].casefold() == "pasta":
        aliases.append(words[0])
    aliases.append(name)
    without_descriptor = re.sub(r"^(?:chopped|crushed|dried|fresh|ground)\s+", "", name, flags=re.IGNORECASE)
    if without_descriptor != name:
        aliases.append(without_descriptor)
    stop_words = {
        "a",
        "an",
        "and",
        "can",
        "chopped",
        "crushed",
        "dried",
        "fresh",
        "finely",
        "ground",
        "large",
        "medium",
        "black",
        "of",
        "or",
        "red",
        "small",
        "sliced",
        "thinly",
        "whole",
        "yellow",
    }
    salient = [word for word in words if word.casefold() not in stop_words]
    if len(salient) >= 2:
        aliases.append(" ".join(salient[-2:]))
    if salient and salient[-1].casefold() not in {"pepper", "salt", "sugar", "water"}:
        aliases.append(salient[-1])
    return list(dict.fromkeys(aliases))


def format_ingredient_series(ingredients: list[IngredientEntry]) -> str:
    markers = [ingredient.marker for ingredient in ingredients]
    if len(markers) == 1:
        return markers[0]
    if len(markers) == 2:
        return f"{markers[0]} and {markers[1]}"
    return f"{', '.join(markers[:-1])}, and {markers[-1]}"


def convert_ingredient_line(line: str) -> str | None:
    prefix = ""
    if ":" in line and not line.lower().startswith(("http:", "https:")):
        possible_prefix, rest = line.split(":", 1)
        if 0 < len(possible_prefix) <= 30 and not any(char.isdigit() for char in possible_prefix):
            prefix = possible_prefix.strip() + ": "
            line = rest.strip()

    quantity, unit, name = split_ingredient(line)
    cook_name = normalize_cook_name(name)
    if not cook_name:
        return None

    amount = ""
    if quantity and unit:
        amount = f"{{{quantity}%{unit}}}"
    elif quantity:
        amount = f"{{{quantity}}}"
    else:
        amount = "{}"

    suffix = ""
    if name.casefold() != cook_name.casefold() and line.endswith(name):
        suffix = line.removesuffix(name).strip()
    return f"{prefix}@{cook_name}{amount}{(' ' + suffix) if suffix else ''}"


def split_ingredient(line: str) -> tuple[str | None, str | None, str]:
    normalized = replace_unicode_fractions(line)
    normalized = re.sub(r"^(\d+(?:\.\d+)?)-([A-Za-z]+)\b", r"\1 \2", normalized)
    yolk_match = re.match(r"yolks? of (?P<quantity>\d+) eggs?", normalized, re.IGNORECASE)
    if yolk_match:
        return yolk_match.group("quantity"), None, "egg yolks"

    quantity_match = QUANTITY_RE.match(normalized)
    if not quantity_match:
        return None, None, line

    quantity = quantity_match.group("quantity").strip()
    remainder = normalized[quantity_match.end() :].strip()
    if not remainder:
        return quantity, None, line

    remainder = re.sub(r"^\([^)]*\)\s+", "", remainder)
    unit = None
    first, _, rest = remainder.partition(" ")
    if re.fullmatch(
        r"\d+(?:\.\d+)?-?(?:oz|ounce|ounces|g|gram|grams|ml|milliliters?|millilitres?|l|liters?|litres?|lb|pound|pounds)",
        first,
        re.IGNORECASE,
    ):
        first, _, rest = rest.partition(" ")
    unit_key = clean_unit_token(first)
    if unit_key in UNIT_ALIASES and rest.strip():
        unit = UNIT_ALIASES[unit_key]
        name = clean_ingredient_name(rest.strip())
    else:
        name = clean_ingredient_name(remainder)
    return quantity, unit, name


def looks_like_ingredient(line: str) -> bool:
    stripped = strip_bullet(line.strip())
    if not stripped:
        return False
    normalized = re.sub(r"^(\d+(?:\.\d+)?)-([A-Za-z]+)\b", r"\1 \2", replace_unicode_fractions(stripped))
    if QUANTITY_RE.match(normalized):
        return True
    if stripped.endswith("."):
        return False
    if re.match(r"^[A-Za-z][A-Za-z' -]+ of \d+", stripped):
        return True
    return "," in stripped and len(stripped.split()) <= 12


def clean_ingredient_name(value: str) -> str:
    value = re.sub(r"^(?:of|can of|tube of|package of)\s+", "", value, flags=re.IGNORECASE)
    value = re.sub(r"^(?:can|tube|package)\s+", "", value, flags=re.IGNORECASE)
    return value.strip()


def convert_steps(lines: list[str]) -> list[str]:
    paragraphs: list[str] = []
    current: list[str] = []
    for line in trim_recipe_tail(lines):
        stripped = line.strip()
        if not stripped:
            if current:
                paragraphs.append(" ".join(current))
                current = []
            continue
        current.append(stripped)
    if current:
        paragraphs.append(" ".join(current))
    return paragraphs


def validate_files(paths: list[Path]) -> list[str]:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
    from app import cooklang  # type: ignore[reportMissingImports]  # pylint: disable=import-outside-toplevel

    errors: list[str] = []
    for path in paths:
        content = path.read_text(encoding="utf-8")
        metadata, body = cooklang.parse_document(content)
        title = cooklang.metadata_title(metadata, path.stem)
        steps = cooklang.parse_steps(body)
        ingredients = cooklang.parse_ingredients(body)
        if not title:
            errors.append(f"{path}: missing title")
        if not body.strip():
            errors.append(f"{path}: empty body")
        if not steps:
            errors.append(f"{path}: no parsed steps")
        if "## Ingredients" in body and not ingredients:
            errors.append(f"{path}: ingredients section produced no parsed ingredients")
    return errors


def import_with_cooklang(url: str, metadata: dict[str, Any], warnings: list[str]) -> str | None:
    try:
        result = subprocess.run(
            ["cooklang-import", url],
            capture_output=True,
            check=False,
            text=True,
            timeout=90,
        )
    except FileNotFoundError:
        warnings.append("cooklang-import is not installed; fell back to ChefTap text conversion")
        return None
    except subprocess.TimeoutExpired:
        warnings.append(f"cooklang-import timed out for {url}; fell back to ChefTap text conversion")
        return None

    if result.returncode != 0:
        detail = result.stderr.strip() or "unknown error"
        warnings.append(f"cooklang-import failed for {url}: {detail}; fell back to ChefTap text conversion")
        return None

    content = result.stdout.strip()
    if not content:
        warnings.append(f"cooklang-import returned empty content for {url}; fell back to ChefTap text conversion")
        return None

    return merge_front_matter(content + "\n", metadata)


def merge_front_matter(content: str, metadata: dict[str, Any]) -> str:
    match = FRONT_MATTER_RE.match(content)
    if not match:
        return render_document(metadata, content)

    front_matter = match.group("front_matter")
    body = content[match.end() :]
    lines = front_matter.splitlines()
    existing_keys = {
        line.split(":", 1)[0].strip()
        for line in lines
        if ":" in line and line[:1] not in {" ", "-"}
    }
    for key, value in metadata.items():
        rendered = f"{key}: {yaml_value(value)}"
        if key in existing_keys:
            lines = [rendered if line.startswith(f"{key}:") else line for line in lines]
        else:
            lines.append(rendered)
    return f"---\n{chr(10).join(lines)}\n---\n\n{body.lstrip()}"


def existing_metadata_value(path: Path, key: str) -> str | None:
    if not path.exists():
        return None

    match = FRONT_MATTER_RE.match(path.read_text(encoding="utf-8"))
    if not match:
        return None

    metadata_match = re.search(rf"^{re.escape(key)}:\s*(?P<value>.+)$", match.group("front_matter"), re.MULTILINE)
    if not metadata_match:
        return None

    return metadata_match.group("value").strip().strip("'\"") or None


def canonical_source_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.netloc.casefold().endswith("google.com") and parsed.path.startswith("/amp/s/"):
        path = parsed.path.removeprefix("/amp/s/").removesuffix("/amp")
        return f"https://{path}"
    return url


def scrape_image_url(url: str) -> tuple[str | None, str | None]:
    request_url = urldefrag(url).url
    try:
        request = Request(
            request_url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/126.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
        )
        with urlopen(request, timeout=15) as response:
            page = response.read(2_000_000).decode(response.headers.get_content_charset() or "utf-8", errors="replace")
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        return None, f"could not fetch image metadata from {url}: {error}"

    image = first_json_ld_image(page)
    if image:
        return absolute_url(url, image), None

    match = META_IMAGE_RE.search(page)
    if match:
        return absolute_url(url, html.unescape(match.group("url").strip())), None

    return None, f"no image metadata found at {url}"


def first_json_ld_image(page: str) -> str | None:
    for match in JSON_LD_RE.finditer(page):
        raw_json = html.unescape(match.group("json")).strip()
        if not raw_json:
            continue
        try:
            data = json.loads(raw_json)
        except json.JSONDecodeError:
            continue
        image = find_image_value(data)
        if image:
            return image
    return None


def find_image_value(value: Any) -> str | None:
    if isinstance(value, str):
        return value if looks_like_image_url(value) else None
    if isinstance(value, list):
        for item in value:
            image = find_image_value(item)
            if image:
                return image
    if isinstance(value, dict):
        for key in ("image", "thumbnailUrl", "thumbnail", "photo"):
            image = image_from_json_value(value.get(key))
            if image:
                return image
        graph = value.get("@graph")
        if graph is not None:
            image = find_image_value(graph)
            if image:
                return image
    return None


def image_from_json_value(value: Any) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        for item in value:
            image = image_from_json_value(item)
            if image:
                return image
    if isinstance(value, dict):
        for key in ("url", "contentUrl"):
            image = value.get(key)
            if isinstance(image, str):
                return image
    return None


def looks_like_image_url(value: str) -> bool:
    return bool(re.search(r"\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$", value, re.IGNORECASE))


def absolute_url(base_url: str, image_url: str) -> str:
    return urljoin(base_url, html.unescape(image_url.strip()))


def render_document(metadata: dict[str, Any], body: str) -> str:
    front_matter = "\n".join(f"{key}: {yaml_value(value)}" for key, value in metadata.items())
    return f"---\n{front_matter}\n---\n\n{body}"


def yaml_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return str(value)
    text = str(value)
    if not text:
        return "''"
    escaped = text.encode("ascii", "backslashreplace").decode("ascii").replace("'", "''")
    return f"'{escaped}'"


def trim_recipe_tail(lines: list[str]) -> list[str]:
    trimmed: list[str] = []
    for line in lines:
        stripped = line.strip()
        if TRAILING_JUNK_RE.match(stripped):
            break
        if len(trimmed) >= 2 and looks_like_scraped_listing(trimmed[-2], trimmed[-1], stripped):
            trimmed = trimmed[:-2]
            break
        trimmed.append(line)
    return trim_blank_edges(trimmed)


def looks_like_scraped_listing(previous_two: str, previous_one: str, current: str) -> bool:
    return all(looks_like_duration(value.strip()) for value in (previous_two, previous_one, current))


def looks_like_duration(value: str) -> bool:
    return bool(re.fullmatch(r"(?:about\s+)?\d+\s+(?:minutes?|hours?)(?:,\s*plus.*)?|easy", value, re.IGNORECASE))


def looks_like_heading(line: str) -> bool:
    if line.endswith(":"):
        return True
    return not any(char.isdigit() for char in line) and len(line.split()) <= 5 and line.isupper()


def normalize_cook_name(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    ascii_value = ascii_value.replace("&", " and ")
    ascii_value = re.sub(r"\([^)]*\)", "", ascii_value)
    ascii_value = ascii_value.split(",", 1)[0]
    ascii_value = re.sub(r"[^A-Za-z0-9_./' -]+", " ", ascii_value)
    return re.sub(r"\s+", " ", ascii_value).strip(" -").casefold()


def replace_unicode_fractions(value: str) -> str:
    value = value.replace("\u2044", "/")
    value = re.sub(r"(?<=\d)\s*/\s*(?=\d)", "/", value)
    for unicode_fraction, ascii_fraction in UNICODE_FRACTIONS.items():
        value = value.replace(unicode_fraction, f" {ascii_fraction}")
    return re.sub(r"\s+", " ", value).strip()


def normalize_spaces(value: str) -> str:
    return value.replace("\u00a0", " ").replace("\u202f", " ")


def strip_bullet(value: str) -> str:
    return re.sub(r"^(?:[-*•]|\d+[.)])\s+", "", value).strip()


def clean_unit_token(value: str) -> str:
    return re.sub(r"[^A-Za-z]", "", value).casefold()


def trim_blank_edges(lines: list[str]) -> list[str]:
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return lines


def first_non_empty(lines: list[str]) -> str | None:
    return next((line.strip() for line in lines if line.strip()), None)


def first_url(lines: list[str]) -> str | None:
    for line in lines:
        match = URL_RE.search(line)
        if match:
            return match.group(0)
    return None


def first_number(value: str) -> int | float | None:
    match = re.search(r"\d+(?:\.\d+)?", value)
    if not match:
        return None
    number = float(match.group(0))
    return int(number) if number.is_integer() else number


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", normalized).strip("-").lower()
    return slug or "imported-recipe"


def unique_slug(slug: str, used_slugs: set[str]) -> str:
    if slug not in used_slugs:
        return slug
    index = 2
    while f"{slug}-{index}" in used_slugs:
        index += 1
    return f"{slug}-{index}"


if __name__ == "__main__":
    raise SystemExit(main())
