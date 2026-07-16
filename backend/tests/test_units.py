from fractions import Fraction

from app.units import (
    format_amount,
    format_fraction,
    format_grams_value,
    normalize_unit,
    to_grams,
)


def test_normalize_unit_aliases():
    assert normalize_unit("C") == "cup"
    assert normalize_unit("tbsp") == "Tbsp"
    assert normalize_unit("teaspoons") == "tsp"
    assert normalize_unit("grams") == "g"
    assert normalize_unit("fl oz") == "fl oz"
    assert normalize_unit("floz") == "fl oz"
    assert normalize_unit("fluid ounces") == "fl oz"


def test_to_grams_mass_and_volume():
    assert to_grams(1, "kg") == 1000
    assert to_grams(1, "lb") == 453.59237
    assert to_grams(250, "ml", density_kg_m3=1000) == 250
    assert to_grams(1.5, "l", density_kg_m3=1000) == 1500
    # 1 cup water at 1000 kg/m3 ~= 236.588 g
    grams = to_grams(1, "cup", density_kg_m3=1000)
    assert grams is not None
    assert abs(grams - 236.588) < 0.01
    # 1 fl oz water ≈ 29.57 g; weight oz is ~28.35 g
    fl_oz = to_grams(1, "fl oz", density_kg_m3=1000)
    assert fl_oz is not None
    assert abs(fl_oz - 29.5735) < 0.01
    assert abs(to_grams(1, "oz") - 28.3495) < 0.01


def test_split_glued_amount_parses_ml_and_liters():
    from app.units import split_glued_amount
    from app.cooklang import parse_quantity_to_fraction

    assert split_glued_amount("250ml", parse_quantity=parse_quantity_to_fraction) == ("250", "ml")
    assert split_glued_amount("1.5l", parse_quantity=parse_quantity_to_fraction) == ("1.5", "l")
    assert split_glued_amount("2 liters", parse_quantity=parse_quantity_to_fraction) == ("2", "l")
    assert split_glued_amount("2fl oz", parse_quantity=parse_quantity_to_fraction) == ("2", "fl oz")


def test_format_metric_and_us():
    from app.units import prefers_fluid_volume

    metric = format_amount(250, "g", unit_system="metric")
    assert metric.format() == "250 g"

    metric_kg = format_amount(2500, "g", unit_system="metric")
    assert metric_kg.unit == "kg"

    us_volume = format_amount(250, "g", unit_system="us", density_kg_m3=530)
    assert us_volume.unit in {"cup", "cups"}
    assert "Tbsp" not in us_volume.format()

    us_mass = format_amount(453.59237, "g", unit_system="us")
    assert us_mass.format() == "1 lb"

    # us_weight prefers lb/oz even when density is known
    us_weight = format_amount(250, "g", unit_system="us_weight", density_kg_m3=530)
    assert us_weight.unit == "oz"
    assert "cup" not in us_weight.format()

    # Cocktail display: US → fl oz, metric → ml (not weight oz / cooking spoons)
    syrup = format_amount(
        39,
        "g",
        unit_system="us",
        density_kg_m3=1330,
        prefer_fluid_volume=True,
    )
    assert syrup.unit == "fl oz"
    assert syrup.quantity == "1"

    syrup_metric = format_amount(
        39,
        "g",
        unit_system="metric",
        density_kg_m3=1330,
        prefer_fluid_volume=True,
    )
    assert syrup_metric.unit == "ml"
    assert syrup_metric.quantity == "29"

    assert prefers_fluid_volume(["cocktail"])
    assert prefers_fluid_volume(["Mocktail"])
    assert not prefers_fluid_volume(["dinner"])
    assert not prefers_fluid_volume(None)

def test_format_fraction_single_unit():
    assert format_fraction(2.25) == "2 ¼"
    assert format_fraction(0.5) == "½"
    assert format_fraction(1 / 3) == "⅓"
    assert format_fraction(0.33) == "⅓"
    assert format_fraction(0.375) == "⅓"
    assert format_fraction(2 / 3) == "⅔"
    assert format_fraction(0.75) == "¾"
    assert format_fraction(0.125) == "¼"


def test_format_grams_value():
    assert format_grams_value(250.0) == "250"
    assert format_grams_value(12.5) == "12.5"
    assert format_grams_value(12.54) == "12.5"
    assert format_grams_value(20.0) == "20"
    assert format_grams_value(20.5) == "21"
    assert format_grams_value(236.588) == "237"


def test_format_metric_small_grams_keep_decimal():
    assert format_amount(12.5, "g", unit_system="metric").format() == "12.5 g"
    assert format_amount(21, "g", unit_system="metric").format() == "21 g"
