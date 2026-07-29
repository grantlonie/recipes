from __future__ import annotations

import re
from dataclasses import dataclass

from app import cooklang
from app.catalog_match import match_catalog_ingredient
from app.ingredient_inflection import inflection_forms, normalize_ingredient_key, token_match_forms
from app.models import CatalogIngredient, Ingredient

_INVALID_AMOUNT_RE = re.compile(
    r"^\s*(?:=)?(?:0(?:\.0+)?%g|0|pinch|splash|to taste|as needed|optional)\s*$",
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
    r"nutrition|related|per serving|save|rate|print|share|jump to|keep screen|"
    r"oops|something went wrong|photo by|photographer:|read more|load more|"
    r"my rating|my review|my answer|view answers|asked by|cancel|submit|"
    r"filter|sort|most helpful|featured|local offers|cookies? settings|"
    r"newsletter|follow us|i made it)\b|^\*|!\[|^\[.*\]\(https?://"
)
# Strip markdown heading / list markers before section matching.
_SECTION_PREFIX_RE = re.compile(r"^(?:#{1,6}\s+|(?:\d+[.)]|[-*+])\s+)+")
_INGREDIENTS_START_RE = re.compile(r"^(?:ingredients)\b", re.IGNORECASE)
_FOR_THE_SUBSECTION_RE = re.compile(r"^for the\b.+:$", re.IGNORECASE)
# Mid-list labels (BBC "To finish", "For the glaze") — not shopping items.
_INGREDIENT_SUBSECTION_LABEL_RE = re.compile(
    r"(?i)^(?:"
    r"to\s+(?:finish|serve|decorate|assemble|garnish|bake|cook)"
    r"|for\s+the\b.+"
    r"):?\s*$"
)
_INGREDIENTS_END_RE = re.compile(
    r"^(?:directions|instructions|method|preparation|steps|procedure|how to|"
    r"nutrition(?:\s+facts)?|reviews?|related|community|ask the community|"
    r"you.?ll also|most-?saved|tips and praise|editorial contributions)\b",
    re.IGNORECASE,
)
_QUANTITY_START_RE = re.compile(
    r"^(?:"
    r"\d+(?:[./]\d+)?"
    r"|[½¼¾⅓⅔⅛⅜⅝⅞]"
    r"|(?:one|two|three|four|five|six|seven|eight|nine|ten|a|an)\b"
    r")",
    re.IGNORECASE,
)
_NOT_INGREDIENT_LINE_RE = re.compile(
    r"(?i)^(?:\d[\d,.]*\s+(?:reviews?|ratings?|photos?|answers?|replies?|stars?)\b|"
    r"\d+\s*(?:mins?|minutes?|hrs?|hours?|secs?|seconds?)\s*$|"
    r"updated on\b|submitted by\b|tested by\b|out of\s+\d|"
    r"calories?\b|daily value\b)"
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
        "floz",
        "fluid",
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
# Prep words that shopping-list lines usually put before the ingredient name.
_PREP_WORDS = frozenset(
    {
        "chopped",
        "crumbled",
        "crushed",
        "cubed",
        "diced",
        "grated",
        "halved",
        "julienned",
        "melted",
        "minced",
        "peeled",
        "pitted",
        "quartered",
        "seeded",
        "shredded",
        "sliced",
        "softened",
        "toasted",
        "trimmed",
    }
)
# Prep-note gaps stay soft — they must not trigger a second LLM.
_STRUCTURAL_WARNING_PREFIXES = (
    "Invalid amount for @",
    "Cookware should use #name{}",
    "Source ingredient may be missing:",
)


@dataclass(frozen=True)
class ImportValidation:
    warnings: list[str]

    @property
    def needs_repair(self) -> bool:
        return any(
            warning.startswith(_STRUCTURAL_WARNING_PREFIXES) for warning in self.warnings
        )


def validate_imported_cooklang(
    content: str,
    *,
    source_text: str | None = None,
    catalog: list[CatalogIngredient] | None = None,
) -> ImportValidation:
    """Surface structural import problems without failing the import."""
    warnings: list[str] = []
    try:
        _metadata, body = cooklang.parse_document(content)
    except Exception:
        return ImportValidation(warnings=["Could not parse imported Cooklang for validation"])

    warnings.extend(_invalid_amount_warnings(body))
    warnings.extend(_cookware_count_warnings(body))
    if source_text:
        warnings.extend(
            _missing_source_ingredient_warnings(body, source_text, catalog=catalog)
        )
        warnings.extend(_missing_prep_note_warnings(body, source_text))
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


def _cookware_count_warnings(body: str) -> list[str]:
    return [
        f"Cookware should use #name{{}}, not a count brace: {match.group(0)}"
        for match in _COOKWARE_COUNT_RE.finditer(body)
    ]


def _missing_source_ingredient_warnings(
    body: str,
    source_text: str,
    *,
    catalog: list[CatalogIngredient] | None = None,
) -> list[str]:
    source_lines = _source_ingredient_lines(source_text)
    if not source_lines:
        return []

    cook_names = _cook_ingredient_names(body, catalog=catalog)
    cook_tokens = _cook_content_tokens(body)
    warnings: list[str] = []
    for line in source_lines:
        if _SKIP_SOURCE_LINE_RE.search(line):
            continue
        if _source_line_is_covered(line, cook_names, cook_tokens, catalog=catalog):
            continue
        warnings.append(f"Source ingredient may be missing: {line}")
    return warnings


def _missing_prep_note_warnings(body: str, source_text: str) -> list[str]:
    """Flag shopping-list prep words (chopped, diced, …) dropped from Cooklang notes."""
    source_lines = _source_ingredient_lines(source_text)
    if not source_lines:
        return []

    cook_ingredients = cooklang.parse_ingredients(body)
    body_folded = body.casefold()
    warnings: list[str] = []
    for line in source_lines:
        if _SKIP_SOURCE_LINE_RE.search(line):
            continue
        matches = _matching_cook_ingredients(line, cook_ingredients)
        if not matches:
            continue
        relevant_prep: list[str] = []
        covered: set[str] = set()
        for ingredient in matches:
            # Only require prep from the OR-branch that matches this @ingredient
            # (e.g. "oil or melted butter" + @vegetable oil → ignore "melted").
            prep_words = _source_prep_words_for_ingredient(line, ingredient)
            for prep in prep_words:
                if prep not in relevant_prep:
                    relevant_prep.append(prep)
            haystack = f"{ingredient.name} {ingredient.note or ''}".casefold()
            for prep in prep_words:
                # Ingredient notes and body/`>` tips both count as coverage.
                if _prep_word_present(prep, haystack) or _prep_word_present(prep, body_folded):
                    covered.add(prep)
        missing = [prep for prep in relevant_prep if prep not in covered]
        if missing:
            warnings.append(
                f"Source preparation note missing for {line}: {', '.join(missing)}"
            )
    return warnings


def _source_ingredient_lines(source_text: str) -> list[str]:
    """Extract shopping-list lines from the ingredients section of source text.

    Site chrome (nav labels, markdown headings, reviews) must not be treated as
    ingredients — Allrecipes-style pages often have a bare "Ingredients" nav
    item and ``## Directions`` headings that older matching missed.
    """
    sections = _ingredient_section_candidates(source_text)
    if not sections:
        return []
    # Prefer the section with the most quantity-led lines (real recipe block).
    best = max(sections, key=lambda lines: (_quantity_line_count(lines), len(lines)))
    if _quantity_line_count(best) == 0 and len(best) > 12:
        # Nav / chrome dump with no real quantities — ignore entirely.
        return []
    return best


def _ingredient_section_candidates(source_text: str) -> list[list[str]]:
    sections: list[list[str]] = []
    in_ingredients = False
    current: list[str] = []
    for raw in source_text.splitlines():
        line = raw.strip()
        if not line:
            continue
        section = _normalize_section_label(line)
        if _is_ingredients_start(section, line):
            if current:
                sections.append(current)
            current = []
            in_ingredients = True
            continue
        if in_ingredients and _INGREDIENTS_END_RE.match(section):
            if current:
                sections.append(current)
            current = []
            in_ingredients = False
            continue
        if not in_ingredients:
            continue
        if _is_ingredient_subsection_label(line):
            continue
        if _SKIP_SOURCE_LINE_RE.search(line):
            continue
        if not _looks_like_ingredient_line(line):
            continue
        current.append(line)
    if current:
        sections.append(current)
    return sections


def _normalize_section_label(line: str) -> str:
    return _SECTION_PREFIX_RE.sub("", line).strip()


def _is_ingredients_start(section: str, original_line: str) -> bool:
    if _INGREDIENTS_START_RE.match(section):
        # Bare nav label "Ingredients" with no other words — allow; scoring
        # later drops chrome-only sections.
        return True
    # "For the sauce:" subsections start an ingredients block when there is no
    # top-level Ingredients header. Require a short labeled heading.
    if _FOR_THE_SUBSECTION_RE.match(section) and len(original_line) < 40:
        return True
    return False


def _is_ingredient_subsection_label(line: str) -> bool:
    """True for mid-list headings like 'To finish' or 'Glaze:' — not ingredients."""
    if len(line) >= 40:
        return False
    if line.endswith(":"):
        return True
    return bool(_INGREDIENT_SUBSECTION_LABEL_RE.match(line))


def _quantity_line_count(lines: list[str]) -> int:
    return sum(1 for line in lines if _QUANTITY_START_RE.match(line.strip()))


def _looks_like_ingredient_line(line: str) -> bool:
    """Reject UI chrome that slipped between Ingredients and Directions."""
    if len(line) > 160:
        return False
    if re.search(r"https?://", line, re.IGNORECASE):
        return False
    if re.search(r"!\[", line):
        return False
    if _NOT_INGREDIENT_LINE_RE.search(line):
        return False
    if _is_ingredient_subsection_label(line):
        return False
    if _QUANTITY_START_RE.match(line):
        return True
    # Unquantified pantry lines ("Salt", "Black pepper") — keep short plain text.
    if len(line) <= 60 and not re.search(r"[|#]", line):
        return True
    return False


def _source_prep_words(line: str) -> list[str]:
    tokens = re.findall(r"[^\W\d_][^\W\d_']{2,}", line.casefold(), flags=re.UNICODE)
    return list(dict.fromkeys(token for token in tokens if token in _PREP_WORDS))


def _prep_word_present(prep: str, haystack: str) -> bool:
    forms = set(inflection_forms(prep))
    forms.add(prep)
    return any(re.search(rf"\b{re.escape(form)}\b", haystack) for form in forms)


def _source_alternative_branches(line: str) -> list[str]:
    """Split 'A or B' shopping lines into alternatives; drop parenthetical asides."""
    without_parens = re.sub(r"\([^)]*\)", " ", line)
    parts = re.split(r"\bor\b", without_parens, flags=re.IGNORECASE)
    branches = [part.strip(" ,;") for part in parts if part.strip(" ,;")]
    return branches if len(branches) > 1 else [line]


def _ingredient_name_forms(ingredient: Ingredient) -> set[str]:
    name_forms: set[str] = set()
    for token in normalize_ingredient_key(ingredient.name).split():
        name_forms.update(token_match_forms(token))
    return name_forms


def _branch_matches_ingredient(branch: str, name_forms: set[str]) -> bool:
    for token in _source_content_tokens(branch):
        if token_match_forms(token) & name_forms:
            return True
    return False


def _source_prep_words_for_ingredient(line: str, ingredient: Ingredient) -> list[str]:
    branches = _source_alternative_branches(line)
    if len(branches) == 1:
        return _source_prep_words(line)

    name_forms = _ingredient_name_forms(ingredient)
    matching = [branch for branch in branches if _branch_matches_ingredient(branch, name_forms)]
    if not matching:
        return _source_prep_words(line)

    prep: list[str] = []
    for branch in matching:
        for word in _source_prep_words(branch):
            if word not in prep:
                prep.append(word)
    return prep


def _matching_cook_ingredients(line: str, cook_ingredients: list[Ingredient]) -> list[Ingredient]:
    content_tokens = _source_content_tokens(line)
    if not content_tokens:
        return []
    matches: list[Ingredient] = []
    for ingredient in cook_ingredients:
        name_forms = _ingredient_name_forms(ingredient)
        for token in content_tokens:
            if token_match_forms(token) & name_forms:
                matches.append(ingredient)
                break
    return matches


def _cook_ingredient_names(
    body: str,
    *,
    catalog: list[CatalogIngredient] | None = None,
) -> set[str]:
    names: set[str] = set()
    for match in cooklang.INGREDIENT_RE.finditer(body):
        name = (match.group("name_braced") or match.group("name") or "").strip()
        if not name:
            continue
        _add_ingredient_label_forms(names, name)
        if catalog:
            hit = match_catalog_ingredient(name, catalog)
            if hit.catalog is not None:
                for label in [hit.catalog.name, *hit.catalog.aliases]:
                    _add_ingredient_label_forms(names, label)
    return names


def _add_ingredient_label_forms(names: set[str], label: str) -> None:
    text = label.strip()
    if not text:
        return
    names.update(token_match_forms(text))
    for token in normalize_ingredient_key(text).split():
        names.update(token_match_forms(token))


def _cook_content_tokens(body: str) -> set[str]:
    tokens: set[str] = set()
    for token in re.findall(r"[^\W\d_][^\W\d_']{2,}", body.casefold(), flags=re.UNICODE):
        if token in _STOP_WORDS or token in _UNIT_WORDS:
            continue
        tokens.add(token)
        tokens.update(inflection_forms(token))
    return tokens


def _source_line_is_covered(
    line: str,
    cook_names: set[str],
    cook_tokens: set[str],
    *,
    catalog: list[CatalogIngredient] | None = None,
) -> bool:
    content_tokens = _source_content_tokens(line)
    if not content_tokens:
        return True

    # Prefer matching against known @ingredient names / inflections / aliases.
    for token in content_tokens:
        if token_match_forms(token) & cook_names:
            return True

    # Catalog: source "triple sec" covers body @orange liqueur when aliased.
    if catalog and _source_line_matches_catalog_cook_ingredient(
        content_tokens, cook_names, catalog
    ):
        return True

    # Fall back to presence of distinctive content tokens in the body.
    distinctive = [token for token in content_tokens if len(token) >= 4]
    if not distinctive:
        distinctive = content_tokens
    return any(
        token in cook_tokens or token_match_forms(token) & cook_tokens for token in distinctive
    )


def _source_line_matches_catalog_cook_ingredient(
    content_tokens: list[str],
    cook_names: set[str],
    catalog: list[CatalogIngredient],
) -> bool:
    phrase = " ".join(content_tokens).strip()
    if not phrase:
        return False
    hit = match_catalog_ingredient(phrase, catalog)
    if hit.catalog is None:
        return False
    catalog_forms: set[str] = set()
    for label in [hit.catalog.name, *hit.catalog.aliases]:
        _add_ingredient_label_forms(catalog_forms, label)
    return bool(catalog_forms & cook_names)


def _source_content_tokens(line: str) -> list[str]:
    cleaned = re.sub(r"\([^)]*\)", " ", line)
    cleaned = re.sub(r"\d+(?:[./]\d+)?", " ", cleaned)
    tokens = [
        token
        for token in re.findall(r"[^\W\d_][^\W\d_']{2,}", cleaned.casefold(), flags=re.UNICODE)
        if token not in _STOP_WORDS and token not in _UNIT_WORDS
    ]
    # Prefer later tokens (usually the ingredient head noun).
    return list(dict.fromkeys(tokens))
