from __future__ import annotations

import re
from dataclasses import dataclass

from app import cooklang
from app.ingredient_inflection import inflection_forms, normalize_ingredient_key

_INVALID_AMOUNT_RE = re.compile(
    r"^\s*(?:=)?(?:0(?:\.0+)?%g|0|pinch|splash|to taste|as needed|optional)\s*$",
    re.IGNORECASE,
)
_PLAIN_AMOUNT_RE = re.compile(
    r"(?<![@#~{/\w])(?P<qty>\d+(?:\.\d+)?(?:\s+\d+/\d+)?|\d+/\d+)\s*"
    r"(?P<unit>cups?|Tbsp|tbsp|tsp|teaspoons?|tablespoons?|ounces?|oz|pounds?|lbs?|"
    r"grams?|kg|ml|liters?|litres?|cloves?)\b",
    re.IGNORECASE,
)
_COOKWARE_COUNT_RE = re.compile(
    r"\b(?:baking\s+)?(?:pan|skillet|bowl|board|rack|dish|pot|sheet|tray)"
    r"\{\d+(?:%[^}]*)?\}",
    re.IGNORECASE,
)
_NOISE_SECTION_RE = re.compile(
    r"(?im)^(?:nutrition|tools|related recipes|per serving|calories|protein|carbohydrates|"
    r"total fat|make ahead|loading\.\.\.|set a timer|bake mode)\b.*$"
)
_TRAILING_TAG_CLOUD_RE = re.compile(
    r"(?im)^(?:bread|cake|grains|almond|orange|bean|chocolate|milk/cream|brownie|"
    r"spring|fall|winter|summer)\s*$"
)
_SKIP_SOURCE_LINE_RE = re.compile(
    r"(?i)^(serving suggestions?|notes?|yield|makes|serves|set a timer|tools?|"
    r"nutrition|related|per serving)\b|^\*"
)
_PLAIN_AMOUNT_ALLOW_RE = re.compile(
    r"(?i)\b(?:of the fat|of fat|pasta water|of gravy|drippings?|pan juices?|"
    r"cooking (?:liquid|juices?)|of (?:this|the) (?:mixture|liquid|dough|"
    r"sauce|batter|syrup|water|gravy)|all but)\b"
)
_UNIT_WORDS = frozenset(
    {
        "bunch",
        "bunches",
        "can",
        "cans",
        "clove",
        "cloves",
        "cup",
        "cups",
        "g",
        "gram",
        "grams",
        "head",
        "heads",
        "kg",
        "large",
        "lb",
        "lbs",
        "liter",
        "liters",
        "litre",
        "litres",
        "medium",
        "ml",
        "ounce",
        "ounces",
        "oz",
        "package",
        "packages",
        "pinch",
        "pinches",
        "pound",
        "pounds",
        "small",
        "stick",
        "sticks",
        "tablespoon",
        "tablespoons",
        "tbsp",
        "teaspoon",
        "teaspoons",
        "tsp",
    }
)
_STOP_WORDS = frozenset(
    {
        "about",
        "additional",
        "and",
        "as",
        "chopped",
        "cooled",
        "crumbled",
        "diced",
        "divided",
        "dried",
        "each",
        "finely",
        "for",
        "fresh",
        "freshly",
        "from",
        "ground",
        "into",
        "melted",
        "minced",
        "more",
        "needed",
        "optional",
        "or",
        "peeled",
        "plus",
        "room",
        "separated",
        "sliced",
        "taste",
        "temperature",
        "the",
        "to",
        "unsalted",
        "with",
    }
)
_STRUCTURAL_WARNING_PREFIXES = (
    "Invalid amount for @",
    "Plain-text amount not marked as ingredient:",
    "Cookware should use #name{}",
    "Source ingredient may be missing from Cooklang:",
)


@dataclass(frozen=True)
class ImportValidation:
    warnings: list[str]

    @property
    def needs_repair(self) -> bool:
        return any(
            warning.startswith(_STRUCTURAL_WARNING_PREFIXES) for warning in self.warnings
        )


def validate_imported_cooklang(content: str, *, source_text: str | None = None) -> ImportValidation:
    """Surface structural import problems without failing the import."""
    warnings: list[str] = []
    try:
        _metadata, body = cooklang.parse_document(content)
    except Exception:
        return ImportValidation(warnings=["Could not parse imported Cooklang for validation"])

    warnings.extend(_invalid_amount_warnings(body))
    warnings.extend(_plain_amount_warnings(body))
    warnings.extend(_cookware_count_warnings(body))
    if source_text:
        warnings.extend(_missing_source_ingredient_warnings(body, source_text))
    return ImportValidation(warnings=warnings)


