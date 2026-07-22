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
    assert match.note == "extra virgin"


def test_match_catalog_ingredient_ignores_apostrophes_and_punctuation():
    catalog = [
        CatalogIngredient(
            name="powdered sugar",
            aliases=["confectioners sugar", "icing sugar"],
        ),
    ]
    match = match_catalog_ingredient("confectioners' sugar", catalog)
    assert match.catalog is not None
    assert match.catalog.name == "powdered sugar"

    assert "confectioners sugar" in inflection_forms("confectioners' sugar")
    assert inflection_forms("confectioners' sugar") == inflection_forms("confectioners sugar")


def test_match_catalog_ingredient_preserves_alias_variety_as_note():
    catalog = [
        CatalogIngredient(
            name="vinegar",
            aliases=[
                "white vinegar",
                "apple cider vinegar",
                "red wine vinegar",
                "balsamic vinegar",
            ],
        ),
        CatalogIngredient(name="black pepper", aliases=["pepper", "ground black pepper"]),
        CatalogIngredient(name="olive oil", aliases=["extra virgin olive oil", "evoo"]),
        CatalogIngredient(name="corn", aliases=["corn kernels"]),
    ]
    balsamic = match_catalog_ingredient("balsamic vinegar", catalog)
    assert balsamic.catalog is not None
    assert balsamic.catalog.name == "vinegar"
    assert balsamic.note == "balsamic"

    cider = match_catalog_ingredient("apple cider vinegar", catalog)
    assert cider.catalog is not None
    assert cider.catalog.name == "vinegar"
    assert cider.note == "apple cider"

    # Short alias expands to canonical name — no leftover note.
    pepper = match_catalog_ingredient("pepper", catalog)
    assert pepper.catalog is not None
    assert pepper.catalog.name == "black pepper"
    assert pepper.note == ""

    evoo = match_catalog_ingredient("evoo", catalog)
    assert evoo.catalog is not None
    assert evoo.catalog.name == "olive oil"
    assert evoo.note == ""

    # Synonym alias where catalog name is a prefix, not the head suffix.
    corn = match_catalog_ingredient("corn kernels", catalog)
    assert corn.catalog is not None
    assert corn.catalog.name == "corn"
    assert corn.note == ""


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


def test_match_pickled_jalapenos_keeps_pickled_as_note():
    catalog = [
        CatalogIngredient(name="jalapenos", aliases=[]),
    ]
    match = match_catalog_ingredient("pickled jalapeños", catalog)
    assert match.catalog is not None
    assert match.catalog.name == "jalapenos"
    assert match.note == "pickled"

    # Brine is a different substance — leave unmatched rather than collapsing to jalapenos.
    assert match_catalog_ingredient("pickled jalapeño brine", catalog).catalog is None
    assert match_catalog_ingredient("jalapeño brine", catalog).catalog is None


def test_match_prefers_jalapeno_brine_over_jalapenos():
    catalog = [
        CatalogIngredient(name="jalapenos", aliases=[]),
        CatalogIngredient(name="jalapeno brine", aliases=[]),
    ]
    brine = match_catalog_ingredient("pickled jalapeño brine", catalog)
    assert brine.catalog is not None
    assert brine.catalog.name == "jalapeno brine"
    assert brine.note == "pickled"


def test_match_folds_accents_without_aliases():
    catalog = [CatalogIngredient(name="jalapenos", aliases=[])]
    exact = match_catalog_ingredient("jalapeños", catalog)
    assert exact.catalog is not None
    assert exact.catalog.name == "jalapenos"
    assert exact.note == ""


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


def test_match_rejects_substance_changing_partial_hits():
    catalog = [
        CatalogIngredient(
            name="black pepper",
            aliases=["pepper", "ground black pepper"],
        ),
        CatalogIngredient(
            name="green bell pepper",
            aliases=[
                "bell pepper",
                "green pepper",
                "italian frying pepper",
                "cubanelle pepper",
            ],
        ),
        CatalogIngredient(name="ground beef", aliases=["beef", "minced beef"]),
        CatalogIngredient(name="vanilla extract", aliases=["vanilla"]),
        CatalogIngredient(name="vanilla bean", aliases=["vanilla pod"]),
        CatalogIngredient(name="milk", aliases=["whole milk"]),
        CatalogIngredient(name="sweetened condensed milk", aliases=["condensed milk"]),
        CatalogIngredient(name="apricots", aliases=[]),
        CatalogIngredient(name="apricot jam", aliases=["apricot preserves"]),
        CatalogIngredient(name="instant vanilla pudding mix", aliases=["vanilla pudding mix"]),
    ]

    bell = match_catalog_ingredient("green bell pepper", catalog)
    assert bell.catalog is not None
    assert bell.catalog.name == "green bell pepper"

    frying = match_catalog_ingredient("italian frying pepper", catalog)
    assert frying.catalog is not None
    assert frying.catalog.name == "green bell pepper"

    # Expanding short aliases must not swallow vegetable/cut varieties.
    assert match_catalog_ingredient("cubanelle pepper", catalog).catalog.name == "green bell pepper"
    assert match_catalog_ingredient("anaheim pepper", catalog).catalog is None
    assert match_catalog_ingredient("roast beef", catalog).catalog is None
    # "roasted"/"red" are modifier words, but must not expand pepper → black pepper.
    assert match_catalog_ingredient("roasted red pepper", catalog).catalog is None
    assert match_catalog_ingredient("red pepper", catalog).catalog is None
    assert match_catalog_ingredient("roasted pepper", catalog).catalog is None

    assert match_catalog_ingredient("vanilla bean", catalog).catalog.name == "vanilla bean"
    assert (
        match_catalog_ingredient("sweetened condensed milk", catalog).catalog.name
        == "sweetened condensed milk"
    )
    assert match_catalog_ingredient("apricot jam", catalog).catalog.name == "apricot jam"
    assert (
        match_catalog_ingredient("instant vanilla pudding mix", catalog).catalog.name
        == "instant vanilla pudding mix"
    )


