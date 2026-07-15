import pytest

from app.cooklang import (
    is_legacy_recipes_path,
    is_local_asset_filename,
    is_ref_file,
    is_ref_url,
    metadata_image_file,
    metadata_image_url,
    metadata_source_file,
    metadata_source_url,
    normalize_document,
    resolve_image_url,
    resolve_source_url,
    validate_ref_value,
)


def test_ref_helpers_recognize_urls_and_file_paths():
    assert is_ref_url("https://example.com/recipe")
    assert not is_ref_url("source.txt")
    assert is_local_asset_filename("source.txt")
    assert is_local_asset_filename("image.jpg")
    assert is_ref_file("source.txt")
    assert is_ref_file("image.jpg")
    assert is_legacy_recipes_path("recipes/chili/image.jpg")
    assert is_ref_file("recipes/chili/image.jpg")
    assert not is_ref_file("https://example.com/image.jpg")
    assert not is_local_asset_filename("notes.txt")
    assert not is_ref_file("ftp://example.com/bad")


def test_metadata_helpers_extract_flat_refs():
    metadata = {
        "source": "https://example.com/chili",
        "image": "image.jpg",
    }
    assert metadata_source_url(metadata) == "https://example.com/chili"
    assert metadata_source_file(metadata) is None
    assert metadata_image_url(metadata) is None
    assert metadata_image_file(metadata) == "image.jpg"


def test_resolve_image_url_maps_relative_files_to_api_route():
    metadata = {"image": "image.jpg"}
    assert (
        resolve_image_url(metadata, "http://localhost:8000", slug="chili")
        == "/api/sources/chili/image.jpg"
    )


def test_resolve_image_url_maps_legacy_file_paths_to_api_route():
    metadata = {"image": "recipes/chili/image.jpg"}
    assert resolve_image_url(metadata, "http://localhost:8000") == "/api/sources/chili/image.jpg"


def test_resolve_source_url_maps_relative_files_to_api_route():
    metadata = {"source": "source.txt"}
    assert (
        resolve_source_url(metadata, "http://localhost:8000", slug="chili")
        == "/api/sources/chili/source.txt"
    )


def test_resolve_source_url_keeps_http_urls():
    metadata = {"source": "https://example.com/chili"}
    assert resolve_source_url(metadata, "http://localhost:8000") == "https://example.com/chili"


def test_validate_ref_value_rejects_unknown_formats():
    assert validate_ref_value("https://example.com/ok")
    assert validate_ref_value("source.pdf")
    assert validate_ref_value("image.jpg")
    assert validate_ref_value("recipes/chili/source.pdf")
    assert not validate_ref_value("ftp://example.com/bad")
    assert not validate_ref_value("notes.txt")


def test_normalize_document_collapses_legacy_asset_paths():
    content = """---
title: Chili
source: recipes/chili/source.txt
image: recipes/chili/image.jpg
---

Cook @beans{}.
"""
    normalized = normalize_document(content)
    assert "source: source.txt" in normalized
    assert "image: image.jpg" in normalized
    assert "recipes/chili/" not in normalized


def test_normalize_document_rejects_invalid_refs():
    content = """---
title: Bad refs
source: not-a-valid-ref
---

Cook @food{}.
"""
    with pytest.raises(ValueError, match="source"):
        normalize_document(content)
