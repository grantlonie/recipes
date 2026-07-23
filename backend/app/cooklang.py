import re
from fractions import Fraction
from typing import Any

import yaml

from app.ingredient_inflection import inflection_forms
from app.models import Ingredient, RecipeNote, RecipeSection, RecipeStep
from app.units import normalize_unit, split_glued_amount

FRONT_MATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.DOTALL)
FRONT_MATTER_LINE_RE = re.compile(r"^([A-Za-z0-9_-]+):\s*(.*)$")
QUOTE_DESCRIPTION_KEYS = frozenset({"description", "introduction", "title"})
QUOTE_LIST_KEYS = frozenset({"review", "import_notes"})
# LLMs sometimes emit Title:/name: instead of the required lowercase title key.
TITLE_KEY_ALIASES = frozenset(
    {
        "title",
        "name",
        "recipe",
        "recipe_name",
        "recipe-name",
        "recipe title",
        "recipe_title",
    }
)
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


def heal_imported_cooklang(
    content: str,
    *,
    fallback_title: str | None = None,
    source_text: str | None = None,
) -> tuple[str, list[str]]:
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

    candidate_count = len(_cooklang_document_candidates(cleaned))
    trimmed = trim_cooklang_document(cleaned)
    if candidate_count > 1 or _body_lost_reasoning(cleaned, trimmed):
        notes.append("heal: trimmed trailing LLM reasoning / duplicate document")
    cleaned = trimmed

    cleaned = sanitize_front_matter(cleaned)
    has_front_matter = bool(FRONT_MATTER_RE.match(cleaned))
    try:
        metadata, body = parse_document(cleaned)
    except Exception:
        return cleaned, notes

    if not isinstance(metadata, dict):
        metadata = {}

    metadata, alias_note = normalize_title_metadata(metadata)
    if alias_note:
        notes.append(alias_note)

    for key in ("source", "image"):
        value = parse_ref_value(metadata, key)
        if value and not validate_ref_value(value):
            metadata.pop(key, None)
            notes.append(f"heal: dropped invalid {key} ref ({value})")

    if not metadata.get("title"):
        recovered, body, recover_note = recover_missing_title(
            body,
            fallback_title=fallback_title,
            source_text=source_text,
        )
        if recovered and (has_front_matter or INGREDIENT_RE.search(body)):
            if not has_front_matter:
                body = _strip_broken_front_matter_prefix(body)
            metadata = {"title": recovered, **{k: v for k, v in metadata.items() if k != "title"}}
            notes.append(recover_note)
        elif not recovered or not has_front_matter:
            return cleaned, notes

    if not metadata.get("title") or not body.strip():
        return cleaned, notes

    cleaned_body, split_salt = split_salt_and_pepper_markers(body)
    if split_salt:
        body = cleaned_body
        notes.append("heal: split @salt and pepper into @salt and @black pepper")

    cleaned_body, dropped_notes = strip_llm_reasoning_notes(body)
    if dropped_notes:
        body = cleaned_body
        notes.append("heal: removed LLM self-talk from notes")

    return render_document(metadata, body), notes


def split_salt_and_pepper_markers(body: str) -> tuple[str, bool]:
    """Rewrite combined salt-and-pepper markers into two catalog-friendly ingredients."""

    def replacer(match: re.Match[str]) -> str:
        amount = (match.group(1) or "").strip()
        note = (match.group(2) or "").strip() or "to taste"
        note_markup = f"({note})"
        if amount:
            return (
                f"@salt{{{amount}}}{note_markup} and @black pepper{{{amount}}}{note_markup}"
            )
        return f"@salt{{}}{note_markup} and @black pepper{{}}{note_markup}"

    updated, count = _SALT_AND_PEPPER_RE.subn(replacer, body)
    return updated, count > 0


def strip_llm_reasoning_notes(body: str) -> tuple[str, bool]:
    """Drop note/prose blocks that are model self-talk, not cook tips."""
    parts = re.split(r"\n\s*\n", body)
    kept: list[str] = []
    dropped = False
    for part in parts:
        text = part.strip()
        if not text:
            continue
        if _is_llm_reasoning_block(text):
            dropped = True
            continue
        kept.append(part)
    if not kept:
        return (body if not dropped else "\n"), dropped
    result = "\n\n".join(kept).rstrip() + "\n"
    return result, dropped or result != body.rstrip() + "\n"


