from pathlib import Path
from unittest.mock import patch

import httpx
import pytest

from app.config import Settings
from app.importer import (
    ImportError,
    import_from_file,
    import_from_text,
    import_from_url,
    suggest_slug,
)
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


def test_import_from_text_maps_catalog_ingredients(
    settings: Settings, ingredients: IngredientRepository
):
    with patch("app.importer.complete_cooklang", return_value=SAMPLE_COOKLANG):
        preview = import_from_text("Recipe text", settings=settings, ingredients=ingredients)

    assert preview.suggested_slug == "chicken-bacon-pasta"
    assert "@chicken" in preview.content
    assert "@bacon" in preview.content
    assert preview.unmatched_ingredients == []
    assert preview.validation_warnings == []


def test_import_from_text_reports_validation_warnings(
    settings: Settings, ingredients: IngredientRepository
):
    cooklang = """---
title: Kebabs
---

Season with @salt{0%g}(to taste). Add 1 Tbsp oil.
"""
    repaired = """---
title: Kebabs
---

Season with @salt{}(to taste). Add @olive oil{1%Tbsp}.
"""
    with patch(
        "app.importer.complete_cooklang", side_effect=[cooklang, repaired]
    ) as mock_complete:
        preview = import_from_text(
            "Ingredients\n1/2 teaspoon salt\n1 tablespoon olive oil\n\nDirections\nSeason.",
            settings=settings,
            ingredients=ingredients,
        )

    assert mock_complete.call_count == 2
    assert mock_complete.call_args.kwargs["model"] == settings.import_model_repair
    assert "@salt{}(to taste)" in preview.content
    assert "Invalid amount for @salt" not in "\n".join(preview.validation_warnings)


def test_import_from_text_skips_quality_repair_when_clean(
    settings: Settings, ingredients: IngredientRepository
):
    with patch("app.importer.complete_cooklang", return_value=SAMPLE_COOKLANG) as mock_complete:
        preview = import_from_text("Recipe text", settings=settings, ingredients=ingredients)

    assert mock_complete.call_count == 1
    assert preview.validation_warnings == []


def test_import_from_text_reports_unmatched_ingredients(
    settings: Settings, ingredients: IngredientRepository
):
    cooklang = """---
title: Mystery stew
---

Add @mystery spice{}.
"""
    with patch("app.importer.complete_cooklang", return_value=cooklang):
        preview = import_from_text("Recipe text", settings=settings, ingredients=ingredients)

    assert preview.unmatched_ingredients == ["mystery spice"]


def test_import_from_text_sanitizes_invalid_yaml_title_quotes(
    settings: Settings, ingredients: IngredientRepository
):
    invalid = """---
title: "Greek" Lamb with Orzo
---

Cook @lamb{}.
"""
    with patch("app.importer.complete_cooklang", return_value=invalid) as mock_complete:
        preview = import_from_text("Recipe text", settings=settings, ingredients=ingredients)

    assert mock_complete.call_count == 1
    assert '"Greek" Lamb with Orzo' in preview.content or "Greek" in preview.content
    metadata_line = next(
        line for line in preview.content.splitlines() if line.startswith("title:")
    )
    assert "Greek" in metadata_line
    assert preview.suggested_slug


def test_import_from_text_raises_when_repair_still_invalid(
    settings: Settings, ingredients: IngredientRepository
):
    invalid = """---
---

Cook @lamb{}.
"""
    with patch("app.importer.complete_cooklang", side_effect=[invalid, invalid]):
        with pytest.raises(ImportError, match="not valid Cooklang"):
            import_from_text("Recipe text", settings=settings, ingredients=ingredients)


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
    assert preview.image_url == "https://www.bbcgoodfood.com/images/chicken-bacon-pasta.jpg"


