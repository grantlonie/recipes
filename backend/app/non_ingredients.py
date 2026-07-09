from __future__ import annotations

import re

from app.ingredients import normalize_ingredient_key

# Supplies, tools, and equipment that recipe importers often mis-tag as ingredients.
NON_INGREDIENTS: tuple[str, ...] = (
    "aluminum foil",
    "baking parchment",
    "baking sheet",
    "baking tray",
    "cake pan",
    "cling film",
    "cooling rack",
    "dutch oven",
    "foil",
    "frying pan",
    "kitchen twine",
    "large bowl",
    "loaf pan",
    "medium bowl",
    "mixing bowl",
    "muffin tin",
    "oven",
    "parchment",
    "parchment paper",
    "plastic wrap",
    "saran wrap",
    "saucepan",
    "sheet pan",
    "skillet",
    "small bowl",
    "stove",
    "tin foil",
    "toothpick",
    "toothpicks",
    "wax paper",
    "wire rack",
    "wooden skewer",
    "wooden skewers",
)

_NON_INGREDIENT_KEYS = frozenset(normalize_ingredient_key(item) for item in NON_INGREDIENTS)


def _flexible_phrase_pattern(phrase: str) -> re.Pattern[str]:
    parts = [re.escape(part) for part in normalize_ingredient_key(phrase).split() if part]
    body = r"[\s-]+".join(parts)
    return re.compile(rf"(^|[\s(,]){body}(?=[\s,.)]|$)", re.IGNORECASE)


_NON_INGREDIENT_PATTERNS = tuple(
    _flexible_phrase_pattern(item) for item in sorted(NON_INGREDIENTS, key=len, reverse=True)
)


def is_non_ingredient(name: str) -> bool:
    trimmed = name.strip()
    if not trimmed:
        return False
    key = normalize_ingredient_key(trimmed)
    if key in _NON_INGREDIENT_KEYS:
        return True
    return any(pattern.search(trimmed) for pattern in _NON_INGREDIENT_PATTERNS)
