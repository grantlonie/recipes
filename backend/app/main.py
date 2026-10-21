from collections.abc import Iterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import (
    Depends,
    FastAPI,
    File,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import auth
from app.config import Settings, get_settings
from app.density_estimate import estimate_ingredient_densities
from app.extract import ExtractError, extract_text_from_path
from app.fireworks_llm import LLMError
from app.hydration import HydrationError, apply_hydration, summarize_hydration_from_content
from app.import_models import (
    FIREWORKS_DASHBOARD_URL,
    FIREWORKS_MODELS_URL,
    ImportModelSettings,
    ImportModelStorageError,
    resolve_import_models,
    save_import_models,
)
from app.importer import (
    ImportError,
    import_from_slug_file,
    import_from_text,
    import_from_upload,
    import_from_url,
)
from app.ingredients import (
    IngredientConflictError,
    IngredientRepository,
    IngredientStorageError,
)
from app.manifest import build_web_manifest
from app.models import (
    AssetUploadResponse,
    AuthState,
    CatalogIngredient,
    DensityEstimateRequest,
    DensityEstimateResponse,
    HydrationUpdate,
    ImportFileRequest,
    ImportModelsResponse,
    ImportModelsUpdate,
    ImportPreview,
    ImportRequest,
    ImportTextRequest,
    IngredientCatalog,
    IngredientRenameRequest,
    IngredientRenameResponse,
    LoginRequest,
    MetadataUpdate,
    RecipeDetail,
    RecipeHydration,
    RecipeSummary,
    RecipeUpdate,
    RecipeWrite,
    SearchResult,
    SourceTextResponse,
    SyncManifest,
)
from app.page_fetch import first_http_url
from app.search import search_details
from app.sources import (
    ALLOWED_IMAGE_EXTENSIONS,
    ALLOWED_SOURCE_EXTENSIONS,
    AssetError,
    guess_media_type,
    resolve_asset_file,
    save_upload,
)
from app.storage import RecipeRepository, StorageError


@asynccontextmanager
async def lifespan(app: FastAPI) -> Iterator[None]:
    settings = get_settings()
    app.state.repository = RecipeRepository(
        app_base_url=settings.app_base_url,
        recipe_root=settings.recipe_root,
    )
    app.state.ingredients = IngredientRepository(catalog_path=settings.ingredients_path)
    yield


app = FastAPI(title="Recipes", lifespan=lifespan)


def get_repository(request: Request) -> RecipeRepository:
    return request.app.state.repository


def get_ingredients(request: Request) -> IngredientRepository:
    return request.app.state.ingredients


def get_settings_dep() -> Settings:
    return get_settings()


def _density_lookup(ingredients: IngredientRepository):
    def density_for_name(name: str) -> float | None:
        item = ingredients.find_by_name(name)
        return item.density_kg_m3 if item is not None else None

    return density_for_name


def with_hydration(recipe: RecipeDetail, ingredients: IngredientRepository) -> RecipeDetail:
    summary = summarize_hydration_from_content(recipe.content, _density_lookup(ingredients))
    if summary is None:
        return recipe.model_copy(update={"hydration": None})
    return recipe.model_copy(
        update={
            "hydration": RecipeHydration(
                adjustable=summary.adjustable,
                flour_g=summary.flour_g,
                issues=summary.issues,
                liquid_g=summary.liquid_g,
                percent=summary.percent,
                starter_g=summary.starter_g,
            )
        }
    )


settings = get_settings()
assets_path = settings.frontend_dist / "assets"
if assets_path.exists():
    app.mount("/assets", StaticFiles(directory=assets_path), name="assets")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/auth/me")
def me(auth_state: AuthState = Depends(auth.current_auth_state)) -> AuthState:
    return auth_state


@app.post("/api/auth/login")
def login(
    payload: LoginRequest,
    response: Response,
    settings: Settings = Depends(get_settings),
) -> AuthState:
    return auth.login(response, payload, settings)


@app.post("/api/auth/logout")
def logout(response: Response) -> AuthState:
    return auth.logout(response)


def _import_models_response(models: ImportModelSettings) -> ImportModelsResponse:
    return ImportModelsResponse(
        bulk=models.bulk,
        fireworks_dashboard_url=FIREWORKS_DASHBOARD_URL,
        fireworks_models_url=FIREWORKS_MODELS_URL,
        repair=models.repair,
        text=models.text,
        vision=models.vision,
    )


@app.get(
    "/api/settings/import-models",
    dependencies=[Depends(auth.require_editor)],
)
def get_import_models_settings(
    settings: Settings = Depends(get_settings_dep),
) -> ImportModelsResponse:
    return _import_models_response(resolve_import_models(settings))


@app.put(
    "/api/settings/import-models",
    dependencies=[Depends(auth.require_editor)],
)
def update_import_models_settings(
    payload: ImportModelsUpdate,
    settings: Settings = Depends(get_settings_dep),
) -> ImportModelsResponse:
    try:
        saved = save_import_models(
            settings,
            ImportModelSettings(
                bulk=payload.bulk,
                repair=payload.repair,
                text=payload.text,
                vision=payload.vision,
            ),
        )
    except ImportModelStorageError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
    return _import_models_response(saved)


@app.get("/api/sync/manifest")
def sync_manifest(repository: RecipeRepository = Depends(get_repository)) -> SyncManifest:
    return repository.manifest()


@app.get("/api/sync/recipes")
def sync_recipes(
    repository: RecipeRepository = Depends(get_repository),
    ingredients: IngredientRepository = Depends(get_ingredients),
) -> list[RecipeDetail]:
    return [with_hydration(recipe, ingredients) for recipe in repository.list_all_details()]


@app.get("/api/recipes")
def list_recipes(
    q: str | None = None,
    tags: list[str] = Query(default=[]),
    repository: RecipeRepository = Depends(get_repository),
) -> list[RecipeSummary] | list[SearchResult]:
    recipes = repository.list_recipes()
    if tags:
        tag_set = {tag.casefold() for tag in tags}
        recipes = [
            recipe
            for recipe in recipes
            if tag_set.issubset({tag.casefold() for tag in recipe.tags})
        ]
    if q:
        details = {slug: recipe.content for slug, recipe in repository.recipes.items()}
        return search_details(recipes, details, q)
    return recipes


@app.get("/api/tags")
def list_tags(repository: RecipeRepository = Depends(get_repository)) -> list[str]:
    tags = {tag for recipe in repository.list_recipes() for tag in recipe.tags}
    return sorted(tags, key=str.casefold)


@app.get("/api/ingredients")
def get_ingredient_catalog(
    ingredients: IngredientRepository = Depends(get_ingredients),
) -> IngredientCatalog:
    return ingredients.get_catalog()


@app.put("/api/ingredients", dependencies=[Depends(auth.require_editor)])
def upsert_ingredient(
    payload: CatalogIngredient,
    ingredients: IngredientRepository = Depends(get_ingredients),
) -> CatalogIngredient:
    try:
        return ingredients.upsert(payload)
    except IngredientStorageError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error


@app.post("/api/ingredients/rename", dependencies=[Depends(auth.require_editor)])
def rename_ingredient(
    payload: IngredientRenameRequest,
    ingredients: IngredientRepository = Depends(get_ingredients),
    repository: RecipeRepository = Depends(get_repository),
) -> IngredientRenameResponse:
    old_name = payload.old_name.strip()
    try:
        renamed = ingredients.rename(old_name, payload.ingredient)
    except IngredientConflictError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    except IngredientStorageError as error:
        status_code = (
            status.HTTP_404_NOT_FOUND
            if str(error) == "Ingredient not found"
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=status_code, detail=str(error)) from error

    updated_recipes: list[str] = []
    if old_name.casefold() != renamed.name.casefold():
        updated_recipes = repository.rewrite_ingredient_name(old_name, renamed.name)

    return IngredientRenameResponse(ingredient=renamed, updated_recipes=updated_recipes)


@app.post("/api/ingredients/estimate-density", dependencies=[Depends(auth.require_editor)])
def estimate_ingredient_density(
    payload: DensityEstimateRequest,
    settings: Settings = Depends(get_settings_dep),
) -> DensityEstimateResponse:
    try:
        estimates = estimate_ingredient_densities(settings=settings, names=payload.names)
    except LLMError as error:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)) from error
    return DensityEstimateResponse(estimates=estimates)


