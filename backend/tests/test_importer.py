import base64
from unittest.mock import patch

import httpx
import pytest

from app.importer import ImportError, _extract_cooklang, _import_with_client, import_from_url, suggest_slug


def _stream_name(cookification_id: str) -> str:
    payload = f'"cookification:{cookification_id}"'.encode()
    return base64.b64encode(payload).decode().rstrip("=")


LOADING_PAGE = f"""
<html>
  <turbo-cable-stream-source signed-stream-name="{_stream_name('abc-123')}--signature"></turbo-cable-stream-source>
  <div>Processing Banner</div>
</html>
"""

DONE_PAGE = """
<html>
  <code id="cook-code" class="language-cooklang">---
title: Chicken &amp; bacon pasta
source: https://www.bbcgoodfood.com/recipes/chicken-bacon-pasta
---

Add @chicken{} and @bacon{}.</code>
</html>
"""


def test_extract_cooklang_unescapes_entities():
    content = _extract_cooklang(DONE_PAGE)
    assert "title: Chicken & bacon pasta" in content
    assert "@chicken{}" in content


def test_suggest_slug_uses_title():
    content = "---\ntitle: Chicken & bacon pasta\n---\n"
    assert suggest_slug("https://example.com/recipe", content) == "chicken-bacon-pasta"


def test_import_from_url_polls_until_recipe_is_ready():
    recipe_url = "https://www.bbcgoodfood.com/recipes/chicken-bacon-pasta"
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == f"/{recipe_url}":
            return httpx.Response(200, text=LOADING_PAGE)
        if request.url.path == "/cookifies/abc-123":
            calls["count"] += 1
            if calls["count"] < 2:
                return httpx.Response(200, text=LOADING_PAGE)
            return httpx.Response(200, text=DONE_PAGE)
        raise AssertionError(f"Unexpected request: {request.url}")

    transport = httpx.MockTransport(handler)
    with patch("app.importer.time.sleep"):
        with httpx.Client(transport=transport) as client:
            preview = _import_with_client(recipe_url, client)

    assert preview.suggested_slug == "chicken-bacon-pasta"
    assert "Add @chicken{} and @bacon{}." in preview.content
    assert calls["count"] == 2


def test_import_from_url_raises_when_session_missing():
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, text="<html><body>missing stream</body></html>")
    )
    with httpx.Client(transport=transport) as client:
        with pytest.raises(ImportError, match="Could not start recipe import"):
            _import_with_client("https://example.com/recipe", client)
