import pytest

from app.storage import RecipeRepository, StorageError
from app.search import search_details


def test_sync_index_tolerates_missing_cached_slug(tmp_path):
    repository = RecipeRepository(
        app_base_url="http://testserver",
        recipe_root=tmp_path / "recipes",
    )
    repository.write_recipe(
        "peanut-butter-cake",
        """---
title: Peanut Butter Cake
---

Mix @flour{}.
""",
    )
    repository.sync_index()
    assert "peanut-butter-cake" in repository.recipes

    # Simulate a concurrent delete that already removed the in-memory recipe entry.
    del repository.recipes["peanut-butter-cake"]
    path = repository.recipe_path("peanut-butter-cake")
    path.unlink()

    repository.sync_index()
    assert "peanut-butter-cake" not in repository.recipes
    assert "peanut-butter-cake" not in repository._mtimes


def test_front_matter_updates_preserve_body_and_do_not_create_images(tmp_path):
    repository = RecipeRepository(
        app_base_url="http://testserver",
        recipe_root=tmp_path / "recipes",
    )
    repository.write_recipe(
        "dinner-chili",
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
        "dinner-chili",
        bookmarked=True,
        image="https://example.com/chili.jpg",
        servings=6,
        tags=["dinner", "freezer"],
        review=["Check salt amount"],
    )

    assert "Brown @beef{1%lb}." in recipe.content
    assert recipe.bookmarked is True
    assert recipe.review == ["Check salt amount"]
    assert recipe.image == "https://example.com/chili.jpg"
    assert recipe.servings == 6
    assert recipe.tags == ["dinner", "freezer"]
    assert "review:" in recipe.content

    cleared = repository.update_metadata("dinner-chili", review=[])
    assert cleared.review == []
    assert "review:" not in cleared.content
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
    assert scaled["vanilla extract"].unit == "tsp"
    step_blocks = [block for block in recipe.blocks if block.kind == "step"]
    assert step_blocks[0].text == (
        "Mix @sourdough starter{0.5 cup}, @buttermilk{0.5 cup}, and @egg{0.5}.\n"
        "Add @melted unsalted butter{0.125 cup} and @vanilla extract{0.25 tsp}."
    )


def test_write_recipe_normalizes_fractions_to_decimals(tmp_path):
    repository = RecipeRepository(
        app_base_url="http://testserver",
        recipe_root=tmp_path / "recipes",
    )
    repository.write_recipe(
        "normalized",
        """---
title: Normalized
---

Add @butter{1 ¼%cup} and @salt{1 1/4%tsp}.
""",
    )

    content = repository.recipe_path("normalized").read_text()
    assert "@butter{1.25%cup}" in content
    assert "@salt{1.25%tsp}" in content


def test_write_recipe_renames_slug_and_assets(tmp_path):
    recipe_root = tmp_path / "recipes"
    repository = RecipeRepository(
        app_base_url="http://testserver",
        recipe_root=recipe_root,
    )
    repository.write_recipe(
        "chili",
        """---
image: image.jpg
source: source.pdf
title: Chili
---

Add @beans{2}.
""",
    )
    chili_dir = recipe_root / "chili"
    (chili_dir / "image.jpg").write_bytes(b"img")
    (chili_dir / "source.pdf").write_bytes(b"pdf")

    recipe = repository.write_recipe(
        "chicken-soup",
        """---
image: image.jpg
source: source.pdf
title: Chicken Soup
---

Add @beans{2}.
""",
        previous_slug="chili",
    )

    assert recipe.slug == "chicken-soup"
    assert not repository.recipe_path("chili").exists()
    assert repository.recipe_path("chicken-soup").exists()
    assert (recipe_root / "chicken-soup" / "image.jpg").exists()
    assert (recipe_root / "chicken-soup" / "recipe.cook").exists()
    assert not (recipe_root / "chili").exists()
    assert "image: image.jpg" in recipe.content
    assert "source: source.pdf" in recipe.content
    assert recipe.image == "/api/sources/chicken-soup/image.jpg"
    assert recipe.original_url == "/api/sources/chicken-soup/source.pdf"


def test_write_recipe_normalizes_legacy_asset_paths_on_rename(tmp_path):
    recipe_root = tmp_path / "recipes"
    repository = RecipeRepository(
        app_base_url="http://testserver",
        recipe_root=recipe_root,
    )
    repository.write_recipe(
        "chili",
        """---
image: recipes/chili/image.jpg
source: recipes/chili/source.pdf
title: Chili
---

Add @beans{2}.
""",
    )
    chili_dir = recipe_root / "chili"
    (chili_dir / "image.jpg").write_bytes(b"img")
    (chili_dir / "source.pdf").write_bytes(b"pdf")

    recipe = repository.write_recipe(
        "chicken-soup",
        """---
image: recipes/chili/image.jpg
source: recipes/chili/source.pdf
title: Chicken Soup
---

Add @beans{2}.
""",
        previous_slug="chili",
    )

    assert "image: image.jpg" in recipe.content
    assert "source: source.pdf" in recipe.content
    assert "recipes/" not in recipe.content
    assert recipe.image == "/api/sources/chicken-soup/image.jpg"
