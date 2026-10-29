import { mergeAttributes, Node } from '@tiptap/core'
import type { NodeType } from '@tiptap/pm/model'
import { NodeSelection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    cookNote: {
      insertCookNote: () => ReturnType
    }
  }
}

export const CookNoteExtension = Node.create({
  name: 'cookNote',
  group: 'block',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-cooklang-note]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        {
          class: 'text-xs italic leading-5 text-stone-600 dark:text-stone-400',
          'data-cooklang-note': '',
        },
        HTMLAttributes
      ),
      0,
    ]
  },

  addCommands() {
    return {
      insertCookNote:
        () =>
        ({ dispatch, state, tr }) =>
          applyInsertCookNote(state, tr, dispatch),
    }
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        if (!editor.isActive('cookNote')) {
          return false
        }
        return editor
          .chain()
          .command(({ dispatch, state, tr }) => {
            const { $from } = state.selection
            const insertPos = $from.after()
            const paragraph = state.schema.nodes.paragraph.create()
            tr.insert(insertPos, paragraph)
            tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)))
            if (dispatch) {
              dispatch(tr.scrollIntoView())
            }
            return true
          })
          .run()
      },
    }
  },
})

export function applyInsertCookNote(
  state: EditorState,
  tr: Transaction,
  dispatch?: (tr: Transaction) => void
): boolean {
  const noteType = state.schema.nodes.cookNote
  if (!noteType) {
    return false
  }

  const { $from, $to, empty } = state.selection
  if ($from.depth < 1) {
    const insertPos = $from.pos + ($from.nodeAfter?.nodeSize ?? 0)
    return insertNoteAt(tr, noteType, insertPos, dispatch)
  }

  const posBefore = $from.before(1)
  const posAfter = $from.after(1)
  const block = $from.node(1)
  const sameBlock = $to.depth >= 1 && $to.before(1) === posBefore
  const selectedText = state.selection instanceof TextSelection && !empty
  const convertCurrent =
    block.type.name === 'paragraph' &&
    !(state.selection instanceof NodeSelection) &&
    (block.content.size === 0 || (selectedText && sameBlock))

  if (convertCurrent) {
    tr.setBlockType(posBefore, posAfter, noteType)
    if (dispatch) {
      dispatch(tr.scrollIntoView())
    }
    return true
  }

  const insertPos = $to.depth >= 1 ? $to.after(1) : posAfter
  return insertNoteAt(tr, noteType, insertPos, dispatch)
}

function insertNoteAt(
  tr: Transaction,
  noteType: NodeType,
  insertPos: number,
  dispatch?: (tr: Transaction) => void
): boolean {
  const note = noteType.create()
  tr.insert(insertPos, note)
  tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)))
  if (dispatch) {
    dispatch(tr.scrollIntoView())
  }
  return true
}
