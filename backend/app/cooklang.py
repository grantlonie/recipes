import re
from fractions import Fraction
from typing import Any

import yaml

from app.models import Ingredient, RecipeSection, RecipeStep
from app.units import normalize_unit, split_glued_amount

FRONT_MATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.DOTALL)
SOURCES_PREFIX = "sources/"
TOKEN_CHARS = r"A-Za-z0-9_./' -"
INGREDIENT_RE = re.compile(
    rf"@(?:(?P<name_braced>[{TOKEN_CHARS}]+?)\{{(?P<amount>[^}}]*)\}}|"
    rf"(?P<name>[{TOKEN_CHARS}]+?)(?=\s|[.,;:!?)]|\(|$))"
    rf"(?:\((?P<preparation>[^)]*)\))?"
)
COOKWARE_RE = re.compile(
    rf"#(?:(?P<name_braced>[{TOKEN_CHARS}]+?)\{{\}}|"
    rf"(?P<name>[{TOKEN_CHARS}]+?)(?=\s|[.,;:!?)]|$))"
)
TIMER_RE = re.compile(r"~(?P<name>[A-Za-z0-9_./' -]*?)?\{(?P<amount>[^}]*)\}")
NOTE_RE = re.compile(r"^\s*>\s?(?P<note>.+)$", re.MULTILINE)
SECTION_LINE_RE = re.compile(r"^=+\s*(.+?)\s*=+\s*$")
UNICODE_FRACTION_CHARS = "¼½¾⅓⅔⅛⅜⅝⅞"
QUANTITY_PATTERN = (
    rf"(?:\d+\s+\d+/\d+|\d+\s+[{UNICODE_FRACTION_CHARS}]|\d+/\d+|\d+(?:\.\d+)?|[{UNICODE_FRACTION_CHARS}])"
)
AMOUNT_WITHOUT_SEPARATOR_RE = re.compile(
    rf"^(?P<quantity>{QUANTITY_PATTERN})(?:\s+(?P<unit>.+))?$"
)
UNICODE_FRACTION_MAP = {
    "¼": Fraction(1, 4),
    "½": Fraction(1, 2),
    "¾": Fraction(3, 4),
    "⅓": Fraction(1, 3),
    "⅔": Fraction(2, 3),
    "⅛": Fraction(1, 8),
    "⅜": Fraction(3, 8),
    "⅝": Fraction(5, 8),
    "⅞": Fraction(7, 8),
}


def parse_document(content: str) -> tuple[dict[str, Any], str]:
    match = FRONT_MATTER_RE.match(content)
    if not match:
        return {}, content.lstrip("\n")

    metadata = yaml.safe_load(match.group(1)) or {}
    if not isinstance(metadata, dict):
        metadata = {}
    return metadata, content[match.end() :]


def render_document(metadata: dict[str, Any], body: str) -> str:
    clean_metadata = {key: value for key, value in metadata.items() if value not in (None, "", [])}
    if not clean_metadata:
        return body.lstrip("\n")

    front_matter = yaml.safe_dump(clean_metadata, sort_keys=False, allow_unicode=False).strip()
    return f"---\n{front_matter}\n---\n\n{body.lstrip()}"


def format_ingredient_markup(name: str, amount: str, note: str | None = None) -> str:
    markup = f"@{name.strip()}"
    if amount:
        markup += f"{{{amount}}}"
    if note:
        markup += f"({note})"
    return markup


def ingredient_note_from_match(match: re.Match[str]) -> str | None:
    return (match.group("preparation") or "").strip() or None


def parse_ingredients(body: str, scale: float | None = None, servings: float = 1) -> list[Ingredient]:
    ingredients: list[Ingredient] = []
    factor = None if scale is None else scale / servings
    for match in INGREDIENT_RE.finditer(strip_comments(body)):
        name = (match.group("name_braced") or match.group("name")).strip()
        if not name:
            continue
        quantity, unit, fixed = split_amount(match.group("amount"))
        note = ingredient_note_from_match(match)
        ingredients.append(
            Ingredient(
                fixed=fixed,
                name=name,
                note=note,
                quantity=quantity,
                scaled_quantity=scale_quantity(quantity, factor, fixed),
                unit=unit,
            )
        )
    return ingredients


