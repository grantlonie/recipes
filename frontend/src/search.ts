import type { RecipeDetail, RecipeSummary } from './types'

export function searchRecipes(
  summaries: RecipeSummary[],
  details: RecipeDetail[],
  query: string,
): RecipeSummary[] {
  const terms = query
    .split(/\s+/)
    .map(term => term.trim().toLocaleLowerCase())
    .filter(Boolean)
  if (!terms.length) {
    return summaries
  }

  const contentBySlug = new Map(details.map(recipe => [recipe.slug, recipe.content.toLocaleLowerCase()]))
  const results: Array<{ recipe: RecipeSummary; score: number }> = []

  for (const recipe of summaries) {
    const score = scoreRecipe(recipe, contentBySlug.get(recipe.slug) ?? '', terms)
    if (score > 0) {
      results.push({ recipe, score })
    }
  }

  return results
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return left.recipe.title.localeCompare(right.recipe.title, undefined, { sensitivity: 'base' })
    })
    .map(result => result.recipe)
}

function scoreRecipe(recipe: RecipeSummary, content: string, terms: string[]): number {
  const title = recipe.title.toLocaleLowerCase()
  const tags = recipe.tags.join(' ').toLocaleLowerCase()
  const notes = recipe.notes.join(' ').toLocaleLowerCase()
  const source = (recipe.original_url ?? '').toLocaleLowerCase()

  let score = 0
  for (const term of terms) {
    if (title.includes(term)) {
      score += 100
    } else if (tags.includes(term)) {
      score += 60
    } else if (notes.includes(term)) {
      score += 35
    } else if (source.includes(term)) {
      score += 25
    } else if (content.includes(term)) {
      score += 10
    }
  }

  return score
}
