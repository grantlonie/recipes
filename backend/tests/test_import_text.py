from unittest.mock import patch

from app.importer import ImportError
from app.models import ImportPreview
from fastapi.testclient import TestClient


def test_import_text_requires_editor(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    with client:
        denied = client.post("/api/import/text", json={"text": "Chili recipe"})
        assert denied.status_code == 401


def test_import_text_converts_recipe(tmp_path, monkeypatch):
    preview = ImportPreview(
        content="---\ntitle: Chili\n---\n\nBrown @beef{}.\n",
        suggested_slug="chili",
        unmatched_ingredients=[],
    )
    client = _client(tmp_path, monkeypatch)
    with client:
        _login(client)
        with patch("app.main.import_from_text", return_value=preview) as mocked:
            response = client.post("/api/import/text", json={"text": "A chili recipe"})

        assert response.status_code == 200
        assert response.json()["suggested_slug"] == "chili"
        mocked.assert_called_once()
        assert mocked.call_args.args[0] == "A chili recipe"


def test_import_text_empty_returns_error(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    with client:
        _login(client)
        response = client.post("/api/import/text", json={"text": "   "})
        assert response.status_code == 502
        assert response.json()["detail"] == "Recipe text is required"


def test_import_text_propagates_import_error(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    with client:
        _login(client)
        with patch(
            "app.main.import_from_text",
            side_effect=ImportError("Couldn't convert this recipe"),
        ):
            response = client.post("/api/import/text", json={"text": "A chili recipe"})
        assert response.status_code == 502
        assert response.json()["detail"] == "Couldn't convert this recipe"


def _client(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setenv("APP_BASE_URL", "http://testserver")
    monkeypatch.setenv("COOKIE_SECURE", "false")
    monkeypatch.setenv("DATA_ROOT", str(tmp_path))
    monkeypatch.setenv("RECIPE_EDITOR_PASSWORD", "secret")
    monkeypatch.setenv("RECIPE_EDITOR_USERNAME", "editor")
    monkeypatch.setenv("SESSION_SECRET", "test-session-secret")

    from app.config import get_settings
    from app.main import app

    get_settings.cache_clear()
    return TestClient(app)


def _login(client: TestClient) -> None:
    login = client.post("/api/auth/login", json={"password": "secret", "username": "editor"})
    assert login.status_code == 200
