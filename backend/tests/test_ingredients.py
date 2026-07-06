from fastapi.testclient import TestClient


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
            json={"name": "rye flour", "density_kg_m3": 500, "aliases": ["rye"]},
        )
        assert created.status_code == 200
        assert created.json()["name"] == "rye flour"

        weight_only = client.put(
            "/api/ingredients",
            json={"name": "brisket", "density_kg_m3": None, "aliases": []},
        )
        assert weight_only.status_code == 200
        assert weight_only.json()["density_kg_m3"] is None

        deleted = client.delete("/api/ingredients/rye%20flour")
        assert deleted.status_code == 204
