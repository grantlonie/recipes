from pathlib import Path
from unittest.mock import patch

import httpx
import pytest
from app import cooklang as cooklang_mod
from app.config import Settings
from app.importer import (
    ImportError,
    _ensure_drink_tags,
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
        page_fetch_fallback_enabled=False,
        page_fetch_max_retries=0,
        page_fetch_min_interval_seconds=0,
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
    with patch("app.importer.complete_cooklang", side_effect=[cooklang, repaired]) as mock_complete:
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
    metadata, _body = cooklang_mod.parse_document(preview.content)
    assert "review" not in metadata
    assert "import_time" in metadata
    assert isinstance(metadata["import_duration_ms"], int)
    assert any(note.startswith("pass1:") for note in metadata["import_notes"])


def test_import_from_text_stores_soft_warnings_in_review_metadata(
    settings: Settings, ingredients: IngredientRepository
):
    ingredients.upsert(CatalogIngredient(name="jalapenos"))
    ingredients.upsert(CatalogIngredient(name="corn"))
    cooklang = """---
title: Sheet pan
---

Toss @jalapenos{0.33%cup}(pickled) with @corn{4%cup}.
"""
    source = """Ingredients
1/3 cup chopped pickled jalapeños, plus brine from the jar
4 cups corn kernels

Directions
Cook.
"""
    with patch("app.importer.complete_cooklang", return_value=cooklang) as mock_complete:
        preview = import_from_text(source, settings=settings, ingredients=ingredients)

    assert mock_complete.call_count == 1
    assert any(
        "Source preparation note missing" in warning for warning in preview.validation_warnings
    )
    metadata, body = cooklang_mod.parse_document(preview.content)
    assert "Import error:" not in body
    assert metadata["review"]
    assert any("Source preparation note missing" in item for item in metadata["review"])
    assert "import_time" in metadata
    assert isinstance(metadata["import_duration_ms"], int)
    assert metadata["import_notes"]
    assert any(note.startswith("pass1:") for note in metadata["import_notes"])


def test_import_from_text_heals_invalid_refs_without_repair_model(
    settings: Settings, ingredients: IngredientRepository
):
    cooklang = """Here is the recipe:

---
title: Soup
image: photos/soup.jpg
---

Cook @onion{1}.
"""
    with patch("app.importer.complete_cooklang", return_value=cooklang) as mock_complete:
        preview = import_from_text("Recipe text", settings=settings, ingredients=ingredients)

    assert mock_complete.call_count == 1
    metadata, body = cooklang_mod.parse_document(preview.content)
    assert metadata["title"] == "Soup"
    assert "image" not in metadata
    assert "Cook @onion" in body
    assert any("heal:" in note for note in metadata["import_notes"])
    assert not any("pass2:" in note for note in metadata["import_notes"])


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
    metadata_line = next(line for line in preview.content.splitlines() if line.startswith("title:"))
    assert "Greek" in metadata_line
    assert preview.suggested_slug


def test_import_from_text_raises_when_repair_still_invalid(
    settings: Settings, ingredients: IngredientRepository
):
    invalid = """---
description: "Broken"
---

"""
    with patch("app.importer.complete_cooklang", side_effect=[invalid, invalid]):
        with pytest.raises(ImportError, match="not valid Cooklang"):
            # No guessable title line; empty body stays invalid after heal.
            import_from_text(
                "Ingredients\n1 lb lamb\n\nDirections\nCook the lamb.",
                settings=settings,
                ingredients=ingredients,
            )


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
            with patch("app.page_fetch.httpx.Client", return_value=httpx.Client(transport=transport)):
                preview = import_from_url(recipe_url, settings=settings, ingredients=ingredients)

    assert preview.suggested_slug == "chicken-bacon-pasta"
    assert "source: https://www.bbcgoodfood.com/recipes/chicken-bacon-pasta" in preview.content
    assert "image: https://www.bbcgoodfood.com/images/chicken-bacon-pasta.jpg" in preview.content
    assert preview.image_url == "https://www.bbcgoodfood.com/images/chicken-bacon-pasta.jpg"


def test_import_from_url_raises_on_fetch_failure(
    settings: Settings, ingredients: IngredientRepository
):
    transport = httpx.MockTransport(lambda request: httpx.Response(404, text="not found"))
    with patch("app.page_fetch.httpx.Client", return_value=httpx.Client(transport=transport)):
        with pytest.raises(ImportError, match="Recipe import failed"):
            import_from_url(
                "https://example.com/recipe", settings=settings, ingredients=ingredients
            )


def test_import_from_url_raises_helpful_message_on_403(
    settings: Settings, ingredients: IngredientRepository
):
    transport = httpx.MockTransport(lambda request: httpx.Response(403, text="forbidden"))
    with patch("app.page_fetch.httpx.Client", return_value=httpx.Client(transport=transport)):
        with pytest.raises(ImportError, match="blocked automated access"):
            import_from_url(
                "https://www.allrecipes.com/recipe/example/",
                settings=settings,
                ingredients=ingredients,
            )


def test_import_from_url_raises_helpful_message_on_429(
    settings: Settings, ingredients: IngredientRepository
):
    transport = httpx.MockTransport(lambda request: httpx.Response(429, text="slow down"))
    with patch("app.page_fetch.httpx.Client", return_value=httpx.Client(transport=transport)):
        with pytest.raises(ImportError, match="rate-limiting imports"):
            import_from_url(
                "https://food52.com/recipes/example/",
                settings=settings,
                ingredients=ingredients,
            )


def test_import_from_url_sends_browser_headers(
    settings: Settings, ingredients: IngredientRepository
):
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
            with patch("app.page_fetch.httpx.Client", client_factory):
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
        with patch("app.page_fetch.httpx.Client", return_value=httpx.Client(transport=transport)):
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
        with patch("app.importer.fetch_page_image_url") as mock_fetch:
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
image: image.jpg
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
        with patch("app.page_fetch.httpx.Client", return_value=httpx.Client(transport=transport)):
            preview = import_from_url(page_url, settings=settings, ingredients=ingredients)

    assert "image: image.jpg" in preview.content
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
            source_path="source.html",
        )

    assert f"image: {image_url}" in preview.content
    assert preview.image_url == image_url
    assert "source: source.html" in preview.content


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
        with patch("app.page_fetch.httpx.Client", return_value=httpx.Client(transport=transport)):
            preview = import_from_file(
                source_file,
                settings=settings,
                ingredients=ingredients,
                source_path="source.txt",
            )

    assert f"image: {image_url}" in preview.content
    assert preview.image_url == image_url
    assert "source: source.txt" in preview.content
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
                source_path="source.txt",
            )

    assert "source: source.txt" in preview.content


