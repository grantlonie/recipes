from app.cooklang import (
    format_yaml_quoted_string,
    heal_imported_cooklang,
    metadata_cook_time,
    normalize_document,
    parse_blocks,
    parse_cookware,
    parse_document,
    parse_ingredients,
    prepare_imported_content,
    render_document,
    sanitize_front_matter,
    scale_blocks,
    scale_steps,
    split_amount,
    trim_cooklang_document,
)


def test_split_amount_parses_ml_and_liter_units():
    assert split_amount("250%ml") == ("250", "ml", False)
    assert split_amount("250 ml") == ("250", "ml", False)
    assert split_amount("250ml") == ("250", "ml", False)
    assert split_amount("1.5%liters") == ("1.5", "l", False)
    assert split_amount("2 l") == ("2", "l", False)


def test_format_yaml_quoted_string_escapes_internal_quotes():
    assert format_yaml_quoted_string('He said "hello"') == r'"He said \"hello\""'


def test_render_document_quotes_description():
    content = render_document(
        {
            "title": "Cornbread",
            "description": "Classic cornbread baked in a well-seasoned cast-iron pan for a crisp edge.",
        },
        "Bake @cornmeal{1%cup}.",
    )
    assert (
        'description: "Classic cornbread baked in a well-seasoned cast-iron pan for a crisp edge."'
        in content
    )
    metadata, body = parse_document(content)
    assert metadata["description"] == (
        "Classic cornbread baked in a well-seasoned cast-iron pan for a crisp edge."
    )
    assert "Bake @cornmeal{1%cup}." in body


def test_sanitize_front_matter_quotes_unquoted_description():
    raw = """---
title: Cornbread
description: Classic cornbread baked in a well-seasoned cast-iron pan for a crisp edge.
---

Bake @cornmeal{1%cup}.
"""
    fixed = sanitize_front_matter(raw)
    assert (
        'description: "Classic cornbread baked in a well-seasoned cast-iron pan for a crisp edge."'
        in fixed
    )
    metadata, _body = parse_document(fixed)
    assert metadata["description"] == (
        "Classic cornbread baked in a well-seasoned cast-iron pan for a crisp edge."
    )
    assert sanitize_front_matter(fixed) == fixed


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


def test_sanitize_front_matter_leaves_valid_yaml_without_descriptions_unchanged():
    raw = """---
title: Chili
servings: 6
---

Brown @beef{454%g}.
"""
    fixed = sanitize_front_matter(raw)
    metadata, body = parse_document(fixed)
    assert metadata == {"title": "Chili", "servings": 6}
    assert "Brown @beef{454%g}." in body
    assert sanitize_front_matter(fixed) == fixed


def test_normalize_document_strips_mangled_description_quotes():
    content = """---
title: Brownies
description: '"Fudgy cocoa brownies made by melting butter with sugar and cocoa over\\'
---

Bake @batter{}.
"""
    normalized = normalize_document(content)
    metadata, _body = parse_document(normalized)
    assert metadata["description"] == (
        "Fudgy cocoa brownies made by melting butter with sugar and cocoa over"
    )
    assert (
        'description: "Fudgy cocoa brownies made by melting butter with sugar and cocoa over"'
        in normalized
    )


def test_normalize_document_decodes_description_unicode_escapes():
    content = r"""---
title: Brownies
description: '"Classic fudgy brownies. Use natural or Dutch\u2011\\'
---

Bake @batter{}.
"""
    normalized = normalize_document(content)
    metadata, _body = parse_document(normalized)
    assert metadata["description"] == "Classic fudgy brownies. Use natural or Dutch‑"
    assert "\\u2011" not in normalized
    assert '"' not in metadata["description"]


def test_sanitize_front_matter_repairs_truncated_description_escapes():
    raw = """---
title: Brownies
description: "Classic fudgy brownies. Use natural or Dutch\\u2011\\
---

Bake @batter{}.
"""
    fixed = sanitize_front_matter(raw)
    metadata, _body = parse_document(fixed)
    assert metadata["description"] == "Classic fudgy brownies. Use natural or Dutch‑"
    assert 'description: "Classic fudgy brownies. Use natural or Dutch‑"' in fixed


def test_trim_cooklang_document_keeps_first_recipe_only():
    raw = """---
title: Scallops
---

Season @sea scallops{907%g}.

> Parsley leaves can be used in place of celery leaves.

Wait, I need to reconsider the vermouth amount. I decided to use 0.25.

Let me finalize:

---
title: Scallops Redo
---

Season @sea scallops{1%lb}.
"""
    trimmed = trim_cooklang_document(raw)
    assert "Season @sea scallops{907%g}." in trimmed
    assert "Parsley leaves can be used" in trimmed
    assert "Wait, I need to reconsider" not in trimmed
    assert "Scallops Redo" not in trimmed


def test_heal_imported_cooklang_strips_prose_and_bad_refs():
    raw = """Here is the recipe:

---
title: Soup
image: photos/soup.jpg
source: not-a-url
---

Cook @onion{1}.
"""
    healed, notes = heal_imported_cooklang(raw)
    assert healed.lstrip().startswith("---")
    metadata, body = parse_document(healed)
    assert metadata["title"] == "Soup"
    assert "image" not in metadata
    assert "source" not in metadata
    assert "Cook @onion{1}." in body
    assert any("leading prose" in note for note in notes)
    assert any("invalid image" in note for note in notes)
    assert any("invalid source" in note for note in notes)