@app.delete(
    "/api/ingredients/{name}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(auth.require_editor)],
)
def delete_ingredient(
    name: str,
    ingredients: IngredientRepository = Depends(get_ingredients),
) -> Response:
    try:
        ingredients.delete(name)
    except IngredientStorageError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/api/import", dependencies=[Depends(auth.require_editor)])
def import_recipe(
    payload: ImportRequest,
    settings: Settings = Depends(get_settings_dep),
    ingredients: IngredientRepository = Depends(get_ingredients),
) -> ImportPreview:
    try:
        return import_from_url(str(payload.url), settings=settings, ingredients=ingredients)
    except ImportError as error:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)) from error


@app.post("/api/import/text", dependencies=[Depends(auth.require_editor)])
def import_recipe_text(
    payload: ImportTextRequest,
    settings: Settings = Depends(get_settings_dep),
    ingredients: IngredientRepository = Depends(get_ingredients),
) -> ImportPreview:
    try:
        return import_from_text(payload.text, settings=settings, ingredients=ingredients)
    except ImportError as error:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)) from error


@app.post("/api/import/file", dependencies=[Depends(auth.require_editor)])
def import_recipe_file(
    payload: ImportFileRequest,
    settings: Settings = Depends(get_settings_dep),
    ingredients: IngredientRepository = Depends(get_ingredients),
    repository: RecipeRepository = Depends(get_repository),
) -> ImportPreview:
    try:
        return import_from_slug_file(
            payload.slug,
            settings=settings,
            ingredients=ingredients,
            recipe_root=repository.recipe_root,
        )
    except ImportError as error:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)) from error


