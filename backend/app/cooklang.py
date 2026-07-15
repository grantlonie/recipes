import re
from fractions import Fraction
from typing import Any

import yaml

from app.models import Ingredient, RecipeNote, RecipeSection, RecipeStep
from app.units import normalize_unit, split_glued_amount

FRONT_MATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.DOTALL)
FRONT_MATTER_LINE_RE = re.compile(r"^([A-Za-z0-9_-]+):\s*(.*)$")
QUOTE_DESCRIPTION_KEYS = frozenset({"description", "introduction"})
QUOTE_LIST_KEYS = frozenset({"review", "import_notes"})
APP_OWNED_IMPORT_KEYS = frozenset(
    {"review", "import_time", "import_duration_ms", "import_notes"}
)
IMPORT_ERROR_NOTE_PREFIX = "Import error: "
RECIPES_PREFIX = "recipes/"
# Local assets live next to recipe.cook as source.* / image.* (no slug in metadata).
LOCAL_ASSET_FILENAME_RE = re.compile(r"^(?:source|image)\.[A-Za-z0-9]+$")
# Latin letters with diacritics (excl. ×÷) so names like jalapeño parse fully.
TOKEN_CHARS = r"A-Za-z0-9_./' \-" + "\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F"
INGREDIENT_RE = re.compile(
    rf"@(?:(?P<name_braced>[{TOKEN_CHARS}]+?)\{{(?P<amount>[^}}]*)\}}|"
    rf"(?P<name>[{TOKEN_CHARS}]+?)(?=\s|[.,;:!?)]|\(|$))"
    rf"(?:\((?P<preparation>[^)]*)\))?"
)
COOKWARE_RE = re.compile(
    rf"#(?:(?P<name_braced>[{TOKEN_CHARS}]+?)\{{\}}|"
    rf"(?P<name>[{TOKEN_CHARS}]+?)(?=\s|[.,;:!?)]|$))"
)
TIMER_RE = re.compile(rf"~(?P<name>[{TOKEN_CHARS}]*?)?\{{(?P<amount>[^}}]*)\}}")
NOTE_RE = re.compile(r"^\s*>\s?(?P<note>.+)$", re.MULTILINE)
SECTION_LINE_RE = re.compile(r"^=+\s*(.+?)\s*=+\s*$")
UNICODE_FRACTION_CHARS = "¼½¾⅓⅔⅛⅜⅝⅞"
QUANTITY_PATTERN = (
    rf"(?:\d+\s+\d+/\d+|\d+\s+[{UNICODE_FRACTION_CHARS}]|"
    rf"\d+/\d+|\d+(?:\.\d+)?|[{UNICODE_FRACTION_CHARS}])"
)
AMOUNT_WITHOUT_SEPARATOR_RE = re.compile(rf"^(?P<quantity>{QUANTITY_PATTERN})(?:\s+(?P<unit>.+))?$")
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
    clean_metadata_notes(metadata)
    return metadata, content[match.end() :]


def sanitize_front_matter(content: str) -> str:
    """Repair common LLM YAML mistakes in front matter before parse.

    Example: ``title: "Greek" Lamb with Orzo`` is invalid YAML because the
    quoted token closes early. Re-encode the value as a safe scalar so import
    can skip the expensive repair model when only front matter is broken.
    """
    stripped = content.lstrip("\n")
    match = FRONT_MATTER_RE.match(stripped)
    if not match:
        return content

    front = match.group(1)
    try:
        loaded = yaml.safe_load(front)
        if isinstance(loaded, dict):
            clean_metadata_notes(loaded)
            return f"---\n{render_front_matter(loaded)}\n---\n{stripped[match.end() :]}"
    except yaml.YAMLError:
        pass

    fixed_lines: list[str] = []
    for line in front.splitlines():
        line_match = FRONT_MATTER_LINE_RE.match(line)
        if not line_match:
            fixed_lines.append(line)
            continue
        key, value = line_match.group(1), line_match.group(2)
        if value == "":
            fixed_lines.append(line)
            continue
        try:
            parsed = yaml.safe_load(f"{key}: {value}")
            if isinstance(parsed, dict) and key in parsed:
                fixed_lines.append(line)
                continue
        except yaml.YAMLError:
            pass
        repaired = repair_broken_scalar(value)
        if key in QUOTE_DESCRIPTION_KEYS:
            fixed_lines.append(f"{key}: {format_yaml_quoted_string(repaired)}")
        else:
            fixed_lines.append(
                yaml.safe_dump(
                    {key: repaired},
                    allow_unicode=True,
                    default_flow_style=False,
                    sort_keys=False,
                ).strip()
            )

    new_front = "\n".join(fixed_lines)
    try:
        loaded = yaml.safe_load(new_front)
        if not isinstance(loaded, dict):
            return content
    except yaml.YAMLError:
        return content

    clean_metadata_notes(loaded)
    return f"---\n{render_front_matter(loaded)}\n---\n{stripped[match.end() :]}"


