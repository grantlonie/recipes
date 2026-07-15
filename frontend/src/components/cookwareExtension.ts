import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'

import { CookwareChip } from './CookwareChip'

export const CookwareExtension = Node.create({
  name: 'cookware',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      name: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-cookware]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-cookware': '' }, HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CookwareChip)
  },
})
