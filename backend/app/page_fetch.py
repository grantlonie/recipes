from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass

import httpx

from app.config import Settings
from app.extract import ExtractError, extract_html_text, extract_page_image_url

DEFAULT_TIMEOUT_SECONDS = 90.0
JINA_READER_PREFIX = "https://r.jina.ai/"
MICROLINK_API = "https://api.microlink.io/"
RETRYABLE_STATUS = frozenset({403, 429})
CURL_CFFI_IMPERSONATE = "chrome131"

BROWSER_HEADERS = {
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
    "DNT": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
}

# Jina rejects browser-like header sets with 403; keep this minimal.
JINA_HEADERS = {
    "Accept": "text/plain,text/markdown,*/*;q=0.8",
    "User-Agent": "recipes-importer/1.0",
}

SOURCE_HTTP_URL_RE = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)
MARKDOWN_IMAGE_RE = re.compile(r"!\[[^\]]*\]\((https?://[^)\s]+)\)")
CHALLENGE_MARKERS = (
    "vercel security checkpoint",
    "just a moment...",
    "cf-browser-verification",
    "attention required",
    "enable javascript and cookies",
    "checking your browser",
)

logger = logging.getLogger(__name__)

_fetch_lock = threading.Lock()
_fetch_slots: threading.Semaphore | None = None
_fetch_slots_limit: int | None = None
_last_fetch_at = 0.0


class PageFetchError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class FetchedPage:
    extracted_text: str
    final_url: str
    image_url: str | None
    used_fallback: bool = False


@dataclass(frozen=True)
class _RawResponse:
    status_code: int
    text: str
    url: str
    headers: dict[str, str]


def first_http_url(text: str) -> str | None:
    match = SOURCE_HTTP_URL_RE.search(text)
    if not match:
        return None
    return match.group(0).rstrip(".,);]>\"'")


def fetch_recipe_page(url: str, *, settings: Settings) -> FetchedPage:
    """Fetch a recipe page with retry/backoff and optional reader fallback."""
    recipe_url = url.strip()
    if not recipe_url:
        raise PageFetchError("Recipe URL is required")

    with _acquire_fetch_slot(settings):
        try:
            return _fetch_direct(recipe_url, settings=settings)
        except PageFetchError as error:
            if not settings.page_fetch_fallback_enabled:
                raise
            if error.status_code not in RETRYABLE_STATUS and error.status_code is not None:
                raise
            logger.info(
                "Direct fetch failed for %s (%s); trying reader fallback", recipe_url, error
            )
            return _fetch_via_jina(recipe_url, settings=settings)


def fetch_page_image_url(url: str, *, settings: Settings) -> str | None:
    """Best-effort og:image (or equivalent) scrape; never raises for HTTP failures."""
    try:
        page = fetch_recipe_page(url, settings=settings)
    except PageFetchError:
        return _fetch_image_via_microlink(url, settings=settings)
    if page.image_url:
        return page.image_url
    return _fetch_image_via_microlink(url, settings=settings)


def rate_limit_message(status_code: int | None = None) -> str:
    if status_code == 429:
        return "This site is rate-limiting imports right now; try again in a few minutes."
    if status_code == 403:
        return (
            "This site blocked automated access. Try copying the recipe text "
            "or saving the page and importing the HTML file instead."
        )
    return "Recipe import failed"


def _fetch_direct(url: str, *, settings: Settings) -> FetchedPage:
    attempts = max(1, settings.page_fetch_max_retries + 1)
    last_error: PageFetchError | None = None

    for attempt in range(attempts):
        try:
            response = _get_page(url)
        except httpx.TimeoutException as error:
            raise PageFetchError("Recipe import timed out") from error
        except httpx.HTTPError as error:
            raise PageFetchError(f"Recipe import failed: {error}") from error

        if response.status_code in RETRYABLE_STATUS:
            last_error = PageFetchError(
                rate_limit_message(response.status_code),
                status_code=response.status_code,
            )
            if attempt + 1 < attempts:
                _sleep_before_retry(response.headers, attempt)
                continue
            raise last_error

        if response.status_code >= 400:
            raise PageFetchError(
                rate_limit_message(response.status_code)
                if response.status_code in RETRYABLE_STATUS
                else f"Recipe import failed: {response.status_code} for url '{url}'",
                status_code=response.status_code,
            )

        html = response.text
        if _looks_like_challenge_page(html):
            last_error = PageFetchError(
                rate_limit_message(403),
                status_code=403,
            )
            if attempt + 1 < attempts:
                _sleep_before_retry(response.headers, attempt)
                continue
            raise last_error

        final_url = response.url
        try:
            extracted = extract_html_text(html)
        except ExtractError as error:
            raise PageFetchError(str(error)) from error
        return FetchedPage(
            extracted_text=extracted,
            final_url=final_url,
            image_url=extract_page_image_url(html, final_url),
            used_fallback=False,
        )

    assert last_error is not None
    raise last_error


def _get_page(url: str) -> _RawResponse:
    """Prefer Chrome TLS impersonation; fall back to plain httpx."""
    curl_response = _get_page_curl_cffi(url)
    if curl_response is not None:
        return curl_response
    return _get_page_httpx(url)