def _strip_broken_front_matter_prefix(body: str) -> str:
    """If body still starts with a broken --- block, keep only the recipe body."""
    stripped = body.lstrip("\n")
    match = FRONT_MATTER_RE.match(stripped)
    if match:
        return stripped[match.end() :]
    if stripped.startswith("---"):
        rest = re.sub(r"\A---\s*\n?", "", stripped, count=1)
        closer = re.search(r"(?m)^---\s*$", rest)
        if closer:
            return rest[closer.end() :].lstrip("\n")
        return rest
    return body


def normalize_title_metadata(metadata: dict[str, Any]) -> tuple[dict[str, Any], str | None]:
    """Map Title:/name:/recipe: aliases onto lowercase ``title``."""
    existing = metadata.get("title")
    if isinstance(existing, str) and existing.strip():
        return metadata, None

    alias_keys = {
        alias.casefold().replace("-", "_").replace(" ", "_") for alias in TITLE_KEY_ALIASES
    }
    for key, value in list(metadata.items()):
        normalized_key = key.casefold().replace("-", "_").replace(" ", "_")
        if normalized_key not in alias_keys:
            continue
        text = str(value).strip() if value not in (None, "") else ""
        if not text:
            continue
        normalized = {k: v for k, v in metadata.items() if k != key and k != "title"}
        normalized = {"title": text, **normalized}
        if key == "title":
            return normalized, None
        return normalized, f"heal: normalized front-matter key {key!r} → title"
    return metadata, None


def recover_missing_title(
    body: str,
    *,
    fallback_title: str | None = None,
    source_text: str | None = None,
) -> tuple[str | None, str, str]:
    """Recover a missing title from source text, explicit fallback, or body heading.

    Prefer source/fallback over body text: body often starts with ==Section==
    labels like Preparation, which are not recipe titles.
    """
    guessed = (fallback_title or "").strip() or guess_title_from_source_text(source_text or "")
    if guessed:
        return guessed, body, "heal: recovered title from source"

    from_body, rest = title_from_body_heading(body)
    if from_body:
        return from_body, rest, "heal: recovered title from body heading"
    return None, body, ""


def title_from_body_heading(body: str) -> tuple[str | None, str]:
    """If the body starts with a plain title line (not a section), lift it into metadata.

    Does not use ==Section== markers — those are usually Preparation/Dough/etc.
    """
    stripped = body.lstrip("\n")
    if not stripped.strip():
        return None, body
    lines = stripped.split("\n")
    first = lines[0].strip()
    rest = "\n".join(lines[1:]).lstrip("\n")

    if _looks_like_title_line(first):
        return first, rest if rest else "\n"
    return None, body


def _looks_like_title_line(text: str) -> bool:
    if not text or len(text) > 120:
        return False
    if text.startswith((">", "=", "#", "-", "*", "@", "~")):
        return False
    if any(token in text for token in ("@{", "#{", "~{", "{", "}")):
        return False
    if text.endswith((".", "!", "?")):
        return False
    lowered = text.casefold()
    step_starters = (
        "preheat",
        "combine",
        "mix",
        "add",
        "whisk",
        "stir",
        "bake",
        "cook",
        "heat",
        "place",
        "pour",
        "slice",
        "cut",
        "season",
        "serve",
        "bring",
        "remove",
        "transfer",
        "boil",
        "simmer",
        "fold",
        "beat",
        "roast",
        "grill",
        "saute",
        "sauté",
        "fry",
        "drain",
        "toss",
        "spread",
        "brush",
        "line",
        "grease",
        "set ",
        "let ",
        "while ",
        "in a ",
        "in the ",
    )
    if any(lowered.startswith(starter) for starter in step_starters):
        return False
    return True


