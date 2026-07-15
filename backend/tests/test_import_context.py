from app.import_context import (
    build_quality_repair_message,
    build_system_prompt,
    build_user_message,
    truncate_source_text,
)
from app.import_validate import clean_source_text, validate_imported_cooklang


def test_build_system_prompt_omits_ingredient_catalog():
    prompt = build_system_prompt()
    assert "Ingredient catalog" not in prompt
    assert "You convert recipes into Cooklang" in prompt
    assert "YAML-quote the entire title when it contains quotes or punctuation" in prompt
    assert "Descriptions should stay plain unquoted text" in prompt
    assert "title: Chili" in prompt
    assert "prep time: 15 minutes" in prompt
    assert "cook time: 45 minutes" in prompt
    assert "Do not collapse prep and cook" in prompt
    assert "Preserve the source's measurement units" in prompt
    assert "Do not convert between volume and mass" in prompt
    assert "@kidney beans{2%cup}" in prompt
    assert "Prefer grams" not in prompt
    assert "green bell pepper ≠ black pepper" in prompt
    assert "Never write {0%g}" in prompt
    assert "Avoid these mistakes:" in prompt
    assert "Put preparation words in (notes)" in prompt
    assert '@pickled jalapeños{0.33%cup}(chopped)' in prompt
    assert "@green bell pepper{1}(diced)" in prompt
    assert "Treat source spellings tbsp" in prompt
    assert '"1 tbsp fennel seeds"' in prompt
    assert "Source casing does not matter" in prompt
    assert "divided" in prompt
    assert "@powdered sugar{}" in prompt
    assert "when the source says 1 tbsp fennel seeds" in prompt
    assert "Use front-matter `description` for general recipe-level notes" in prompt
    assert "Step-specific tips stay as Cooklang `>` note lines" in prompt
    assert "description: Hearty weeknight chili with kidney beans. Leftovers keep 3 days refrigerated." in prompt
    assert (
        "description: Hearty beer bread. Sift the flour (or spoon into the cup). "
        "If not using beer, add a packet of active dry yeast."
    ) in prompt
    assert "> Soft crust: mix melted butter into the batter instead of pouring it over the top." in prompt
    assert "> If the mixture looks dry, add a splash of water before simmering." in prompt
    assert "@pecans{0.5%cup}(optional)" in prompt


def test_truncate_source_text_limits_length():
    text = "a" * 100
    assert len(truncate_source_text(text, max_chars=20)) == 20
    assert truncate_source_text(text, max_chars=20).endswith("…")


def test_build_user_message_truncates_source_text():
    message = build_user_message("x" * 100, source_url="https://example.com/r", max_chars=30)
    assert "Original source URL: https://example.com/r" in message
    assert "x" * 29 in message


def test_build_user_message_strips_source_noise():
    source = """My Soup

Ingredients
1 onion

Directions
Cook onion.

Nutrition
Calories 100
Tools
Set a Timer
Bread
Cake
"""
    message = build_user_message(source)
    assert "Ingredients" in message
    assert "1 onion" in message
    assert "Nutrition" not in message
    assert "Tools" not in message
    assert "Set a Timer" not in message


def test_build_quality_repair_message_includes_warnings_and_source():
    message = build_quality_repair_message(
        source_text="Ingredients\n1 onion\n\nDirections\nCook.",
        previous_cooklang="---\ntitle: Soup\n---\n\nCook.\n",
        warnings=["Source ingredient may be missing from Cooklang: 1 onion"],
    )
    assert "Problems to fix:" in message
    assert "1 onion" in message
    assert "title: Soup" in message


def test_clean_source_text_removes_noise_sections():
    cleaned = clean_source_text("Hello\nNutrition\nCalories 12\nTools\nWorld\n")
    assert "Nutrition" not in cleaned
    assert "Tools" not in cleaned
    assert "Hello" in cleaned
    assert "World" in cleaned


def test_validate_imported_cooklang_flags_invalid_amounts_and_plain_text():
    content = """---
title: Test
---

Season with @salt{0%g}(to taste).

Add 1 Tbsp sambal oelek and oil the baking pan{1}.
"""
    result = validate_imported_cooklang(content)
    joined = "\n".join(result.warnings)
    assert "Invalid amount for @salt" in joined
    assert "Plain-text amount not marked as ingredient: 1 Tbsp" in joined
    assert "Cookware should use #name{}" in joined
    assert result.needs_repair


def test_validate_allows_plain_byproduct_amounts():
    content = """---
title: Test
---

Drain all but 2 tablespoons of the fat. Reserve 0.5 cup of pasta water.
Ladle about 0.25 cup of gravy over the roast.
"""
    result = validate_imported_cooklang(content)
    assert result.warnings == []


def test_validate_imported_cooklang_flags_missing_source_ingredients():
    content = """---
title: Test
---

Add @onion{1}.
"""
    source = """Ingredients
1 onion
2 cloves garlic

Directions
Cook.
"""
    result = validate_imported_cooklang(content, source_text=source)
    assert any("garlic" in warning for warning in result.warnings)
    assert not any("onion" in warning.lower() for warning in result.warnings)


def test_validate_imported_cooklang_flags_missing_prep_notes():
    content = """---
title: Sheet pan
---

Toss @jalapenos{0.33%cup}(pickled) with @corn{4%cup}.
Garnish with @jalapenos{1}(sliced into rings).
"""
    source = """Ingredients
1/3 cup chopped pickled jalapeños, plus brine from the jar
4 cups corn kernels
1 jalapeño, sliced into rings

Directions
Cook.
"""
    result = validate_imported_cooklang(content, source_text=source)
    assert any(
        "chopped" in warning and "Source preparation note missing for" in warning
        for warning in result.warnings
    )
    assert not any(
        "sliced into rings" in warning and "Source preparation note missing for" in warning
        for warning in result.warnings
    )
    # Soft warning only — do not trigger the expensive repair model.
    assert not result.needs_repair


def test_validate_imported_cooklang_accepts_prep_notes():
    content = """---
title: Sheet pan
---

Toss @jalapenos{0.33%cup}(pickled, chopped) with @corn{4%cup}.
"""
    source = """Ingredients
1/3 cup chopped pickled jalapeños

Directions
Cook.
"""
    result = validate_imported_cooklang(content, source_text=source)
    assert result.warnings == []


def test_validate_recognizes_converted_amounts_as_present():
    content = """---
title: Brownies
---

Combine @butter{140%g}, @granulated sugar{250%g}, and @eggs{2}.
"""
    source = """Ingredients
10 tablespoons (1 1/4 sticks, 140 grams) unsalted butter
1 1/4 cups (250 grams) sugar
2 cold large eggs

Directions
Mix.
"""
    result = validate_imported_cooklang(content, source_text=source)
    assert result.warnings == []


def test_validate_skips_serving_suggestions_and_footnotes():
    content = """---
title: Brie
---

Bake @brie{1}.
"""
    source = """Ingredients
One 10-ounce round Brie
Serving suggestions: nuts, crackers
*1 medium potato yields mashed potato.

Directions
Bake.
"""
    result = validate_imported_cooklang(content, source_text=source)
    assert result.warnings == []
