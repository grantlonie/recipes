import { Dialog } from './Dialog'

interface ImportingDialogProps {
  open: boolean
}

export function ImportingDialog({ open }: ImportingDialogProps) {
  return (
    <Dialog labelledBy="importing-dialog-title" open={open}>
      <div className="flex flex-col items-center px-4 py-10 text-center">
        <div aria-hidden="true" className="import-whisk-scene">
          <div className="import-whisk-bowl" />
          <svg className="import-whisk" fill="none" viewBox="0 0 64 96" xmlns="http://www.w3.org/2000/svg">
            <rect fill="#c2410c" height="44" rx="3" width="6" x="29" y="4" />
            <path
              d="M18 48c0-6 6-10 14-10s14 4 14 10c0 8-8 18-14 24-6-6-14-16-14-24z"
              stroke="#78716c"
              strokeLinecap="round"
              strokeWidth="2.5"
            />
            <path
              d="M22 50c2 4 6 8 10 10M32 48v12M42 50c-2 4-6 8-10 10"
              stroke="#a8a29e"
              strokeLinecap="round"
              strokeWidth="1.5"
            />
          </svg>
        </div>
        <h2 className="mt-8 text-lg font-semibold text-stone-900" id="importing-dialog-title">
          Importing recipe…
        </h2>
        <p className="mt-2 text-sm text-stone-600">Fetching and parsing the recipe</p>
      </div>
    </Dialog>
  )
}
