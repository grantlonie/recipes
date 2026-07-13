from __future__ import annotations

import re
from dataclasses import dataclass

from app import cooklang
from app.ingredient_inflection import inflection_forms
from app.ingredients import IngredientRepository, normalize_ingredient_key
from app.models import CatalogIngredient
from app.non_ingredients import is_non_ingredient
from app.units import format_grams_value, is_volume_unit, to_grams

# Words allowed in leftover notes for partial catalog matches.
_MODIFIER_WORDS = frozenset(
    {
        "black",
        "brown",
        "cayenne",
        "chopped",
        "coarse",
        "coarsely",
        "cold",
        "cooked",
        "cracked",
        "crushed",
        "dark",
        "diced",
        "dried",
        "dry",
        "extra",
        "fine",
        "finely",
        "firmly",
        "fresh",
        "freshly",
        "frozen",
        "green",
        "ground",
        "halved",
        "hot",
        "jumbo",
        "kosher",
        "large",
        "light",
        "lightly",
        "medium",
        "minced",
        "organic",
        "packed",
        "pure",
        "raw",
        "red",
        "roasted",
        "room",
        "salted",
        "sea",
        "sliced",
        "small",
        "smoked",
        "softened",
        "sour",
        "sweet",
        "toasted",
        "unsalted",
        "virgin",
        "white",
        "whole",
        "yellow",
    }
)

# Leftover tokens that mean the matched catalog item is the wrong substance.
_SUBSTANCE_CHANGE_TOKENS = frozenset(
    {
        "aperitivo",
        "bean",
        "beans",
        "bell",
        "broth",
        "butter",
        "cheese",
        "chips",
        "chutney",
        "condensed",
        "cream",
        "extract",
        "flour",
        "jam",
        "jelly",
        "juice",
        "liqueur",
        "meal",
        "milk",
        "mix",
        "nectar",
        "oil",
        "paste",
        "powder",
        "preserves",
        "pudding",
        "puree",
        "relish",
        "rind",
        "sauce",
        "stock",
        "sweetened",
        "syrup",
        "vinegar",
        "wine",
        "yogurt",
        "zest",
    }
)


@dataclass(frozen=True)
class CatalogMatch:
    catalog: CatalogIngredient | None
    note: str


def match_catalog_ingredient(imported_name: str, catalog: list[CatalogIngredient]) -> CatalogMatch:
    trimmed = imported_name.strip()
    if not trimmed:
        return CatalogMatch(catalog=None, note="")

    exact = _find_catalog_ingredient(trimmed, catalog)
    if exact:
        return CatalogMatch(catalog=exact, note="")

    best: tuple[CatalogIngredient, str, str, tuple[int, int, int]] | None = None
    for item in catalog:
        for label in [item.name, *item.aliases]:
            candidate = label.strip()
            if not candidate:
                continue
            matched_form = _matched_phrase_form(trimmed, candidate)
            if matched_form is None:
                continue
            score = _phrase_match_score(trimmed, candidate, matched_form)
            if best is None or score > best[3]:
                best = (item, candidate, matched_form, score)

    if best is None:
        return CatalogMatch(catalog=None, note="")

    item, _label, matched_form, _score = best
    note = _extract_unmatched_note(trimmed, matched_form)
    if not _partial_match_is_safe(trimmed, matched_form, note):
        return CatalogMatch(catalog=None, note="")
    return CatalogMatch(catalog=item, note=note)


def apply_catalog_mapping(body: str, repository: IngredientRepository) -> tuple[str, list[str]]:
    catalog = repository.list_ingredients()
    unmatched: list[str] = []

    def replacer(match: re.Match[str]) -> str:
        name = (match.group("name_braced") or match.group("name") or "").strip()
        if not name:
            return match.group(0)
        if is_non_ingredient(name):
            return cooklang.ingredient_match_to_plain_text(match)
        amount = match.group("amount") or ""
        note = cooklang.ingredient_note_from_match(match)
        catalog_match = match_catalog_ingredient(name, catalog)
        if catalog_match.catalog is None:
            if name.casefold() not in {item.casefold() for item in unmatched}:
                unmatched.append(name)
            return match.group(0)

        canonical = catalog_match.catalog.name
        merged_note = _merge_notes(catalog_match.note, note)
        quantity, unit, fixed = cooklang.split_amount(amount)
        converted_amount = _maybe_convert_to_grams(
            canonical,
            quantity,
            unit,
            fixed,
            amount,
            catalog_match.catalog,
        )
        if converted_amount is not None:
            amount = converted_amount
        return cooklang.format_ingredient_markup(canonical, amount, merged_note)

    return cooklang.INGREDIENT_RE.sub(replacer, body), unmatched


