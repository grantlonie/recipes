import { mergeAttributes, Node } from '@tiptap/core'

export const SectionExtension = Node.create({
  name: 'section',
  group: 'block',
  content: 'text*',

  parseHTML() {
    return [{ tag: 'div[data-cooklang-section]' }]
  },

  renderHTML({ node }) {
    return [
      'div',
      mergeAttributes({
        class: 'my-3 text-sm font-bold uppercase tracking-wide text-orange-800',
        'data-cooklang-section': '',
      }),
      node.textContent,
    ]
  },
})
