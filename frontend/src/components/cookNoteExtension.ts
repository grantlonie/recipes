import { mergeAttributes, Node } from '@tiptap/core'

export const CookNoteExtension = Node.create({
  name: 'cookNote',
  group: 'block',
  content: 'text*',

  parseHTML() {
    return [{ tag: 'div[data-cooklang-note]' }]
  },

  renderHTML({ node }) {
    return [
      'div',
      mergeAttributes({
        class: 'my-2 border-l-2 border-stone-300 pl-3 text-sm italic text-stone-600',
        'data-cooklang-note': '',
      }),
      ['span', { class: 'mr-1 font-semibold not-italic text-stone-500' }, '›'],
      node.textContent,
    ]
  },
})
