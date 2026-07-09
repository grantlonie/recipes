from scripts.convert_cheftap_export import (
    IngredientEntry,
    canonical_source_url,
    convert_ingredient_line,
    existing_metadata_value,
    inline_ingredients,
    parse_ingredient_entries,
)


def test_inline_ingredients_consumes_word_amount_before_alias():
    steps = ["Heat the one tablespoon of olive oil until shimmering."]
    ingredients = [IngredientEntry("1 tablespoon olive oil", "olive oil", "1", "Tbsp")]

    assert inline_ingredients(steps, ingredients) == [
        "Heat the one tablespoon @olive oil{1%Tbsp} until shimmering."
    ]


def test_inline_ingredients_consumes_numeric_amount_before_alias():
    steps = ["Toss the orzo with the 2 tablespoons of olive oil and lemon juice."]
    ingredients = [
        IngredientEntry("2 tablespoons olive oil", "olive oil", "2", "Tbsp"),
        IngredientEntry("1/4 cup lemon juice", "lemon juice", "1/4", "cup"),
    ]

    assert inline_ingredients(steps, ingredients) == [
        "Toss the orzo with the 2 tablespoons @olive oil{2%Tbsp} and @lemon juice{1/4%cup}."
    ]


def test_inline_ingredients_marks_pasta_before_pasta_water():
    steps = ["Add the orzo and cook until al dente. Reserve 1/2 cup of orzo pasta water."]
    ingredients = [IngredientEntry("1 pound orzo pasta", "orzo pasta", "1", "lb")]

    assert inline_ingredients(steps, ingredients) == [
        "Add the @orzo pasta{1%lb} and cook until al dente. Reserve 1/2 cup of orzo pasta water."
    ]


def test_parse_ingredient_entries_keeps_cooklang_names_lowercase():
    warnings: list[str] = []

    entries = parse_ingredient_entries(["1 tablespoon Olive Oil", "Salt and Pepper"], warnings)

    assert warnings == []
    assert [entry.marker for entry in entries] == ["@olive oil{1%Tbsp}", "@salt and pepper{}"]


def test_convert_ingredient_line_keeps_cooklang_name_lowercase():
    assert convert_ingredient_line("1 tablespoon Olive Oil") == "@olive oil{1%Tbsp}"


def test_existing_metadata_value_reads_image(tmp_path):
    recipe = tmp_path / "recipe.cook"
    recipe.write_text(
        "---\ntitle: Test\nimage: 'https://example.com/photo.jpg'\n---\n\nCook.", encoding="utf-8"
    )

    assert existing_metadata_value(recipe, "image") == "https://example.com/photo.jpg"


def test_canonical_source_url_unwraps_google_amp_recipe_url():
    assert (
        canonical_source_url(
            "https://www.google.com/amp/s/food52.com/recipes/14948-test-recipe/amp"
        )
        == "https://food52.com/recipes/14948-test-recipe"
    )
