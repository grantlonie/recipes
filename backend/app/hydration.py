from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal

from app import cooklang
from app.ingredient_inflection import normalize_ingredient_key
from app.units import format_grams_value, is_mass_unit, is_volume_unit, to_grams

IngredientRole = Literal["flour", "liquid", "starter", "other"]

HYDRATION_MIN_PERCENT = 40.0
HYDRATION_MAX_PERCENT = 100.0

DensityLookup = Callable[[str], float | None]

_FLOUR_EXCLUDE_KEYS = frozenset(
    {
        "breadcrumb",
        "breadcrumbs",
        "flour tortilla",
        "flour tortillas",
    }
)
_STARTER_KEYS = frozenset(
    {
        "sourdough starter",
        "starter",
        "levain",
        "preferment",
        "pre ferment",
    }
)
_LIQUID_EXACT = frozenset(
    {
        "water",
        "milk",
        "buttermilk",
        "cream",
        "heavy cream",
        "whipping cream",
        "half and half",
        "honey",
        "molasses",
        "treacle",
        "beer",
        "wine",
        "butter",
        "unsalted butter",
        "salted butter",
        "eggs",
        "egg",
        "egg white",
        "egg whites",
        "egg yolk",
        "egg yolks",
    }
)
_LIQUID_SUFFIXES = (
    " oil",
    " syrup",
    " juice",
    " milk",
)
_MEAL_FLOURS = frozenset(
    {
        "wheat meal",
        "rye meal",
        "spelt meal",
        "graham meal",
    }
)


@dataclass
class IngredientMass:
    fixed: bool
    grams: float | None
    name: str
    note: str | None
    quantity: str | None
    role: IngredientRole
    unit: str | None


@dataclass
class HydrationSummary:
    adjustable: bool
    flour_g: float
    liquid_g: float
    percent: float | None
    starter_g: float
    issues: list[str] = field(default_factory=list)


class HydrationError(ValueError):
    pass


def is_bread_tagged(tags: list[str] | None) -> bool:
    if not tags:
        return False
    return any(tag.strip().casefold() == "bread" for tag in tags)


def classify_ingredient(name: str) -> IngredientRole:
    key = normalize_ingredient_key(name)
    if not key:
        return "other"
    if key in _STARTER_KEYS or key.endswith(" starter"):
        return "starter"
    if key in _FLOUR_EXCLUDE_KEYS:
        return "other"
    if key.endswith(" flour") or key == "flour" or key in _MEAL_FLOURS:
        return "flour"
    if key in _LIQUID_EXACT:
        return "liquid"
    if key.endswith(_LIQUID_SUFFIXES) or key.endswith("oil"):
        return "liquid"
    if " oil" in key:
        return "liquid"
    return "other"


def summarize_hydration(body: str, density_for_name: DensityLookup) -> HydrationSummary:
    masses = _ingredient_masses(body, density_for_name)
    return _summary_from_masses(masses)


def summarize_hydration_from_content(
    content: str, density_for_name: DensityLookup
) -> HydrationSummary | None:
    metadata, body = cooklang.parse_document(content)
    if not is_bread_tagged(cooklang.metadata_tags(metadata)):
        return None
    return summarize_hydration(body, density_for_name)


