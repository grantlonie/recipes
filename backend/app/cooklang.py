import re
from fractions import Fraction
from typing import Any

import yaml

from app.models import Ingredient

FRONT_MATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.DOTALL)
TOKEN_CHARS = r"A-Za-z0-9_./' -"
INGREDIENT_RE = re.compile(
    rf"@(?:(?P<name_braced>[{TOKEN_CHARS}]+?)\{{(?P<amount>[^}}]*)\}}|"
    rf"(?P<name>[{TOKEN_CHARS}]+?)(?=\s|[.,;:!?)]|$))"
)
COOKWARE_RE = re.compile(
    rf"#(?:(?P<name_braced>[{TOKEN_CHARS}]+?)\{{\}}|"
    rf"(?P<name>[{TOKEN_CHARS}]+?)(?=\s|[.,;:!?)]|$))"
)
TIMER_RE = re.compile(r"~(?P<name>[A-Za-z0-9_./' -]*?)?\{(?P<amount>[^}]*)\}")
NOTE_RE = re.compile(r"^\s*>\s?(?P<note>.+)$", re.MULTILINE)


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


def parse_ingredients(body: str, scale: float | None = None, servings: float = 1) -> list[Ingredient]:
    ingredients: list[Ingredient] = []
    factor = None if scale is None else scale / servings
    for match in INGREDIENT_RE.finditer(strip_comments(body)):
        name = (match.group("name_braced") or match.group("name")).strip()
        if not name:
            continue
        quantity, unit, fixed = split_amount(match.group("amount"))
        ingredients.append(
            Ingredient(
                fixed=fixed,
                name=name,
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


def parse_steps(body: str) -> list[str]:
    steps: list[str] = []
    for block in re.split(r"\n\s*\n", body.strip()):
        step = "\n".join(line for line in block.splitlines() if not line.lstrip().startswith(">")).strip()
        if step:
            steps.append(step)
    return steps


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


def metadata_image(metadata: dict[str, Any]) -> str | None:
    for key in ("image", "picture"):
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    for key in ("images", "pictures"):
        value = metadata.get(key)
        if isinstance(value, list) and value:
            return str(value[0]).strip()
    return None


def metadata_original_url(metadata: dict[str, Any]) -> str | None:
    source = metadata.get("source")
    if isinstance(source, str) and source.startswith(("http://", "https://")):
        return source
    if isinstance(source, dict):
        value = source.get("url")
        if isinstance(value, str) and value.startswith(("http://", "https://")):
            return value
    value = metadata.get("source.url")
    if isinstance(value, str) and value.startswith(("http://", "https://")):
        return value
    return None


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
        return quantity.strip() or None, unit.strip() or None, fixed
    return value.strip() or None, None, fixed


def scale_quantity(quantity: str | None, factor: float | None, fixed: bool) -> str | None:
    if quantity is None or factor is None or fixed:
        return quantity

    try:
        number = Fraction(quantity)
    except ValueError:
        return quantity

    scaled = float(number * Fraction(factor).limit_denominator())
    return format(scaled, ".3f").rstrip("0").rstrip(".")


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