def parse_cookware(body: str) -> list[str]:
    return unique(
        (match.group("name_braced") or match.group("name")).strip()
        for match in COOKWARE_RE.finditer(strip_comments(body))
    )


def parse_timers(body: str) -> list[str]:
    timers: list[str] = []
    for match in TIMER_RE.finditer(strip_comments(body)):
        name = match.group("name").strip()
        amount = match.group("amount").strip()
        timers.append(f"{name}: {amount}" if name else amount)
    return timers


def parse_notes(metadata: dict[str, Any], body: str) -> list[str]:
    notes: list[str] = []
    for key in ("description", "introduction"):
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            notes.append(value.strip())
    notes.extend(match.group("note").strip() for match in NOTE_RE.finditer(body))
    return notes


def parse_blocks(body: str) -> list[RecipeSection | RecipeStep]:
    blocks: list[RecipeSection | RecipeStep] = []
    for block in re.split(r"\n\s*\n", body.strip()):
        lines = [line for line in block.splitlines() if not line.lstrip().startswith(">")]
        index = 0
        while index < len(lines):
            stripped = lines[index].strip()
            if not stripped:
                index += 1
                continue
            section_match = SECTION_LINE_RE.match(stripped)
            if section_match:
                blocks.append(RecipeSection(title=section_match.group(1).strip()))
                index += 1
                continue
            step_lines: list[str] = []
            while index < len(lines):
                line = lines[index].strip()
                if not line:
                    index += 1
                    continue
                if SECTION_LINE_RE.match(line):
                    break
                step_lines.append(lines[index])
                index += 1
            if step_lines:
                blocks.append(RecipeStep(text="\n".join(step_lines).strip()))
    return blocks


def parse_steps(body: str) -> list[str]:
    return [block.text for block in parse_blocks(body) if isinstance(block, RecipeStep)]


def metadata_tags(metadata: dict[str, Any]) -> list[str]:
    tags = metadata.get("tags", [])
    if isinstance(tags, str):
        return [tag.strip() for tag in tags.split(",") if tag.strip()]
    if isinstance(tags, list):
        return sorted({str(tag).strip() for tag in tags if str(tag).strip()}, key=str.casefold)
    return []


def metadata_bookmarked(metadata: dict[str, Any]) -> bool:
    value = metadata.get("bookmarked", False)
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().casefold() in {"1", "true", "yes", "y"}
    return bool(value)


def metadata_title(metadata: dict[str, Any], fallback: str) -> str:
    title = metadata.get("title")
    return str(title).strip() if title else fallback


def parse_ref_value(metadata: dict[str, Any], key: str) -> str | None:
    value = metadata.get(key)
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    if isinstance(value, dict):
        for nested_key in ("url", "path"):
            nested = value.get(nested_key)
            if isinstance(nested, str) and nested.strip():
                return nested.strip()
    return None


def is_ref_url(value: str) -> bool:
    return value.startswith(("http://", "https://"))


def is_ref_file(value: str) -> bool:
    return value.startswith(SOURCES_PREFIX)


def validate_ref_value(value: str) -> bool:
    stripped = value.strip()
    if not stripped:
        return True
    return is_ref_url(stripped) or is_ref_file(stripped)


def metadata_image(metadata: dict[str, Any]) -> str | None:
    value = parse_ref_value(metadata, "image")
    if value:
        return value
    for key in ("picture",):
        legacy = metadata.get(key)
        if isinstance(legacy, str) and legacy.strip():
            return legacy.strip()
    for key in ("images", "pictures"):
        legacy = metadata.get(key)
        if isinstance(legacy, list) and legacy:
            return str(legacy[0]).strip()
    return None


def metadata_image_url(metadata: dict[str, Any]) -> str | None:
    value = metadata_image(metadata)
    if value and is_ref_url(value):
        return value
    return None


def metadata_image_file(metadata: dict[str, Any]) -> str | None:
    value = metadata_image(metadata)
    if value and is_ref_file(value):
        return value
    return None


def metadata_source_value(metadata: dict[str, Any]) -> str | None:
    return parse_ref_value(metadata, "source")


def metadata_source_url(metadata: dict[str, Any]) -> str | None:
    value = metadata_source_value(metadata)
    if value and is_ref_url(value):
        return value
    return None


