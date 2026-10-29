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

        preview = client.get("/api/recipe-scale/test-loaf?hydration=80")
        assert preview.status_code == 200
        preview_body = preview.json()
        assert abs(preview_body["hydration"]["percent"] - 80.0) < 0.5
        assert preview_body["hydration"]["flour_g"] == 500
        assert (
            abs(preview_body["hydration"]["liquid_g"] / preview_body["hydration"]["flour_g"] - 0.8)
            < 0.01
        )
        assert "@water{350%g}" in preview_body["content"]
        assert "@salt{10%g}" in preview_body["content"]
        flour = next(item for item in preview_body["ingredients"] if "flour" in item["name"])
        water = next(item for item in preview_body["ingredients"] if item["name"] == "water")
        salt = next(item for item in preview_body["ingredients"] if item["name"] == "salt")
        assert salt["quantity"] == "10"
        assert float(flour["quantity"]) == 500
        assert abs(float(water["quantity"]) - 400) < 0.5
        assert abs(float(water["quantity"]) / float(flour["quantity"]) - 0.8) < 0.01

        stored = client.get("/api/recipes/test-loaf")
        assert stored.status_code == 200
        assert stored.json()["hydration"]["percent"] == 70.0
        assert "@water{350%g}" in stored.json()["content"]

        logout = client.post("/api/auth/logout")
        assert logout.status_code == 200
        public_preview = client.get("/api/recipe-scale/test-loaf?hydration=80")
        assert public_preview.status_code == 200
        denied_write = client.post("/api/recipes/test-loaf/hydration", json={"percent": 80})
        assert denied_write.status_code == 401

        login = client.post("/api/auth/login", json={"password": "secret", "username": "editor"})
        assert login.status_code == 200
        updated = client.post("/api/recipes/test-loaf/hydration", json={"percent": 80})
        assert updated.status_code == 200
        body = updated.json()
        assert abs(body["hydration"]["percent"] - 80.0) < 0.5
        assert "@bread flour{500%g}" in body["content"]
        assert "@salt{10%g}" in body["content"]
        assert body["hydration"]["flour_g"] == 500
        assert abs(body["hydration"]["liquid_g"] / body["hydration"]["flour_g"] - 0.8) < 0.01
        persisted = client.get("/api/recipes/test-loaf")
        assert abs(persisted.json()["hydration"]["percent"] - 80.0) < 0.5

        denied = client.post("/api/recipes", json={"content": NON_BREAD_CONTENT, "slug": "chili"})
        assert denied.status_code == 200
        assert denied.json()["hydration"] is None

        reject = client.post("/api/recipes/chili/hydration", json={"percent": 70})
        assert reject.status_code == 400
        reject_preview = client.get("/api/recipe-scale/chili?hydration=70")
        assert reject_preview.status_code == 400


def test_hydration_preview_with_scale(tmp_path, monkeypatch):
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

        scaled = client.get("/api/recipe-scale/test-loaf?servings=2&hydration=80")
        assert scaled.status_code == 200
        body = scaled.json()
        assert abs(body["hydration"]["percent"] - 80.0) < 0.5
        flour = next(item for item in body["ingredients"] if "flour" in item["name"])
        water = next(item for item in body["ingredients"] if item["name"] == "water")
        salt = next(item for item in body["ingredients"] if item["name"] == "salt")
        flour_g = float(flour["scaled_quantity"] or flour["quantity"])
        water_g = float(water["scaled_quantity"] or water["quantity"])
        salt_g = float(salt["scaled_quantity"] or salt["quantity"])
        assert salt_g == 20
        assert abs(flour_g - 1000) < 1
        assert abs(water_g - 800) < 1
        assert abs(water_g / flour_g - 0.8) < 0.01
        assert "@water{350%g}" in body["content"]
