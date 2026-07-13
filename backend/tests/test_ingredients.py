from fastapi.testclient import TestClient
import pytest

from app.ingredients import IngredientRepository, IngredientStorageError, normalize_ingredient_key
from app.models import CatalogIngredient


def test_ingredient_catalog_write_is_atomic(tmp_path):
    catalog_path = tmp_path / "ingredients.json"
    repository = IngredientRepository(catalog_path=catalog_path)
    repository.upsert(CatalogIngredient(name="flour", density_kg_m3=530, aliases=[]))

    assert catalog_path.exists()
    assert not catalog_path.with_suffix(".json.tmp").exists()
    payload = catalog_path.read_text(encoding="utf-8")
    assert '"flour"' in payload
    assert payload.strip().startswith("{")


def test_ingredient_catalog_rejects_empty_file(tmp_path):
    catalog_path = tmp_path / "ingredients.json"
    catalog_path.write_text("", encoding="utf-8")
    with pytest.raises(IngredientStorageError, match="empty"):
        IngredientRepository(catalog_path=catalog_path)


def test_find_by_name_matches_hyphen_and_space_variants(tmp_path):
    repository = IngredientRepository(catalog_path=tmp_path / "ingredients.json")
    repository.upsert(
        CatalogIngredient(name="half-and-half", density_kg_m3=1020, aliases=["half and half"])
    )

    assert repository.find_by_name("half and half") is not None
    assert repository.find_by_name("half-and-half") is not None


def test_ingredient_catalog_seed_and_crud(tmp_path, monkeypatch):
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
        catalog = client.get("/api/ingredients")
        assert catalog.status_code == 200
        payload = catalog.json()
        assert payload["version"] >= 1
        assert any(item["name"] == "all-purpose flour" for item in payload["ingredients"])

        denied = client.put(
            "/api/ingredients",
            json={"name": "rye flour", "density_kg_m3": 500, "aliases": ["rye"]},
        )
        assert denied.status_code == 401

        login = client.post("/api/auth/login", json={"password": "secret", "username": "editor"})
        assert login.status_code == 200

        created = client.put(
            "/api/ingredients",
            json={"name": "Rye Flour", "density_kg_m3": 500, "aliases": ["Rye"]},
        )
        assert created.status_code == 200
        assert created.json()["name"] == "rye flour"
        assert created.json()["aliases"] == ["rye"]

        weight_only = client.put(
            "/api/ingredients",
            json={"name": "brisket", "density_kg_m3": None, "aliases": []},
        )
        assert weight_only.status_code == 200
        assert weight_only.json()["density_kg_m3"] is None

        deleted = client.delete("/api/ingredients/rye%20flour")
        assert deleted.status_code == 204


def test_estimate_density_requires_auth(tmp_path, monkeypatch):
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
        denied = client.post(
            "/api/ingredients/estimate-density",
            json={"names": ["rye flour"]},
        )
        assert denied.status_code == 401


def test_estimate_density_returns_estimates(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_BASE_URL", "http://testserver")
    monkeypatch.setenv("COOKIE_SECURE", "false")
    monkeypatch.setenv("DATA_ROOT", str(tmp_path))
    monkeypatch.setenv("RECIPE_EDITOR_PASSWORD", "secret")
    monkeypatch.setenv("RECIPE_EDITOR_USERNAME", "editor")
    monkeypatch.setenv("SESSION_SECRET", "test-session-secret")

    from app.config import get_settings
    from app.main import app
    from app.models import DensityEstimate

    get_settings.cache_clear()

    def fake_estimate(*, settings, names):
        assert names == ["rye flour"]
        return [DensityEstimate(name="rye flour", density_kg_m3=500)]

    monkeypatch.setattr("app.main.estimate_ingredient_densities", fake_estimate)

    with TestClient(app) as client:
        login = client.post("/api/auth/login", json={"password": "secret", "username": "editor"})
        assert login.status_code == 200

        response = client.post(
            "/api/ingredients/estimate-density",
            json={"names": ["rye flour"]},
        )
        assert response.status_code == 200
        assert response.json() == {
            "estimates": [{"name": "rye flour", "density_kg_m3": 500.0}]
        }
