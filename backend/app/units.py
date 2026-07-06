from __future__ import annotations

import math
from dataclasses import dataclass
from fractions import Fraction

ML_PER_CUP = 236.5882365
ML_PER_TBSP = ML_PER_CUP / 16
ML_PER_TSP = ML_PER_CUP / 48
ML_PER_QUART = ML_PER_CUP * 4
ML_PER_PINT = ML_PER_CUP * 2
ML_PER_GALLON = ML_PER_CUP * 16
G_PER_OZ = 28.349523125
G_PER_LB = 453.59237

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
    "quart": ML_PER_QUART,
    "pint": ML_PER_PINT,
    "gallon": ML_PER_GALLON,
}

UNICODE_FRACTIONS = {
    Fraction(1, 8): "⅛",
    Fraction(1, 4): "¼",
    Fraction(3, 8): "⅜",
    Fraction(1, 2): "½",
    Fraction(5, 8): "⅝",
    Fraction(3, 4): "¾",
    Fraction(7, 8): "⅞",
}


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


def format_fraction(value: float, *, step: Fraction = Fraction(1, 8)) -> str:
    if value < 0:
        return format_fraction(-value, step=step)
    steps = int(round(value / float(step)))
    total = steps * step
    whole = int(total)
    remainder = total - whole
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


def format_metric_mass(grams: float) -> DisplayAmount:
    whole_grams = round_grams(grams)
    if whole_grams >= 2000:
        kg = whole_grams / 1000.0
        if abs(kg - round(kg)) < 0.05:
            return DisplayAmount(str(int(round(kg))), "kg")
        text = f"{kg:.1f}".rstrip("0").rstrip(".")
        return DisplayAmount(text, "kg")
    return DisplayAmount(str(whole_grams), "g")


def format_us_mass(grams: float) -> DisplayAmount:
    if grams >= G_PER_LB:
        pounds = grams / G_PER_LB
        return DisplayAmount(format_fraction(pounds), "lb")
    ounces = grams / G_PER_OZ
    return DisplayAmount(format_fraction(ounces), "oz")


def format_us_volume(grams: float, density_kg_m3: float) -> DisplayAmount:
    ml = grams_to_ml(grams, density_kg_m3)
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
    return DisplayAmount(format_fraction(tsp, step=Fraction(1, 4)), "tsp")


def format_amount(
    quantity: float | None,
    unit: str | None,
    *,
    unit_system: str,
    density_kg_m3: float | None = None,
) -> DisplayAmount:
    if quantity is None:
        return DisplayAmount("", normalize_unit(unit))

    canonical = normalize_unit(unit)
    if canonical == "g":
        if unit_system == "us_weight":
            return format_us_mass(quantity)
        if unit_system == "us":
            if density_kg_m3 is not None and density_kg_m3 > 0:
                return format_us_volume(quantity, density_kg_m3)
            return format_us_mass(quantity)
        return format_metric_mass(quantity)

    return DisplayAmount(format_fraction(quantity), canonical or unit)


def format_grams_value(grams: float) -> str:
    return str(round_grams(grams))
