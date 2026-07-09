from pathlib import Path
from unittest.mock import patch

import httpx
import pytest

from app.config import Settings
from app.importer import ImportError, import_from_file, import_from_text, import_from_url, suggest_slug
from app.ingredients import IngredientRepository
from app.models import CatalogIngredient


SAMPLE_COOKLANG = """---
title: Chicken & bacon pasta
source: https://www.bbcgoodfood.com/recipes/chicken-bacon-pasta
---

Add @chicken{} and @bacon{}.
"""


@pytest.fixture
def settings() -> Settings:
    return Settings(
        fireworks_api_key="test-key",
        data_root=Path("/tmp/recipes-test"),
    )


@pytest.fixture
def ingredients(tmp_path: Path) -> IngredientRepository:
    repository = IngredientRepository(catalog_path=tmp_path / "ingredients.json")
    repository.upsert(CatalogIngredient(name="chicken"))
    repository.upsert(CatalogIngredient(name="bacon"))
    return repository


def test_suggest_slug_uses_title():
    content = "---\ntitle: Chicken & bacon pasta\n---\n"
    assert suggest_slug("https://example.com/recipe", content) == "chicken-bacon-pasta"


def test_import_from_text_maps_catalog_ingredients(settings: Settings, ingredients: IngredientRepository):
    with patch("app.importer.complete_cooklang", return_value=SAMPLE_COOKLANG):
        preview = import_from_text("Recipe text", settings=settings, ingredients=ingredients)

    assert preview.suggested_slug == "chicken-bacon-pasta"
    assert "@chicken" in preview.content
    assert "@bacon" in preview.content
    assert preview.unmatched_ingredients == []


def test_import_from_text_reports_unmatched_ingredients(settings: Settings, ingredients: IngredientRepository):
    cooklang = """---
title: Mystery stew
---

Add @mystery spice{}.
"""
    with patch("app.importer.complete_cooklang", return_value=cooklang):
        preview = import_from_text("Recipe text", settings=settings, ingredients=ingredients)

    assert preview.unmatched_ingredients == ["mystery spice"]


def test_import_from_url_fetches_and_imports(settings: Settings, ingredients: IngredientRepository):
    recipe_url = "https://www.bbcgoodfood.com/recipes/chicken-bacon-pasta"

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == recipe_url:
            return httpx.Response(
                200,
                text=(
                    '<html><head><meta property="og:image" '
                    'content="https://www.bbcgoodfood.com/images/chicken-bacon-pasta.jpg" />'
                    "</head><body>Recipe page</body></html>"
                ),
            )
        raise AssertionError(f"Unexpected request: {request.url}")

    transport = httpx.MockTransport(handler)
    with patch("app.importer.extract_html_text", return_value="Chicken bacon pasta recipe"):
        with patch("app.importer.complete_cooklang", return_value=SAMPLE_COOKLANG):
            with patch("app.importer.httpx.Client", return_value=httpx.Client(transport=transport)):
                preview = import_from_url(recipe_url, settings=settings, ingredients=ingredients)

    assert preview.suggested_slug == "chicken-bacon-pasta"
    assert "source: https://www.bbcgoodfood.com/recipes/chicken-bacon-pasta" in preview.content
    assert "image: https://www.bbcgoodfood.com/images/chicken-bacon-pasta.jpg" in preview.content


def test_import_from_url_raises_on_fetch_failure(settings: Settings, ingredients: IngredientRepository):
    transport = httpx.MockTransport(
        lambda request: httpx.Response(404, text="not found")
    )
    with patch("app.importer.httpx.Client", return_value=httpx.Client(transport=transport)):
        with pytest.raises(ImportError, match="Recipe import failed"):
            import_from_url("https://example.com/recipe", settings=settings, ingredients=ingredients)


def test_import_from_file_sets_source_path_for_assets(
    settings: Settings,
    ingredients: IngredientRepository,
    tmp_path: Path,
):
    source_dir = tmp_path / "chili"
    source_dir.mkdir()
    source_file = source_dir / "source.txt"
    source_file.write_text("Chili recipe text", encoding="utf-8")

    with patch("app.importer.extract_text_from_path", return_value="Chili recipe text"):
        with patch("app.importer.complete_cooklang", return_value="---\ntitle: Chili\n---\n\nBrown @beef{}.\n"):
            preview = import_from_file(
                source_file,
                settings=settings,
                ingredients=ingredients,
                source_path="sources/chili/source.txt",
            )

    assert "source: sources/chili/source.txt" in preview.content