def heal_imported_cooklang(content: str) -> tuple[str, list[str]]:
    """Local repairs that avoid an expensive second LLM call when possible.

    Returns (healed_content, heal_notes). Notes describe what was fixed.
    """
    notes: list[str] = []
    cleaned = content.strip()
    if not cleaned.startswith("---"):
        match = re.search(r"(?m)^---\s*$", cleaned)
        if match:
            cleaned = cleaned[match.start() :].strip()
            notes.append("heal: stripped leading prose before front matter")

    trimmed = trim_cooklang_document(cleaned)
    if trimmed != cleaned:
        notes.append("heal: trimmed trailing LLM reasoning / duplicate document")
        cleaned = trimmed

    cleaned = sanitize_front_matter(cleaned)
    try:
        metadata, body = parse_document(cleaned)
    except Exception:
        return cleaned, notes

    if not isinstance(metadata, dict):
        metadata = {}

    for key in ("source", "image"):
        value = parse_ref_value(metadata, key)
        if value and not validate_ref_value(value):
            metadata.pop(key, None)
            notes.append(f"heal: dropped invalid {key} ref ({value})")

    if not metadata.get("title") or not body.strip():
        return cleaned, notes

    return render_document(metadata, body), notes


# Model sometimes keeps "thinking" in the main content channel after a valid .cook doc.
_LLM_REASONING_START_RE = re.compile(
    r"(?im)^(?:"
    r"Wait,?\s+I\b|Actually,?\s+(?:wait|let me|I)\b|Let me (?:reconsider|finalize|also|check)\b|"
    r"Hmm,|I (?:need to|should|think|decided|will)\b|Looking at this\b|"
    r"My (?:description|revised|final)\b|Revised description\b|"
    r"One more thing\b|I'll go with\b|I'?m overcomplicating\b"
    r")"
)


def trim_cooklang_document(content: str) -> str:
    """Keep the first Cooklang document; drop trailing reasoning and restarts."""
    stripped = content.strip()
    match = FRONT_MATTER_RE.match(stripped)
    if not match:
        return content

    front_end = match.end()
    body = stripped[front_end:]

    # A second front-matter block means the model restarted after thinking out loud.
    second = re.search(r"\n---\s*\n", body)
    if second:
        body = body[: second.start()]

    body = _strip_trailing_llm_reasoning(body)
    return f"{stripped[:front_end]}{body}".rstrip() + "\n"


def _strip_trailing_llm_reasoning(body: str) -> str:
    if not body.strip():
        return body

    # Prefer cutting at paragraph boundaries when reasoning prose appears.
    parts = re.split(r"\n\s*\n", body)
    kept: list[str] = []
    for part in parts:
        text = part.strip()
        if not text:
            continue
        if kept and _LLM_REASONING_START_RE.match(text):
            break
        if kept and _looks_like_llm_reasoning_paragraph(text):
            break
        kept.append(part)
    if not kept:
        return body
    return "\n\n".join(kept).rstrip() + "\n"


