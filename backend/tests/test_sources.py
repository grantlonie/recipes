import shutil
from pathlib import Path

import pytest

from app.sources import (
    AssetError,
    delete_recipe_dir,
    metadata_asset_path,
    rename_recipe_dir,
    resolve_asset_file,
)


def test_metadata_asset_path_is_relative_filename():
    assert metadata_asset_path("source", ".pdf") == "source.pdf"
    assert metadata_asset_path("image", "jpg") == "image.jpg"


def test_resolve_asset_file_reads_uploaded_asset(tmp_path: Path):
    assets_dir = tmp_path / "chili"
    assets_dir.mkdir(parents=True)
    image = assets_dir / "image.jpg"
    image.write_bytes(b"fake-image")

    resolved = resolve_asset_file(tmp_path, "recipes/chili/image.jpg")
    assert resolved == image


def test_resolve_asset_file_rejects_escape_attempts(tmp_path: Path):
    with pytest.raises(AssetError):
        resolve_asset_file(tmp_path, "recipes/../secret.txt")


def test_delete_and_rename_recipe_dir(tmp_path: Path):
    slug_dir = tmp_path / "old-slug"
    slug_dir.mkdir()
    (slug_dir / "source.txt").write_text("recipe", encoding="utf-8")

    rename_recipe_dir(tmp_path, "old-slug", "new-slug")
    assert not slug_dir.exists()
    assert (tmp_path / "new-slug" / "source.txt").exists()

    delete_recipe_dir(tmp_path, "new-slug")
    assert not (tmp_path / "new-slug").exists()
