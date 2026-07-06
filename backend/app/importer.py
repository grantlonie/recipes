import base64
import html
import re
import time
from urllib.parse import urlparse

import httpx

from app import cooklang
from app.models import ImportPreview

COOK_MD_BASE_URL = "https://cook.md"
COOK_CODE_RE = re.compile(
    r'<code id="cook-code" class="language-cooklang">(.*?)</code>',
    re.DOTALL,
)
STREAM_NAME_RE = re.compile(r'signed-stream-name="([^"]+)"')
DEFAULT_POLL_INTERVAL_SECONDS = 5.0
DEFAULT_TIMEOUT_SECONDS = 90.0
USER_AGENT = "recipes-app/0.1 (+https://github.com/cooklang/cooklang)"


class ImportError(RuntimeError):
    pass


def import_from_url(url: str) -> ImportPreview:
    recipe_url = url.strip()
    if not recipe_url:
        raise ImportError("Recipe URL is required")

    timeout = httpx.Timeout(DEFAULT_TIMEOUT_SECONDS, connect=15.0)
    headers = {"User-Agent": USER_AGENT}

    try:
        with httpx.Client(follow_redirects=True, timeout=timeout, headers=headers) as client:
            return _import_with_client(recipe_url, client)
    except httpx.TimeoutException as error:
        raise ImportError("Recipe import timed out") from error
    except httpx.HTTPError as error:
        raise ImportError(f"Recipe import failed: {error}") from error


def _import_with_client(recipe_url: str, client: httpx.Client) -> ImportPreview:
    cookmd_url = f"{COOK_MD_BASE_URL}/{recipe_url}"
    cookification_id = _start_cookification(client, cookmd_url)
    content = _poll_for_cooklang(client, cookification_id)

    content = content.strip()
    if not content:
        raise ImportError("Recipe import returned empty content")

    content = cooklang.prepare_imported_content(content)
    return ImportPreview(content=content + "\n", suggested_slug=suggest_slug(recipe_url, content))


def _start_cookification(client: httpx.Client, cookmd_url: str) -> str:
    response = client.get(cookmd_url)
    response.raise_for_status()

    stream_match = STREAM_NAME_RE.search(response.text)
    if not stream_match:
        raise ImportError("Could not start recipe import on cook.md")

    payload = stream_match.group(1).split("--", maxsplit=1)[0]
    padding = "=" * (-len(payload) % 4)
    try:
        stream_name = base64.b64decode(payload + padding).decode().strip().strip('"')
    except (ValueError, UnicodeDecodeError) as error:
        raise ImportError("Could not read cook.md import session") from error

    if not stream_name.startswith("cookification:"):
        raise ImportError("Unexpected cook.md import session")

    cookification_id = stream_name.split(":", maxsplit=1)[1].strip()
    if not cookification_id:
        raise ImportError("Could not read cook.md import session")

    return cookification_id


def _poll_for_cooklang(client: httpx.Client, cookification_id: str) -> str:
    poll_url = f"{COOK_MD_BASE_URL}/cookifies/{cookification_id}"
    deadline = time.monotonic() + DEFAULT_TIMEOUT_SECONDS

    while time.monotonic() < deadline:
        response = client.get(poll_url)
        response.raise_for_status()

        content = _extract_cooklang(response.text)
        if content:
            return content

        time.sleep(DEFAULT_POLL_INTERVAL_SECONDS)

    raise ImportError("Recipe import timed out waiting for cook.md")


def _extract_cooklang(page_html: str) -> str:
    match = COOK_CODE_RE.search(page_html)
    if not match:
        return ""

    return html.unescape(match.group(1).strip())


def suggest_slug(url: str, content: str) -> str:
    title_match = re.search(r"^title:\s*(?P<title>.+)$", content, re.MULTILINE)
    if title_match:
        return slugify(title_match.group("title"))

    path = urlparse(url).path.strip("/").split("/")[-1]
    return slugify(path or "imported-recipe")


def slugify(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return normalized or "imported-recipe"
