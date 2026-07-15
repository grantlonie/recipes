import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'

import { TimerChip } from './TimerChip'

export const TimerExtension = Node.create({
  name: 'timer',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      name: { default: '' },
      quantity: { default: '' },
      unit: { default: 'minutes' },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-timer]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-timer': '' }, HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TimerChip)
  },
})
