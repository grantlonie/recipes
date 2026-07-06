from app.cooklang import (
    normalize_document,
    parse_cookware,
    parse_ingredients,
    scale_steps,
    split_amount,
)


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
    assert split_amount("½ teaspoon") == ("½", "teaspoon", False)
    assert split_amount("1") == ("1", None, False)
    assert split_amount("=1%packet") == ("1", "packet", True)


def test_parse_ingredients_reads_parenthesis_preparation():
    ingredients = parse_ingredients(
        "Add @egg yolks{3}(large) and @chocolate{100%g}(bittersweet)."
    )

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
    assert salt.unit == "teaspoon"
    assert salt.scaled_quantity == "0.25"


def test_normalize_document_converts_fractions_to_decimals():
    content = """---
title: Test
---

Mix @flour{1 1/4%cup} and @salt{½%teaspoon} and @sugar{1 ¼ cup}.
"""
    normalized = normalize_document(content)

    assert "@flour{1.25%cup}" in normalized
    assert "@salt{0.5%teaspoon}" in normalized
    assert "@sugar{1.25 cup}" in normalized


def test_scale_steps_updates_ingredient_amounts():
    steps = scale_steps(
        ["Mix @flour{1%cup} and @salt{0.5%teaspoon}."],
        scale=2,
        servings=4,
    )

    assert steps == ["Mix @flour{0.5%cup} and @salt{0.25%teaspoon}."]


def test_scale_steps_preserves_preparation_notes():
    steps = scale_steps(
        ["Mix @flour{1%cup}(sifted) and @salt{0.5%teaspoon}."],
        scale=2,
        servings=4,
    )

    assert steps == ["Mix @flour{0.5%cup}(sifted) and @salt{0.25%teaspoon}."]
