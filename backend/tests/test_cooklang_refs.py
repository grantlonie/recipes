import pytest

from app.cooklang import (
    is_ref_file,
    is_ref_url,
    metadata_image_file,
    metadata_image_url,
    metadata_source_file,
    metadata_source_url,
    normalize_document,
    resolve_image_url,
    validate_ref_value,
)


def test_ref_helpers_recognize_urls_and_file_paths():
    assert is_ref_url("https://example.com/recipe")
    assert not is_ref_url("recipes/chili/image.jpg")
    assert is_ref_file("recipes/chili/image.jpg")
    assert not is_ref_file("https://example.com/image.jpg")


def test_metadata_helpers_extract_flat_refs():
    metadata = {
        "source": "https://example.com/chili",
        "image": "recipes/chili/image.jpg",
    }
    assert metadata_source_url(metadata) == "https://example.com/chili"
    assert metadata_source_file(metadata) is None
    assert metadata_image_url(metadata) is None
    assert metadata_image_file(metadata) == "recipes/chili/image.jpg"


def test_resolve_image_url_maps_file_paths_to_api_route():
    metadata = {"image": "recipes/chili/image.jpg"}
    assert (
        resolve_image_url(metadata, "http://localhost:8000")
        == "http://localhost:8000/api/sources/chili/image.jpg"
    )


def test_validate_ref_value_rejects_unknown_formats():
    assert validate_ref_value("https://example.com/ok")
    assert validate_ref_value("recipes/chili/source.pdf")
    assert not validate_ref_value("ftp://example.com/bad")


def test_normalize_document_rejects_invalid_refs():
    content = """---
title: Bad refs
source: not-a-valid-ref
---

Cook @food{}.
"""
    with pytest.raises(ValueError, match="source"):
        normalize_document(content)
