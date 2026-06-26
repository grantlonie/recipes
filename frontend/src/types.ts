export interface AuthState {
  authenticated: boolean
  username?: string | null
}

export interface Ingredient {
  fixed: boolean
  name: string
  quantity?: string | null
  scaled_quantity?: string | null
  unit?: string | null
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

export interface RecipeDetail extends RecipeSummary {
  content: string
  cookware: string[]
  ingredients: Ingredient[]
  metadata: Record<string, unknown>
  public_url: string
  steps: string[]
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
}

export interface RecipeMetadataInput {
  bookmarked?: boolean
  image?: string | null
  servings?: number | null
  tags?: string[] | null
}