def test_import_from_url_raises_on_fetch_failure(
    settings: Settings, ingredients: IngredientRepository
):
    transport = httpx.MockTransport(lambda request: httpx.Response(404, text="not found"))
    with patch("app.importer.httpx.Client", return_value=httpx.Client(transport=transport)):
        with pytest.raises(ImportError, match="Recipe import failed"):
            import_from_url(
                "https://example.com/recipe", settings=settings, ingredients=ingredients
            )


def test_import_from_url_raises_helpful_message_on_403(
    settings: Settings, ingredients: IngredientRepository
):
    transport = httpx.MockTransport(lambda request: httpx.Response(403, text="forbidden"))
    with patch("app.importer.httpx.Client", return_value=httpx.Client(transport=transport)):
        with pytest.raises(ImportError, match="blocked automated access"):
            import_from_url(
                "https://www.allrecipes.com/recipe/example/",
                settings=settings,
                ingredients=ingredients,
            )


def test_import_from_url_sends_browser_headers(settings: Settings, ingredients: IngredientRepository):
    recipe_url = "https://example.com/recipe"
    captured_kwargs: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html><body>Recipe page</body></html>")

    transport = httpx.MockTransport(handler)
    original_client = httpx.Client

    def client_factory(*args, **kwargs):
        captured_kwargs.update(kwargs)
        return original_client(transport=transport, **kwargs)

    with patch("app.importer.extract_html_text", return_value="Recipe text"):
        with patch("app.importer.complete_cooklang", return_value=SAMPLE_COOKLANG):
            with patch("app.importer.httpx.Client", client_factory):
                import_from_url(recipe_url, settings=settings, ingredients=ingredients)

    headers = captured_kwargs.get("headers", {})
    assert "mozilla" in headers.get("User-Agent", "").lower()
    assert "text/html" in headers.get("Accept", "")


def test_import_from_text_fetches_image_from_source_when_missing(
    settings: Settings, ingredients: IngredientRepository
):
    cooklang = """---
title: Chicken & bacon pasta
source: https://www.bbcgoodfood.com/recipes/chicken-bacon-pasta
---

Add @chicken{} and @bacon{}.
"""
    source_url = "https://www.bbcgoodfood.com/recipes/chicken-bacon-pasta"
    image_url = "https://www.bbcgoodfood.com/images/chicken-bacon-pasta.jpg"

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == source_url:
            return httpx.Response(
                200,
                text=(
                    f'<html><head><meta property="og:image" content="{image_url}" />'
                    "</head><body>Recipe page</body></html>"
                ),
            )
        raise AssertionError(f"Unexpected request: {request.url}")

    transport = httpx.MockTransport(handler)
    with patch("app.importer.complete_cooklang", return_value=cooklang):
        with patch("app.importer.httpx.Client", return_value=httpx.Client(transport=transport)):
            preview = import_from_text(
                "Recipe text",
                settings=settings,
                ingredients=ingredients,
            )

    assert f"image: {image_url}" in preview.content


def test_import_from_text_keeps_existing_image(
    settings: Settings, ingredients: IngredientRepository
):
    cooklang = """---
title: Chicken & bacon pasta
source: https://www.bbcgoodfood.com/recipes/chicken-bacon-pasta
image: https://cdn.example.com/existing.jpg
---

Add @chicken{} and @bacon{}.
"""

    with patch("app.importer.complete_cooklang", return_value=cooklang):
        with patch("app.importer._fetch_source_image_url") as mock_fetch:
            preview = import_from_text(
                "Recipe text",
                settings=settings,
                ingredients=ingredients,
            )

    mock_fetch.assert_not_called()
    assert "image: https://cdn.example.com/existing.jpg" in preview.content
    assert preview.image_url == "https://cdn.example.com/existing.jpg"