def test_render_front_matter_quotes_import_notes_with_colons():
    content = render_document(
        {
            "title": "Tart",
            "import_notes": [
                "pass2: quality repair via gpt-oss-120b — Plain-text amount not marked as ingredient: 2 tablespoons"
            ],
        },
        "Bake @batter{}.",
    )
    assert 'import_notes:\n- "pass2: quality repair' in content or (
        'import_notes:\n  - "pass2: quality repair' in content
    )
    metadata, _body = parse_document(content)
    assert metadata["import_notes"][0].startswith("pass2:")
    assert "2 tablespoons" in metadata["import_notes"][0]


def test_prepare_imported_content_strips_import_error_notes_and_app_keys():
    content = """---
title: Test
review:
  - stale
import_time: "2020-01-01T00:00:00Z"
import_duration_ms: 12
import_notes:
  - old
---

> Import error: Source ingredient may be missing from Cooklang: To finish

Bake @batter{}.
"""
    prepared = prepare_imported_content(content)
    metadata, body = parse_document(prepared)
    assert "review" not in metadata
    assert "import_time" not in metadata
    assert "Import error:" not in body
    assert "Bake @batter{}." in body


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


def test_parse_blocks_keeps_inline_notes():
    blocks = parse_blocks(
        """Pour butter over the batter.

> Soft crust: mix butter into the batter.
> If not using beer, add yeast.

Bake for ~{1%hour}."""
    )

    assert [block.kind for block in blocks] == ["step", "note", "note", "step"]
    assert blocks[1].text == "Soft crust: mix butter into the batter."
    assert blocks[2].text == "If not using beer, add yeast."
    assert blocks[3].text == "Bake for ~{1%hour}."


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


def test_parse_ingredients_allows_accented_letters_in_names():
    ingredients = parse_ingredients(
        "Combine @pickled jalapeño brine{2%Tbsp} and @pickled jalapeños{0.33%cup}."
    )

    assert [ingredient.name for ingredient in ingredients] == [
        "pickled jalapeño brine",
        "pickled jalapeños",
    ]
    assert ingredients[0].quantity == "2"
    assert ingredients[0].unit == "Tbsp"
    assert ingredients[1].quantity == "0.33"
    assert ingredients[1].unit == "cup"


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


def test_parse_ingredients_merges_same_name_and_note():
    ingredients = parse_ingredients(
        "Mix @rice flour{0.5%cup} into the crust. "
        "Sprinkle @rice flour{0.5%cup} over the top."
    )

    assert len(ingredients) == 1
    assert ingredients[0].name == "rice flour"
    assert ingredients[0].quantity == "1"
    assert ingredients[0].unit == "cup"
    assert ingredients[0].note is None


def test_parse_ingredients_does_not_merge_different_notes():
    ingredients = parse_ingredients(
        "Slice @tomatoes{2}(beefsteak) and @tomatoes{1}(cherry)."
    )

    assert len(ingredients) == 2
    assert ingredients[0].name == "tomatoes"
    assert ingredients[0].note == "beefsteak"
    assert ingredients[0].quantity == "2"
    assert ingredients[1].name == "tomatoes"
    assert ingredients[1].note == "cherry"
    assert ingredients[1].quantity == "1"


def test_parse_ingredients_does_not_merge_different_units():
    ingredients = parse_ingredients(
        "Add @rice flour{0.5%cup} and @rice flour{50%g}."
    )

    assert len(ingredients) == 2
    assert ingredients[0].quantity == "0.5"
    assert ingredients[0].unit == "cup"
    assert ingredients[1].quantity == "50"
    assert ingredients[1].unit == "g"


def test_parse_ingredients_merges_scaled_amounts():
    ingredients = parse_ingredients(
        "Mix @rice flour{1%cup} into the crust. Sprinkle @rice flour{1%cup} over the top.",
        scale=2,
        servings=4,
    )

    assert len(ingredients) == 1
    assert ingredients[0].quantity == "2"
    assert ingredients[0].scaled_quantity == "1"


def test_parse_ingredients_excludes_note_line_references():
    ingredients = parse_ingredients(
        "\n".join(
            [
                "Add @chicken broth{836%g}(seafood).",
                "> Start with @chicken broth{717%g} and add up to @chicken broth{119%g} more.",
            ]
        )
    )

    assert [ingredient.name for ingredient in ingredients] == ["chicken broth"]
    assert ingredients[0].quantity == "836"
    assert ingredients[0].unit == "g"
    assert ingredients[0].note == "seafood"


def test_scale_blocks_scales_note_ingredient_amounts():
    blocks = parse_blocks(
        "\n".join(
            [
                "Add @chicken broth{836%g}.",
                "> Start with @chicken broth{717%g} of stock.",
            ]
        )
    )
    scaled = scale_blocks(blocks, scale=2, servings=1)

    assert scaled[0].text == "Add @chicken broth{1672%g}."
    assert scaled[1].text == "Start with @chicken broth{1434%g} of stock."


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