def guess_title_from_source_text(source_text: str) -> str | None:
    """Best-effort title from the first meaningful line of source text."""
    skip_prefixes = (
        "http://",
        "https://",
        "ingredients",
        "directions",
        "instructions",
        "method",
        "steps",
        "serves",
        "servings",
        "yield",
        "yields",
        "prep time",
        "cook time",
        "total time",
        "makes ",
        "recipe text",
    )
    for raw_line in source_text.splitlines():
        line = raw_line.strip().strip("*# ").strip()
        if not line:
            continue
        lowered = line.casefold()
        if any(lowered.startswith(prefix) for prefix in skip_prefixes):
            continue
        # Ingredient lines ("1 lb lamb", "½ cup sugar") are not titles.
        if re.match(r"^[\d¼½¾⅓⅔⅛⅜⅝⅞]", line):
            continue
        if len(line) > 120:
            continue
        # Strip trailing site noise / trademark marks.
        cleaned = line.replace("®", "").replace("©", "").replace("™", "").strip()
        cleaned = re.sub(r"\s+", " ", cleaned)
        return cleaned or None
    return None


def _body_lost_reasoning(before: str, after: str) -> bool:
    """True when trim removed reasoning prose (not just blank-line normalization)."""
    try:
        _, before_body = parse_document(before)
        _, after_body = parse_document(after)
    except Exception:
        return before.strip() != after.strip()
    before_norm = re.sub(r"\n{3,}", "\n\n", before_body.strip())
    after_norm = re.sub(r"\n{3,}", "\n\n", after_body.strip())
    if before_norm == after_norm:
        return False
    dropped = before_norm[len(after_norm) :] if before_norm.startswith(after_norm) else before_norm
    return bool(
        _LLM_REASONING_START_RE.search(dropped)
        or _looks_like_llm_reasoning_paragraph(dropped.strip()[:200])
        or "let me" in dropped.casefold()
        or "wait," in dropped.casefold()
    )


# Model sometimes keeps "thinking" in the main content channel after a valid .cook doc.
_LLM_REASONING_START_RE = re.compile(
    r"(?im)^(?:"
    r"Wait,?\s+I\b|Wait[,.]?\s*$|Hmm,?\b|Actually,?\s+(?:wait|let me|I)\b|"
    r"Let me (?:reconsider|finalize|also|check|re-check|write|think|just)\b|"
    r"I (?:need to|should|think|decided|will|realize|want to)\b|Looking at (?:this|the)\b|"
    r"My (?:description|revised|final|draft)\b|Revised description\b|"
    r"One more thing\b|I'll (?:go with|use|keep|tag|include)\b|I'?m overcomplicating\b|"
    r"The rules say\b|Per the rules\b|Actually,?\s+looking\b|"
    r"\d+\.\s+\""  # numbered self-review: 1. "6 inner stalks...
    r")"
)

_SALT_AND_PEPPER_RE = re.compile(
    r"@salt\s*(?:and|&)\s*(?:freshly\s+ground\s+)?(?:black\s+)?pepper"
    r"\{([^}]*)\}(?:\(([^)]*)\))?",
    re.IGNORECASE,
)


def trim_cooklang_document(content: str) -> str:
    """Keep one Cooklang document; drop trailing reasoning and bad restarts.

    When the model emits multiple ``---`` documents (usually after self-talk about
    quoting titles with apostrophes), prefer the first *complete* document
    (title + body). Otherwise a draft without a title can discard a later fix.
    """
    stripped = content.strip()
    candidates = _cooklang_document_candidates(stripped)
    if not candidates:
        return content

    chosen = candidates[0]
    for candidate in candidates:
        if _cooklang_document_is_complete(candidate):
            chosen = candidate
            break
    else:
        for candidate in candidates:
            if _cooklang_document_has_title(candidate):
                chosen = candidate
                break

    match = FRONT_MATTER_RE.match(chosen)
    if not match:
        return chosen.rstrip() + "\n"
    body = _strip_trailing_llm_reasoning(chosen[match.end() :])
    return f"{chosen[: match.end()]}{body}".rstrip() + "\n"