def _looks_like_llm_reasoning_paragraph(text: str) -> bool:
    """Heuristic for mid-document self-talk that isn't a cook tip note."""
    if text.startswith(">"):
        return False
    if text.startswith("==") and text.endswith("=="):
        return False
    if "@" in text or "#{" in text or "~{" in text:
        return False
    lowered = text.casefold()
    markers = (
        "the rules say",
        "i decided to",
        "if i strictly follow",
        "let me finalize",
        "let me also reconsider",
        "overcomplicating",
        "don't invent",
        "do not invent",
        "yaml should handle",
        "i'll leave it unquoted",
        "revised description",
    )
    return any(marker in lowered for marker in markers)


def format_yaml_quoted_string(value: str) -> str:
    """Encode a scalar as a double-quoted YAML string with escapes."""
    escaped = (
        value.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )
    return f'"{escaped}"'


def render_front_matter(metadata: dict[str, Any]) -> str:
    lines: list[str] = []
    for key, value in metadata.items():
        if value in (None, "", []):
            continue
        if key in QUOTE_DESCRIPTION_KEYS and isinstance(value, str):
            lines.append(f"{key}: {format_yaml_quoted_string(value)}")
            continue
        if key in QUOTE_LIST_KEYS and isinstance(value, list):
            items = [str(item).strip() for item in value if str(item).strip()]
            if not items:
                continue
            lines.append(f"{key}:")
            for item in items:
                lines.append(f"  - {format_yaml_quoted_string(item)}")
            continue
        dumped = yaml.safe_dump(
            {key: value},
            allow_unicode=True,
            default_flow_style=False,
            sort_keys=False,
            width=10_000,
        ).strip()
        lines.append(dumped)
    return "\n".join(lines)


def render_document(metadata: dict[str, Any], body: str) -> str:
    clean_metadata = {key: value for key, value in metadata.items() if value not in (None, "", [])}
    if not clean_metadata:
        return body.lstrip("\n")

    return f"---\n{render_front_matter(clean_metadata)}\n---\n\n{body.lstrip()}"


def format_ingredient_markup(name: str, amount: str, note: str | None = None) -> str:
    markup = f"@{name.strip()}{{{amount}}}"
    if note:
        markup += f"({note})"
    return markup


def ingredient_note_from_match(match: re.Match[str]) -> str | None:
    return (match.group("preparation") or "").strip() or None


def ingredient_name_from_match(match: re.Match[str]) -> str:
    return (match.group("name_braced") or match.group("name") or "").strip()


def ingredient_match_to_plain_text(match: re.Match[str]) -> str:
    name = ingredient_name_from_match(match)
    amount = match.group("amount") or ""
    note = ingredient_note_from_match(match)
    quantity, unit, _fixed = split_amount(amount)
    parts: list[str] = []
    if quantity:
        parts.append(quantity)
    if unit:
        parts.append(unit)
    if name:
        parts.append(name)
    text = " ".join(parts)
    if note:
        text = f"{text} ({note})" if text else f"({note})"
    return text or match.group(0)


def parse_ingredients(
    body: str, scale: float | None = None, servings: float = 1
) -> list[Ingredient]:
    ingredients: list[Ingredient] = []
    factor = None if scale is None else scale / servings
    # Note lines (`> ...`) may reference step ingredients for tips; keep them
    # out of the shopping list so amounts are not double-counted.
    for match in INGREDIENT_RE.finditer(strip_note_lines(strip_comments(body))):
        name = ingredient_name_from_match(match)
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
    return merge_ingredients(ingredients)


def merge_ingredients(ingredients: list[Ingredient]) -> list[Ingredient]:
    groups: dict[tuple[str, str | None, str | None, bool], Ingredient] = {}
    order: list[tuple[str, str | None, str | None, bool]] = []
    for ingredient in ingredients:
        key = (
            ingredient.name,
            ingredient.note,
            normalize_unit(ingredient.unit),
            ingredient.fixed,
        )
        if key not in groups:
            groups[key] = ingredient
            order.append(key)
            continue
        groups[key] = sum_ingredient_quantities(groups[key], ingredient)
    return [groups[key] for key in order]


def sum_ingredient_quantities(left: Ingredient, right: Ingredient) -> Ingredient:
    quantity = _sum_quantity_text(left.quantity, right.quantity)
    scaled_quantity = _sum_quantity_text(left.scaled_quantity, right.scaled_quantity)
    return left.model_copy(
        update={"quantity": quantity, "scaled_quantity": scaled_quantity},
    )


