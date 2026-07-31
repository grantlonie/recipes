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
IMAGE_SCRAPE_TIMEOUT_SECONDS = 8.0
JINA_IMAGE_TIMEOUT_SECONDS = 45.0
JINA_READER_PREFIX = "https://r.jina.ai/"
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
# Request full HTML so og:image / JSON-LD extraction stays on the shared path.
JINA_HEADERS = {
    "Accept": "text/html,*/*;q=0.8",
    "User-Agent": "recipes-importer/1.0",
    "X-Respond-With": "html",
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
            try:
                return _fetch_via_jina(recipe_url, settings=settings)
            except PageFetchError as fallback_error:
                logger.warning(
                    "Reader fallback failed for %s (%s); surfacing original error",
                    recipe_url,
                    fallback_error,
                )
                # Prefer the site-facing error over raw r.jina.ai auth failures.
                raise error from fallback_error


@dataclass(frozen=True)
class ImageScrapeResult:
    blocked: bool = False
    error: str | None = None
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

    blocked = response.status_code in RETRYABLE_STATUS or _looks_like_challenge_page(
        response.text
    )
    if blocked:
        blocked_result = ImageScrapeResult(
            blocked=True,
            error=f"status={response.status_code}",
            status_code=response.status_code or 403,
        )
        if (
            settings is not None
            and settings.page_fetch_fallback_enabled
            and settings.jina_api_key.strip()
        ):
            fallback = _image_via_jina(page_url, settings=settings)
            if fallback.image_url or not fallback.blocked:
                return fallback
        return blocked_result
    if response.status_code >= 400:
        return ImageScrapeResult(
            error=f"status={response.status_code}",
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
            "Reader fallback needs authentication. Set JINA_API_KEY in the server "
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


def _jina_request_headers(settings: Settings) -> dict[str, str]:
    headers = dict(JINA_HEADERS)
    api_key = settings.jina_api_key.strip()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
        # Hosted proxy pool (residential/datacenter rotation); requires API key.
        headers["X-Proxy"] = "auto"
    return headers


def _fetch_jina_html(
    url: str, *, settings: Settings, timeout_seconds: float
) -> str:
    timeout = httpx.Timeout(timeout_seconds, connect=min(15.0, timeout_seconds))
    reader_url = f"{JINA_READER_PREFIX}{url}"
    headers = _jina_request_headers(settings)
    try:
        with httpx.Client(follow_redirects=True, timeout=timeout, headers=headers) as client:
            response = client.get(reader_url)
            response.raise_for_status()
            text = response.text.strip()
    except httpx.TimeoutException as error:
        raise PageFetchError("Recipe import timed out") from error
    except httpx.HTTPStatusError as error:
        status = error.response.status_code
        if status in RETRYABLE_STATUS or status == 401:
            raise PageFetchError(rate_limit_message(status), status_code=status) from error
        raise PageFetchError(
            f"Recipe import failed: {error}",
            status_code=status,
        ) from error
    except httpx.HTTPError as error:
        raise PageFetchError(f"Recipe import failed: {error}") from error

    if not text:
        raise PageFetchError("Recipe import failed: empty reader response")
    if _looks_like_challenge_page(text):
        raise PageFetchError(rate_limit_message(403), status_code=403)
    return text


def _fetch_via_jina(url: str, *, settings: Settings) -> FetchedPage:
    html = _fetch_jina_html(url, settings=settings, timeout_seconds=DEFAULT_TIMEOUT_SECONDS)
    try:
        extracted = extract_html_text(html)
    except ExtractError as error:
        raise PageFetchError(str(error)) from error
    return FetchedPage(
        extracted_text=extracted,
        final_url=url,
        image_url=extract_page_image_url(html, url),
        used_fallback=True,
    )


def _image_via_jina(url: str, *, settings: Settings) -> ImageScrapeResult:
    logger.info("Direct image scrape blocked for %s; trying Jina HTML fallback", url)
    try:
        html = _fetch_jina_html(
            url, settings=settings, timeout_seconds=JINA_IMAGE_TIMEOUT_SECONDS
        )
    except PageFetchError as error:
        logger.warning("Jina image fallback failed for %s (%s)", url, error)
        return ImageScrapeResult(
            blocked=True,
            error=str(error),
            status_code=error.status_code or 403,
        )
    except Exception as error:  # noqa: BLE001 - image scrape is best-effort
        logger.warning("Jina image fallback failed for %s (%s)", url, error)
        return ImageScrapeResult(blocked=True, error=str(error), status_code=403)

    image_url = extract_page_image_url(html, url)
    if not image_url:
        return ImageScrapeResult(error="no og:image", status_code=200)
    return ImageScrapeResult(image_url=image_url, status_code=200)


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