def apply_hydration(
    content: str,
    target_percent: float,
    density_for_name: DensityLookup,
) -> tuple[str, HydrationSummary]:
    if not (HYDRATION_MIN_PERCENT <= target_percent <= HYDRATION_MAX_PERCENT):
        raise HydrationError(
            f"Hydration must be between {HYDRATION_MIN_PERCENT:g}% and {HYDRATION_MAX_PERCENT:g}%"
        )

    metadata, body = cooklang.parse_document(content)
    if not is_bread_tagged(cooklang.metadata_tags(metadata)):
        raise HydrationError("Recipe is not tagged as bread")

    analyzed: list[tuple[re.Match[str], IngredientMass]] = []
    for match in cooklang.INGREDIENT_RE.finditer(body):
        analyzed.append((match, _mass_from_match(match, density_for_name)))

    summary = _summary_from_masses([mass for _, mass in analyzed])
    if not summary.adjustable or summary.flour_g <= 0:
        raise HydrationError(
            summary.issues[0] if summary.issues else "Cannot adjust hydration without flour mass"
        )

    flour_total = sum(
        mass.grams or 0.0 for _, mass in analyzed if mass.role == "flour" and mass.grams
    )
    liquid_total = sum(
        mass.grams or 0.0 for _, mass in analyzed if mass.role == "liquid" and mass.grams
    )
    starter_total = sum(
        mass.grams or 0.0 for _, mass in analyzed if mass.role == "starter" and mass.grams
    )
    if flour_total <= 0:
        raise HydrationError("Cannot adjust hydration without flour and liquid mass")
    if liquid_total <= 0:
        raise HydrationError("Cannot adjust hydration without liquid mass")

    h = target_percent / 100.0
    # Keep flour mass fixed; change only liquids so (L + 0.5S) / (F + 0.5S) = h.
    liquid_target = h * flour_total + 0.5 * starter_total * (h - 1.0)
    if liquid_target <= 0:
        raise HydrationError("Target hydration is not achievable for this recipe")

    liquid_scale = liquid_target / liquid_total

    pieces: list[str] = []
    cursor = 0
    for match, mass in analyzed:
        pieces.append(body[cursor : match.start()])
        if mass.role == "liquid" and mass.grams is not None and mass.grams > 0:
            new_grams = mass.grams * liquid_scale
            grams_text = format_grams_value(new_grams)
            prefix = "=" if mass.fixed else ""
            pieces.append(
                cooklang.format_ingredient_markup(mass.name, f"{prefix}{grams_text}%g", mass.note)
            )
        else:
            pieces.append(match.group(0))
        cursor = match.end()
    pieces.append(body[cursor:])
    new_body = "".join(pieces)
    new_content = cooklang.render_document(metadata, new_body)
    new_summary = summarize_hydration(new_body, density_for_name)
    return new_content, new_summary


def _ingredient_masses(body: str, density_for_name: DensityLookup) -> list[IngredientMass]:
    return [
        _mass_from_match(match, density_for_name) for match in cooklang.INGREDIENT_RE.finditer(body)
    ]


def _mass_from_match(match: re.Match[str], density_for_name: DensityLookup) -> IngredientMass:
    name = cooklang.ingredient_name_from_match(match)
    amount = match.group("amount")
    if amount is None and match.group("name_braced") is None:
        quantity_text, unit, fixed = None, None, False
    else:
        quantity_text, unit, fixed = cooklang.split_amount(amount or "")
    note = cooklang.ingredient_note_from_match(match)
    role = classify_ingredient(name)
    grams: float | None = None
    if quantity_text and unit:
        number = cooklang.parse_quantity_to_fraction(quantity_text)
        if number is not None:
            quantity = float(number)
            if is_mass_unit(unit):
                grams = to_grams(quantity, unit)
            elif is_volume_unit(unit):
                grams = to_grams(quantity, unit, density_kg_m3=density_for_name(name))
    return IngredientMass(
        fixed=fixed,
        grams=grams,
        name=name,
        note=note,
        quantity=quantity_text,
        role=role,
        unit=unit,
    )


def _summary_from_masses(masses: list[IngredientMass]) -> HydrationSummary:
    issues: list[str] = []
    flour_g = 0.0
    liquid_g = 0.0
    starter_g = 0.0

    for mass in masses:
        if mass.role == "other":
            continue
        if mass.grams is None or mass.grams <= 0:
            if mass.role in {"flour", "liquid", "starter"} and mass.quantity:
                issues.append(f"No mass for {mass.name}")
            continue
        if mass.role == "flour":
            flour_g += mass.grams
        elif mass.role == "liquid":
            liquid_g += mass.grams
        elif mass.role == "starter":
            starter_g += mass.grams

    effective_flour = flour_g + 0.5 * starter_g
    effective_liquid = liquid_g + 0.5 * starter_g
    percent: float | None = None
    if effective_flour > 0:
        percent = 100.0 * effective_liquid / effective_flour

    adjustable = flour_g > 0 and liquid_g > 0 and percent is not None
    if flour_g <= 0:
        issues.append("No flour mass available")
    if liquid_g <= 0:
        issues.append("No liquid mass available")

    return HydrationSummary(
        adjustable=adjustable,
        flour_g=round(flour_g, 3),
        issues=issues,
        liquid_g=round(liquid_g, 3),
        percent=round(percent, 1) if percent is not None else None,
        starter_g=round(starter_g, 3),
    )