def _sum_quantity_text(left: str | None, right: str | None) -> str | None:
    if left is None and right is None:
        return None
    if left is None:
        return right
    if right is None:
        return left
    left_number = parse_quantity_to_fraction(left)
    right_number = parse_quantity_to_fraction(right)
    if left_number is None or right_number is None:
        return left
    return format_decimal(left_number + right_number)


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


def parse_blocks(body: str) -> list[RecipeNote | RecipeSection | RecipeStep]:
    blocks: list[RecipeNote | RecipeSection | RecipeStep] = []
    for block in re.split(r"\n\s*\n", body.strip()):
        lines = block.splitlines()
        index = 0
        while index < len(lines):
            stripped = lines[index].strip()
            if not stripped:
                index += 1
                continue
            note_match = NOTE_RE.match(stripped)
            if note_match:
                blocks.append(RecipeNote(text=note_match.group("note").strip()))
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
                if SECTION_LINE_RE.match(line) or NOTE_RE.match(line):
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


def metadata_string_list(metadata: dict[str, Any], key: str) -> list[str]:
    value = metadata.get(key)
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def metadata_review(metadata: dict[str, Any]) -> list[str]:
    return metadata_string_list(metadata, "review")


def metadata_import_notes(metadata: dict[str, Any]) -> list[str]:
    return metadata_string_list(metadata, "import_notes")


def strip_app_owned_import_keys(metadata: dict[str, Any]) -> None:
    for key in APP_OWNED_IMPORT_KEYS:
        metadata.pop(key, None)


def strip_import_error_notes(body: str) -> str:
    """Remove legacy `> Import error:` notes from recipe bodies."""
    blocks = parse_blocks(body)
    kept: list[str] = []
    for block in blocks:
        if isinstance(block, RecipeNote) and block.text.startswith(IMPORT_ERROR_NOTE_PREFIX):
            continue
        if isinstance(block, RecipeNote):
            kept.append(f"> {block.text}")
        elif isinstance(block, RecipeSection):
            kept.append(f"=={block.title}==")
        else:
            kept.append(block.text)
    return "\n\n".join(kept).strip() + ("\n" if kept else "")


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


def is_local_asset_filename(value: str) -> bool:
    return bool(LOCAL_ASSET_FILENAME_RE.fullmatch(value))


def is_legacy_recipes_path(value: str) -> bool:
    if not value.startswith(RECIPES_PREFIX):
        return False
    remainder = value.removeprefix(RECIPES_PREFIX)
    parts = remainder.split("/")
    return len(parts) == 2 and bool(parts[0]) and is_local_asset_filename(parts[1])


def is_ref_file(value: str) -> bool:
    return is_local_asset_filename(value) or is_legacy_recipes_path(value)


def local_asset_filename(value: str) -> str | None:
    if is_local_asset_filename(value):
        return value
    if is_legacy_recipes_path(value):
        return value.rsplit("/", 1)[-1]
    return None


def validate_ref_value(value: str) -> bool:
    stripped = value.strip()
    if not stripped:
        return True
    return is_ref_url(stripped) or is_ref_file(stripped)


def normalize_ref_value(value: str) -> str:
    """Collapse legacy recipes/{slug}/asset.* refs to bare asset.* filenames."""
    filename = local_asset_filename(value)
    return filename if filename is not None else value


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


def resolve_asset_api_path(value: str, *, slug: str | None = None) -> str | None:
    if is_legacy_recipes_path(value):
        return f"/api/sources/{value.removeprefix(RECIPES_PREFIX)}"
    if is_local_asset_filename(value):
        if not slug:
            return None
        return f"/api/sources/{slug}/{value}"
    return None


def resolve_image_url(
    metadata: dict[str, Any], app_base_url: str, *, slug: str | None = None
) -> str | None:
    value = metadata_image(metadata)
    if not value:
        return None
    if is_ref_url(value):
        return value
    return resolve_asset_api_path(value, slug=slug) or value


