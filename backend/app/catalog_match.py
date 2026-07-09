from __future__ import annotations

import re
from dataclasses import dataclass

from app import cooklang
from app.ingredients import IngredientRepository, normalize_ingredient_key
from app.models import CatalogIngredient
from app.units import format_grams_value, is_volume_unit, to_grams


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

    best: tuple[CatalogIngredient, str] | None = None
    for item in catalog:
        for label in [item.name, *item.aliases]:
            candidate = label.strip()
            if not candidate or not _contains_phrase(trimmed, candidate):
                continue
            if best is None or len(candidate) > len(best[1]):
                best = (item, candidate)

    if best is None:
        return CatalogMatch(catalog=None, note="")

    item, label = best
    return CatalogMatch(catalog=item, note=_extract_unmatched_note(trimmed, label))


def apply_catalog_mapping(body: str, repository: IngredientRepository) -> tuple[str, list[str]]:
    catalog = repository.list_ingredients()
    unmatched: list[str] = []

    def replacer(match: re.Match[str]) -> str:
        name = (match.group("name_braced") or match.group("name") or "").strip()
        if not name:
            return match.group(0)
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
    key = normalize_ingredient_key(name)
    for item in catalog:
        if normalize_ingredient_key(item.name) == key:
            return item
        if any(normalize_ingredient_key(alias) == key for alias in item.aliases):
            return item
    return None


def _contains_phrase(haystack: str, phrase: str) -> bool:
    return _flexible_phrase_pattern(phrase).search(haystack.strip()) is not None


def _extract_unmatched_note(imported_name: str, matched_label: str) -> str:
    imported = imported_name.strip()
    match = _flexible_phrase_pattern(matched_label).search(imported)
    if not match:
        return imported
    before = imported[: match.start()].strip()
    after = imported[match.end() :].strip()
    return ", ".join(part for part in (before, after) if part)


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