def test_match_still_allows_safe_head_noun_notes():
    catalog = [
        CatalogIngredient(name="lemons", aliases=[]),
        CatalogIngredient(name="zest", aliases=[]),
        CatalogIngredient(name="onions", aliases=[]),
        CatalogIngredient(name="eggs", aliases=[]),
    ]
    zest = match_catalog_ingredient("lemon zest", catalog)
    assert zest.catalog is not None
    assert zest.catalog.name == "zest"
    assert zest.note == "lemon"

    onion = match_catalog_ingredient("yellow onion", catalog)
    assert onion.catalog is not None
    assert onion.catalog.name == "onions"
    assert onion.note == "yellow"

    egg = match_catalog_ingredient("large egg", catalog)
    assert egg.catalog is not None
    assert egg.note == "large"


def test_apply_catalog_mapping_maps_roasted_red_pepper_as_own_ingredient(tmp_path):
    repository = IngredientRepository(catalog_path=tmp_path / "ingredients.json")
    repository.upsert(
        CatalogIngredient(name="black pepper", aliases=["pepper", "ground black pepper"])
    )
    repository.upsert(
        CatalogIngredient(
            name="bell pepper",
            aliases=["red pepper", "green pepper"],
        )
    )
    repository.upsert(
        CatalogIngredient(
            name="roasted red peppers",
            aliases=["roasted red pepper", "jarred roasted red peppers"],
        )
    )
    repository.upsert(
        CatalogIngredient(
            name="red pepper flakes",
            aliases=["crushed red pepper", "crushed red pepper flakes"],
        )
    )

    body = "Dice @roasted red pepper{1} and @chorizo{150%g}."
    mapped, unmatched = apply_catalog_mapping(body, repository)
    assert "@roasted red peppers{1}" in mapped
    assert "@black pepper" not in mapped
    assert "@bell pepper" not in mapped
    assert unmatched == []

    flakes_body = "Add @red pepper flakes{1%tsp}."
    flakes_mapped, _ = apply_catalog_mapping(flakes_body, repository)
    assert "@red pepper flakes{1%tsp}." in flakes_mapped


def test_apply_catalog_mapping_does_not_corrupt_bell_pepper(tmp_path):
    repository = IngredientRepository(catalog_path=tmp_path / "ingredients.json")
    repository.upsert(
        CatalogIngredient(name="black pepper", aliases=["pepper", "ground black pepper"])
    )
    repository.upsert(
        CatalogIngredient(
            name="green bell pepper",
            aliases=["bell pepper", "green pepper", "italian frying pepper"],
        )
    )

    body = "Add @green bell pepper{1}(diced)."
    mapped, unmatched = apply_catalog_mapping(body, repository)
    assert "@green bell pepper{1}(diced)" in mapped
    assert unmatched == []

    frying_body = "Add @italian frying pepper{1}(cored and seeded)."
    frying_mapped, frying_unmatched = apply_catalog_mapping(frying_body, repository)
    assert "@green bell pepper{1}(italian frying, cored and seeded)" in frying_mapped
    assert frying_unmatched == []


def test_apply_catalog_mapping_reinterprets_oz_as_fl_oz_for_cocktails(tmp_path):
    repository = IngredientRepository(catalog_path=tmp_path / "ingredients.json")
    repository.upsert(CatalogIngredient(name="simple syrup", density_kg_m3=1330))
    repository.upsert(CatalogIngredient(name="vodka", density_kg_m3=940))

    body = "Add @simple syrup{1%oz} and @vodka{2%fl oz}."
    mass_mapped, _ = apply_catalog_mapping(body, repository)
    assert "@simple syrup{1%oz}" in mass_mapped
    assert "@vodka{2%fl oz}" in mass_mapped

    fluid_mapped, unmatched = apply_catalog_mapping(
        body,
        repository,
        reinterpret_oz_as_fl_oz=True,
    )
    assert unmatched == []
    assert "@simple syrup{1%fl oz}" in fluid_mapped
    assert "@vodka{2%fl oz}" in fluid_mapped