def resolve_source_url(
    metadata: dict[str, Any], app_base_url: str, *, slug: str | None = None
) -> str | None:
    value = metadata_source_value(metadata)
    if not value:
        return None
    if is_ref_url(value):
        return value
    return resolve_asset_api_path(value, slug=slug)


def metadata_original_url(metadata: dict[str, Any]) -> str | None:
    return metadata_source_url(metadata)


def metadata_cook_time(metadata: dict[str, Any]) -> str | None:
    prep = metadata.get("prep time") or metadata.get("time.prep")
    cook = metadata.get("cook time") or metadata.get("time.cook")
    if prep and cook:
        return f"{prep} prep + {cook} cook"
    if prep:
        return f"{prep} prep"
    if cook:
        return f"{cook} cook"
    for key in ("time", "duration", "time required"):
        value = metadata.get(key)
        if value:
            return str(value)
    return None


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
    review: list[str] | None = None,
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
    if review is not None:
        cleaned = [item.strip() for item in review if item.strip()]
        if cleaned:
            updated["review"] = cleaned
        else:
            updated.pop("review", None)
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
            raise ValueError(
                f"Invalid {key} value: must be http(s) URL or local asset file "
                "(source.* / image.*)"
            )


def normalize_document_refs(metadata: dict[str, Any]) -> None:
    for key in ("source", "image"):
        value = parse_ref_value(metadata, key)
        if not value:
            continue
        normalized = normalize_ref_value(value)
        if normalized != value:
            metadata[key] = normalized


def normalize_document(content: str) -> str:
    metadata, body = parse_document(content)
    normalize_document_refs(metadata)
    validate_document_refs(metadata)
    return render_document(metadata, normalize_body_amounts(body))


def prepare_imported_content(content: str) -> str:
    metadata, body = parse_document(trim_cooklang_document(content))
    metadata.pop("tags", None)
    strip_app_owned_import_keys(metadata)
    body = normalize_ingredient_amounts(strip_import_error_notes(body))
    return normalize_document(render_document(metadata, body))


def clean_metadata_notes(metadata: dict[str, Any]) -> None:
    """Strip LLM quote/escape artifacts from description-like fields."""
    for key in ("description", "introduction"):
        value = metadata.get(key)
        if isinstance(value, str):
            cleaned = clean_note_text(value)
            if cleaned:
                metadata[key] = cleaned
            else:
                metadata.pop(key, None)


def clean_note_text(value: str) -> str:
    text = repair_broken_scalar(value)
    return text


def repair_broken_scalar(value: str) -> str:
    """Unwrap truncated/misquoted YAML scalars and decode leftover escapes."""
    text = value.strip()
    while len(text) >= 2 and text[0] in "\"'" and text.endswith("\\"):
        text = text[1:-1].rstrip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        inner = text[1:-1]
        if text[0] == "'" or ('"' not in inner):
            text = inner.strip()
    if text.startswith('"') and text.count('"') == 1:
        text = text[1:]
    if text.startswith("'") and text.count("'") == 1:
        text = text[1:]
    text = text.rstrip("\\").strip()
    return decode_unicode_escapes(text).strip()


_UNICODE_ESCAPE_RE = re.compile(r"\\u([0-9a-fA-F]{4})|\\U([0-9a-fA-F]{8})")


def decode_unicode_escapes(value: str) -> str:
    def replace(match: re.Match[str]) -> str:
        hex_value = match.group(1) or match.group(2)
        return chr(int(hex_value, 16))

    return _UNICODE_ESCAPE_RE.sub(replace, value)


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
    blocks: list[RecipeNote | RecipeSection | RecipeStep],
    scale: float | None = None,
    servings: float = 1,
) -> list[RecipeNote | RecipeSection | RecipeStep]:
    if scale is None:
        return blocks
    factor = scale / servings
    scaled: list[RecipeNote | RecipeSection | RecipeStep] = []
    for block in blocks:
        if isinstance(block, RecipeSection):
            scaled.append(block)
        elif isinstance(block, RecipeNote):
            scaled.append(RecipeNote(text=scale_step_ingredients(block.text, factor)))
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


def strip_note_lines(body: str) -> str:
    return "\n".join(line for line in body.splitlines() if not NOTE_RE.match(line))


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
