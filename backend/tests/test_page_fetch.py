from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest
from app.config import Settings
from app.page_fetch import (
    PageFetchError,
    fetch_page_image_url,
    fetch_recipe_page,
    first_http_url,
    reset_fetch_throttle_for_tests,
)


@pytest.fixture(autouse=True)
def _reset_throttle():
    reset_fetch_throttle_for_tests()
    yield
    reset_fetch_throttle_for_tests()


@pytest.fixture(autouse=True)
def _disable_curl_cffi():
    # Keep unit tests on the mocked httpx path.
    with patch("app.page_fetch._get_page_curl_cffi", return_value=None):
        yield


@pytest.fixture
def settings() -> Settings:
    return Settings(
        page_fetch_fallback_enabled=True,
        page_fetch_max_retries=1,
        page_fetch_min_interval_seconds=0,
        page_fetch_concurrency=1,
    )


def _patch_client(transport: httpx.MockTransport):
    original = httpx.Client

    def factory(*args, **kwargs):
        kwargs = {**kwargs, "transport": transport}
        return original(*args, **kwargs)

    return patch("app.page_fetch.httpx.Client", side_effect=factory)


def test_first_http_url_strips_trailing_punctuation():
    assert (
        first_http_url("See https://food52.com/recipes/21102-greek-lamb-with-orzo.")
        == "https://food52.com/recipes/21102-greek-lamb-with-orzo"
    )


def test_fetch_recipe_page_direct_success(settings: Settings):
    page_url = "https://example.com/recipe"
    image_url = "https://example.com/hero.jpg"

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == page_url
        return httpx.Response(
            200,
            text=(
                f'<html><head><meta property="og:image" content="{image_url}" />'
                "</head><body><article>Chili</article></body></html>"
            ),
        )

    transport = httpx.MockTransport(handler)
    with patch("app.page_fetch.extract_html_text", return_value="Chili recipe"):
        with _patch_client(transport):
            page = fetch_recipe_page(page_url, settings=settings)

    assert page.extracted_text == "Chili recipe"
    assert page.image_url == image_url
    assert page.used_fallback is False


def test_fetch_recipe_page_retries_429_then_succeeds(settings: Settings):
    page_url = "https://example.com/recipe"
    image_url = "https://example.com/hero.jpg"
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        if calls["count"] == 1:
            return httpx.Response(429, text="slow down", headers={"Retry-After": "0"})
        return httpx.Response(
            200,
            text=(
                f'<html><head><meta property="og:image" content="{image_url}" />'
                "</head><body>Recipe</body></html>"
            ),
        )

    transport = httpx.MockTransport(handler)
    with patch("app.page_fetch.time.sleep"):
        with patch("app.page_fetch.extract_html_text", return_value="Recipe text"):
            with _patch_client(transport):
                page = fetch_recipe_page(page_url, settings=settings)

    assert calls["count"] == 2
    assert page.image_url == image_url
    assert page.used_fallback is False


def test_fetch_recipe_page_falls_back_to_jina_on_429(settings: Settings):
    page_url = "https://food52.com/recipes/example"
    image_url = "https://images.food52.com/dish.jpg"
    jina_headers: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url == page_url:
            return httpx.Response(429, text="slow down", headers={"Retry-After": "0"})
        if url.startswith("https://r.jina.ai/"):
            jina_headers.update({key.lower(): value for key, value in request.headers.items()})
            return httpx.Response(
                200,
                text=(
                    f"# Greek Lamb\n\n![hero]({image_url})\n\n"
                    "Ingredients\n- lamb\n\nDirections\n- cook\n"
                ),
            )
        raise AssertionError(f"Unexpected request: {url}")

    transport = httpx.MockTransport(handler)
    with patch("app.page_fetch.time.sleep"):
        with _patch_client(transport):
            page = fetch_recipe_page(page_url, settings=settings)

    assert page.used_fallback is True
    assert "Greek Lamb" in page.extracted_text
    assert page.image_url == image_url
    # Browser-like header sets make Jina return 403.
    assert "sec-fetch-mode" not in jina_headers
    assert "mozilla" not in jina_headers.get("user-agent", "").lower()


def test_fetch_recipe_page_rejects_jina_challenge_page(settings: Settings):
    page_url = "https://food52.com/recipes/example"

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url == page_url:
            return httpx.Response(403, text="forbidden")
        if url.startswith("https://r.jina.ai/"):
            return httpx.Response(
                200,
                text=(
                    "Title: Vercel Security Checkpoint\n"
                    "Warning: Target URL returned 403\n"
                    "Enable JavaScript and cookies to continue\n"
                ),
            )
        raise AssertionError(f"Unexpected request: {url}")

    transport = httpx.MockTransport(handler)
    with patch("app.page_fetch.time.sleep"):
        with _patch_client(transport):
            with pytest.raises(PageFetchError, match="blocked automated access"):
                fetch_recipe_page(page_url, settings=settings)


def test_fetch_page_image_url_uses_microlink_when_page_fetch_fails(settings: Settings):
    page_url = "https://food52.com/recipes/example"
    image_url = "https://images.food52.com/dish.jpg"

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url == page_url or url.startswith("https://r.jina.ai/"):
            return httpx.Response(429, text="slow down", headers={"Retry-After": "0"})
        if "api.microlink.io" in url:
            return httpx.Response(
                200,
                json={"status": "success", "data": {"image": {"url": image_url}}},
            )
        raise AssertionError(f"Unexpected request: {url}")

    transport = httpx.MockTransport(handler)
    with patch("app.page_fetch.time.sleep"):
        with _patch_client(transport):
            assert fetch_page_image_url(page_url, settings=settings) == image_url


def test_fetch_recipe_page_total_failure(settings: Settings):
    settings = settings.model_copy(update={"page_fetch_fallback_enabled": False})

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, text="slow down")

    transport = httpx.MockTransport(handler)
    with patch("app.page_fetch.time.sleep"):
        with _patch_client(transport):
            with pytest.raises(PageFetchError, match="rate-limiting"):
                fetch_recipe_page("https://example.com/recipe", settings=settings)


def test_fetch_page_image_url_returns_none_on_total_failure(settings: Settings):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="nope")

    transport = httpx.MockTransport(handler)
    with _patch_client(transport):
        assert fetch_page_image_url("https://example.com/recipe", settings=settings) is None
