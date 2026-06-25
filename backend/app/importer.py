import re
import subprocess
from urllib.parse import urlparse

from app.models import ImportPreview


class ImportError(RuntimeError):
    pass


def import_from_url(url: str) -> ImportPreview:
    try:
        result = subprocess.run(
            ["cooklang-import", url],
            capture_output=True,
            check=False,
            text=True,
            timeout=90,
        )
    except FileNotFoundError as error:
        raise ImportError("cooklang-import is not installed in the server image") from error
    except subprocess.TimeoutExpired as error:
        raise ImportError("Recipe import timed out") from error

    if result.returncode != 0:
        detail = result.stderr.strip() or "Recipe import failed"
        raise ImportError(detail)

    content = result.stdout.strip()
    if not content:
        raise ImportError("Recipe import returned empty content")

    return ImportPreview(content=content + "\n", suggested_slug=suggest_slug(url, content))


def suggest_slug(url: str, content: str) -> str:
    title_match = re.search(r"^title:\s*(?P<title>.+)$", content, re.MULTILINE)
    if title_match:
        return slugify(title_match.group("title"))

    path = urlparse(url).path.strip("/").split("/")[-1]
    return slugify(path or "imported-recipe")


def slugify(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return normalized or "imported-recipe"
