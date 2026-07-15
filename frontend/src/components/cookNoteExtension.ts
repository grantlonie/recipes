import { mergeAttributes, Node } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

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
