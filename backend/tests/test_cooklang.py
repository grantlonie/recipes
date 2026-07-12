from app.cooklang import (
    metadata_cook_time,
    normalize_document,
    parse_blocks,
    parse_cookware,
    parse_document,
    parse_ingredients,
    prepare_imported_content,
    sanitize_front_matter,
    scale_steps,
    split_amount,
)


def test_split_amount_parses_ml_and_liter_units():
    assert split_amount("250%ml") == ("250", "ml", False)
    assert split_amount("250 ml") == ("250", "ml", False)
    assert split_amount("250ml") == ("250", "ml", False)
    assert split_amount("1.5%liters") == ("1.5", "l", False)
    assert split_amount("2 l") == ("2", "l", False)


def test_sanitize_front_matter_fixes_embedded_title_quotes():
    raw = """---
title: "Greek" Lamb with Orzo
source: https://food52.com/recipes/21102-greek-lamb-with-orzo
---

Cook @lamb{}.
"""
    fixed = sanitize_front_matter(raw)
    metadata, body = parse_document(fixed)
    assert metadata["title"] == '"Greek" Lamb with Orzo'
    assert "Cook @lamb{}." in body
    assert sanitize_front_matter(fixed) == fixed


def test_sanitize_front_matter_leaves_valid_yaml_unchanged():
    raw = """---
title: Chili
servings: 6
---

Brown @beef{454%g}.
"""
    assert sanitize_front_matter(raw) == raw



def test_prepare_imported_content_normalizes_volume_units():
    content = """---
title: Test
---

Add @water{250ml} and @milk{1.5%liters}.
"""
    normalized = prepare_imported_content(content)

    assert "@water{250%ml}" in normalized
    assert "@milk{1.5%l}" in normalized


def test_parse_blocks_splits_sections_from_steps():
    blocks = parse_blocks(
        """==Dough==

Mix @flour{200%g} and @water{100%ml}.

==Filling==

Combine @cheese{100%g} and @spinach{50%g}."""
    )

    assert [block.kind for block in blocks] == ["section", "step", "section", "step"]
    assert blocks[0].title == "Dough"
    assert blocks[1].text == "Mix @flour{200%g} and @water{100%ml}."
    assert blocks[2].title == "Filling"
    assert blocks[3].text == "Combine @cheese{100%g} and @spinach{50%g}."


def test_parse_blocks_section_and_step_in_same_paragraph():
    blocks = parse_blocks("==Sauce==\nSimmer @tomatoes{2%cup}.")

    assert [block.kind for block in blocks] == ["section", "step"]
    assert blocks[0].title == "Sauce"
    assert blocks[1].text == "Simmer @tomatoes{2%cup}."


def test_parse_ingredients_keeps_braced_multi_word_names_together():
    ingredients = parse_ingredients(
        "Heat @olive oil{1%Tbsp}. Add @ground lamb{1%lb} and @salt and pepper{}."
    )

    assert [ingredient.name for ingredient in ingredients] == [
        "olive oil",
        "ground lamb",
        "salt and pepper",
    ]
    assert ingredients[0].quantity == "1"
    assert ingredients[0].unit == "Tbsp"
    assert ingredients[2].quantity is None
    assert ingredients[2].unit is None


def test_parse_ingredients_still_supports_single_word_shorthand():
    ingredients = parse_ingredients("Season with @salt and serve.")

    assert [ingredient.name for ingredient in ingredients] == ["salt"]


def test_parse_cookware_keeps_braced_multi_word_names_together():
    cookware = parse_cookware("Mix in a #large bowl{} with a #spoon.")

    assert cookware == ["large bowl", "spoon"]


def test_split_amount_parses_quantity_and_unit_without_separator():
    assert split_amount("1 cup") == ("1", "cup", False)
    assert split_amount("¼ cup") == ("¼", "cup", False)
    assert split_amount("½ teaspoon") == ("½", "tsp", False)
    assert split_amount("1") == ("1", None, False)
    assert split_amount("=1%packet") == ("1", "packet", True)


def test_parse_ingredients_reads_parenthesis_preparation():
    ingredients = parse_ingredients("Add @egg yolks{3}(large) and @chocolate{100%g}(bittersweet).")

    yolks = next(ingredient for ingredient in ingredients if ingredient.name == "egg yolks")
    chocolate = next(ingredient for ingredient in ingredients if ingredient.name == "chocolate")

    assert yolks.quantity == "3"
    assert yolks.note == "large"
    assert chocolate.quantity == "100"
    assert chocolate.unit == "g"
    assert chocolate.note == "bittersweet"


def test_parse_ingredients_scales_amounts_with_embedded_units():
    ingredients = parse_ingredients(
        "Mix @flour{1 cup}, @egg{1}, and @salt{½ teaspoon}.",
        scale=2,
        servings=4,
    )

    flour = next(ingredient for ingredient in ingredients if ingredient.name == "flour")
    egg = next(ingredient for ingredient in ingredients if ingredient.name == "egg")
    salt = next(ingredient for ingredient in ingredients if ingredient.name == "salt")

    assert flour.quantity == "1"
    assert flour.unit == "cup"
    assert flour.scaled_quantity == "0.5"
    assert egg.scaled_quantity == "0.5"
    assert salt.quantity == "½"
    assert salt.unit == "tsp"
    assert salt.scaled_quantity == "0.25"


def test_normalize_document_converts_fractions_to_decimals():
    content = """---
title: Test
---

Mix @flour{1 1/4%cup} and @salt{½%teaspoon} and @sugar{1 ¼ cup}.
"""
    normalized = normalize_document(content)

    assert "@flour{1.25%cup}" in normalized
    assert "@salt{0.5%tsp}" in normalized
    assert "@sugar{1.25 cup}" in normalized


def test_scale_steps_updates_ingredient_amounts():
    steps = scale_steps(
        ["Mix @flour{1%cup} and @salt{0.5%teaspoon}."],
        scale=2,
        servings=4,
    )

    assert steps == ["Mix @flour{0.5%cup} and @salt{0.25%tsp}."]


def test_scale_steps_preserves_preparation_notes():
    steps = scale_steps(
        ["Mix @flour{1%cup}(sifted) and @salt{0.5%teaspoon}."],
        scale=2,
        servings=4,
    )

    assert steps == ["Mix @flour{0.5%cup}(sifted) and @salt{0.25%tsp}."]


def test_format_ingredient_markup_keeps_empty_braces():
    from app.cooklang import format_ingredient_markup

    assert format_ingredient_markup("kalamata olives", "", "pitted") == (
        "@kalamata olives{}(pitted)"
    )
    assert format_ingredient_markup("salt", "", None) == "@salt{}"
    assert format_ingredient_markup("olive oil", "27%g", None) == "@olive oil{27%g}"
    assert (
        metadata_cook_time({"prep time": "20 minutes", "cook time": "1 hour 30 minutes"})
        == "20 minutes prep + 1 hour 30 minutes cook"
    )
    assert metadata_cook_time({"time": "1 hour 50 minutes"}) == "1 hour 50 minutes"
    assert metadata_cook_time({"cook time": "45 minutes"}) == "45 minutes cook"
