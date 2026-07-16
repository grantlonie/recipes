from __future__ import annotations

import re
from dataclasses import dataclass

from app import cooklang
from app.ingredient_inflection import fold_accents, inflection_forms
from app.ingredients import IngredientRepository, normalize_ingredient_key
from app.models import CatalogIngredient
from app.non_ingredients import is_non_ingredient
from app.units import normalize_unit

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
        "brine",
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
        item, matched_label = exact
        return CatalogMatch(
            catalog=item,
            note=_note_for_exact_match(trimmed, item.name, matched_label),
        )

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
    if not _partial_match_is_safe(trimmed, matched_form, note, catalog_name=item.name):
        return CatalogMatch(catalog=None, note="")
    return CatalogMatch(catalog=item, note=note)


def apply_catalog_mapping(
    body: str,
    repository: IngredientRepository,
    *,
    reinterpret_oz_as_fl_oz: bool = False,
) -> tuple[str, list[str]]:
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
        normalized_amount = _maybe_normalize_amount(
            quantity,
            unit,
            fixed,
            amount,
            reinterpret_oz_as_fl_oz=reinterpret_oz_as_fl_oz,
        )
        if normalized_amount is not None:
            amount = normalized_amount
        return cooklang.format_ingredient_markup(canonical, amount, merged_note)

    return cooklang.INGREDIENT_RE.sub(replacer, body), unmatched


def _find_catalog_ingredient(
    name: str, catalog: list[CatalogIngredient]
) -> tuple[CatalogIngredient, str] | None:
    imported_forms = set(inflection_forms(name))
    for item in catalog:
        for label in [item.name, *item.aliases]:
            label_forms = set(inflection_forms(label))
            if imported_forms & label_forms:
                return item, label
    return None


def _note_for_exact_match(imported_name: str, canonical_name: str, matched_label: str) -> str:
    """Keep variety/modifiers when an alias collapses to a shorter catalog name.

    Example: \"balsamic vinegar\" matches vinegar via alias → note \"balsamic\".
    Synonym aliases where the catalog name is not the head-noun suffix
    (\"corn kernels\" → \"corn\") stay note-free — leftovers like \"kernels\" are
    identity wording, not variety.
    Pure inflections (\"egg\" → \"eggs\") and short aliases that expand
    (\"pepper\" → \"black pepper\", \"evoo\" → \"olive oil\") stay note-free.
    Alternate full names (\"italian frying pepper\" → \"green bell pepper\") keep
    the variety as a note relative to the shared head noun.
    """
    if set(inflection_forms(imported_name)) & set(inflection_forms(canonical_name)):
        return ""

    matched_form = _matched_phrase_form(imported_name, canonical_name)
    if matched_form is not None:
        # Only pre-head leftovers become notes (balsamic vinegar → balsamic).
        if not _matched_phrase_is_suffix(imported_name, matched_form):
            return ""
        return _extract_unmatched_note(imported_name, matched_form)

    # pepper → black pepper; ground pepper → black pepper (modifier + expanding head)
    if _is_expanding_alias(matched_label, canonical_name):
        return ""
    if _is_modifier_qualified_head(matched_label, canonical_name):
        return ""

    head = normalize_ingredient_key(canonical_name).split()[-1]
    if not head:
        return ""
    head_form = _matched_phrase_form(imported_name, head)
    if head_form is None:
        return ""
    if not _matched_phrase_is_suffix(imported_name, head_form):
        return ""
    return _extract_unmatched_note(imported_name, head_form)


def _is_modifier_qualified_head(matched_label: str, catalog_name: str) -> bool:
    """True for aliases like \"ground pepper\" under \"black pepper\"."""
    head = normalize_ingredient_key(catalog_name).split()[-1]
    if not head:
        return False
    label_tokens = normalize_ingredient_key(matched_label).split()
    if len(label_tokens) < 2:
        return False
    if label_tokens[-1] not in set(inflection_forms(head)):
        return False
    return all(token in _MODIFIER_WORDS for token in label_tokens[:-1])


def _matched_phrase_form(haystack: str, phrase: str) -> str | None:
    trimmed = haystack.strip()
    best: str | None = None
    for form in inflection_forms(phrase):
        if _phrase_hit(trimmed, form) is None:
            continue
        if best is None or len(form) > len(best):
            best = form
    return best