def _find_catalog_ingredient(
    name: str, catalog: list[CatalogIngredient]
) -> CatalogIngredient | None:
    imported_forms = set(inflection_forms(name))
    for item in catalog:
        label_forms = {form for label in [item.name, *item.aliases] for form in inflection_forms(label)}
        if imported_forms & label_forms:
            return item
    return None


def _matched_phrase_form(haystack: str, phrase: str) -> str | None:
    trimmed = haystack.strip()
    best: str | None = None
    for form in inflection_forms(phrase):
        if _flexible_phrase_pattern(form).search(trimmed) is None:
            continue
        if best is None or len(form) > len(best):
            best = form
    return best


def _phrase_match_score(haystack: str, candidate: str, matched_form: str) -> tuple[int, int, int]:
    """Prefer multi-word labels, then rightmost head-noun matches, then longer labels."""
    match = _flexible_phrase_pattern(matched_form).search(haystack.strip())
    word_count = len(normalize_ingredient_key(candidate).split())
    end = match.end() if match else -1
    return (word_count, end, len(candidate))


def _extract_unmatched_note(imported_name: str, matched_label: str) -> str:
    imported = imported_name.strip()
    match = _flexible_phrase_pattern(matched_label).search(imported)
    if not match:
        return imported
    before = imported[: match.start()].strip()
    after = imported[match.end() :].strip()
    return ", ".join(part for part in (before, after) if part)


def _partial_match_is_safe(imported_name: str, matched_form: str, note: str) -> bool:
    """Reject partial matches that rewrite a different substance into a catalog item.

    Culinary names are usually head-noun-last (\"lemon zest\", \"yellow onion\").
    Leftover tokens that change substance (\"bell\", \"bean\", \"jam\", \"condensed\")
    mean the short catalog hit was wrong.
    """
    if not note.strip():
        return True

    tokens = [token for token in normalize_ingredient_key(note).split() if token]
    if not tokens:
        return True
    if all(token in _MODIFIER_WORDS for token in tokens):
        return True
    if any(token in _SUBSTANCE_CHANGE_TOKENS for token in tokens):
        return False
    if _matched_phrase_is_suffix(imported_name, matched_form):
        return True
    return False


def _matched_phrase_is_suffix(imported_name: str, matched_form: str) -> bool:
    match = _flexible_phrase_pattern(matched_form).search(imported_name.strip())
    if match is None:
        return False
    after = imported_name[match.end() :].strip(" ,.")
    return not after


def _flexible_phrase_pattern(phrase: str) -> re.Pattern[str]:
    parts = [re.escape(part) for part in normalize_ingredient_key(phrase).split() if part]
    body = r"[\s-]+".join(parts)
    return re.compile(rf"(^|[\s(,]){body}(?=[\s,.)]|$)", re.IGNORECASE)


def _merge_notes(left: str, right: str | None) -> str | None:
    parts = [part.strip() for part in (left, right or "") if part and part.strip()]
    if not parts:
        return None
    return ", ".join(dict.fromkeys(parts))


def _maybe_convert_to_grams(
    name: str,
    quantity: str | None,
    unit: str | None,
    fixed: bool,
    original_amount: str,
    catalog_item: CatalogIngredient,
) -> str | None:
    if not quantity or not unit:
        return None
    number = cooklang.parse_quantity_to_fraction(quantity)
    if number is None:
        return None
    density = catalog_item.density_kg_m3
    if is_volume_unit(unit) and density is None:
        return None
    grams = to_grams(float(number), unit, density_kg_m3=density)
    if grams is None:
        return None
    prefix = "=" if fixed else ""
    return f"{prefix}{format_grams_value(grams)}%g"
