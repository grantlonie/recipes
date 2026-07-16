from __future__ import annotations

import asyncio
import logging
import re
import tempfile
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
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
from app.import_context import (
    build_quality_repair_message,
    build_system_prompt,
    build_user_message,
)
from app.import_validate import validate_imported_cooklang
from app.ingredients import IngredientRepository
from app.models import ImportPreview
from app.sources import ALLOWED_SOURCE_EXTENSIONS, AssetError
from app.units import prefers_fluid_volume

DEFAULT_TIMEOUT_SECONDS = 90.0
logger = logging.getLogger(__name__)
SOURCE_HTTP_URL_RE = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)
BROWSER_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
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


class ImportError(RuntimeError):
    pass


@dataclass
class ImportTrace:
    notes: list[str] = field(default_factory=list)
    started_monotonic: float = field(default_factory=time.monotonic)
    started_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def add(self, note: str) -> None:
        text = note.strip()
        if text:
            self.notes.append(text)


def _model_label(model: str) -> str:
    return model.rsplit("/", 1)[-1]


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
    try:
        with httpx.Client(
            follow_redirects=True, timeout=timeout, headers=BROWSER_HEADERS
        ) as client:
            response = client.get(recipe_url)
            response.raise_for_status()
            html = response.text
            extracted = extract_html_text(html)
            image_url = extract_page_image_url(html, str(response.url))
    except httpx.TimeoutException as error:
        raise ImportError("Recipe import timed out") from error
    except httpx.HTTPStatusError as error:
        raise ImportError(_fetch_error_message(error)) from error
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
    page_image_url: str | None = None
    if extension in image_extensions:
        preview = _import_image_file(path, settings=settings, ingredients=ingredients)
    else:
        try:
            if extension in {".html", ".htm"}:
                html = path.read_text(encoding="utf-8", errors="replace")
                extracted = extract_html_text(html)
                page_image_url = extract_page_image_url(html, source_path or path.name)
            else:
                extracted = extract_text_from_path(path)
        except ExtractError as error:
            raise ImportError(str(error)) from error
        if not page_image_url:
            page_image_url = _image_url_from_source_text(extracted)
        preview = _import_extracted_text(
            extracted,
            source_url=source_path,
            image_url=page_image_url,
            settings=settings,
            ingredients=ingredients,
        )

    if source_path and cooklang.is_ref_file(source_path):
        metadata, body = cooklang.parse_document(preview.content)
        metadata["source"] = cooklang.normalize_ref_value(source_path)
        if extension in image_extensions:
            metadata.setdefault("image", cooklang.normalize_ref_value(source_path))
        content = cooklang.render_document(metadata, body) + "\n"
        preview = preview.model_copy(
            update={
                "content": content,
                "image_url": cooklang.metadata_image_url(metadata) or preview.image_url,
            }
        )
    return preview


