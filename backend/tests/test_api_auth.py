from fastapi.testclient import TestClient


def test_public_reads_and_protected_writes(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_BASE_URL", "http://testserver")
    monkeypatch.setenv("DATA_ROOT", str(tmp_path))
    monkeypatch.setenv("RECIPE_EDITOR_PASSWORD", "secret")
    monkeypatch.setenv("RECIPE_EDITOR_USERNAME", "editor")
    monkeypatch.setenv("SESSION_SECRET", "test-session-secret")

    from app.config import get_settings
    from app.main import app

    get_settings.cache_clear()

    with TestClient(app) as client:
        assert client.get("/api/recipes").status_code == 200

        denied = client.post(
            "/api/recipes",
            json={"content": "---\ntitle: Chili\n---\n\nAdd @beans{2}.", "slug": "chili"},
        )
        assert denied.status_code == 401

        login = client.post("/api/auth/login", json={"password": "secret", "username": "editor"})
        assert login.status_code == 200

        created = client.post(
            "/api/recipes",
            json={"content": "---\ntitle: Chili\n---\n\nAdd @beans{2}.", "slug": "chili"},
        )
        assert created.status_code == 200

        public_recipe = client.get("/api/recipes/chili")
        assert public_recipe.status_code == 200
        assert public_recipe.json()["title"] == "Chili"
