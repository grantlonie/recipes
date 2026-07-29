from fastapi.testclient import TestClient


def test_source_text_format_returns_extracted_text_and_website_url(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_BASE_URL", "http://testserver")
    monkeypatch.setenv("COOKIE_SECURE", "false")
    monkeypatch.setenv("DATA_ROOT", str(tmp_path))
    monkeypatch.setenv("RECIPE_EDITOR_PASSWORD", "secret")
    monkeypatch.setenv("RECIPE_EDITOR_USERNAME", "editor")
    monkeypatch.setenv("SESSION_SECRET", "test-session-secret")

    recipe_dir = tmp_path / "recipes" / "chili"
    recipe_dir.mkdir(parents=True)
    (recipe_dir / "recipe.cook").write_text(
        "---\ntitle: Chili\nsource: source.txt\n---\n\nAdd @beans{2}.\n",
        encoding="utf-8",
    )
    (recipe_dir / "source.txt").write_text(
        "https://food52.com/recipes/chili\n\nChili recipe text\n",
        encoding="utf-8",
    )

    from app.config import get_settings
    from app.main import app

    get_settings.cache_clear()

    with TestClient(app) as client:
        response = client.get("/api/sources/chili/source.txt?format=text")
        assert response.status_code == 200
        payload = response.json()
        assert "Chili recipe text" in payload["text"]
        assert payload["website_url"] == "https://food52.com/recipes/chili"