def import_from_slug_file(
    slug: str,
    *,
    settings: Settings,
    ingredients: IngredientRepository,
    recipe_root: Path,
) -> ImportPreview:
    path = _find_source_file(recipe_root, slug)
    if path is None:
        raise ImportError("No source file found for recipe")
    return import_from_file(
        path,
        settings=settings,
        ingredients=ingredients,
        source_path=path.name,
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
        # Run blocking LLM/file work off the event loop so concurrent bulk
        # uploads can progress in parallel under a single uvicorn worker.
        return await asyncio.to_thread(
            import_from_file,
            temp_path,
            settings=settings,
            ingredients=ingredients,
        )
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
    trace = ImportTrace()
    primary_model = settings.import_model_vision
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
    raw = cooklang.sanitize_front_matter(raw)
    raw, heal_notes = cooklang.heal_imported_cooklang(raw)
    for note in heal_notes:
        trace.add(note)
    trace.add(
        f"pass1: {_model_label(primary_model)} (vision)"
        + (" (healed locally)" if heal_notes else "")
    )
    return _with_import_metadata(
        _finalize_import(
            raw,
            source_url=None,
            settings=settings,
            ingredients=ingredients,
            source_text=None,
        ),
        trace=trace,
    )


def _import_extracted_text(
    extracted_text: str,
    *,
    source_url: str | None,
    image_url: str | None = None,
    settings: Settings,
    ingredients: IngredientRepository,
) -> ImportPreview:
    trace = ImportTrace()
    primary_model = settings.import_model_text
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

    raw = cooklang.sanitize_front_matter(raw)
    raw, heal_notes = cooklang.heal_imported_cooklang(
        raw,
        source_text=extracted_text,
    )
    for note in heal_notes:
        trace.add(note)

    if not _is_valid_import(raw):
        reason = _invalid_import_reason(raw)
        _log_advanced_processing(
            f"invalid Cooklang on first pass ({reason})",
            content=raw,
            source_url=source_url,
        )
        repair_model = settings.import_model_repair
        trace.add(
            f"pass2: invalid Cooklang after {_model_label(primary_model)} ({reason}); "
            f"repair via {_model_label(repair_model)}"
        )
        try:
            raw = complete_cooklang(
                settings=settings,
                system_prompt=system_prompt,
                user_message=(
                    f"{user_message}\n\n"
                    "The previous output was invalid Cooklang. "
                    "Return only valid Cooklang with YAML front matter. "
                    'Front matter must start with title: "Recipe Name".'
                ),
                model=repair_model,
            )
        except LLMError as error:
            raise ImportError(str(error)) from error
        raw = cooklang.sanitize_front_matter(raw)
        raw, repair_heal_notes = cooklang.heal_imported_cooklang(
            raw,
            source_text=extracted_text,
        )
        for note in repair_heal_notes:
            trace.add(note)
    else:
        if not any(note.startswith("pass1:") for note in trace.notes):
            label = f"pass1: {_model_label(primary_model)}"
            if heal_notes:
                label += " (healed locally)"
            trace.add(label)

    preview = _finalize_import(
        raw,
        source_url=source_url,
        image_url=image_url,
        settings=settings,
        ingredients=ingredients,
        source_text=extracted_text,
    )
    return _with_import_metadata(
        _maybe_quality_repair(
            preview,
            extracted_text=extracted_text,
            source_url=source_url,
            image_url=image_url,
            settings=settings,
            ingredients=ingredients,
            system_prompt=system_prompt,
            trace=trace,
        ),
        trace=trace,
    )


def _finalize_import(
    raw: str,
    *,
    source_url: str | None,
    image_url: str | None = None,
    settings: Settings,
    ingredients: IngredientRepository,
    source_text: str | None = None,
) -> ImportPreview:
    if not _is_valid_import(raw):
        raise ImportError("Imported content is not valid Cooklang")

    metadata, body = cooklang.parse_document(raw)
    if source_url and cooklang.is_ref_url(source_url):
        metadata["source"] = source_url
    elif source_url and cooklang.is_ref_file(source_url):
        metadata["source"] = source_url
    _apply_import_image(metadata, image_url=image_url)

    content = cooklang.render_document(metadata, body)
    content = cooklang.prepare_imported_content(content)
    metadata, body = cooklang.parse_document(content)
    _ensure_drink_tags(metadata)
    fluid_volume = prefers_fluid_volume(cooklang.metadata_tags(metadata))
    mapped_body, unmatched = apply_catalog_mapping(
        body,
        ingredients,
        reinterpret_oz_as_fl_oz=fluid_volume,
    )
    content = cooklang.prepare_imported_content(cooklang.render_document(metadata, mapped_body))
    metadata, body = cooklang.parse_document(content)
    # Re-apply after normalize in case front-matter repair dropped image.
    _apply_import_image(metadata, image_url=image_url)
    _ensure_drink_tags(metadata)
    content = cooklang.render_document(metadata, body)
    validation = validate_imported_cooklang(
        content,
        source_text=source_text,
        catalog=ingredients.list_ingredients(),
    )

    slug_source = source_url or metadata.get("title", "imported-recipe")
    if isinstance(slug_source, str) and cooklang.is_ref_file(slug_source):
        # Legacy recipes/{slug}/asset.* → use folder name; bare asset.* → title.
        if cooklang.is_legacy_recipes_path(slug_source):
            slug_source = Path(slug_source).parent.name
        else:
            slug_source = metadata.get("title", "imported-recipe")
    suggested_slug = suggest_slug(str(slug_source), content)
    return ImportPreview(
        content=content + "\n",
        suggested_slug=suggested_slug,
        unmatched_ingredients=sorted(set(unmatched), key=str.casefold),
        validation_warnings=validation.warnings,
        image_url=cooklang.metadata_image_url(metadata),
    )


def _maybe_quality_repair(
    preview: ImportPreview,
    *,
    extracted_text: str,
    source_url: str | None,
    image_url: str | None,
    settings: Settings,
    ingredients: IngredientRepository,
    system_prompt: str,
    trace: ImportTrace,
) -> ImportPreview:
    validation = validate_imported_cooklang(
        preview.content,
        source_text=extracted_text,
        catalog=ingredients.list_ingredients(),
    )
    if not validation.needs_repair:
        return preview.model_copy(update={"validation_warnings": validation.warnings})

    _log_advanced_processing(
        "structural quality warnings after first pass",
        content=preview.content,
        source_url=source_url,
    )
    repair_model = settings.import_model_repair
    warning_summary = "; ".join(validation.warnings[:4])
    if len(validation.warnings) > 4:
        warning_summary += f"; +{len(validation.warnings) - 4} more"
    trace.add(
        f"pass2: quality repair via {_model_label(repair_model)} — {warning_summary}"
    )
    try:
        repaired = complete_cooklang(
            settings=settings,
            system_prompt=system_prompt,
            user_message=build_quality_repair_message(
                source_text=extracted_text,
                previous_cooklang=preview.content,
                warnings=validation.warnings,
                max_chars=settings.import_max_source_chars,
            ),
            model=repair_model,
        )
    except LLMError:
        trace.add("pass2: quality repair failed; keeping first-pass result")
        return preview.model_copy(update={"validation_warnings": validation.warnings})

    repaired = cooklang.sanitize_front_matter(repaired)
    if not _is_valid_import(repaired):
        trace.add("pass2: quality repair returned invalid Cooklang; keeping first-pass result")
        return preview.model_copy(update={"validation_warnings": validation.warnings})

    repaired_preview = _finalize_import(
        repaired,
        source_url=source_url,
        image_url=image_url,
        settings=settings,
        ingredients=ingredients,
        source_text=extracted_text,
    )
    # Prefer the repaired result even if some soft warnings remain.
    return repaired_preview


def _with_import_metadata(preview: ImportPreview, *, trace: ImportTrace) -> ImportPreview:
    """Write app-owned review/import_* front matter; never embed validation as step notes."""
    metadata, body = cooklang.parse_document(preview.content)
    cooklang.strip_app_owned_import_keys(metadata)
    body = cooklang.strip_import_error_notes(body)

    duration_ms = max(0, int((time.monotonic() - trace.started_monotonic) * 1000))
    notes = list(trace.notes)
    if preview.validation_warnings:
        remaining = "; ".join(preview.validation_warnings[:4])
        if len(preview.validation_warnings) > 4:
            remaining += f"; +{len(preview.validation_warnings) - 4} more"
        notes.append(f"remaining warnings: {remaining}")
        metadata["review"] = [warning.strip() for warning in preview.validation_warnings if warning.strip()]
    else:
        metadata.pop("review", None)

    metadata["import_time"] = trace.started_at.isoformat().replace("+00:00", "Z")
    metadata["import_duration_ms"] = duration_ms
    if notes:
        metadata["import_notes"] = notes
    else:
        metadata.pop("import_notes", None)

    content = cooklang.render_document(metadata, body)
    if not content.endswith("\n"):
        content += "\n"
    return preview.model_copy(update={"content": content})


def _log_advanced_processing(
    reason: str,
    *,
    content: str,
    source_url: str | None = None,
) -> None:
    title_match = re.search(r"^title:\s*(?P<title>.+)$", content, re.MULTILINE)
    label = (
        title_match.group("title").strip()
        if title_match
        else (source_url or "unknown recipe")
    )
    message = (
        f"Recipe import required more advanced processing ({reason}): {label}\n"
        f"{content.rstrip() or '(empty)'}"
    )
    # Print so it always shows in the uvicorn/dev console without extra logging config.
    print(f"[import] {message}", flush=True)
    logger.warning("%s", message)


def _ensure_drink_tags(metadata: dict) -> None:
    """Tag cocktails/mocktails so fluid ounces convert and display correctly."""
    tags = cooklang.metadata_tags(metadata)
    if prefers_fluid_volume(tags):
        return
    blob = " ".join(
        str(metadata.get(key) or "")
        for key in ("title", "description", "servings")
    ).casefold()
    markers = (
        "cocktail",
        "mocktail",
        "gimlet",
        "margarita",
        "martini",
        "negroni",
        "daiquiri",
        "mojito",
        "old fashioned",
        "highball",
    )
    if not any(marker in blob for marker in markers):
        return
    tag = "mocktail" if "mocktail" in blob else "cocktail"
    metadata["tags"] = sorted({*tags, tag}, key=str.casefold)


def _apply_import_image(metadata: dict, *, image_url: str | None) -> None:
    """Set image from scrape unless a local asset file is already present."""
    if cooklang.metadata_image_file(metadata):
        return
    if image_url and cooklang.is_ref_url(image_url):
        metadata["image"] = image_url
        return
    if _has_usable_image(metadata):
        return
    source = metadata.get("source")
    if isinstance(source, str) and cooklang.is_ref_url(source):
        scraped = _fetch_source_image_url(source)
        if scraped:
            metadata["image"] = scraped


def _image_url_from_source_text(text: str) -> str | None:
    """Scrape og:image from the first website URL embedded in source text."""
    web_url = first_http_url(text)
    if not web_url:
        return None
    return _fetch_source_image_url(web_url)


def first_http_url(text: str) -> str | None:
    match = SOURCE_HTTP_URL_RE.search(text)
    if not match:
        return None
    return match.group(0).rstrip(".,);]>\"'")


def _has_usable_image(metadata: dict) -> bool:
    image = metadata.get("image")
    if not isinstance(image, str):
        return False
    value = image.strip()
    return bool(value) and (cooklang.is_ref_url(value) or cooklang.is_ref_file(value))


def _fetch_source_image_url(url: str) -> str | None:
    timeout = httpx.Timeout(DEFAULT_TIMEOUT_SECONDS, connect=15.0)
    try:
        with httpx.Client(
            follow_redirects=True, timeout=timeout, headers=BROWSER_HEADERS
        ) as client:
            response = client.get(url)
            response.raise_for_status()
            return extract_page_image_url(response.text, str(response.url))
    except httpx.HTTPError:
        return None


def _is_valid_import(content: str) -> bool:
    return _invalid_import_reason(content) is None


def _invalid_import_reason(content: str) -> str | None:
    try:
        metadata, body = cooklang.parse_document(content.strip())
    except Exception as error:
        return f"parse error: {error}"
    if not metadata.get("title"):
        return "missing title"
    if not body.strip():
        return "empty body"
    try:
        cooklang.validate_document_refs(metadata)
    except ValueError as error:
        return str(error)
    return None


def _find_source_file(recipe_root: Path, slug: str) -> Path | None:
    assets_dir = recipe_root / slug
    if not assets_dir.exists():
        return None
    matches = sorted(assets_dir.glob("source.*"))
    return matches[0] if matches else None


def _fetch_error_message(error: httpx.HTTPStatusError) -> str:
    status = error.response.status_code
    if status == 403:
        return (
            "This site blocked automated access. Try copying the recipe text "
            "or saving the page and importing the HTML file instead."
        )
    return f"Recipe import failed: {error}"