def test_import_from_url_keeps_existing_image_file(
    settings: Settings, ingredients: IngredientRepository
):
    cooklang = """---
title: Chicken & bacon pasta
source: https://www.bbcgoodfood.com/recipes/chicken-bacon-pasta
image: recipes/chicken-bacon-pasta/image.jpg
---

Add @chicken{} and @bacon{}.
"""
    page_url = "https://www.bbcgoodfood.com/recipes/chicken-bacon-pasta"
    scraped_image = "https://www.bbcgoodfood.com/images/chicken-bacon-pasta.jpg"

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == page_url:
            return httpx.Response(
                200,
                text=(
                    f'<html><head><meta property="og:image" content="{scraped_image}" />'
                    "</head><body>Pasta recipe with chicken and bacon</body></html>"
                ),
            )
        raise AssertionError(f"Unexpected request: {request.url}")

    transport = httpx.MockTransport(handler)
    with patch("app.importer.complete_cooklang", return_value=cooklang):
        with patch("app.importer.httpx.Client", return_value=httpx.Client(transport=transport)):
            preview = import_from_url(page_url, settings=settings, ingredients=ingredients)

    assert "image: recipes/chicken-bacon-pasta/image.jpg" in preview.content
    assert scraped_image not in preview.content
    assert preview.image_url is None


def test_import_from_html_file_extracts_page_image(
    settings: Settings,
    ingredients: IngredientRepository,
    tmp_path: Path,
):
    image_url = "https://example.com/chili.jpg"
    source_dir = tmp_path / "chili"
    source_dir.mkdir()
    source_file = source_dir / "source.html"
    source_file.write_text(
        f'<html><head><meta property="og:image" content="{image_url}" /></head>'
        "<body><article>Chili recipe with beans</article></body></html>",
        encoding="utf-8",
    )

    with patch(
        "app.importer.complete_cooklang",
        return_value="---\ntitle: Chili\n---\n\nBrown @beef{}.\n",
    ):
        preview = import_from_file(
            source_file,
            settings=settings,
            ingredients=ingredients,
            source_path="recipes/chili/source.html",
        )

    assert f"image: {image_url}" in preview.content
    assert preview.image_url == image_url
    assert "source: recipes/chili/source.html" in preview.content


def test_import_from_text_file_scrapes_embedded_website_url(
    settings: Settings,
    ingredients: IngredientRepository,
    tmp_path: Path,
):
    page_url = "https://food52.com/recipes/21007-alice-medrich-s-best-cocoa-brownies"
    image_url = "https://images.food52.com/brownies.jpg"
    source_dir = tmp_path / "alice-medrich-s-best-cocoa-brownies"
    source_dir.mkdir()
    source_file = source_dir / "source.txt"
    source_file.write_text(
        f"Alice Medrich's Best Cocoa Brownies\n\n{page_url}\n\nPrep time 25 minutes\n",
        encoding="utf-8",
    )

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == page_url:
            return httpx.Response(
                200,
                text=(
                    f'<html><head><meta property="og:image" content="{image_url}" />'
                    "</head><body>Brownies</body></html>"
                ),
            )
        raise AssertionError(f"Unexpected request: {request.url}")

    transport = httpx.MockTransport(handler)
    with patch(
        "app.importer.complete_cooklang",
        return_value="---\ntitle: Brownies\n---\n\nBake @batter{}.\n",
    ):
        with patch("app.importer.httpx.Client", return_value=httpx.Client(transport=transport)):
            preview = import_from_file(
                source_file,
                settings=settings,
                ingredients=ingredients,
                source_path="recipes/alice-medrich-s-best-cocoa-brownies/source.txt",
            )

    assert f"image: {image_url}" in preview.content
    assert preview.image_url == image_url
    assert "source: recipes/alice-medrich-s-best-cocoa-brownies/source.txt" in preview.content
    assert page_url not in preview.content.split("---")[1]


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
        with patch(
            "app.importer.complete_cooklang",
            return_value="---\ntitle: Chili\n---\n\nBrown @beef{}.\n",
        ):
            preview = import_from_file(
                source_file,
                settings=settings,
                ingredients=ingredients,
                source_path="recipes/chili/source.txt",
            )

    assert "source: recipes/chili/source.txt" in preview.content
