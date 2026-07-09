from app.catalog_match import apply_catalog_mapping, match_catalog_ingredient
from app.ingredients import IngredientRepository
from app.models import CatalogIngredient


def test_match_catalog_ingredient_matches_aliases():
    catalog = [
        CatalogIngredient(name="olive oil", aliases=["extra virgin olive oil"]),
    ]
    match = match_catalog_ingredient("extra virgin olive oil", catalog)
    assert match.catalog is not None
    assert match.catalog.name == "olive oil"


def test_apply_catalog_mapping_rewrites_known_ingredients(tmp_path):
    repository = IngredientRepository(catalog_path=tmp_path / "ingredients.json")
    repository.upsert(CatalogIngredient(name="chicken"))
    repository.upsert(CatalogIngredient(name="bacon"))

    body = "Add @Chicken{} and @bacon{} and @mystery spice{}."
    mapped, unmatched = apply_catalog_mapping(body, repository)

    assert "@chicken" in mapped
    assert "@bacon" in mapped
    assert "@mystery spice{}" in mapped
    assert unmatched == ["mystery spice"]