def metadata_source_file(metadata: dict[str, Any]) -> str | None:
    value = metadata_source_value(metadata)
    if value and is_ref_file(value):
        return value
    return None


def resolve_image_url(metadata: dict[str, Any], app_base_url: str) -> str | None:
    value = metadata_image(metadata)
    if not value:
        return None
    if is_ref_url(value):
        return value
    if is_ref_file(value):
        base = app_base_url.rstrip("/")
        return f"{base}/api/sources/{value.removeprefix(SOURCES_PREFIX)}"
    return value


def metadata_original_url(metadata: dict[str, Any]) -> str | None:
    return metadata_source_url(metadata)


def metadata_cook_time(metadata: dict[str, Any]) -> str | None:
    for key in ("time", "duration", "time required"):
        value = metadata.get(key)
        if value:
            return str(value)
    prep = metadata.get("prep time") or metadata.get("time.prep")
    cook = metadata.get("cook time") or metadata.get("time.cook")
    parts = [str(value) for value in (prep, cook) if value]
    return " + ".join(parts) if parts else None


def metadata_servings(metadata: dict[str, Any]) -> float:
    for key in ("servings", "serves", "yield"):
        value = metadata.get(key)
        if value is None:
            continue
        match = re.search(r"\d+(?:\.\d+)?", str(value))
        if match:
            return float(match.group(0))
    return 1


def set_metadata_values(
    metadata: dict[str, Any],
    *,
    bookmarked: bool | None = None,
    image: str | None = None,
    servings: float | None = None,
    tags: list[str] | None = None,
) -> dict[str, Any]:
    updated = dict(metadata)
    if bookmarked is not None:
        updated["bookmarked"] = bookmarked
    if image is not None:
        updated["image"] = image.strip() or None
    if servings is not None:
        updated["servings"] = servings
    if tags is not None:
        updated["tags"] = sorted({tag.strip() for tag in tags if tag.strip()}, key=str.casefold)
    return updated


def split_amount(amount: str | None) -> tuple[str | None, str | None, bool]:
    if not amount:
        return None, None, False
    fixed = amount.startswith("=")
    value = amount[1:] if fixed else amount
    if "%" in value:
        quantity, unit = value.split("%", 1)
        unit = normalize_unit(unit.strip()) if unit.strip() else None
        return quantity.strip() or None, unit, fixed
    match = AMOUNT_WITHOUT_SEPARATOR_RE.match(value.strip())
    if match:
        quantity = match.group("quantity").strip() or None
        unit = match.group("unit")
        unit = normalize_unit(unit.strip()) if unit else None
        return quantity, unit, fixed
    quantity, unit = split_glued_amount(value.strip(), parse_quantity=parse_quantity_to_fraction)
    if quantity:
        return quantity, unit, fixed
    return value.strip() or None, None, fixed


def scale_quantity(quantity: str | None, factor: float | None, fixed: bool) -> str | None:
    if quantity is None or factor is None or fixed:
        return quantity

    number = parse_quantity_to_fraction(quantity)
    if number is None:
        return quantity

    return format_decimal(number * Fraction(factor).limit_denominator())


def format_decimal(value: Fraction) -> str:
    scaled = float(value)
    return format(scaled, ".3f").rstrip("0").rstrip(".")


def normalize_quantity(quantity: str | None) -> str | None:
    if quantity is None:
        return None

    number = parse_quantity_to_fraction(quantity)
    if number is None:
        return quantity

    return format_decimal(number)


def validate_document_refs(metadata: dict[str, Any]) -> None:
    for key in ("source", "image"):
        value = parse_ref_value(metadata, key)
        if value and not validate_ref_value(value):
            raise ValueError(f"Invalid {key} value: must be http(s) URL or sources/ path")


def normalize_document(content: str) -> str:
    metadata, body = parse_document(content)
    validate_document_refs(metadata)
    return render_document(metadata, normalize_body_amounts(body))


def prepare_imported_content(content: str) -> str:
    metadata, body = parse_document(content)
    metadata.pop("tags", None)
    body = normalize_ingredient_amounts(body)
    return normalize_document(render_document(metadata, body))


