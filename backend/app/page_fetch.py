from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

from app.config import Settings
from app.extract import ExtractError, extract_html_text, extract_page_image_url

DEFAULT_TIMEOUT_SECONDS = 90.0
IMAGE_SCRAPE_TIMEOUT_SECONDS = 8.0
IFRAMELY_TIMEOUT_SECONDS = 45.0
IFRAMELY_API_URL = "https://iframe.ly/api/iframely"
RETRYABLE_STATUS = frozenset({403, 429})
GONE_STATUS = frozenset({404, 410})
IFRAMELY_PAUSE_STATUS = frozenset({401, 402, 403, 429})
IFRAMELY_GONE_MARKERS = ("no longer available",)
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

SOURCE_HTTP_URL_RE = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)
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
    # Drop trailing punctuation and URL fragments (#comments).
    return match.group(0).rstrip(".,);]>\"'").split("#", 1)[0]


def fetch_recipe_page(url: str, *, settings: Settings) -> FetchedPage:
    """Fetch a recipe page with retry/backoff (no HTML reader fallback)."""
    recipe_url = url.strip()
    if not recipe_url:
        raise PageFetchError("Recipe URL is required")

    with _acquire_fetch_slot(settings):
        return _fetch_direct(recipe_url, settings=settings)


@dataclass(frozen=True)
class ImageScrapeResult:
    blocked: bool = False
    error: str | None = None
    # Page is permanently missing (404/410); give up on this recipe without retries.
    gone: bool = False
    image_url: str | None = None
    status_code: int | None = None


def fetch_page_image_url(url: str, *, settings: Settings) -> str | None:
    """Fetch HTML once and read og:image / twitter:image / JSON-LD image."""
    return fetch_page_image_result(url, settings=settings).image_url


def fetch_page_image_result(url: str, *, settings: Settings | None = None) -> ImageScrapeResult:
    """Fetch HTML once and read image meta; returns status for queue backoff."""
    page_url = url.strip().split("#", 1)[0]
    if not page_url:
        return ImageScrapeResult(error="empty url")

    try:
        response = _get_page(page_url, timeout_seconds=IMAGE_SCRAPE_TIMEOUT_SECONDS)
    except Exception as error:  # noqa: BLE001 - image scrape is best-effort
        return ImageScrapeResult(error=str(error))

    blocked = response.status_code in RETRYABLE_STATUS or _looks_like_challenge_page(response.text)
    if blocked:
        blocked_result = ImageScrapeResult(
            blocked=True,
            error=f"status={response.status_code}",
            status_code=response.status_code or 403,
        )
        if (
            settings is not None
            and settings.page_fetch_fallback_enabled
            and settings.iframely_api_key.strip()
        ):
            return _image_via_iframely(page_url, settings=settings)
        return blocked_result
    if response.status_code >= 400:
        return ImageScrapeResult(
            error=f"status={response.status_code}",
            gone=response.status_code in GONE_STATUS,
            status_code=response.status_code,
        )

    image_url = extract_page_image_url(response.text, response.url or page_url)
    if not image_url:
        return ImageScrapeResult(error="no og:image", status_code=response.status_code)
    return ImageScrapeResult(image_url=image_url, status_code=response.status_code)


def rate_limit_message(status_code: int | None = None) -> str:
    if status_code == 429:
        return "This site is rate-limiting imports right now; try again in a few minutes."
    if status_code == 403:
        return (
            "This site blocked automated access. Try copying the recipe text "
            "or saving the page and importing the HTML file instead."
        )
    if status_code == 401:
        return (
            "Image fallback needs authentication. Set IFRAMELY_API_KEY in the server "
            "environment, or import via pasted text/HTML instead."
        )
    return "Recipe import failed"


def _fetch_direct(url: str, *, settings: Settings) -> FetchedPage:
    attempts = max(1, settings.page_fetch_max_retries + 1)
    last_error: PageFetchError | None = None

    for attempt in range(attempts):
        try:
            response = _get_page(url, timeout_seconds=DEFAULT_TIMEOUT_SECONDS)
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


def _get_page(url: str, *, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS) -> _RawResponse:
    """Prefer Chrome TLS impersonation; fall back to plain httpx."""
    curl_response = _get_page_curl_cffi(url, timeout_seconds=timeout_seconds)
    if curl_response is not None:
        return curl_response
    return _get_page_httpx(url, timeout_seconds=timeout_seconds)


