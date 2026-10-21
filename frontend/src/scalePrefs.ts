export interface ScaleOption {
  builtin: boolean
  id: string
  label: string
  value: number
}

export interface RecipeScalePrefs {
  defaultOptionId: string | null
  options: ScaleOption[]
}

export interface ScaleOptionPersist {
  id: string
  label: string
  value: number
}

const BUILTIN_VALUES = [0.5, 1, 1.5, 2] as const

export const BUILTIN_SCALE_OPTIONS: ScaleOption[] = BUILTIN_VALUES.map(value => ({
  builtin: true,
  id: builtinScaleId(value),
  label: formatScaleMultiplier(value),
  value,
}))

export function builtinScaleId(value: number): string {
  return `builtin-${formatScaleIdValue(value)}`
}

export function formatScaleMultiplier(value: number): string {
  return `${formatScaleIdValue(value)}X`
}

export function isDefaultScaleLabel(value: number, label: string): boolean {
  return label.trim().toLocaleLowerCase() === formatScaleMultiplier(value).toLocaleLowerCase()
}

export function isNamedScaleOption(option: ScaleOption): boolean {
  return !option.builtin || !isDefaultScaleLabel(option.value, option.label)
}

export function mergeScalePrefs(metadata: Record<string, unknown> | undefined): RecipeScalePrefs {
  const storedOptions = parseStoredScaleOptions(metadata?.scale_options)
  const byId = new Map(BUILTIN_SCALE_OPTIONS.map(option => [option.id, { ...option }]))

  for (const stored of storedOptions) {
    const existing = byId.get(stored.id)
    if (existing?.builtin) {
      byId.set(stored.id, { ...existing, label: stored.label })
      continue
    }
    byId.set(stored.id, {
      builtin: false,
      id: stored.id,
      label: stored.label,
      value: stored.value,
    })
  }

  const options = sortScaleOptions([...byId.values()])
  const defaultOptionId =
    typeof metadata?.scale_default === 'string' && metadata.scale_default.trim()
      ? metadata.scale_default.trim()
      : null
  const validDefault =
    defaultOptionId && options.some(option => option.id === defaultOptionId)
      ? defaultOptionId
      : null

  return { defaultOptionId: validDefault, options }
}

export function scaleOptionsForPersist(options: ScaleOption[]): ScaleOptionPersist[] {
  return options
    .filter(option => isNamedScaleOption(option))
    .map(option => ({
      id: option.id,
      label: option.label.trim(),
      value: option.value,
    }))
}

export function createCustomScaleOption(value: number, label?: string): ScaleOption {
  const normalized = normalizeScaleValue(value)
  return {
    builtin: false,
    id: `custom-${crypto.randomUUID()}`,
    label: (label ?? formatScaleMultiplier(normalized)).trim(),
    value: normalized,
  }
}

export function normalizeScaleValue(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Scale must be a positive number')
  }
  return Number(value.toPrecision(6))
}

export function findScaleOption(
  options: ScaleOption[],
  optionId: string | null | undefined
): ScaleOption | undefined {
  if (!optionId) {
    return undefined
  }
  return options.find(option => option.id === optionId)
}

export function defaultScaleOption(prefs: RecipeScalePrefs): ScaleOption {
  return (
    findScaleOption(prefs.options, prefs.defaultOptionId) ??
    findScaleOption(prefs.options, builtinScaleId(1)) ??
    BUILTIN_SCALE_OPTIONS[1]
  )
}

function sortScaleOptions(options: ScaleOption[]): ScaleOption[] {
  const named = options.filter(isNamedScaleOption)
  const builtins = BUILTIN_SCALE_OPTIONS.map(builtin => {
    const match = options.find(option => option.id === builtin.id)
    return match && !isNamedScaleOption(match) ? match : null
  }).filter((option): option is ScaleOption => option != null)
  const namedCustoms = named.filter(option => !option.builtin)
  const namedBuiltins = named.filter(option => option.builtin)
  return [...namedCustoms, ...namedBuiltins, ...builtins]
}

function parseStoredScaleOptions(raw: unknown): ScaleOptionPersist[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const options: ScaleOptionPersist[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const record = item as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    const label = typeof record.label === 'string' ? record.label.trim() : ''
    const value = typeof record.value === 'number' ? record.value : Number(record.value)
    if (!id || !label || !Number.isFinite(value) || value <= 0 || seen.has(id)) {
      continue
    }
    seen.add(id)
    options.push({ id, label, value })
  }
  return options
}

function formatScaleIdValue(value: number): string {
  if (Number.isInteger(value)) {
    return String(value)
  }
  return String(value)
}
