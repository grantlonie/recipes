from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.config import Settings
from app.importer import ImportError, import_from_upload
from app.ingredients import IngredientRepository


@pytest.fixture
def settings() -> Settings:
    return Settings(fireworks_api_key="test-key", data_root=Path("/tmp/recipes-test"))


@pytest.fixture
def ingredients(tmp_path: Path) -> IngredientRepository:
    return IngredientRepository(catalog_path=tmp_path / "ingredients.json")


def test_import_from_upload_rejects_unsupported_extension(
    settings: Settings,
    ingredients: IngredientRepository,
):
    async def run() -> None:
        upload = AsyncMock()
        upload.filename = "recipe.xyz"
        upload.read = AsyncMock(return_value=b"data")

        with pytest.raises(ImportError, match="Unsupported file type"):
            await import_from_upload(upload, settings=settings, ingredients=ingredients)

    import asyncio

    asyncio.run(run())


def test_import_from_upload_imports_supported_file(
    settings: Settings,
    ingredients: IngredientRepository,
):
    async def run() -> None:
        upload = AsyncMock()
        upload.filename = "recipe.txt"
        upload.read = AsyncMock(return_value=b"Chili recipe text")

        class Preview:
            content = "---\ntitle: Chili\n---\n\nBrown @beef{}.\n"
            suggested_slug = "chili"
            unmatched_ingredients: list[str] = []

        with patch("app.importer.import_from_file", return_value=Preview()):
            preview = await import_from_upload(upload, settings=settings, ingredients=ingredients)

        assert preview.suggested_slug == "chili"

    import asyncio

    asyncio.run(run())