def normalize_ingredient_amounts(body: str) -> str:
    def replacer(match: re.Match[str]) -> str:
        name = match.group("name_braced")
        if not name:
            return match.group(0)
        amount = match.group("amount") or ""
        quantity, unit, fixed = split_amount(amount)
        note = ingredient_note_from_match(match)
        if quantity is None and unit is None:
            return match.group(0)
        inner = format_canonical_amount(quantity, unit, fixed)
        return format_ingredient_markup(name, inner, note)

    return INGREDIENT_RE.sub(replacer, body)


def format_canonical_amount(
    quantity: str | None,
    unit: str | None,
    fixed: bool,
) -> str:
    prefix = "=" if fixed else ""
    if unit:
        return f"{prefix}{quantity}%{unit}"
    if quantity:
        return f"{prefix}{quantity}"
    return ""


def normalize_body_amounts(body: str) -> str:
    def replacer(match: re.Match[str]) -> str:
        name = match.group("name_braced")
        if not name:
            return match.group(0)
        amount = match.group("amount") or ""
        quantity, unit, fixed = split_amount(amount)
        note = ingredient_note_from_match(match)
        normalized_quantity = normalize_quantity(quantity)
        if normalized_quantity == quantity:
            return match.group(0)
        return format_ingredient_markup(
            name,
            rebuild_amount(normalized_quantity, unit, fixed, amount),
            note,
        )

    return INGREDIENT_RE.sub(replacer, body)


def rebuild_amount(
    quantity: str | None,
    unit: str | None,
    fixed: bool,
    original: str,
) -> str:
    if not quantity and not unit:
        return ""
    prefix = "=" if fixed else ""
    if unit:
        separator = "%" if "%" in original else " "
        return f"{prefix}{quantity}{separator}{unit}"
    return f"{prefix}{quantity}"


def scale_blocks(
    blocks: list[RecipeSection | RecipeStep],
    scale: float | None = None,
    servings: float = 1,
) -> list[RecipeSection | RecipeStep]:
    if scale is None:
        return blocks
    factor = scale / servings
    scaled: list[RecipeSection | RecipeStep] = []
    for block in blocks:
        if isinstance(block, RecipeSection):
            scaled.append(block)
        else:
            scaled.append(RecipeStep(text=scale_step_ingredients(block.text, factor)))
    return scaled


def scale_steps(steps: list[str], scale: float | None = None, servings: float = 1) -> list[str]:
    if scale is None:
        return steps
    factor = scale / servings
    return [scale_step_ingredients(step, factor) for step in steps]


def scale_step_ingredients(step: str, factor: float) -> str:
    def replacer(match: re.Match[str]) -> str:
        name = match.group("name_braced")
        if not name:
            return match.group(0)
        amount = match.group("amount") or ""
        quantity, unit, fixed = split_amount(amount)
        note = ingredient_note_from_match(match)
        scaled_quantity = scale_quantity(quantity, factor, fixed)
        if scaled_quantity == quantity:
            return match.group(0)
        return format_ingredient_markup(
            name,
            rebuild_amount(scaled_quantity, unit, fixed, amount),
            note,
        )

    return INGREDIENT_RE.sub(replacer, step)


def parse_quantity_to_fraction(quantity: str) -> Fraction | None:
    value = quantity.strip()
    if not value:
        return None

    if value in UNICODE_FRACTION_MAP:
        return UNICODE_FRACTION_MAP[value]

    for char, fraction in UNICODE_FRACTION_MAP.items():
        if char in value:
            whole, remainder = value.split(char, maxsplit=1)
            if remainder.strip():
                continue
            try:
                return Fraction(whole.strip()) + fraction
            except ValueError:
                continue

    try:
        return Fraction(value)
    except ValueError:
        parts = value.split()
        if len(parts) == 2:
            try:
                return Fraction(parts[0]) + Fraction(parts[1])
            except ValueError:
                return None
    return None


def strip_comments(body: str) -> str:
    lines = []
    for line in body.splitlines():
        if line.lstrip().startswith("--"):
            continue
        lines.append(line.split("--", 1)[0])
    return "\n".join(lines)


def unique(values: object) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        normalized = value.casefold()
        if value and normalized not in seen:
            seen.add(normalized)
            result.append(value)
    return result
