from fastapi.testclient import TestClient


def test_sync_manifest_and_bundle(tmp_path, monkeypatch):
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
        empty_manifest = client.get("/api/sync/manifest")
        assert empty_manifest.status_code == 200
        assert empty_manifest.json() == {"recipes": [], "version": 0}

        login = client.post("/api/auth/login", json={"password": "secret", "username": "editor"})
        assert login.status_code == 200

        created = client.post(
            "/api/recipes",
            json={
                "content": "---\ntitle: Chili\n---\n\nAdd @beans{2}.",
                "slug": "chili",
            },
        )
        assert created.status_code == 200

        manifest = client.get("/api/sync/manifest").json()
        assert manifest["version"] == 1
        assert len(manifest["recipes"]) == 1
        assert manifest["recipes"][0]["slug"] == "chili"

        bundle = client.get("/api/sync/recipes").json()
        assert len(bundle) == 1
        assert bundle[0]["slug"] == "chili"
        assert bundle[0]["content"].startswith("---")


def test_get_recipe_reads_single_file_without_full_rescan(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_BASE_URL", "http://testserver")
    monkeypatch.setenv("COOKIE_SECURE", "false")
    monkeypatch.setenv("DATA_ROOT", str(tmp_path))
    monkeypatch.setenv("SESSION_SECRET", "test-session-secret")

    from app.config import get_settings
    from app.main import app
    from app.storage import RecipeRepository

    get_settings.cache_clear()

    repository = RecipeRepository(
        app_base_url="http://testserver",
        recipe_root=tmp_path / "recipes",
    )
    repository.write_recipe("one", "---\ntitle: One\n---\n\nOne.\n")
    repository.write_recipe("two", "---\ntitle: Two\n---\n\nTwo.\n")
    initial_version = repository.version

    recipe = repository.get_recipe("one")
    assert recipe.title == "One"
    assert repository.version == initial_version

    with TestClient(app) as client:
        response = client.get("/api/recipes/one")
        assert response.status_code == 200
        assert response.json()["title"] == "One"
