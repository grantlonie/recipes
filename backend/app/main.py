from collections.abc import Iterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import auth
from app.config import Settings, get_settings
from app.importer import ImportError, import_from_url
from app.models import (
    AuthState,
    Group,
    GroupWrite,
    ImportPreview,
    ImportRequest,
    LoginRequest,
    MetadataUpdate,
    RecipeDetail,
    RecipeSummary,
    RecipeUpdate,
    RecipeWrite,
    SearchResult,
)
from app.search import search_details
from app.storage import RecipeRepository, StorageError, summary_from_detail


@asynccontextmanager
async def lifespan(app: FastAPI) -> Iterator[None]:
    settings = get_settings()
    app.state.repository = RecipeRepository(
        app_base_url=settings.app_base_url,
        groups_root=settings.groups_root,
        recipe_root=settings.recipe_root,
    )
    yield


app = FastAPI(title="Recipes", lifespan=lifespan)


def get_repository(request: Request) -> RecipeRepository:
    return request.app.state.repository


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


@app.get("/api/recipes")
def list_recipes(
    group: str | None = None,
    q: str | None = None,
    tags: list[str] = Query(default=[]),
    repository: RecipeRepository = Depends(get_repository),
) -> list[RecipeSummary] | list[SearchResult]:
    recipes = repository.list_recipes()
    if group:
        wanted = set(next((item.recipes for item in repository.list_groups() if item.slug == group), []))
        recipes = [recipe for recipe in recipes if recipe.slug in wanted]
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


@app.get("/api/groups")
def list_groups(repository: RecipeRepository = Depends(get_repository)) -> list[Group]:
    return repository.list_groups()


@app.post("/api/groups", dependencies=[Depends(auth.require_editor)])
def create_group(payload: GroupWrite, repository: RecipeRepository = Depends(get_repository)) -> Group:
    return repository.write_group(slugify(payload.title), payload.title, payload.recipes)


@app.put("/api/groups/{slug}", dependencies=[Depends(auth.require_editor)])
def update_group(
    slug: str,
    payload: GroupWrite,
    repository: RecipeRepository = Depends(get_repository),
) -> Group:
    return repository.write_group(slug, payload.title, payload.recipes)


@app.delete("/api/groups/{slug}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(auth.require_editor)])
def delete_group(slug: str, repository: RecipeRepository = Depends(get_repository)) -> Response:
    repository.delete_group(slug)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/api/import", dependencies=[Depends(auth.require_editor)])
def import_recipe(payload: ImportRequest) -> ImportPreview:
    try:
        return import_from_url(str(payload.url))
    except ImportError as error:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)) from error


@app.post("/api/recipes", dependencies=[Depends(auth.require_editor)])
def create_recipe(
    payload: RecipeWrite,
    repository: RecipeRepository = Depends(get_repository),
) -> RecipeDetail:
    try:
        return repository.write_recipe(payload.slug, payload.content)
    except StorageError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error


@app.get("/api/recipe-scale/{slug:path}")
def get_scaled_recipe(
    slug: str,
    servings: float,
    repository: RecipeRepository = Depends(get_repository),
) -> RecipeDetail:
    try:
        return repository.get_recipe(slug, scaled_servings=servings)
    except StorageError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error


@app.get("/api/recipes/{slug:path}")
def get_recipe(slug: str, repository: RecipeRepository = Depends(get_repository)) -> RecipeDetail:
    try:
        return repository.get_recipe(slug)
    except StorageError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error


@app.put("/api/recipes/{slug:path}", dependencies=[Depends(auth.require_editor)])
def update_recipe(
    slug: str,
    payload: RecipeUpdate,
    repository: RecipeRepository = Depends(get_repository),
) -> RecipeDetail:
    try:
        return repository.write_recipe(slug, payload.content)
    except StorageError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error


@app.patch("/api/recipes/{slug:path}/metadata", dependencies=[Depends(auth.require_editor)])
def update_metadata(
    slug: str,
    payload: MetadataUpdate,
    repository: RecipeRepository = Depends(get_repository),
) -> RecipeDetail:
    try:
        return repository.update_metadata(
            slug,
            image=payload.image,
            servings=payload.servings,
            tags=payload.tags,
        )
    except StorageError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error


def slugify(value: str) -> str:
    return "-".join(part for part in "".join(char.lower() if char.isalnum() else "-" for char in value).split("-") if part)


settings = get_settings()
dist_path = settings.frontend_dist
assets_path = dist_path / "assets"
if assets_path.exists():
    app.mount("/assets", StaticFiles(directory=assets_path), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str) -> FileResponse:
    index = settings.frontend_dist / "index.html"
    target = settings.frontend_dist / path
    if path and target.exists() and target.is_file():
        return FileResponse(target)
    if index.exists():
        return FileResponse(index)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Frontend not built")
