import pytest

from app.storage import RecipeRepository, StorageError
from app.search import search_details


def test_front_matter_updates_preserve_body_and_do_not_create_images(tmp_path):
    repository = RecipeRepository(
        app_base_url="http://testserver",
        recipe_root=tmp_path / "recipes",
    )
    repository.write_recipe(
        "dinner/chili",
        """---
title: Chili
tags:
  - dinner
servings: 4
---

Brown @beef{1%lb}.
""",
    )

    recipe = repository.update_metadata(
        "dinner/chili",
        bookmarked=True,
        image="https://example.com/chili.jpg",
        servings=6,
        tags=["dinner", "freezer"],
    )

    assert "Brown @beef{1%lb}." in recipe.content
    assert recipe.bookmarked is True
    assert recipe.image == "https://example.com/chili.jpg"
    assert recipe.servings == 6
    assert recipe.tags == ["dinner", "freezer"]
    assert not list(tmp_path.rglob("*.jpg"))


def test_recipe_paths_cannot_escape_recipe_root(tmp_path):
    repository = RecipeRepository(
        app_base_url="http://testserver",
        recipe_root=tmp_path / "recipes",
    )

    with pytest.raises(StorageError):
        repository.write_recipe("../secret", "nope")


def test_recipe_delete_removes_file_and_refreshes_cache(tmp_path):
    repository = RecipeRepository(
        app_base_url="http://testserver",
        recipe_root=tmp_path / "recipes",
    )
    repository.write_recipe("toast", "Toast @bread{}.\n")

    repository.delete_recipe("toast")

    assert repository.list_recipes() == []
    with pytest.raises(StorageError):
        repository.get_recipe("toast")


def test_search_ranks_title_matches_before_recipe_text_matches(tmp_path):
    repository = RecipeRepository(
        app_base_url="http://testserver",
        recipe_root=tmp_path / "recipes",
    )
    repository.write_recipe(
        "pasta",
        """---
title: Tomato Pasta
tags:
  - dinner
---

Boil @noodles{1%lb}.
""",
    )
    repository.write_recipe(
        "soup",
        """---
title: Weeknight Soup
tags:
  - dinner
---

Add @tomato{2}.
""",
    )

    recipes = repository.list_recipes()
    details = {slug: recipe.content for slug, recipe in repository.recipes.items()}
    results = search_details(recipes, details, "tomato")

    assert [result.recipe.slug for result in results] == ["pasta", "soup"]


def test_scaling_respects_servings_and_fixed_quantities(tmp_path):
    repository = RecipeRepository(
        app_base_url="http://testserver",
        recipe_root=tmp_path / "recipes",
    )
    repository.write_recipe(
        "bread",
        """---
title: Bread
servings: 2
---

Mix @flour{500%g} and @yeast{=1%packet}.
""",
    )

    recipe = repository.get_recipe("bread", scaled_servings=4)

    flour = next(ingredient for ingredient in recipe.ingredients if ingredient.name == "flour")
    yeast = next(ingredient for ingredient in recipe.ingredients if ingredient.name == "yeast")
    assert flour.scaled_quantity == "1000"
    assert yeast.scaled_quantity == "1"


def test_scaling_handles_sourdough_style_amounts(tmp_path):
    repository = RecipeRepository(
        app_base_url="http://testserver",
        recipe_root=tmp_path / "recipes",
    )
    repository.write_recipe(
        "pancakes",
        """---
title: Pancakes
servings: 4
---

Mix @sourdough starter{1 cup}, @buttermilk{1 cup}, and @egg{1}.
Add @melted unsalted butter{¼ cup} and @vanilla extract{½ teaspoon}.
""",
    )

    recipe = repository.get_recipe("pancakes", scaled_servings=2)

    scaled = {ingredient.name: ingredient for ingredient in recipe.ingredients}
    assert scaled["sourdough starter"].scaled_quantity == "0.5"
    assert scaled["sourdough starter"].unit == "cup"
    assert scaled["buttermilk"].scaled_quantity == "0.5"
    assert scaled["egg"].scaled_quantity == "0.5"
    assert scaled["melted unsalted butter"].scaled_quantity == "0.125"
    assert scaled["vanilla extract"].scaled_quantity == "0.25"
    assert scaled["vanilla extract"].unit == "teaspoon"
