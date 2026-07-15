from fastapi.testclient import TestClient
import pytest

from app.cooklang import rename_ingredient_markers
from app.ingredients import IngredientConflictError, IngredientRepository, IngredientStorageError
from app.models import CatalogIngredient
from app.storage import RecipeRepository


def test_rename_ingredient_markers_rewrites_braced_and_unbraced():
    body = "Mix @flour{1%cup} with @salt and @flour{2%Tbsp}(sifted)."
    assert rename_ingredient_markers(body, "flour", "all-purpose flour") == (
        "Mix @all-purpose flour{1%cup} with @salt and @all-purpose flour{2%Tbsp}(sifted)."
    )
    assert (
        rename_ingredient_markers("Season with @salt.", "salt", "kosher salt")
        == "Season with @kosher salt{}."
    )


def test_rename_ingredient_markers_matches_inflection_forms():
    body = "Add @tomato{1}(diced) and @tomatoes{2}."
    assert (
        rename_ingredient_markers(body, "tomatoes", "roma tomatoes")
        == "Add @roma tomatoes{1}(diced) and @roma tomatoes{2}."
    )


def test_rename_ingredient_markers_leaves_unrelated_names():
    body = "Add @black pepper{1%tsp} and @green bell pepper{1}."
    assert rename_ingredient_markers(body, "black pepper", "peppercorns") == (
        "Add @peppercorns{1%tsp} and @green bell pepper{1}."
    )


def test_repository_rename_rejects_collision(tmp_path):
    repository = IngredientRepository(catalog_path=tmp_path / "ingredients.json")
    repository.upsert(CatalogIngredient(name="cake flour", density_kg_m3=500))
    repository.upsert(CatalogIngredient(name="all-purpose flour", density_kg_m3=530))

    with pytest.raises(IngredientConflictError, match="conflicts with existing entry"):
        repository.rename(
            "cake flour",
            CatalogIngredient(name="all-purpose flour", density_kg_m3=500),
        )


def test_repository_rename_rejects_alias_collision(tmp_path):
    repository = IngredientRepository(catalog_path=tmp_path / "ingredients.json")
    repository.upsert(
        CatalogIngredient(name="all-purpose flour", density_kg_m3=530, aliases=["flour"])
    )
    repository.upsert(CatalogIngredient(name="cake flour", density_kg_m3=500))

    with pytest.raises(IngredientConflictError, match="conflicts with existing entry"):
        repository.rename(
            "cake flour",
            CatalogIngredient(name="flour", density_kg_m3=500),
        )


def test_repository_rename_allows_inflection_of_same_entry(tmp_path):
    repository = IngredientRepository(catalog_path=tmp_path / "ingredients.json")
    repository.upsert(CatalogIngredient(name="tomatoes", density_kg_m3=None))

    renamed = repository.rename(
        "tomatoes",
        CatalogIngredient(name="tomato", density_kg_m3=None, aliases=["roma tomato"]),
    )
    assert renamed.name == "tomato"
    assert renamed.aliases == ["roma tomato"]
    assert repository.find_by_name("tomatoes").name == "tomato"
    assert [item.name for item in repository.list_ingredients()].count("tomato") == 1


def test_repository_rename_missing_raises(tmp_path):
    repository = IngredientRepository(catalog_path=tmp_path / "ingredients.json")
    with pytest.raises(IngredientStorageError, match="Ingredient not found"):
        repository.rename("missing", CatalogIngredient(name="other"))


def test_rewrite_ingredient_name_updates_recipes(tmp_path):
    recipe_root = tmp_path / "recipes"
    repository = RecipeRepository(app_base_url="http://test", recipe_root=recipe_root)
    repository.write_recipe(
        "soup",
        "---\ntitle: Soup\n---\n\nSimmer @stock{1%cup} with @garlic{2}.\n",
    )
    repository.write_recipe(
        "bread",
        "---\ntitle: Bread\n---\n\nMix @flour{2%cup}.\n",
    )

    updated = repository.rewrite_ingredient_name("stock", "chicken stock")
    assert updated == ["soup"]
    soup = repository.get_recipe("soup")
    assert "@chicken stock{1%cup}" in soup.content
    assert "@garlic{2}" in soup.content
    bread = repository.get_recipe("bread")
    assert "@flour{2%cup}" in bread.content


def test_rename_api_rewrites_recipes_and_rejects_collision(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_BASE_URL", "http://testserver")
    monkeypatch.setenv("COOKIE_SECURE", "false")
    monkeypatch.setenv("DATA_ROOT", str(tmp_path))
    monkeypatch.setenv("RECIPE_EDITOR_PASSWORD", "secret")
    monkeypatch.setenv("RECIPE_EDITOR_USERNAME", "editor")
    monkeypatch.setenv("SESSION_SECRET", "test-session-secret")

    from app.config import get_settings
    from app.main import app

    get_settings.cache_clear()

    with TestClient(app) as client:
        login = client.post("/api/auth/login", json={"password": "secret", "username": "editor"})
        assert login.status_code == 200

        created = client.put(
            "/api/ingredients",
            json={"name": "zz-test-stock", "density_kg_m3": 1000, "aliases": []},
        )
        assert created.status_code == 200

        client.put(
            "/api/ingredients",
            json={"name": "zz-test-broth", "density_kg_m3": 1000, "aliases": []},
        )

        write = client.post(
            "/api/recipes",
            json={
                "slug": "soup",
                "content": "---\ntitle: Soup\n---\n\nHeat @zz-test-stock{1%cup}.\n",
            },
        )
        assert write.status_code == 200

        renamed = client.post(
            "/api/ingredients/rename",
            json={
                "old_name": "zz-test-stock",
                "ingredient": {
                    "name": "zz-renamed-stock",
                    "density_kg_m3": 1000,
                    "aliases": ["zz-test-stock"],
                },
            },
        )
        assert renamed.status_code == 200
        payload = renamed.json()
        assert payload["ingredient"]["name"] == "zz-renamed-stock"
        assert payload["updated_recipes"] == ["soup"]

        recipe = client.get("/api/recipes/soup")
        assert "@zz-renamed-stock{1%cup}" in recipe.json()["content"]

        conflict = client.post(
            "/api/ingredients/rename",
            json={
                "old_name": "zz-renamed-stock",
                "ingredient": {
                    "name": "zz-test-broth",
                    "density_kg_m3": 1000,
                    "aliases": [],
                },
            },
        )
        assert conflict.status_code == 409
        assert "conflicts with existing entry" in conflict.json()["detail"]
