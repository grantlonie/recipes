from __future__ import annotations

import json
import re
from html import unescape
from pathlib import Path
from urllib.parse import urljoin, urlparse

SUPPORTED_EXTENSIONS = {
    ".docx",
    ".htm",
    ".html",
    ".md",
    ".markdown",
    ".pdf",
    ".txt",
}
DEFAULT_EXTENSIONS = sorted(SUPPORTED_EXTENSIONS)


class ExtractError(ValueError):
    pass


def extract_text_from_path(path: Path) -> str:
    extension = path.suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise ExtractError(f"Unsupported file extension: {extension or 'none'}")
    raw = path.read_bytes()
    return extract_text_from_bytes(raw, extension, path.name)


def extract_text_from_bytes(data: bytes, extension: str, filename: str = "upload") -> str:
    extension = extension.lower()
    if extension == ".txt":
        return _decode_text(data)
    if extension in {".md", ".markdown"}:
        return _decode_text(data)
    if extension in {".html", ".htm"}:
        return extract_html_text(_decode_text(data))
    if extension == ".pdf":
        return extract_pdf_text(data)
    if extension == ".docx":
        return extract_docx_text(data)
    raise ExtractError(f"Unsupported file extension: {extension}")


def extract_html_text(html: str) -> str:
    try:
        import trafilatura

        extracted = trafilatura.extract(html, include_comments=False, include_tables=True)
        if extracted and extracted.strip():
            return extracted.strip()
    except Exception:
        pass
    text = re.sub(r"(?is)<script.*?>.*?</script>", " ", html)
    text = re.sub(r"(?is)<style.*?>.*?</style>", " ", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = unescape(re.sub(r"\s+", " ", text)).strip()
    if not text:
        raise ExtractError("Could not extract text from HTML")
    return text


def extract_page_image_url(html: str, page_url: str) -> str | None:
    for candidate in _iter_page_image_candidates(html):
        resolved = _resolve_url(candidate, page_url)
        if resolved and _is_usable_image_url(resolved):
            return resolved
    return None


def _iter_page_image_candidates(html: str):
    yield from _meta_image_candidates(html)
    yield from _json_ld_image_candidates(html)
    yield from _content_image_candidates(html)


def _meta_image_candidates(html: str):
    for match in re.finditer(r"(?is)<meta\s+([^>]+)>", html):
        attrs = _parse_tag_attributes(match.group(1))
        content = attrs.get("content", "").strip()
        if not content:
            continue
        prop = attrs.get("property", "").lower()
        name = attrs.get("name", "").lower()
        if prop in {"og:image", "og:image:url", "og:image:secure_url"}:
            yield content
        elif name in {"twitter:image", "twitter:image:src"}:
            yield content
        elif attrs.get("rel", "").lower() == "image_src":
            yield attrs.get("href", "").strip() or content


def _json_ld_image_candidates(html: str):
    for match in re.finditer(
        r'(?is)<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
    ):
        payload = match.group(1).strip()
        if not payload:
            continue
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            continue
        yield from _recipe_images_from_json_ld(data)


def _recipe_images_from_json_ld(data: object):
    if isinstance(data, list):
        for item in data:
            yield from _recipe_images_from_json_ld(item)
        return

    if not isinstance(data, dict):
        return

    graph = data.get("@graph")
    if isinstance(graph, list):
        yield from _recipe_images_from_json_ld(graph)

    if _json_ld_type_is_recipe(data.get("@type")):
        yield from _normalize_image_field(data.get("image"))

    for value in data.values():
        if isinstance(value, (dict, list)):
            yield from _recipe_images_from_json_ld(value)


def _json_ld_type_is_recipe(value: object) -> bool:
    if isinstance(value, str):
        return value.lower() == "recipe"
    if isinstance(value, list):
        return any(isinstance(item, str) and item.lower() == "recipe" for item in value)
    return False


def _normalize_image_field(value: object):
    if isinstance(value, str):
        stripped = value.strip()
        if stripped:
            yield stripped
        return

    if isinstance(value, list):
        for item in value:
            yield from _normalize_image_field(item)
        return

    if isinstance(value, dict):
        for key in ("url", "contentUrl", "@id"):
            nested = value.get(key)
            if isinstance(nested, str) and nested.strip():
                yield nested.strip()


def _content_image_candidates(html: str):
    containers: list[str] = []
    for pattern in (
        r"(?is)<article[^>]*>(.*?)</article>",
        r'(?is)<[^>]+class=["\'][^"\']*recipe[^"\']*["\'][^>]*>(.*?)</[^>]+>',
        r"(?is)<main[^>]*>(.*?)</main>",
    ):
        containers.extend(match.group(1) for match in re.finditer(pattern, html))

    search_html = containers[0] if containers else html
    ranked: list[tuple[int, str]] = []
    for match in re.finditer(r"(?is)<img\s+([^>]+)>", search_html):
        attrs = _parse_tag_attributes(match.group(1))
        src = _img_source(attrs)
        if not src:
            continue
        ranked.append((_image_priority(attrs, src), src))

    for _, src in sorted(ranked, key=lambda item: item[0], reverse=True):
        yield src


def _img_source(attrs: dict[str, str]) -> str:
    for key in ("src", "data-src", "data-lazy-src", "data-original"):
        value = attrs.get(key, "").strip()
        if value:
            return value
    srcset = attrs.get("srcset", "").strip()
    if srcset:
        first = srcset.split(",")[0].strip().split()[0]
        if first:
            return first
    return ""


def _image_priority(attrs: dict[str, str], src: str) -> int:
    score = 0
    width = _parse_dimension(attrs.get("width", ""))
    height = _parse_dimension(attrs.get("height", ""))
    if width and height:
        score += min(width, height)
    lowered = src.lower()
    if any(token in lowered for token in ("hero", "featured", "title", "lead", "main")):
        score += 250
    if any(token in lowered for token in ("thumb", "thumbnail", "icon", "logo", "avatar")):
        score -= 500
    return score


def _parse_dimension(value: str) -> int | None:
    match = re.search(r"\d+", value)
    if not match:
        return None
    try:
        return int(match.group(0))
    except ValueError:
        return None


def _parse_tag_attributes(raw: str) -> dict[str, str]:
    attrs: dict[str, str] = {}
    for match in re.finditer(r'''([\w:.-]+)\s*=\s*["']([^"']*)["']''', raw):
        attrs[match.group(1).lower()] = unescape(match.group(2))
    return attrs


def _resolve_url(candidate: str, page_url: str) -> str | None:
    stripped = candidate.strip()
    if not stripped or stripped.startswith("#"):
        return None
    if stripped.startswith(("http://", "https://")):
        return stripped
    if stripped.startswith("//"):
        parsed = urlparse(page_url)
        scheme = parsed.scheme or "https"
        return f"{scheme}:{stripped}"
    return urljoin(page_url, stripped)


def _is_usable_image_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return False

    lowered = url.lower()
    blocked_tokens = (
        "favicon",
        "sprite",
        "pixel",
        "spacer",
        "tracking",
        "analytics",
        "doubleclick",
        "gravatar",
        "emoji",
        "badge",
        "advert",
        "adservice",
        "/ad/",
        "logo",
        "icon",
        "avatar",
    )
    if any(token in lowered for token in blocked_tokens):
        return False

    path = parsed.path.lower()
    if path.endswith(".svg"):
        return False
    return True


def extract_pdf_text(data: bytes) -> str:
    from pypdf import PdfReader
    from io import BytesIO

    reader = PdfReader(BytesIO(data))
    pages = [page.extract_text() or "" for page in reader.pages]
    text = "\n".join(page.strip() for page in pages if page.strip())
    if not text.strip():
        raise ExtractError("Could not extract text from PDF")
    return text.strip()


def extract_docx_text(data: bytes) -> str:
    from docx import Document
    from io import BytesIO

    document = Document(BytesIO(data))
    paragraphs = [paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip()]
    if not paragraphs:
        raise ExtractError("Could not extract text from DOCX")
    return "\n".join(paragraphs)


def _decode_text(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ExtractError("Could not decode text file")
