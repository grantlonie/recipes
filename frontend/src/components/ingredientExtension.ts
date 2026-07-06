import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'

import { IngredientChip } from './IngredientChip'

export const IngredientExtension = Node.create({
  name: 'ingredient',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      name: { default: '' },
      note: { default: '' },
      quantity: { default: '' },
      unit: { default: '' },
      fixed: { default: false },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-ingredient]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-ingredient': '' }, HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(IngredientChip)
  },
})