def _cooklang_document_candidates(content: str) -> list[str]:
    """Split model output into full front-matter documents.

    Only treats a later ``---`` as a new document when it opens real YAML
    front matter (at least one ``key:`` line). Closing delimiters and bare
    ``---`` rules in prose are ignored.
    """
    candidates: list[str] = []
    remaining = content
    while True:
        match = FRONT_MATTER_RE.match(remaining)
        if not match:
            break
        body = remaining[match.end() :]
        next_start: int | None = None
        for marker in re.finditer(r"(?m)^---\s*$", body):
            chunk = body[marker.start() :]
            nested = FRONT_MATTER_RE.match(chunk)
            if not nested:
                continue
            if not re.search(r"(?m)^[A-Za-z0-9_-]+:\s*", nested.group(1)):
                continue
            next_start = match.end() + marker.start()
            break
        if next_start is None:
            candidates.append(remaining.rstrip() + "\n")
            break
        candidates.append(remaining[:next_start].rstrip() + "\n")
        remaining = remaining[next_start:]
    return candidates


def _cooklang_document_has_title(content: str) -> bool:
    try:
        metadata, _body = parse_document(content)
    except Exception:
        return False
    return bool(isinstance(metadata, dict) and metadata.get("title"))


def _cooklang_document_is_complete(content: str) -> bool:
    try:
        metadata, body = parse_document(content)
    except Exception:
        return False
    return bool(isinstance(metadata, dict) and metadata.get("title") and body.strip())


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
        if kept and _is_llm_reasoning_block(text):
            break
        kept.append(part)
    if not kept:
        return body
    return "\n\n".join(kept).rstrip() + "\n"


def _is_llm_reasoning_block(text: str) -> bool:
    """True for self-talk paragraphs, including those wrapped as `>` notes."""
    unwrapped = _unwrap_cooklang_note_paragraph(text)
    if not unwrapped.strip():
        return False
    if _LLM_REASONING_START_RE.match(unwrapped.strip()):
        return True
    return _looks_like_llm_reasoning_paragraph(unwrapped)


def _unwrap_cooklang_note_paragraph(text: str) -> str:
    lines: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith(">"):
            stripped = stripped.lstrip(">").strip()
        lines.append(stripped)
    return "\n".join(lines)


def _looks_like_llm_reasoning_paragraph(text: str) -> bool:
    """Heuristic for mid-document self-talk that isn't a cook tip note."""
    unwrapped = _unwrap_cooklang_note_paragraph(text).strip()
    if not unwrapped:
        return False
    if unwrapped.startswith("==") and unwrapped.endswith("=="):
        return False
    lowered = unwrapped.casefold()
    markers = (
        "the rules say",
        "per the rules",
        "i decided to",
        "if i strictly follow",
        "let me finalize",
        "let me also reconsider",
        "let me re-check",
        "let me reconsider",
        "let me write the final",
        "let me just use",
        "overcomplicating",
        "don't invent",
        "do not invent",
        "yaml should handle",
        "i'll leave it unquoted",
        "revised description",
        "looking at the source",
        "looking at the rules",
        "looking at the examples",
        "one more review",
        "my draft",
        "i'll tag",
        "i should tag",
        "i should still tag",
        "i'll use @",
        "i'll keep",
        "hmm,",
        "hmm.",
        "wait -",
        "wait,",
        "actually, i",
        "actually looking",
        "re-check a few things",
    )
    if any(marker in lowered for marker in markers):
        return True
    # Numbered self-audit lines quoting ingredient text.
    if re.search(r'(?m)^\d+\.\s+".+"\s+-\s+', unwrapped):
        return True
    return False


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


def rename_ingredient_markers(body: str, old_name: str, new_name: str) -> str:
    """Rewrite @ingredient markers that match old_name (incl. inflection) to new_name."""
    old_forms = set(inflection_forms(old_name))
    if not old_forms:
        return body
    target = new_name.strip()
    if not target:
        return body

    def replacer(match: re.Match[str]) -> str:
        name = ingredient_name_from_match(match)
        if not name or not (set(inflection_forms(name)) & old_forms):
            return match.group(0)
        amount = match.group("amount")
        if amount is None and match.group("name_braced") is None:
            amount = ""
        else:
            amount = amount or ""
        return format_ingredient_markup(target, amount, ingredient_note_from_match(match))

    return INGREDIENT_RE.sub(replacer, body)


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
    strip_app_owned_import_keys(metadata)
    body, _ = split_salt_and_pepper_markers(body)
    body, _ = strip_llm_reasoning_notes(body)
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