@app.post("/api/import/upload", dependencies=[Depends(auth.require_editor)])
async def import_recipe_upload(
    file: UploadFile = File(...),
    settings: Settings = Depends(get_settings_dep),
    ingredients: IngredientRepository = Depends(get_ingredients),
) -> ImportPreview:
    try:
        return await import_from_upload(file, settings=settings, ingredients=ingredients)
    except ImportError as error:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)) from error


@app.post(
    "/api/recipes/{slug}/source",
    dependencies=[Depends(auth.require_editor)],
)
async def upload_recipe_source(
    slug: str,
    file: UploadFile = File(...),
    settings: Settings = Depends(get_settings_dep),
) -> AssetUploadResponse:
    try:
        path = await save_upload(
            settings.recipe_root,
            slug,
            "source",
            file,
            allowed_extensions=ALLOWED_SOURCE_EXTENSIONS,
        )
        return AssetUploadResponse(path=path)
    except AssetError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error


@app.post(
    "/api/recipes/{slug}/image",
    dependencies=[Depends(auth.require_editor)],
)
async def upload_recipe_image(
    slug: str,
    file: UploadFile = File(...),
    settings: Settings = Depends(get_settings_dep),
) -> AssetUploadResponse:
    try:
        path = await save_upload(
            settings.recipe_root,
            slug,
            "image",
            file,
            allowed_extensions=ALLOWED_IMAGE_EXTENSIONS,
        )
        return AssetUploadResponse(path=path)
    except AssetError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error


@app.get("/api/sources/{asset_path:path}", response_model=None)
def get_recipe_asset(
    asset_path: str,
    format: str | None = Query(default=None),
    settings: Settings = Depends(get_settings_dep),
) -> FileResponse | SourceTextResponse:
    relative_path = f"recipes/{asset_path}"
    try:
        file_path = resolve_asset_file(settings.recipe_root, relative_path)
    except AssetError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    if format == "text":
        try:
            text = extract_text_from_path(file_path)
        except ExtractError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(error),
            ) from error
        website_url = first_http_url(text)
        if not website_url:
            website_url = _website_url_from_source_bytes(file_path)
        return SourceTextResponse(text=text, website_url=website_url)
    return FileResponse(
        file_path,
        media_type=guess_media_type(file_path),
        filename=file_path.name,
        content_disposition_type="inline",
    )


