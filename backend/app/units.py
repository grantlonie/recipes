from __future__ import annotations

import math
from dataclasses import dataclass
from fractions import Fraction

ML_PER_CUP = 236.5882365
ML_PER_TBSP = ML_PER_CUP / 16
ML_PER_TSP = ML_PER_CUP / 48
ML_PER_FL_OZ = ML_PER_CUP / 8
ML_PER_QUART = ML_PER_CUP * 4
ML_PER_PINT = ML_PER_CUP * 2
ML_PER_GALLON = ML_PER_CUP * 16
G_PER_OZ = 28.349523125
G_PER_LB = 453.59237

FLUID_VOLUME_TAGS = frozenset({"cocktail", "drink", "mocktail"})

UNIT_ALIASES: dict[str, str] = {
    "g": "g",
    "gram": "g",
    "grams": "g",
    "kg": "kg",
    "kilogram": "kg",
    "kilograms": "kg",
    "oz": "oz",
    "ounce": "oz",
    "ounces": "oz",
    "fl oz": "fl oz",
    "floz": "fl oz",
    "fl. oz": "fl oz",
    "fl. oz.": "fl oz",
    "fluid ounce": "fl oz",
    "fluid ounces": "fl oz",
    "lb": "lb",
    "lbs": "lb",
    "pound": "lb",
    "pounds": "lb",
    "ml": "ml",
    "milliliter": "ml",
    "milliliters": "ml",
    "millilitre": "ml",
    "millilitres": "ml",
    "l": "l",
    "liter": "l",
    "liters": "l",
    "litre": "l",
    "litres": "l",
    "cup": "cup",
    "cups": "cup",
    "c": "cup",
    "tbsp": "Tbsp",
    "tbs": "Tbsp",
    "tablespoon": "Tbsp",
    "tablespoons": "Tbsp",
    "tsp": "tsp",
    "teaspoon": "tsp",
    "teaspoons": "tsp",
    "quart": "quart",
    "quarts": "quart",
    "qt": "quart",
    "pint": "pint",
    "pints": "pint",
    "pt": "pint",
    "gallon": "gallon",
    "gallons": "gallon",
    "gal": "gallon",
}

MASS_TO_GRAMS: dict[str, float] = {
    "g": 1.0,
    "kg": 1000.0,
    "oz": G_PER_OZ,
    "lb": G_PER_LB,
}

VOLUME_TO_ML: dict[str, float] = {
    "ml": 1.0,
    "l": 1000.0,
    "cup": ML_PER_CUP,
    "Tbsp": ML_PER_TBSP,
    "tsp": ML_PER_TSP,
    "fl oz": ML_PER_FL_OZ,
    "quart": ML_PER_QUART,
    "pint": ML_PER_PINT,
    "gallon": ML_PER_GALLON,
}

UNICODE_FRACTIONS = {
    Fraction(1, 4): "¼",
    Fraction(1, 3): "⅓",
    Fraction(1, 2): "½",
    Fraction(2, 3): "⅔",
    Fraction(3, 4): "¾",
}

# Quarters, thirds, and half — no eighths for display.
_DISPLAY_FRACTION_CANDIDATES = (
    Fraction(0),
    Fraction(1, 4),
    Fraction(1, 3),
    Fraction(1, 2),
    Fraction(2, 3),
    Fraction(3, 4),
    Fraction(1),
)


@dataclass(frozen=True)
class DisplayAmount:
    quantity: str
    unit: str | None

    def format(self) -> str:
        if not self.quantity:
            return self.unit or ""
        if not self.unit:
            return self.quantity
        return f"{self.quantity} {self.unit}"


def normalize_unit(unit: str | None) -> str | None:
    if unit is None:
        return None
    key = unit.strip().casefold()
    if not key:
        return None
    return UNIT_ALIASES.get(key, unit.strip())


def split_glued_amount(value: str, *, parse_quantity) -> tuple[str | None, str | None]:
    stripped = value.strip()
    if not stripped:
        return None, None
    for alias in sorted(UNIT_ALIASES, key=len, reverse=True):
        if len(stripped) <= len(alias):
            continue
        if stripped.casefold().endswith(alias.casefold()):
            quantity_text = stripped[: -len(alias)].strip()
            if parse_quantity(quantity_text) is not None:
                return quantity_text, normalize_unit(alias)
    return None, None


def is_mass_unit(unit: str | None) -> bool:
    return normalize_unit(unit) in MASS_TO_GRAMS


def is_volume_unit(unit: str | None) -> bool:
    return normalize_unit(unit) in VOLUME_TO_ML


def to_grams(
    quantity: float,
    unit: str | None,
    *,
    density_kg_m3: float | None = None,
) -> float | None:
    canonical = normalize_unit(unit)
    if canonical is None:
        return None
    if canonical in MASS_TO_GRAMS:
        return quantity * MASS_TO_GRAMS[canonical]
    if canonical in VOLUME_TO_ML:
        if density_kg_m3 is None or density_kg_m3 <= 0:
            return None
        ml = quantity * VOLUME_TO_ML[canonical]
        return ml * density_kg_m3 / 1000.0
    return None


def grams_to_ml(grams: float, density_kg_m3: float) -> float:
    return grams * 1000.0 / density_kg_m3


