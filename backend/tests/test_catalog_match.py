from app.catalog_match import apply_catalog_mapping, match_catalog_ingredient
from app.ingredient_inflection import inflection_forms, pluralize_token, singularize_token
from app.ingredients import IngredientRepository
from app.models import CatalogIngredient


def test_match_catalog_ingredient_matches_aliases():
    catalog = [
        CatalogIngredient(name="olive oil", aliases=["extra virgin olive oil"]),
    ]
    match = match_catalog_ingredient("extra virgin olive oil", catalog)
    assert match.catalog is not None
    assert match.catalog.name == "olive oil"


def test_match_catalog_ingredient_matches_singular_and_plural():
    catalog = [CatalogIngredient(name="eggs", aliases=[])]
    assert match_catalog_ingredient("egg", catalog).catalog is not None
    assert match_catalog_ingredient("eggs", catalog).catalog is not None

    match = match_catalog_ingredient("large egg", catalog)
    assert match.catalog is not None
    assert match.catalog.name == "eggs"
    assert match.note == "large"

    leaves = [CatalogIngredient(name="bay leaves", aliases=[])]
    assert match_catalog_ingredient("bay leaf", leaves).catalog is not None
    leaf_note = match_catalog_ingredient("dried bay leaf", leaves)
    assert leaf_note.catalog is not None
    assert leaf_note.note == "dried"


def test_inflection_forms_cover_common_culinary_plurals():
    assert "egg" in inflection_forms("eggs")
    assert "eggs" in inflection_forms("egg")
    assert "bay leaf" in inflection_forms("bay leaves")
    assert "tomatoes" in inflection_forms("tomato")
    assert singularize_token("molasses") == "molasses"
    assert pluralize_token("molasses") == "molasses"


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


def test_match_catalog_ingredient_prefers_head_noun_over_modifier():
    catalog = [
        CatalogIngredient(name="lemons", aliases=[]),
        CatalogIngredient(name="zest", aliases=[]),
        CatalogIngredient(name="eggs", aliases=[]),
        CatalogIngredient(name="egg yolks", aliases=[]),
        CatalogIngredient(name="potatoes", aliases=[]),
        CatalogIngredient(name="sweet potatoes", aliases=[]),
    ]
    zest = match_catalog_ingredient("lemon zest", catalog)
    assert zest.catalog is not None
    assert zest.catalog.name == "zest"
    assert zest.note == "lemon"

    yolks = match_catalog_ingredient("egg yolks", catalog)
    assert yolks.catalog is not None
    assert yolks.catalog.name == "egg yolks"

    sweet = match_catalog_ingredient("sweet potatoes", catalog)
    assert sweet.catalog is not None
    assert sweet.catalog.name == "sweet potatoes"

    onionish = match_catalog_ingredient("yellow onion", [CatalogIngredient(name="onions", aliases=[])])
    assert onionish.catalog is not None
    assert onionish.catalog.name == "onions"
    assert onionish.note == "yellow"


def test_upsert_drops_singular_alias_of_plural_name(tmp_path):
    repository = IngredientRepository(catalog_path=tmp_path / "ingredients.json")
    saved = repository.upsert(CatalogIngredient(name="shallots", aliases=["shallot", "eschalot"]))
    assert saved.aliases == ["eschalot"]
