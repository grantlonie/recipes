from fastapi.testclient import TestClient

BREAD_CONTENT = """---
title: Test Loaf
tags:
  - bread
---

Mix @bread flour{500%g} with @water{350%g} and @salt{10%g}.
"""

NON_BREAD_CONTENT = """---
title: Chili
---

Add @beans{2}.
"""


def test_hydration_on_detail_and_apply(tmp_path, monkeypatch):
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

        created = client.post(
            "/api/recipes",
            json={"content": BREAD_CONTENT, "slug": "test-loaf"},
        )
        assert created.status_code == 200
        hydration = created.json()["hydration"]
        assert hydration is not None
        assert hydration["percent"] == 70.0
        assert hydration["adjustable"] is True
        assert hydration["flour_g"] == 500
        assert hydration["liquid_g"] == 350

        detail = client.get("/api/recipes/test-loaf")
        assert detail.status_code == 200
        assert detail.json()["hydration"]["percent"] == 70.0

        updated = client.post("/api/recipes/test-loaf/hydration", json={"percent": 80})
        assert updated.status_code == 200
        body = updated.json()
        assert abs(body["hydration"]["percent"] - 80.0) < 0.5
        assert "@salt{10%g}" in body["content"]
        assert abs(body["hydration"]["liquid_g"] / body["hydration"]["flour_g"] - 0.8) < 0.01

        denied = client.post("/api/recipes", json={"content": NON_BREAD_CONTENT, "slug": "chili"})
        assert denied.status_code == 200
        assert denied.json()["hydration"] is None

        reject = client.post("/api/recipes/chili/hydration", json={"percent": 70})
        assert reject.status_code == 400
