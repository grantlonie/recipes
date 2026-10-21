from app.hydration import (
    apply_hydration,
    classify_ingredient,
    summarize_hydration,
)


def _density(name: str) -> float | None:
    densities = {
        "all-purpose flour": 530.0,
        "bread flour": 540.0,
        "water": 1000.0,
        "olive oil": 910.0,
        "honey": 1420.0,
        "sourdough starter": 1000.0,
        "salt": 1220.0,
    }
    return densities.get(name.casefold())


def test_classify_ingredient_roles():
    assert classify_ingredient("bread flour") == "flour"
    assert classify_ingredient("all-purpose flour") == "flour"
    assert classify_ingredient("water") == "liquid"
    assert classify_ingredient("olive oil") == "liquid"
    assert classify_ingredient("honey") == "liquid"
    assert classify_ingredient("sourdough starter") == "starter"
    assert classify_ingredient("levain") == "starter"
    assert classify_ingredient("salt") == "other"
    assert classify_ingredient("breadcrumbs") == "other"
    assert classify_ingredient("flour tortillas") == "other"


def test_summarize_hydration_basic():
    body = "Mix @bread flour{500%g} with @water{350%g} and @salt{10%g}."
    summary = summarize_hydration(body, _density)
    assert summary.flour_g == 500
    assert summary.liquid_g == 350
    assert summary.starter_g == 0
    assert summary.percent == 70.0
    assert summary.adjustable


def test_summarize_hydration_with_starter():
    # 400 flour + 100 starter (50 flour / 50 water) + 250 water
    # F = 400 + 50 = 450; L = 250 + 50 = 300; H = 66.7%
    body = "Mix @bread flour{400%g}, @sourdough starter{100%g}, @water{250%g}, and @salt{8%g}."
    summary = summarize_hydration(body, _density)
    assert summary.flour_g == 400
    assert summary.liquid_g == 250
    assert summary.starter_g == 100
    assert summary.percent == 66.7
    assert summary.adjustable


def test_apply_hydration_keeps_total_and_fixed_ingredients():
    content = """---
title: Test Loaf
tags:
  - bread
---

Mix @bread flour{500%g} with @water{350%g}, @olive oil{20%g}, and @salt{10%g}.
"""
    new_content, summary = apply_hydration(content, 80.0, _density)
    assert abs(summary.percent - 80.0) < 0.5
    # Adjustable pool was 500+350+20=870; salt 10 stays fixed; total 880
    assert abs(summary.flour_g + summary.liquid_g - 870) < 0.5
    assert "@salt{10%g}" in new_content
    assert "%g" in new_content
    # Effective H = liquid/flour ≈ 80%
    assert abs(summary.liquid_g / summary.flour_g - 0.8) < 0.01


def test_apply_hydration_keeps_starter_fixed():
    content = """---
title: Sourdough
tags:
  - bread
---

Mix @bread flour{400%g}, @sourdough starter{100%g}, @water{250%g}, and @salt{8%g}.
"""
    new_content, summary = apply_hydration(content, 75.0, _density)
    assert "@sourdough starter{100%g}" in new_content
    assert "@salt{8%g}" in new_content
    assert summary.starter_g == 100
    # (L + 50) / (F + 50) == 0.75
    effective_f = summary.flour_g + 50
    effective_l = summary.liquid_g + 50
    assert abs(effective_l / effective_f - 0.75) < 0.01
    # Adjustable flour+liquid mass unchanged
    assert abs(summary.flour_g + summary.liquid_g - 650) < 0.5


def test_apply_hydration_rejects_non_bread():
    content = """---
title: Soup
---

Add @water{100%g}.
"""
    try:
        apply_hydration(content, 70.0, _density)
        raise AssertionError("expected HydrationError")
    except Exception as error:
        from app.hydration import HydrationError

        assert isinstance(error, HydrationError)