def clean_source_text(text: str) -> str:
    """Strip common scrape noise that confuses recipe conversion."""
    lines: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            lines.append("")
            continue
        if _NOISE_SECTION_RE.match(stripped):
            continue
        if _TRAILING_TAG_CLOUD_RE.match(stripped):
            continue
        lines.append(line)
    cleaned = "\n".join(lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _invalid_amount_warnings(body: str) -> list[str]:
    warnings: list[str] = []
    for match in cooklang.INGREDIENT_RE.finditer(body):
        name = (match.group("name_braced") or match.group("name") or "").strip()
        amount = (match.group("amount") or "").strip()
        if not name or not amount:
            continue
        if _INVALID_AMOUNT_RE.match(amount):
            warnings.append(
                f"Invalid amount for @{name}: {{{amount}}} — "
                "use an empty amount with a (to taste)/(as needed) note instead"
            )
    return warnings


def _plain_amount_warnings(body: str) -> list[str]:
    warnings: list[str] = []
    for match in _PLAIN_AMOUNT_RE.finditer(body):
        snippet = match.group(0).strip()
        start = match.start()
        open_brace = body.rfind("{", 0, start)
        close_brace = body.rfind("}", 0, start)
        if open_brace > close_brace:
            continue
        window = body[match.end() : match.end() + 48]
        if _PLAIN_AMOUNT_ALLOW_RE.search(window) or _PLAIN_AMOUNT_ALLOW_RE.search(
            body[max(0, start - 24) : match.end() + 48]
        ):
            continue
        warnings.append(f"Plain-text amount not marked as ingredient: {snippet}")
    return warnings


def _cookware_count_warnings(body: str) -> list[str]:
    return [
        f"Cookware should use #name{{}}, not a count brace: {match.group(0)}"
        for match in _COOKWARE_COUNT_RE.finditer(body)
    ]


def _missing_source_ingredient_warnings(body: str, source_text: str) -> list[str]:
    source_lines = _source_ingredient_lines(source_text)
    if not source_lines:
        return []

    cook_names = _cook_ingredient_names(body)
    cook_tokens = _cook_content_tokens(body)
    warnings: list[str] = []
    for line in source_lines:
        if _SKIP_SOURCE_LINE_RE.search(line):
            continue
        if _source_line_is_covered(line, cook_names, cook_tokens):
            continue
        warnings.append(f"Source ingredient may be missing from Cooklang: {line}")
    return warnings


def _source_ingredient_lines(source_text: str) -> list[str]:
    lines = source_text.splitlines()
    in_ingredients = False
    collected: list[str] = []
    for raw in lines:
        line = raw.strip()
        if re.match(r"^(ingredients|for the)\b", line, re.IGNORECASE):
            in_ingredients = True
            continue
        if in_ingredients and re.match(
            r"^(directions|instructions|method|preparation|steps|procedure|how to)\b",
            line,
            re.IGNORECASE,
        ):
            break
        if not in_ingredients or not line:
            continue
        if line.endswith(":") and len(line) < 40:
            continue
        if re.match(r"^(nutrition|tools|related)\b", line, re.IGNORECASE):
            continue
        collected.append(line)
    return collected


def _cook_ingredient_names(body: str) -> set[str]:
    names: set[str] = set()
    for match in cooklang.INGREDIENT_RE.finditer(body):
        name = (match.group("name_braced") or match.group("name") or "").strip()
        if not name:
            continue
        names.update(inflection_forms(name))
        names.update(normalize_ingredient_key(name).split())
    return names


def _cook_content_tokens(body: str) -> set[str]:
    tokens: set[str] = set()
    for token in re.findall(r"[a-z][a-z']{2,}", body.casefold()):
        if token in _STOP_WORDS or token in _UNIT_WORDS:
            continue
        tokens.add(token)
        tokens.update(inflection_forms(token))
    return tokens


def _source_line_is_covered(line: str, cook_names: set[str], cook_tokens: set[str]) -> bool:
    content_tokens = _source_content_tokens(line)
    if not content_tokens:
        return True

    # Prefer matching against known @ingredient names / inflections.
    for token in content_tokens:
        forms = set(inflection_forms(token))
        forms.add(token)
        if forms & cook_names:
            return True

    # Fall back to presence of distinctive content tokens in the body.
    distinctive = [token for token in content_tokens if len(token) >= 4]
    if not distinctive:
        distinctive = content_tokens
    return any(token in cook_tokens or set(inflection_forms(token)) & cook_tokens for token in distinctive)


def _source_content_tokens(line: str) -> list[str]:
    cleaned = re.sub(r"\([^)]*\)", " ", line)
    cleaned = re.sub(r"\d+(?:[./]\d+)?", " ", cleaned)
    tokens = [
        token
        for token in re.findall(r"[a-z][a-z']{2,}", cleaned.casefold())
        if token not in _STOP_WORDS and token not in _UNIT_WORDS
    ]
    # Prefer later tokens (usually the ingredient head noun).
    return list(dict.fromkeys(tokens))
