# UI patterns

Interaction and layout conventions for JS/React UIs. Prefer these over inventing one-off behaviors.

For code style (naming, TypeScript, React hooks), see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Dialogs (chrome)

Rules for the modal container itself — independent of whether the content is read-only or editable.

- Mount to the document root via a portal (not inline in the triggering component's DOM subtree)
- Fixed header and footer; the dialog body scrolls if needed
- Close control (`X`) in the top-right of the header
- Lock page scroll while the dialog is open (document/`body` does not scroll underneath)
- Primary and secondary actions live in the footer, right-aligned
- Prefer a shared `Dialog` (or equivalent) primitive; do not rebuild chrome per feature

### Props

- **`size`**: `sm` | `md` | `lg` | `full`
- **`placement`**: `center` | `top` — default `top`
  - **`top`**: anchored a fixed percent from the top of the viewport; as content grows the dialog expands downward until a max height, then the body scrolls
  - **`center`**: vertically and horizontally centered; as content grows the dialog expands up and down together while remaining centered, until a max height, then the body scrolls
- **`lazyMount`**: when true, defer mounting content until the dialog opens
- **`backdrop`**: backdrop behavior options, including **`clickaway`** (dismiss on backdrop click when enabled)

## Popovers

Prefer a shared `Popover` (or equivalent) primitive for anchored overlays (menus, pickers, lightweight panels).

### Props

- **`position`**: placement relative to the anchor (e.g. top, bottom, left, right, and variants as needed)
- **`lazyMount`**: when true, defer mounting content until the popover opens

### Behavior

- Mount to the document root via a portal (same as dialogs)
- Prefer the shared primitive over ad-hoc absolutely positioned panels

## Editing surfaces

Editing can live in a **dialog**, **drawer**, or **on-page** form. Dirty-state and action rules are the same regardless of chrome.

- Prefer one state object for the editable fields (not many parallel `useState`s) when the surface has several related values
- Keep an initial snapshot; dirty = `!isEqual(current, initial)` via Lodash `isEqual` (see preferred libraries in [CONTRIBUTING.md](./CONTRIBUTING.md))
- Clean state: primary action is **Done** (or equivalent dismiss); do not show Cancel
- Dirty state: primary action is **Save**; show a **`text` variant Cancel** that discards changes (reset to the initial snapshot)
- Give the Done/Save control a fixed width so the label swap does not resize the button or shift the layout
- Place save/done actions consistently with the surface (dialog/drawer footer right-aligned; on-page near the form end or sticky action bar per existing layout)
- On successful save, clear dirty state by updating the initial snapshot to the saved values (and typically close the dialog/drawer unless the flow stays open)

## Buttons

Prefer a shared `Button` (or equivalent) primitive with a clear props shape. Build or extend it rather than one-off styled `<button>`s.

### Props

- **`variant`**: `filled` | `outlined` | `text`
- **`color`**: `primary` | `warning` | `error`
- **`size`**: `sm` | `md` | `lg` — default `md`
- **`leftIcon`**: optional icon before the label
- **`rightIcon`**: optional icon after the label
- **`disabled`**: boolean — non-interactive; no pointer cursor
- **`loading`**: boolean — show a loading indicator; treat as non-interactive while loading

### Behavior & affordance

- Default cursor is `pointer` unless `disabled` (or effectively disabled while `loading`)
- Hover fills / emphasis appropriate to the variant (e.g. stronger fill on `filled`, light fill on `outlined` / `text`)
- Variants share the same height for a given `size`, accounting for border width (e.g. transparent border on `filled` / `text` so they align with `outlined`)

## Icon buttons

Prefer a shared `IconButton` that **extends `Button`** for icon-only controls (toolbar / header actions such as more, settings, fullscreen). Do not hand-roll one-off square icon `<button>`s.

### Props

- Extends `Button` props (same **`variant`**, **`size`**, **`disabled`**, etc.)
- **`icon`**: required React node for the glyph (no text children)
- Require an accessible name via **`aria-label`**
- **`tooltip`**: optional; `Omit<TooltipProps, 'children'>` — when set, `IconButton` wraps itself in `Tooltip` with those props

### Behavior & affordance

- Default to a quiet/`ghost` (or equivalent) variant so icon buttons sit calmly in chrome
- Use a square hit target sized to match `Button` heights for the same **`size`** (icon-only; no label padding)
- Keep icons `aria-hidden` when the button already has an `aria-label`

## Tooltips

Prefer a shared `Tooltip` that wraps any trigger and shows a short label on hover/focus. Use it instead of the native HTML `title` attribute for app UI (native tips are delayed inconsistently and cannot match design).

### Props

- **`content`**: tooltip label (string or light node)
- **`children`**: the wrapped trigger
- **`delayMs`**: delay before show — default ~`400`
- **`position`**: `top` | `bottom` | `left` | `right` — default `top`

### Behavior

- Mount to the document root via a portal
- Show after the delay on pointer enter and keyboard focus; hide on leave/blur
- Keep tip content short; do not put interactive controls inside a tooltip
- Prefer `Tooltip` around arbitrary triggers; for `IconButton`, prefer the **`tooltip`** prop so wrapping is automatic

## Shared components

- Before building a one-off UI piece, check for an existing shared component
- If none exists and the pattern will (or likely will) be reused, build a generic component with a clear props type (`ComponentNameProps`) instead of baking feature-specific logic into a private copy
- Prefer composition (slots/children for header, body, footer) over prop sprawl