@app.post("/api/recipes", dependencies=[Depends(auth.require_editor)])
def create_recipe(
    payload: RecipeWrite,
    repository: RecipeRepository = Depends(get_repository),
    ingredients: IngredientRepository = Depends(get_ingredients),
) -> RecipeDetail:
    try:
        return with_hydration(
            repository.write_recipe(
                payload.slug,
                payload.content,
                previous_slug=payload.previous_slug,
            ),
            ingredients,
        )
    except StorageError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error


@app.get("/api/recipe-scale/{slug:path}")
def get_scaled_recipe(
    slug: str,
    servings: float,
    repository: RecipeRepository = Depends(get_repository),
    ingredients: IngredientRepository = Depends(get_ingredients),
) -> RecipeDetail:
    try:
        # Hydration is always from the base recipe (independent of scale).
        return with_hydration(repository.get_recipe(slug, scaled_servings=servings), ingredients)
    except StorageError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error


@app.get("/api/recipes/{slug:path}")
def get_recipe(
    slug: str,
    repository: RecipeRepository = Depends(get_repository),
    ingredients: IngredientRepository = Depends(get_ingredients),
) -> RecipeDetail:
    try:
        return with_hydration(repository.get_recipe(slug), ingredients)
    except StorageError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error


@app.put("/api/recipes/{slug:path}", dependencies=[Depends(auth.require_editor)])
def update_recipe(
    slug: str,
    payload: RecipeUpdate,
    repository: RecipeRepository = Depends(get_repository),
    ingredients: IngredientRepository = Depends(get_ingredients),
) -> RecipeDetail:
    try:
        target_slug = payload.slug or slug
        previous_slug = slug if target_slug != slug else None
        return with_hydration(
            repository.write_recipe(
                target_slug,
                payload.content,
                previous_slug=previous_slug,
            ),
            ingredients,
        )
    except StorageError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error


@app.post(
    "/api/recipes/{slug:path}/hydration",
    dependencies=[Depends(auth.require_editor)],
)
def update_recipe_hydration(
    slug: str,
    payload: HydrationUpdate,
    repository: RecipeRepository = Depends(get_repository),
    ingredients: IngredientRepository = Depends(get_ingredients),
) -> RecipeDetail:
    try:
        recipe = repository.get_recipe(slug)
    except StorageError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    try:
        new_content, _summary = apply_hydration(
            recipe.content, payload.percent, _density_lookup(ingredients)
        )
        return with_hydration(repository.write_recipe(slug, new_content), ingredients)
    except HydrationError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
    except StorageError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error


@app.delete(
    "/api/recipes/{slug:path}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(auth.require_editor)],
)
def delete_recipe(slug: str, repository: RecipeRepository = Depends(get_repository)) -> Response:
    try:
        repository.delete_recipe(slug)
    except StorageError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.patch("/api/recipes/{slug:path}/metadata", dependencies=[Depends(auth.require_editor)])
def update_metadata(
    slug: str,
    payload: MetadataUpdate,
    repository: RecipeRepository = Depends(get_repository),
    ingredients: IngredientRepository = Depends(get_ingredients),
) -> RecipeDetail:
    try:
        scale_options = (
            [option.model_dump() for option in payload.scale_options]
            if payload.scale_options is not None
            else None
        )
        return with_hydration(
            repository.update_metadata(
                slug,
                bookmarked=payload.bookmarked,
                image=payload.image,
                servings=payload.servings,
                tags=payload.tags,
                review=payload.review,
                scale_default=payload.scale_default,
                scale_options=scale_options,
            ),
            ingredients,
        )
    except StorageError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error


@app.get("/manifest.webmanifest", include_in_schema=False)
def web_manifest(settings: Settings = Depends(get_settings)) -> JSONResponse:
    return JSONResponse(
        build_web_manifest(settings),
        media_type="application/manifest+json",
    )


@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str) -> FileResponse:
    index = settings.frontend_dist / "index.html"
    target = settings.frontend_dist / path
    if path and target.exists() and target.is_file():
        return FileResponse(target)
    if index.exists():
        return FileResponse(index)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Frontend not built")


def _website_url_from_source_bytes(file_path: Path) -> str | None:
    """Best-effort URL from raw source bytes (HTML often loses links after extraction)."""
    try:
        raw = file_path.read_bytes()
    except OSError:
        return None
    for encoding in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            return first_http_url(raw.decode(encoding))
        except UnicodeDecodeError:
            continue
    return None
