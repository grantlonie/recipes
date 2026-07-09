import { useMemo } from 'react'

import { Autocomplete } from './Autocomplete'
import { Button } from './Button'
import { DensitySearchLink } from './DensitySearchLink'
import { Dialog } from './Dialog'
import {
  mappingRowDensityValid,
  mappingRowNeedsCreate,
  mappingRowNeedsDensity,
  mappingRowsAreValid,
  type MappingRow,
} from '../importMapping'
import { inputClassName } from '../themeClasses'
import type { CatalogIngredient } from '../types'

interface ImportMappingDialogProps {
  applying?: boolean
  catalog: CatalogIngredient[]
  onApply: () => void
  onCancel: () => void
  onUpdateRow: (index: number, patch: Partial<MappingRow>) => void
  open: boolean
  rows: MappingRow[]
}

export function ImportMappingDialog({
  applying = false,
  catalog,
  onApply,
  onCancel,
  onUpdateRow,
  open,
  rows,
}: ImportMappingDialogProps) {
  const ingredientOptions = useMemo(
    () =>
      catalog.map(item => ({
        label: item.density_kg_m3 == null ? `${item.name} (weight)` : item.name,
        value: item.name,
      })),
    [catalog]
  )
  const mappingCanApply = useMemo(() => mappingRowsAreValid(rows, catalog), [rows, catalog])

  return (
    <Dialog labelledBy="import-mapping-title" open={open}>
      <h2 className="text-xl font-bold" id="import-mapping-title">
        Map imported ingredients
      </h2>
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
        Ingredients not in your catalog are highlighted and will be created on apply. Match others
        to existing entries; extra wording is saved as details.
      </p>
      <div className="mt-4 max-h-96 space-y-4 overflow-y-auto">
        {rows.map((row, index) => {
          const needsCreate = mappingRowNeedsCreate(row, catalog)
          const densityRequired = mappingRowNeedsDensity(row, catalog)
          const densityInvalid = densityRequired && !mappingRowDensityValid(row)
          return (
            <div
              className={`rounded-2xl p-3 ${
                needsCreate
                  ? 'bg-amber-100 ring-1 ring-amber-300'
                  : 'bg-orange-50 ring-1 ring-orange-100 dark:bg-stone-800 dark:ring-stone-700'
              }`}
              key={`${row.originalName}-${index}`}
            >
              <p className="text-sm font-semibold text-stone-800 dark:text-stone-100">
                {row.quantity}
                {row.unit ? ` ${row.unit}` : ''} {row.originalName}
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-semibold text-stone-700 dark:text-stone-200">
                    Ingredient
                  </span>
                  <div className="mt-1">
                    <Autocomplete
                      onChange={catalogName => onUpdateRow(index, { catalogName })}
                      options={ingredientOptions}
                      placeholder="Search or enter name"
                      value={row.catalogName}
                    />
                  </div>
                </label>
                <label className="block text-sm">
                  <span className="font-semibold text-stone-700 dark:text-stone-200">Details</span>
                  <input
                    className={`${inputClassName} mt-1`}
                    onChange={event => onUpdateRow(index, { note: event.target.value })}
                    placeholder="large, bittersweet, unsalted…"
                    value={row.note}
                  />
                </label>
              </div>
              {needsCreate ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-sm font-semibold text-amber-900">Create new ingredient</p>
                    <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">
                      Provide density for volume conversions between US and metric.
                    </p>
                  </div>
                  <label className="block text-sm">
                    <span className="font-semibold text-stone-700 dark:text-stone-200">
                      Density (kg/m³){densityRequired ? ' *' : ''}
                    </span>
                    <div className="mt-1 flex items-center gap-1">
                      <input
                        className={`${inputClassName} min-w-0 flex-1${densityInvalid ? ' border-red-400 ring-red-400' : ''}`}
                        onChange={event =>
                          onUpdateRow(index, { createDensity: event.target.value })
                        }
                        placeholder={densityRequired ? 'Required for cup measures' : 'Optional'}
                        value={row.createDensity}
                      />
                      <DensitySearchLink ingredientName={row.catalogName} />
                    </div>
                  </label>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      {!mappingCanApply ? (
        <p className="mt-3 text-sm text-red-700">
          Enter an ingredient name for each row. New ingredients with volume measures (cups, ml, L,
          etc.) need a density.
        </p>
      ) : null}
      <div className="mt-6 flex justify-end gap-2">
        <Button disabled={applying} onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <Button disabled={!mappingCanApply || applying} onClick={onApply} type="button">
          {applying ? 'Saving...' : 'Apply mapping'}
        </Button>
      </div>
    </Dialog>
  )
}