def format_fraction(value: float) -> str:
    """Round to the nearest quarter, third, or half for display."""
    if value < 0:
        return format_fraction(-value)

    whole = int(math.floor(value + 1e-12))
    fractional = Fraction(value - whole).limit_denominator(10_000)
    best = min(
        _DISPLAY_FRACTION_CANDIDATES,
        key=lambda candidate: (
            abs(candidate - fractional),
            0 if candidate not in (0, 1) else 1,
        ),
    )
    if best == 1:
        whole += 1
        remainder = Fraction(0)
    else:
        remainder = best

    if remainder == 0:
        return str(whole)
    fraction = UNICODE_FRACTIONS.get(remainder, f"{remainder.numerator}/{remainder.denominator}")
    if whole == 0:
        return fraction
    return f"{whole} {fraction}"


def round_grams(grams: float) -> int:
    """Round to nearest gram, half away from zero (matches JS Math.round)."""
    if grams >= 0:
        return int(math.floor(grams + 0.5))
    return int(math.ceil(grams - 0.5))


def format_stored_grams(grams: float) -> str:
    sign = "-" if grams < 0 else ""
    value = abs(grams)
    if value <= 20:
        rounded = round(value, 1)
        text = f"{rounded:.1f}".rstrip("0").rstrip(".")
        return f"{sign}{text}"
    return f"{sign}{round_grams(value)}"


def format_metric_mass(grams: float) -> DisplayAmount:
    sign = "-" if grams < 0 else ""
    value = abs(grams)
    if value >= 2000:
        whole_grams = round_grams(value)
        kg = whole_grams / 1000.0
        if abs(kg - round(kg)) < 0.05:
            return DisplayAmount(f"{sign}{int(round(kg))}", "kg")
        text = f"{kg:.1f}".rstrip("0").rstrip(".")
        return DisplayAmount(f"{sign}{text}", "kg")
    if value <= 20:
        rounded = round(value, 1)
        text = f"{rounded:.1f}".rstrip("0").rstrip(".")
        return DisplayAmount(f"{sign}{text}", "g")
    return DisplayAmount(f"{sign}{round_grams(value)}", "g")


def format_us_mass(grams: float) -> DisplayAmount:
    if grams >= G_PER_LB:
        pounds = grams / G_PER_LB
        return DisplayAmount(format_fraction(pounds), "lb")
    ounces = grams / G_PER_OZ
    return DisplayAmount(format_fraction(ounces), "oz")


def prefers_fluid_volume(tags: list[str] | None) -> bool:
    if not tags:
        return False
    return any(tag.strip().casefold() in FLUID_VOLUME_TAGS for tag in tags)


def format_metric_volume(grams: float, density_kg_m3: float) -> DisplayAmount:
    ml = grams_to_ml(grams, density_kg_m3)
    sign = "-" if ml < 0 else ""
    value = abs(ml)
    if value >= 1000:
        liters = value / 1000.0
        if abs(liters - round(liters)) < 0.05:
            return DisplayAmount(f"{sign}{int(round(liters))}", "l")
        text = f"{liters:.1f}".rstrip("0").rstrip(".")
        return DisplayAmount(f"{sign}{text}", "l")
    if value < 10:
        text = f"{value:.1f}".rstrip("0").rstrip(".")
        return DisplayAmount(f"{sign}{text}", "ml")
    return DisplayAmount(f"{sign}{round_grams(value)}", "ml")


def format_us_volume(
    grams: float,
    density_kg_m3: float,
    *,
    prefer_fl_oz: bool = False,
) -> DisplayAmount:
    ml = grams_to_ml(grams, density_kg_m3)
    if prefer_fl_oz:
        fl_oz = ml / ML_PER_FL_OZ
        return DisplayAmount(format_fraction(fl_oz), "fl oz")
    cups = ml / ML_PER_CUP
    if cups >= 4:
        quarts = cups / 4
        label = "quart" if quarts <= 1.01 else "quarts"
        return DisplayAmount(format_fraction(quarts), label)
    if cups >= 0.25:
        label = "cup" if cups <= 1.01 else "cups"
        return DisplayAmount(format_fraction(cups), label)
    tbsp = ml / ML_PER_TBSP
    if tbsp >= 1:
        return DisplayAmount(format_fraction(tbsp), "Tbsp")
    tsp = ml / ML_PER_TSP
    return DisplayAmount(format_fraction(tsp), "tsp")


def format_amount(
    quantity: float | None,
    unit: str | None,
    *,
    unit_system: str,
    density_kg_m3: float | None = None,
    prefer_fluid_volume: bool = False,
) -> DisplayAmount:
    if quantity is None:
        return DisplayAmount("", normalize_unit(unit))

    canonical = normalize_unit(unit)
    if canonical == "g":
        has_density = density_kg_m3 is not None and density_kg_m3 > 0
        if prefer_fluid_volume and has_density:
            assert density_kg_m3 is not None
            if unit_system == "metric":
                return format_metric_volume(quantity, density_kg_m3)
            return format_us_volume(quantity, density_kg_m3, prefer_fl_oz=True)
        if unit_system == "us_weight":
            return format_us_mass(quantity)
        if unit_system == "us":
            if has_density:
                assert density_kg_m3 is not None
                return format_us_volume(quantity, density_kg_m3)
            return format_us_mass(quantity)
        return format_metric_mass(quantity)

    return DisplayAmount(format_fraction(quantity), canonical or unit)


def format_grams_value(grams: float) -> str:
    return format_stored_grams(grams)
