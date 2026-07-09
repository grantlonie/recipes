from __future__ import annotations

import re
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import UploadFile

from app import cooklang
from app.catalog_match import apply_catalog_mapping
from app.config import Settings
from app.extract import (
    ExtractError,
    extract_html_text,
    extract_page_image_url,
    extract_text_from_path,
)
from app.fireworks_llm import LLMError, complete_cooklang
from app.import_context import build_system_prompt, build_user_message
from app.ingredients import IngredientRepository
from app.models import ImportPreview
from app.sources import ALLOWED_SOURCE_EXTENSIONS, AssetError

DEFAULT_TIMEOUT_SECONDS = 90.0
USER_AGENT = "recipes-app/0.1 (+https://github.com/cooklang/cooklang)"


class ImportError(RuntimeError):
    pass


def import_from_url(
    url: str,
    *,
    settings: Settings,
    ingredients: IngredientRepository,
) -> ImportPreview:
    recipe_url = url.strip()
    if not recipe_url:
        raise ImportError("Recipe URL is required")

    timeout = httpx.Timeout(DEFAULT_TIMEOUT_SECONDS, connect=15.0)
    headers = {"User-Agent": USER_AGENT}
    try:
        with httpx.Client(follow_redirects=True, timeout=timeout, headers=headers) as client:
            response = client.get(recipe_url)
            response.raise_for_status()
            html = response.text
            extracted = extract_html_text(html)
            image_url = extract_page_image_url(html, str(response.url))
    except httpx.TimeoutException as error:
        raise ImportError("Recipe import timed out") from error
    except httpx.HTTPError as error:
        raise ImportError(f"Recipe import failed: {error}") from error
    except ExtractError as error:
        raise ImportError(str(error)) from error

    return _import_extracted_text(
        extracted,
        source_url=recipe_url,
        image_url=image_url,
        settings=settings,
        ingredients=ingredients,
    )


def import_from_text(
    text: str,
    *,
    settings: Settings,
    ingredients: IngredientRepository,
    source_url: str | None = None,
) -> ImportPreview:
    stripped = text.strip()
    if not stripped:
        raise ImportError("Recipe text is required")
    return _import_extracted_text(
        stripped,
        source_url=source_url,
        settings=settings,
        ingredients=ingredients,
    )


def import_from_file(
    path: Path,
    *,
    settings: Settings,
    ingredients: IngredientRepository,
    source_path: str | None = None,
) -> ImportPreview:
    if not path.exists():
        raise ImportError("Source file not found")

    extension = path.suffix.lower()
    image_extensions = {".heic", ".jpeg", ".jpg", ".png", ".webp"}
    if extension in image_extensions:
        preview = _import_image_file(path, settings=settings, ingredients=ingredients)
    else:
        try:
            extracted = extract_text_from_path(path)
        except ExtractError as error:
            raise ImportError(str(error)) from error
        preview = _import_extracted_text(
            extracted,
            source_url=source_path,
            settings=settings,
            ingredients=ingredients,
        )

    if source_path and source_path.startswith("sources/"):
        metadata, body = cooklang.parse_document(preview.content)
        metadata["source"] = source_path
        if extension in image_extensions:
            metadata.setdefault("image", source_path)
        preview = preview.model_copy(
            update={"content": cooklang.render_document(metadata, body) + "\n"}
        )
    return preview


def import_from_slug_file(
    slug: str,
    *,
    settings: Settings,
    ingredients: IngredientRepository,
    sources_root: Path,
) -> ImportPreview:
    path = _find_source_file(sources_root, slug)
    if path is None:
        raise ImportError("No source file found for recipe")
    source_path = f"sources/{slug}/{path.name}"
    return import_from_file(
        path,
        settings=settings,
        ingredients=ingredients,
        source_path=source_path,
    )


async def import_from_upload(
    upload: UploadFile,
    *,
    settings: Settings,
    ingredients: IngredientRepository,
) -> ImportPreview:
    filename = (upload.filename or "upload").strip()
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_SOURCE_EXTENSIONS:
        raise ImportError(f"Unsupported file type: {extension or 'unknown'}")

    data = await upload.read()
    if not data:
        raise ImportError("Uploaded file is empty")

    with tempfile.NamedTemporaryFile(suffix=extension, delete=False) as handle:
        handle.write(data)
        temp_path = Path(handle.name)

    try:
        return import_from_file(temp_path, settings=settings, ingredients=ingredients)
    except AssetError as error:
        raise ImportError(str(error)) from error
    finally:
        temp_path.unlink(missing_ok=True)


