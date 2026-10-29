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
    image_pending: bool = False
    notes: list[str] = Field(default_factory=list)
    original_url: str | None = None
    review: list[str] = Field(default_factory=list)
    servings: float = 1
    site: str | None = None
    slug: str
    tags: list[str] = Field(default_factory=list)
    title: str


class RecipeHydration(BaseModel):
    adjustable: bool
    flour_g: float
    issues: list[str] = Field(default_factory=list)
    liquid_g: float
    percent: float | None = None
    starter_g: float = 0


class RecipeDetail(RecipeSummary):
    content: str
    cookware: list[str] = Field(default_factory=list)
    hydration: RecipeHydration | None = None
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


class HydrationUpdate(BaseModel):
    percent: float


class ScaleOption(BaseModel):
    id: str
    label: str
    value: float


class MetadataUpdate(BaseModel):
    bookmarked: bool | None = None
    image: str | None = None
    review: list[str] | None = None
    scale_default: str | None = None
    scale_options: list[ScaleOption] | None = None
    servings: float | None = None
    tags: list[str] | None = None


class ImportRequest(BaseModel):
    url: HttpUrl


class ImportTextRequest(BaseModel):
    instruction: str | None = None
    text: str


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


class SourceTextResponse(BaseModel):
    text: str
    website_url: str | None = None


class LoginRequest(BaseModel):
    password: str
    username: str


class AuthState(BaseModel):
    authenticated: bool
    username: str | None = None


class ImportModelsUpdate(BaseModel):
    bulk: str
    repair: str
    text: str
    vision: str


class ImportModelsResponse(BaseModel):
    bulk: str
    fireworks_dashboard_url: str
    fireworks_models_url: str
    repair: str
    text: str
    vision: str


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