def test_import_from_file_normalizes_legacy_source_path(
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

    assert "source: source.txt" in preview.content
    assert "recipes/" not in preview.content


def test_ensure_drink_tags_ignores_old_fashioned_cake():
    metadata = {
        "title": "The Best Chocolate Cake Recipe Ever",
        "description": "Based on the Old Fashioned Hershey's recipe with espresso powder.",
        "servings": 12,
    }
    body = (
        "Preheat the oven to 350°F. Add @flour{2%cup} and @cocoa powder{0.75%cup}. "
        "Bake ~{30%minutes}."
    )
    _ensure_drink_tags(metadata, body)
    assert "tags" not in metadata


def test_ensure_drink_tags_strips_cocktail_tag_from_baked_goods():
    metadata = {
        "title": "Old Fashioned Chocolate Cake",
        "description": "A rich cake.",
        "tags": ["cocktail"],
    }
    body = "Bake the cake in the oven until done."
    _ensure_drink_tags(metadata, body)
    assert "tags" not in metadata


def test_ensure_drink_tags_keeps_llm_cocktail_tag():
    metadata = {
        "title": "Negroni",
        "description": "Classic Italian aperitivo.",
        "tags": ["cocktail"],
    }
    body = (
        "Stir @gin{1%fl oz}, @campari{1%fl oz}, and @sweet vermouth{1%fl oz} "
        "with ice. Strain into a rocks glass."
    )
    _ensure_drink_tags(metadata, body)
    assert metadata["tags"] == ["cocktail"]


def test_ensure_drink_tags_infers_from_explicit_word():
    metadata = {
        "title": "House Sour",
        "description": "A bright whiskey cocktail.",
    }
    _ensure_drink_tags(metadata, "Shake and strain.")
    assert metadata["tags"] == ["cocktail"]


def test_ensure_drink_tags_infers_mocktail_from_explicit_word():
    metadata = {
        "title": "Citrus Spritz",
        "description": "A refreshing mocktail.",
    }
    _ensure_drink_tags(metadata, "Build over ice.")
    assert metadata["tags"] == ["mocktail"]


def test_ensure_drink_tags_infers_from_mixed_drink_structure():
    metadata = {"title": "House Sour", "description": "Bright and citrusy."}
    body = (
        "Shake @bourbon{2%fl oz}, @lemon juice{1%fl oz}, and @simple syrup{0.75%fl oz} "
        "with ice. Strain into a coupe. Garnish with a cherry."
    )
    _ensure_drink_tags(metadata, body)
    assert metadata["tags"] == ["cocktail"]


def test_ensure_drink_tags_ignores_single_spirit_in_food():
    metadata = {
        "title": "Bourbon Glaze",
        "description": "For roasted pork.",
    }
    body = "Simmer @bourbon{2%fl oz} with @brown sugar{0.5%cup} until thick."
    _ensure_drink_tags(metadata, body)
    assert "tags" not in metadata
