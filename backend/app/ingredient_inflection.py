from __future__ import annotations

import re
import unicodedata

# Last-token forms that look plural/singular-sensitive but should not be inflected.
_UNINFLECTED = frozenset(
    {
        "asparagus",
        "bass",
        "couscous",
        "hummus",
        "molasses",
        "news",
        "rice",
        "series",
        "species",
    }
)

_IRREGULAR_PLURALS = {
    "leaf": "leaves",
    "loaf": "loaves",
    "potato": "potatoes",
    "tomato": "tomatoes",
    "knife": "knives",
    "life": "lives",
    "wolf": "wolves",
    "calf": "calves",
    "self": "selves",
    "half": "halves",
    "elf": "elves",
    "thief": "thieves",
}

_IRREGULAR_SINGULARS = {plural: singular for singular, plural in _IRREGULAR_PLURALS.items()}


def normalize_ingredient_key(value: str) -> str:
    text = fold_accents(value.strip().casefold().replace("-", " "))
    text = re.sub(r"[^\w\s]+", "", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def fold_accents(value: str) -> str:
    """Strip combining marks so jalapeño and jalapeno compare equal."""
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def token_match_forms(token: str) -> set[str]:
    """Inflection forms for accent-insensitive matching (normalize already folds)."""
    return {token, *inflection_forms(token)}


def singularize_token(token: str) -> str:
    value = token.casefold()
    if not value or value in _UNINFLECTED:
        return value
    if value in _IRREGULAR_SINGULARS:
        return _IRREGULAR_SINGULARS[value]
    if value.endswith("ies") and len(value) > 4:
        return f"{value[:-3]}y"
    if value.endswith(("ches", "shes", "xes", "zes")) and len(value) > 4:
        return value[:-2]
    if value.endswith("oes") and len(value) > 4:
        return value[:-2]
    if value.endswith("ves") and len(value) > 4:
        return f"{value[:-3]}f"
    if value.endswith("s") and not value.endswith(("ss", "us", "is")) and len(value) > 3:
        return value[:-1]
    return value


def pluralize_token(token: str) -> str:
    value = token.casefold()
    if not value or value in _UNINFLECTED:
        return value
    if value in _IRREGULAR_PLURALS:
        return _IRREGULAR_PLURALS[value]
    if value.endswith("y") and len(value) > 1 and value[-2] not in "aeiou":
        return f"{value[:-1]}ies"
    if value.endswith(("s", "x", "z", "ch", "sh")):
        return f"{value}es"
    if value.endswith("f"):
        return f"{value[:-1]}ves"
    if value.endswith("fe"):
        return f"{value[:-2]}ves"
    if value.endswith("o") and value not in {"canto", "photo", "piano", "solo", "stereo"}:
        # Culinary defaults: potato/tomato handled above; most others just +s
        return f"{value}s"
    if not value.endswith("s"):
        return f"{value}s"
    return value


def inflection_forms(value: str) -> tuple[str, ...]:
    """Return normalized phrase variants with the last token singularized/pluralized."""
    key = normalize_ingredient_key(value)
    if not key:
        return ()
    parts = key.split()
    last = parts[-1]
    variants = {key}
    for token in {last, singularize_token(last), pluralize_token(last)}:
        if not token:
            continue
        variants.add(" ".join([*parts[:-1], token]) if parts[:-1] else token)
    return tuple(sorted(variants))


def singular_match_key(value: str) -> str:
    """Normalize for equality checks that ignore singular/plural on the last token."""
    key = normalize_ingredient_key(value)
    if not key:
        return key
    parts = key.split()
    parts[-1] = singularize_token(parts[-1])
    return " ".join(parts)
