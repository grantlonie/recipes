import json

from app.config import Settings
from app.import_models import ImportModelSettings, resolve_import_models, save_import_models
from fastapi.testclient import TestClient


def test_resolve_falls_back_to_env_defaults(tmp_path):
    settings = Settings(
        data_root=tmp_path,
        import_model_bulk="accounts/fireworks/models/bulk-default",
        import_model_repair="accounts/fireworks/models/repair-default",
        import_model_text="accounts/fireworks/models/text-default",
        import_model_vision="accounts/fireworks/models/vision-default",
        session_secret="test-session-secret",
    )
    models = resolve_import_models(settings)
    assert models.text == "accounts/fireworks/models/text-default"
    assert models.vision == "accounts/fireworks/models/vision-default"
    assert models.repair == "accounts/fireworks/models/repair-default"
    assert models.bulk == "accounts/fireworks/models/bulk-default"


def test_save_and_resolve_round_trip(tmp_path):
    settings = Settings(data_root=tmp_path, session_secret="test-session-secret")
    saved = save_import_models(
        settings,
        ImportModelSettings(
            bulk="accounts/fireworks/models/bulk-a",
            repair="accounts/fireworks/models/repair-a",
            text="accounts/fireworks/models/text-a",
            vision="accounts/fireworks/models/vision-a",
        ),
    )
    assert saved.text == "accounts/fireworks/models/text-a"
    raw = json.loads((tmp_path / "import_models.json").read_text(encoding="utf-8"))
    assert raw["text"] == "accounts/fireworks/models/text-a"
    assert resolve_import_models(settings).bulk == "accounts/fireworks/models/bulk-a"


def test_import_models_api(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_BASE_URL", "http://testserver")
    monkeypatch.setenv("COOKIE_SECURE", "false")
    monkeypatch.setenv("DATA_ROOT", str(tmp_path))
    monkeypatch.setenv("RECIPE_EDITOR_PASSWORD", "secret")
    monkeypatch.setenv("RECIPE_EDITOR_USERNAME", "editor")
    monkeypatch.setenv("SESSION_SECRET", "test-session-secret")
    monkeypatch.setenv("IMPORT_MODEL_TEXT", "accounts/fireworks/models/env-text")
    monkeypatch.setenv("IMPORT_MODEL_VISION", "accounts/fireworks/models/env-vision")
    monkeypatch.setenv("IMPORT_MODEL_REPAIR", "accounts/fireworks/models/env-repair")
    monkeypatch.setenv("IMPORT_MODEL_BULK", "accounts/fireworks/models/env-bulk")

    from app.config import get_settings
    from app.main import app

    get_settings.cache_clear()

    with TestClient(app) as client:
        assert client.get("/api/settings/import-models").status_code == 401

        login = client.post("/api/auth/login", json={"password": "secret", "username": "editor"})
        assert login.status_code == 200

        current = client.get("/api/settings/import-models")
        assert current.status_code == 200
        body = current.json()
        assert body["text"] == "accounts/fireworks/models/env-text"
        assert body["fireworks_dashboard_url"].startswith("https://")
        assert "fireworks" in body["fireworks_models_url"]

        updated = client.put(
            "/api/settings/import-models",
            json={
                "bulk": "accounts/fireworks/models/bulk-saved",
                "repair": "accounts/fireworks/models/repair-saved",
                "text": "accounts/fireworks/models/text-saved",
                "vision": "accounts/fireworks/models/vision-saved",
            },
        )
        assert updated.status_code == 200
        assert updated.json()["text"] == "accounts/fireworks/models/text-saved"

        again = client.get("/api/settings/import-models")
        assert again.json()["vision"] == "accounts/fireworks/models/vision-saved"
        assert (tmp_path / "import_models.json").exists()
