import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'

import { SectionChip } from './SectionChip'

function deleteSelectedSection(editor: {
  commands: { deleteSelection: () => boolean }
  state: { selection: unknown }
}) {
  const { selection } = editor.state
  if (selection instanceof NodeSelection && selection.node.type.name === 'section') {
    return editor.commands.deleteSelection()
  }
  return false
}

export const SectionExtension = Node.create({
  name: 'section',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      title: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-cooklang-section]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        {
          class: 'text-sm font-bold uppercase tracking-wide text-orange-800 dark:text-orange-300',
          'data-cooklang-section': '',
        },
        HTMLAttributes
      ),
      String(HTMLAttributes.title ?? ''),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(SectionChip)
  },

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => deleteSelectedSection(editor),
      Delete: ({ editor }) => deleteSelectedSection(editor),
    }
  },
})
