from app.cooklang import parse_cookware, parse_ingredients


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
