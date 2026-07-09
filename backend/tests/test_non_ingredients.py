from app.catalog_match import apply_catalog_mapping
from app.ingredients import IngredientRepository
from app.models import CatalogIngredient
from app.non_ingredients import is_non_ingredient


def test_is_non_ingredient_matches_common_supplies():
    assert is_non_ingredient("parchment paper")
    assert is_non_ingredient("Parchment Paper")
    assert is_non_ingredient("large parchment paper")
    assert not is_non_ingredient("flour")


def test_apply_catalog_mapping_demotes_non_ingredients(tmp_path):
    repository = IngredientRepository(catalog_path=tmp_path / "ingredients.json")
    repository.upsert(CatalogIngredient(name="flour"))

    body = "Line pan with @parchment paper{1}(sheet) and add @flour{240%g}."
    mapped, unmatched = apply_catalog_mapping(body, repository)

    assert "1 parchment paper (sheet)" in mapped
    assert "@parchment paper" not in mapped
    assert "@flour{240%g}" in mapped or "flour{240%g}" in mapped
    assert unmatched == []