def _phrase_match_score(haystack: str, candidate: str, matched_form: str) -> tuple[int, int, int]:
    """Prefer multi-word labels, then rightmost head-noun matches, then longer labels."""
    hit = _phrase_hit(haystack.strip(), matched_form)
    word_count = len(normalize_ingredient_key(candidate).split())
    end = hit[2] if hit else -1
    return (word_count, end, len(candidate))


def _extract_unmatched_note(imported_name: str, matched_label: str) -> str:
    imported = imported_name.strip()
    hit = _phrase_hit(imported, matched_label)
    if hit is None:
        return imported
    source, start, end = hit
    before = source[:start].strip()
    after = source[end:].strip()
    return ", ".join(part for part in (before, after) if part)


def _partial_match_is_safe(
    imported_name: str,
    matched_form: str,
    note: str,
    *,
    catalog_name: str,
) -> bool:
    """Reject partial matches that rewrite a different substance into a catalog item.

    Culinary names are usually head-noun-last (\"lemon zest\", \"yellow onion\").
    Leftover tokens that change substance (\"bell\", \"bean\", \"jam\", \"condensed\")
    mean the short catalog hit was wrong.

    Expanding short aliases (\"pepper\" → \"black pepper\", \"beef\" → \"ground beef\")
    must not absorb variety names (\"italian frying pepper\", \"roast beef\").
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
    if _is_expanding_alias(matched_form, catalog_name):
        return False
    if _matched_phrase_is_suffix(imported_name, matched_form):
        return True
    return False


def _is_expanding_alias(matched_form: str, catalog_name: str) -> bool:
    """True when the matched label is a shorter alias that adds meaning.

    Examples: pepper → black pepper, beef → ground beef.
    Inflection-only pairs (onion → onions) are not expanding.
    """
    if set(inflection_forms(matched_form)) & set(inflection_forms(catalog_name)):
        return False
    matched_tokens = set(normalize_ingredient_key(matched_form).split())
    catalog_tokens = set(normalize_ingredient_key(catalog_name).split())
    return bool(matched_tokens) and matched_tokens < catalog_tokens


def _matched_phrase_is_suffix(imported_name: str, matched_form: str) -> bool:
    hit = _phrase_hit(imported_name.strip(), matched_form)
    if hit is None:
        return False
    source, _start, end = hit
    after = source[end:].strip(" ,.")
    return not after


def _phrase_hit(haystack: str, phrase: str) -> tuple[str, int, int] | None:
    """Return (matched_source, start, end), folding accents when needed."""
    pattern = _flexible_phrase_pattern(phrase)
    match = pattern.search(haystack)
    if match:
        return haystack, match.start(), match.end()
    folded = fold_accents(haystack)
    if folded == haystack:
        return None
    match = pattern.search(folded)
    if match is None:
        return None
    return folded, match.start(), match.end()


def _flexible_phrase_pattern(phrase: str) -> re.Pattern[str]:
    parts = [re.escape(part) for part in normalize_ingredient_key(phrase).split() if part]
    body = r"[\s-]+".join(parts)
    return re.compile(rf"(^|[\s(,]){body}(?=[\s,.)]|$)", re.IGNORECASE)


def _merge_notes(left: str, right: str | None) -> str | None:
    parts = [part.strip() for part in (left, right or "") if part and part.strip()]
    if not parts:
        return None
    return ", ".join(dict.fromkeys(parts))


def _maybe_normalize_amount(
    quantity: str | None,
    unit: str | None,
    fixed: bool,
    original_amount: str,
    *,
    reinterpret_oz_as_fl_oz: bool = False,
) -> str | None:
    """Normalize unit aliases; optionally reinterpret weight oz as fl oz for drinks.

    Amounts stay in authored units — density is only used at display time.
    """
    if not quantity or not unit:
        return None
    canonical = normalize_unit(unit)
    if canonical is None:
        return None
    if reinterpret_oz_as_fl_oz and canonical == "oz":
        canonical = "fl oz"
    prefix = "=" if fixed else ""
    rebuilt = f"{prefix}{quantity}%{canonical}"
    if rebuilt == original_amount:
        return None
    return rebuilt
