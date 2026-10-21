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

export interface IngredientRenameResult {
  ingredient: CatalogIngredient
  updated_recipes: string[]
}

export interface DensityEstimate {
  name: string
  density_kg_m3?: number | null
}

export interface RecipeSummary {
  bookmarked: boolean
  cook_time?: string | null
  image?: string | null
  image_pending?: boolean
  notes: string[]
  original_url?: string | null
  review?: string[]
  servings: number
  site?: string | null
  slug: string
  tags: string[]
  title: string
}

export type RecipeBlock =
  | { kind: 'note'; text: string }
  | { kind: 'section'; title: string }
  | { kind: 'step'; text: string }

export interface RecipeHydration {
  adjustable: boolean
  flour_g: number
  issues: string[]
  liquid_g: number
  percent: number | null
  starter_g: number
}

export interface RecipeDetail extends RecipeSummary {
  content: string
  cookware: string[]
  hydration?: RecipeHydration | null
  ingredients: Ingredient[]
  metadata: Record<string, unknown>
  public_url: string
  blocks?: RecipeBlock[]
  timers: string[]
  updated_at?: string | null
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
  image_url?: string | null
}

export interface AssetUploadResponse {
  path: string
}

export interface ScaleOptionInput {
  id: string
  label: string
  value: number
}

export interface RecipeMetadataInput {
  bookmarked?: boolean
  image?: string | null
  review?: string[] | null
  scale_default?: string | null
  scale_options?: ScaleOptionInput[] | null
  servings?: number | null
  tags?: string[] | null
}

export interface ImportModels {
  bulk: string
  fireworks_dashboard_url: string
  fireworks_models_url: string
  repair: string
  text: string
  vision: string
}

export type ImportModelsInput = Pick<ImportModels, 'bulk' | 'repair' | 'text' | 'vision'>

export interface ManifestEntry {
  slug: string
  updated_at: string
}

export interface SyncManifest {
  version: number
  recipes: ManifestEntry[]
}
