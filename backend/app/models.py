from typing import Any

from pydantic import BaseModel, Field, HttpUrl


class Ingredient(BaseModel):
    fixed: bool = False
    name: str
    note: str | None = None
    quantity: str | None = None
    scaled_quantity: str | None = None
    unit: str | None = None


class CatalogIngredient(BaseModel):
    name: str
    density_kg_m3: float | None = None
    aliases: list[str] = Field(default_factory=list)


class IngredientCatalog(BaseModel):
    version: int = 1
    ingredients: list[CatalogIngredient] = Field(default_factory=list)


class IngredientRenameRequest(BaseModel):
    old_name: str
    ingredient: CatalogIngredient


class IngredientRenameResponse(BaseModel):
    ingredient: CatalogIngredient
    updated_recipes: list[str] = Field(default_factory=list)


class DensityEstimateRequest(BaseModel):
    names: list[str] = Field(default_factory=list)


class DensityEstimate(BaseModel):
    name: str
    density_kg_m3: float | None = None


class DensityEstimateResponse(BaseModel):
    estimates: list[DensityEstimate] = Field(default_factory=list)


class RecipeNote(BaseModel):
    kind: str = "note"
    text: str


class RecipeSection(BaseModel):
    kind: str = "section"
    title: str


class RecipeStep(BaseModel):
    kind: str = "step"
    text: str


class RecipeSummary(BaseModel):
    bookmarked: bool = False
    cook_time: str | None = None
    image: str | None = None
    notes: list[str] = Field(default_factory=list)
    original_url: str | None = None
    review: list[str] = Field(default_factory=list)
    servings: float = 1
    slug: str
    tags: list[str] = Field(default_factory=list)
    title: str


class RecipeDetail(RecipeSummary):
    content: str
    cookware: list[str] = Field(default_factory=list)
    ingredients: list[Ingredient] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    public_url: str
    blocks: list[RecipeNote | RecipeSection | RecipeStep] = Field(default_factory=list)
    timers: list[str] = Field(default_factory=list)
    updated_at: str | None = None


class RecipeWrite(BaseModel):
    content: str
    previous_slug: str | None = None
    slug: str


class RecipeUpdate(BaseModel):
    content: str
    slug: str | None = None


class MetadataUpdate(BaseModel):
    bookmarked: bool | None = None
    image: str | None = None
    review: list[str] | None = None
    servings: float | None = None
    tags: list[str] | None = None


class ImportRequest(BaseModel):
    url: HttpUrl


class ImportPreview(BaseModel):
    content: str
    suggested_slug: str
    unmatched_ingredients: list[str] = Field(default_factory=list)
    validation_warnings: list[str] = Field(default_factory=list)
    image_url: str | None = None


class ImportFileRequest(BaseModel):
    slug: str


class AssetUploadResponse(BaseModel):
    path: str


class LoginRequest(BaseModel):
    password: str
    username: str


class AuthState(BaseModel):
    authenticated: bool
    username: str | None = None


class SearchResult(BaseModel):
    match: str
    recipe: RecipeSummary
    score: int


class ManifestEntry(BaseModel):
    slug: str
    updated_at: str


class SyncManifest(BaseModel):
    version: int
    recipes: list[ManifestEntry]