def _get_page_curl_cffi(
    url: str, *, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS
) -> _RawResponse | None:
    try:
        from curl_cffi import requests as curl_requests
    except ImportError:
        return None

    try:
        response = curl_requests.get(
            url,
            impersonate=CURL_CFFI_IMPERSONATE,
            timeout=timeout_seconds,
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


def _get_page_httpx(url: str, *, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS) -> _RawResponse:
    timeout = httpx.Timeout(timeout_seconds, connect=min(15.0, timeout_seconds))
    with httpx.Client(follow_redirects=True, timeout=timeout, headers=BROWSER_HEADERS) as client:
        response = client.get(url)
        return _RawResponse(
            status_code=response.status_code,
            text=response.text,
            url=str(response.url),
            headers=dict(response.headers),
        )


def _image_via_iframely(url: str, *, settings: Settings) -> ImageScrapeResult:
    logger.info("Direct image scrape blocked for %s; trying Iframely fallback", url)
    api_key = settings.iframely_api_key.strip()
    if not api_key:
        return ImageScrapeResult(blocked=True, error="missing IFRAMELY_API_KEY", status_code=401)

    params = urlencode({"url": url, "api_key": api_key})
    request_url = f"{IFRAMELY_API_URL}?{params}"
    timeout = httpx.Timeout(IFRAMELY_TIMEOUT_SECONDS, connect=min(15.0, IFRAMELY_TIMEOUT_SECONDS))
    try:
        with httpx.Client(follow_redirects=True, timeout=timeout) as client:
            response = client.get(request_url)
    except httpx.TimeoutException:
        logger.warning("Iframely image fallback timed out for %s", url)
        return ImageScrapeResult(blocked=True, error="iframely timeout", status_code=408)
    except httpx.HTTPError as error:
        logger.warning("Iframely image fallback failed for %s (%s)", url, error)
        return ImageScrapeResult(blocked=True, error=str(error), status_code=403)

    if response.status_code in IFRAMELY_PAUSE_STATUS:
        logger.warning(
            "Iframely image fallback blocked for %s (status=%s)", url, response.status_code
        )
        return ImageScrapeResult(
            blocked=True,
            error=f"iframely status={response.status_code}",
            status_code=response.status_code,
        )
    if response.status_code in GONE_STATUS:
        logger.warning("Iframely reports page gone for %s (status=%s)", url, response.status_code)
        return ImageScrapeResult(
            error=f"iframely status={response.status_code}",
            gone=True,
            status_code=response.status_code,
        )
    if response.status_code >= 400:
        logger.warning(
            "Iframely image fallback failed for %s (status=%s)", url, response.status_code
        )
        return ImageScrapeResult(
            blocked=True,
            error=f"iframely status={response.status_code}",
            status_code=response.status_code,
        )

    try:
        payload = response.json()
    except ValueError:
        return ImageScrapeResult(blocked=True, error="iframely invalid json", status_code=502)

    if isinstance(payload, dict) and payload.get("error"):
        error = payload.get("error")
        message = error if isinstance(error, str) else str(error)
        try:
            payload_status = int(payload.get("status") or 0)
        except (TypeError, ValueError):
            payload_status = 0
        if payload_status in GONE_STATUS or any(
            marker in message.lower() for marker in IFRAMELY_GONE_MARKERS
        ):
            logger.warning("Iframely reports page gone for %s (%s)", url, message)
            return ImageScrapeResult(
                error=f"iframely: {message}",
                gone=True,
                status_code=payload_status or 404,
            )
        logger.warning("Iframely image fallback error for %s (%s)", url, message)
        return ImageScrapeResult(
            blocked=True,
            error=f"iframely: {message}",
            status_code=payload_status or 403,
        )

    image_url = _image_url_from_iframely(payload if isinstance(payload, dict) else {})
    if not image_url:
        return ImageScrapeResult(error="no iframely thumbnail", status_code=200)
    return ImageScrapeResult(image_url=image_url, status_code=200)


def _image_url_from_iframely(payload: dict) -> str | None:
    links = payload.get("links")
    if isinstance(links, dict):
        for key in ("thumbnail", "image"):
            items = links.get(key)
            if isinstance(items, dict):
                items = [items]
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                href = item.get("href")
                if isinstance(href, str) and href.startswith(("http://", "https://")):
                    return href.strip()

    meta = payload.get("meta")
    if isinstance(meta, dict):
        for key in ("image", "thumbnail", "og_image"):
            value = meta.get(key)
            if isinstance(value, str) and value.startswith(("http://", "https://")):
                return value.strip()
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
