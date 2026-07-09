from __future__ import annotations

import mimetypes
import re
import shutil
from pathlib import Path

from fastapi import UploadFile

from app.cooklang import SOURCES_PREFIX

ALLOWED_SOURCE_EXTENSIONS = {
    ".docx",
    ".heic",
    ".htm",
    ".html",
    ".jpeg",
    ".jpg",
    ".md",
    ".markdown",
    ".pdf",
    ".png",
    ".txt",
    ".webp",
}
ALLOWED_IMAGE_EXTENSIONS = {".heic", ".jpeg", ".jpg", ".png", ".webp"}
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


class AssetError(ValueError):
    pass


def recipe_assets_dir(sources_root: Path, slug: str) -> Path:
    _validate_slug(slug)
    return sources_root / slug


def metadata_asset_path(slug: str, kind: str, extension: str) -> str:
    ext = extension.lower().lstrip(".")
    return f"{SOURCES_PREFIX}{slug}/{kind}.{ext}"


def delete_recipe_assets(sources_root: Path, slug: str) -> None:
    path = recipe_assets_dir(sources_root, slug)
    if path.exists():
        shutil.rmtree(path)


def rename_recipe_assets(sources_root: Path, old_slug: str, new_slug: str) -> None:
    if old_slug == new_slug:
        return
    source = recipe_assets_dir(sources_root, old_slug)
    if not source.exists():
        return
    destination = recipe_assets_dir(sources_root, new_slug)
    if destination.exists():
        shutil.rmtree(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    source.rename(destination)


def resolve_asset_file(sources_root: Path, relative_path: str) -> Path:
    if not relative_path.startswith(SOURCES_PREFIX):
        raise AssetError("Invalid asset path")
    remainder = relative_path.removeprefix(SOURCES_PREFIX)
    parts = Path(remainder).parts
    if not parts or ".." in parts:
        raise AssetError("Invalid asset path")
    path = (sources_root / Path(*parts)).resolve()
    root = sources_root.resolve()
    if root not in path.parents and path != root:
        raise AssetError("Invalid asset path")
    if not path.exists() or not path.is_file():
        raise AssetError("Asset not found")
    return path


async def save_upload(
    sources_root: Path,
    slug: str,
    kind: str,
    upload: UploadFile,
    *,
    allowed_extensions: set[str],
) -> str:
    if kind not in {"image", "source"}:
        raise AssetError("Invalid asset kind")

    filename = (upload.filename or "").strip()
    extension = Path(filename).suffix.lower()
    if extension not in allowed_extensions:
        raise AssetError(f"Unsupported file type: {extension or 'unknown'}")

    data = await upload.read()
    if not data:
        raise AssetError("Uploaded file is empty")
    if len(data) > MAX_UPLOAD_BYTES:
        raise AssetError("Uploaded file is too large")

    assets_dir = recipe_assets_dir(sources_root, slug)
    assets_dir.mkdir(parents=True, exist_ok=True)
    for existing in assets_dir.glob(f"{kind}.*"):
        existing.unlink()

    destination = assets_dir / f"{kind}{extension}"
    destination.write_bytes(data)
    return metadata_asset_path(slug, kind, extension)


def guess_media_type(path: Path) -> str:
    media_type, _ = mimetypes.guess_type(path.name)
    return media_type or "application/octet-stream"


def _validate_slug(slug: str) -> None:
    if not slug or slug.startswith("/") or ".." in Path(slug).parts:
        raise AssetError("Invalid slug")
    if not re.fullmatch(r"[A-Za-z0-9._-]+", slug):
        raise AssetError("Invalid slug")
