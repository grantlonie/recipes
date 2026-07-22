import { getAllStoredRecipes } from './db'
import type { CatalogIngredient, Ingredient } from './types'
import { isMassUnit, isVolumeUnit, matchCatalogIngredient, normalizeUnit } from './units'

export interface UnmatchedUsageExample {
  quantity: string
  slug: string
  title: string
  unit: string
}

export interface UnmatchedIngredientRow {
  examples: UnmatchedUsageExample[]
  /** True when any usage uses mass/volume units that need density for conversion. */
  hasConvertibleUnit: boolean
  name: string
  recipeCount: number
  recipeSlugs: string[]
}

/** Units that participate in metric/US conversion (need density for volume↔weight). */
export function isConvertibleUnit(unit: string | null | undefined): boolean {
  return isMassUnit(unit) || isVolumeUnit(unit)
}

export async function scanUnmatchedIngredients(
  catalog: CatalogIngredient[]
): Promise<UnmatchedIngredientRow[]> {
  const stored = await getAllStoredRecipes()
  const byName = new Map<string, UnmatchedIngredientRow>()

  for (const record of stored) {
    const recipe = record.recipe
    const seenInRecipe = new Set<string>()

    for (const ingredient of recipe.ingredients) {
      const name = ingredient.name.trim()
      if (!name) {
        continue
      }
      const key = name.toLowerCase()
      const match = matchCatalogIngredient(name, catalog)
      if (match.catalog) {
        continue
      }

      const example = exampleFromIngredient(ingredient, recipe.slug, recipe.title)
      const convertible = isConvertibleUnit(example.unit)
      const existing = byName.get(key)

      if (existing) {
        if (!seenInRecipe.has(key)) {
          seenInRecipe.add(key)
          existing.recipeCount += 1
          existing.recipeSlugs.push(recipe.slug)
        }
        if (convertible) {
          existing.hasConvertibleUnit = true
        }
        addExample(existing, example, convertible)
        continue
      }

      seenInRecipe.add(key)
      byName.set(key, {
        examples: [example],
        hasConvertibleUnit: convertible,
        name,
        recipeCount: 1,
        recipeSlugs: [recipe.slug],
      })
    }
  }

  return [...byName.values()].sort(compareUnmatchedRows)
}

export function compareUnmatchedRows(
  left: UnmatchedIngredientRow,
  right: UnmatchedIngredientRow
): number {
  if (left.hasConvertibleUnit !== right.hasConvertibleUnit) {
    return left.hasConvertibleUnit ? -1 : 1
  }
  if (right.recipeCount !== left.recipeCount) {
    return right.recipeCount - left.recipeCount
  }
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
}

function addExample(
  row: UnmatchedIngredientRow,
  example: UnmatchedUsageExample,
  convertible: boolean
) {
  if (row.examples.length >= 5) {
    if (!convertible) {
      return
    }
    // Prefer convertible examples: replace a non-convertible slot when full.
    const replaceAt = row.examples.findIndex(item => !isConvertibleUnit(item.unit))
    if (replaceAt < 0) {
      return
    }
    row.examples[replaceAt] = example
    row.examples.sort(compareExamples)
    return
  }
  row.examples.push(example)
  row.examples.sort(compareExamples)
}

function compareExamples(left: UnmatchedUsageExample, right: UnmatchedUsageExample): number {
  const leftConvertible = isConvertibleUnit(left.unit) ? 0 : 1
  const rightConvertible = isConvertibleUnit(right.unit) ? 0 : 1
  if (leftConvertible !== rightConvertible) {
    return leftConvertible - rightConvertible
  }
  return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })
}

function exampleFromIngredient(
  ingredient: Ingredient,
  slug: string,
  title: string
): UnmatchedUsageExample {
  return {
    quantity: ingredient.quantity?.trim() ?? '',
    slug,
    title,
    unit: normalizeUnit(ingredient.unit) ?? ingredient.unit?.trim() ?? '',
  }
}