def suggest_slug(url: str, content: str) -> str:
    title_match = re.search(r"^title:\s*(?P<title>.+)$", content, re.MULTILINE)
    if title_match:
        return slugify(title_match.group("title"))

    if url.startswith(("http://", "https://")):
        path = urlparse(url).path.strip("/").split("/")[-1]
        return slugify(path or "imported-recipe")

    return slugify(Path(url).stem or "imported-recipe")


def slugify(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return normalized or "imported-recipe"


def _import_image_file(
    path: Path,
    *,
    settings: Settings,
    ingredients: IngredientRepository,
) -> ImportPreview:
    system_prompt = build_system_prompt()
    user_message = build_user_message(
        "The recipe is provided as an image. Extract the recipe faithfully.",
        max_chars=settings.import_max_source_chars,
    )
    try:
        raw = complete_cooklang(
            settings=settings,
            system_prompt=system_prompt,
            user_message=user_message,
            image_path=path,
        )
    except LLMError as error:
        raise ImportError(str(error)) from error
    return _finalize_import(raw, source_url=None, settings=settings, ingredients=ingredients)


def _import_extracted_text(
    extracted_text: str,
    *,
    source_url: str | None,
    image_url: str | None = None,
    settings: Settings,
    ingredients: IngredientRepository,
) -> ImportPreview:
    system_prompt = build_system_prompt()
    user_message = build_user_message(
        extracted_text,
        source_url=source_url,
        max_chars=settings.import_max_source_chars,
    )
    try:
        raw = complete_cooklang(
            settings=settings,
            system_prompt=system_prompt,
            user_message=user_message,
        )
    except LLMError as error:
        raise ImportError(str(error)) from error

    if not _is_valid_import(raw):
        try:
            raw = complete_cooklang(
                settings=settings,
                system_prompt=system_prompt,
                user_message=(
                    f"{user_message}\n\n"
                    "The previous output was invalid Cooklang. "
                    "Return only valid Cooklang with YAML front matter."
                ),
                model=settings.import_model_repair,
            )
        except LLMError as error:
            raise ImportError(str(error)) from error

    return _finalize_import(
        raw,
        source_url=source_url,
        image_url=image_url,
        settings=settings,
        ingredients=ingredients,
    )


def _finalize_import(
    raw: str,
    *,
    source_url: str | None,
    image_url: str | None = None,
    settings: Settings,
    ingredients: IngredientRepository,
) -> ImportPreview:
    if not _is_valid_import(raw):
        raise ImportError("Imported content is not valid Cooklang")

    metadata, body = cooklang.parse_document(raw)
    if source_url and cooklang.is_ref_url(source_url):
        metadata["source"] = source_url
    elif source_url and cooklang.is_ref_file(source_url):
        metadata["source"] = source_url
    if image_url and cooklang.is_ref_url(image_url):
        metadata["image"] = image_url

    content = cooklang.render_document(metadata, body)
    content = cooklang.prepare_imported_content(content)
    metadata, body = cooklang.parse_document(content)
    mapped_body, unmatched = apply_catalog_mapping(body, ingredients)
    content = cooklang.prepare_imported_content(cooklang.render_document(metadata, mapped_body))

    slug_source = source_url or metadata.get("title", "imported-recipe")
    if isinstance(slug_source, str) and cooklang.is_ref_file(slug_source):
        slug_source = Path(slug_source).parent.name
    suggested_slug = suggest_slug(str(slug_source), content)
    return ImportPreview(
        content=content + "\n",
        suggested_slug=suggested_slug,
        unmatched_ingredients=sorted(set(unmatched), key=str.casefold),
    )


def _is_valid_import(content: str) -> bool:
    metadata, body = cooklang.parse_document(content.strip())
    if not metadata.get("title"):
        return False
    if not body.strip():
        return False
    try:
        cooklang.validate_document_refs(metadata)
    except ValueError:
        return False
    return True


def _find_source_file(sources_root: Path, slug: str) -> Path | None:
    assets_dir = sources_root / slug
    if not assets_dir.exists():
        return None
    matches = sorted(assets_dir.glob("source.*"))
    return matches[0] if matches else None