def _get_page_curl_cffi(url: str) -> _RawResponse | None:
    try:
        from curl_cffi import requests as curl_requests
    except ImportError:
        return None

    try:
        response = curl_requests.get(
            url,
            impersonate=CURL_CFFI_IMPERSONATE,
            timeout=DEFAULT_TIMEOUT_SECONDS,
            allow_redirects=True,
            headers={
                "Accept": BROWSER_HEADERS["Accept"],
                "Accept-Language": BROWSER_HEADERS["Accept-Language"],
            },
        )
    except Exception as error:  # noqa: BLE001 - fall back to httpx
        logger.info("curl_cffi fetch failed for %s (%s); using httpx", url, error)
        return None

    return _RawResponse(
        status_code=int(response.status_code),
        text=response.text or "",
        url=str(response.url),
        headers={str(key): str(value) for key, value in response.headers.items()},
    )


def _get_page_httpx(url: str) -> _RawResponse:
    timeout = httpx.Timeout(DEFAULT_TIMEOUT_SECONDS, connect=15.0)
    with httpx.Client(follow_redirects=True, timeout=timeout, headers=BROWSER_HEADERS) as client:
        response = client.get(url)
        return _RawResponse(
            status_code=response.status_code,
            text=response.text,
            url=str(response.url),
            headers=dict(response.headers),
        )


def _fetch_via_jina(url: str, *, settings: Settings) -> FetchedPage:
    timeout = httpx.Timeout(DEFAULT_TIMEOUT_SECONDS, connect=15.0)
    reader_url = f"{JINA_READER_PREFIX}{url}"
    try:
        with httpx.Client(follow_redirects=True, timeout=timeout, headers=JINA_HEADERS) as client:
            response = client.get(reader_url)
            response.raise_for_status()
            text = response.text.strip()
    except httpx.TimeoutException as error:
        raise PageFetchError("Recipe import timed out") from error
    except httpx.HTTPStatusError as error:
        raise PageFetchError(
            rate_limit_message(error.response.status_code)
            if error.response.status_code in RETRYABLE_STATUS
            else f"Recipe import failed: {error}",
            status_code=error.response.status_code,
        ) from error
    except httpx.HTTPError as error:
        raise PageFetchError(f"Recipe import failed: {error}") from error

    if not text:
        raise PageFetchError("Recipe import failed: empty reader response")
    if _looks_like_challenge_page(text):
        raise PageFetchError(rate_limit_message(403), status_code=403)

    image_url = _image_url_from_markdown(text, base_url=url)
    if not image_url:
        image_url = _fetch_image_via_microlink(url, settings=settings)
    return FetchedPage(
        extracted_text=text,
        final_url=url,
        image_url=image_url,
        used_fallback=True,
    )


def _fetch_image_via_microlink(url: str, *, settings: Settings) -> str | None:
    if not settings.page_fetch_fallback_enabled:
        return None
    timeout = httpx.Timeout(30.0, connect=10.0)
    try:
        with httpx.Client(follow_redirects=True, timeout=timeout) as client:
            response = client.get(MICROLINK_API, params={"url": url, "meta": "true"})
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError):
        return None

    if not isinstance(payload, dict) or payload.get("status") != "success":
        return None
    data = payload.get("data")
    if not isinstance(data, dict):
        return None
    image = data.get("image")
    if isinstance(image, str) and image.startswith(("http://", "https://")):
        return image
    if isinstance(image, dict):
        candidate = image.get("url")
        if isinstance(candidate, str) and candidate.startswith(("http://", "https://")):
            return candidate
    return None


def _image_url_from_markdown(text: str, *, base_url: str) -> str | None:
    for match in MARKDOWN_IMAGE_RE.finditer(text):
        candidate = match.group(1).strip()
        if candidate:
            resolved = extract_page_image_url(
                f'<meta property="og:image" content="{candidate}" />',
                base_url,
            )
            if resolved:
                return resolved
    for match in SOURCE_HTTP_URL_RE.finditer(text):
        candidate = match.group(0).rstrip(".,);]>\"'")
        lowered = candidate.lower()
        if any(lowered.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif")):
            return candidate
        if "images." in lowered or "/image" in lowered:
            return candidate
    return None


def _looks_like_challenge_page(text: str) -> bool:
    lowered = text[:4000].lower()
    return any(marker in lowered for marker in CHALLENGE_MARKERS)


def _sleep_before_retry(headers: dict[str, str], attempt: int) -> None:
    retry_after = headers.get("Retry-After") or headers.get("retry-after")
    delay: float
    if retry_after:
        try:
            delay = float(retry_after)
        except ValueError:
            delay = 2.0**attempt
    else:
        delay = 2.0**attempt
    time.sleep(min(delay, 30.0))


def _acquire_fetch_slot(settings: Settings):
    return _FetchSlot(settings)


class _FetchSlot:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def __enter__(self) -> None:
        global _fetch_slots, _fetch_slots_limit, _last_fetch_at
        limit = max(1, self._settings.page_fetch_concurrency)
        with _fetch_lock:
            if _fetch_slots is None or _fetch_slots_limit != limit:
                _fetch_slots = threading.Semaphore(limit)
                _fetch_slots_limit = limit
            slots = _fetch_slots
        slots.acquire()
        self._slots = slots
        interval = max(0.0, self._settings.page_fetch_min_interval_seconds)
        if interval:
            with _fetch_lock:
                wait = (_last_fetch_at + interval) - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            with _fetch_lock:
                _last_fetch_at = time.monotonic()

    def __exit__(self, exc_type, exc, tb) -> None:
        self._slots.release()


def reset_fetch_throttle_for_tests() -> None:
    """Reset throttle state between unit tests."""
    global _fetch_slots, _fetch_slots_limit, _last_fetch_at
    with _fetch_lock:
        _fetch_slots = None
        _fetch_slots_limit = None
        _last_fetch_at = 0.0
