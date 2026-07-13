export interface AuthState {
  authenticated: boolean
  username?: string | null
}

export type UnitSystem = 'metric' | 'us' | 'us_weight'

export interface Ingredient {
  fixed: boolean
  name: string
  note?: string | null
  quantity?: string | null
  scaled_quantity?: string | null
  unit?: string | null
}

export interface CatalogIngredient {
  name: string
  density_kg_m3?: number | null
  aliases: string[]
}

export interface IngredientCatalog {
  version: number
  ingredients: CatalogIngredient[]
}

export interface DensityEstimate {
  name: string
  density_kg_m3?: number | null
}

export interface RecipeSummary {
  bookmarked: boolean
  cook_time?: string | null
  image?: string | null
  notes: string[]
  original_url?: string | null
  servings: number
  slug: string
  tags: string[]
  title: string
}

export type RecipeBlock = { kind: 'section'; title: string } | { kind: 'step'; text: string }

export interface RecipeDetail extends RecipeSummary {
  content: string
  cookware: string[]
  ingredients: Ingredient[]
  metadata: Record<string, unknown>
  public_url: string
  blocks?: RecipeBlock[]
  timers: string[]
}

export interface SearchResult {
  match: string
  recipe: RecipeSummary
  score: number
}

export interface ImportPreview {
  content: string
  suggested_slug: string
  unmatched_ingredients?: string[]
  validation_warnings?: string[]
}

export interface AssetUploadResponse {
  path: string
}

export interface RecipeMetadataInput {
  bookmarked?: boolean
  image?: string | null
  servings?: number | null
  tags?: string[] | null
}

export interface ManifestEntry {
  slug: string
  updated_at: string
}

export interface SyncManifest {
  version: number
  recipes: ManifestEntry[]
}
