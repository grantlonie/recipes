const LOWERCASE_INGREDIENT_WORDS = new Set([
  'and',
  'as',
  'for',
  'in',
  'of',
  'or',
  'the',
  'to',
  'with',
])

export function titleCaseIngredient(value: string) {
  let wordIndex = 0

  return value.replace(/[A-Za-z][A-Za-z']*/g, word => {
    const lower = word.toLowerCase()
    const formatted =
      wordIndex > 0 && LOWERCASE_INGREDIENT_WORDS.has(lower)
        ? lower
        : `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`
    wordIndex += 1
    return formatted
  })
}
