from unittest.mock import patch

from app.models import ImportPreview
from fastapi.testclient import TestClient


def test_import_text_requires_editor_and_imports(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_BASE_URL", "http://testserver")
    monkeypatch.setenv("COOKIE_SECURE", "false")
    monkeypatch.setenv("DATA_ROOT", str(tmp_path))
    monkeypatch.setenv("RECIPE_EDITOR_PASSWORD", "secret")
    monkeypatch.setenv("RECIPE_EDITOR_USERNAME", "editor")
    monkeypatch.setenv("SESSION_SECRET", "test-session-secret")

    from app.config import get_settings
    from app.main import app

    get_settings.cache_clear()

    preview = ImportPreview(
        content="---\ntitle: Chili\n---\n\nBrown @beef{1%lb}.\n",
        suggested_slug="chili",
    )

    with TestClient(app) as client:
        denied = client.post("/api/import/text", json={"text": "Chili recipe"})
        assert denied.status_code == 401

        login = client.post("/api/auth/login", json={"password": "secret", "username": "editor"})
        assert login.status_code == 200

        with patch("app.main.import_from_text", return_value=preview) as import_text:
            response = client.post("/api/import/text", json={"text": "Chili recipe"})

        assert response.status_code == 200
        assert response.json()["suggested_slug"] == "chili"
        import_text.assert_called_once()
        assert import_text.call_args.args[0] == "Chili recipe"
