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


def test_to_grams_mass_and_volume():
    assert to_grams(1, "kg") == 1000
    assert to_grams(1, "lb") == 453.59237
    # 1 cup water at 1000 kg/m3 ~= 236.588 g
    grams = to_grams(1, "cup", density_kg_m3=1000)
    assert grams is not None
    assert abs(grams - 236.588) < 0.01


def test_format_metric_and_us():
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


def test_format_fraction_single_unit():
    assert format_fraction(2.25) == "2 ¼"
    assert format_fraction(0.5) == "½"
    assert format_fraction(0.125) == "⅛"


def test_format_grams_value():
    assert format_grams_value(250.0) == "250"
    assert format_grams_value(12.5) == "13"
    assert format_grams_value(236.588) == "237"
