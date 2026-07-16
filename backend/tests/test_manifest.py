from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app


def test_web_manifest_uses_absolute_share_target_action(monkeypatch):
    monkeypatch.setenv("APP_BASE_URL", "https://recipes.example.com")
    get_settings.cache_clear()

    client = TestClient(app)
    response = client.get("/manifest.webmanifest")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/manifest+json")

    manifest = response.json()
    assert manifest["share_target"]["action"] == "https://recipes.example.com/import"
    assert manifest["share_target"]["method"] == "GET"
    assert manifest["share_target"]["enctype"] == "application/x-www-form-urlencoded"

    get_settings.cache_clear()
