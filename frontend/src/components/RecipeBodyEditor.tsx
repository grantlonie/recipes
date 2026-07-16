import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'

import type { CookwareAttrs } from '../cooklangCookware'
import { parseCooklangBody, serializeCooklangBody } from '../cooklangEditor'
import type { IngredientAttrs } from '../cooklangTokens'
import type { TimerAttrs } from '../cooklangTimers'
import type { CatalogIngredient, UnitSystem } from '../types'
import { CookNoteExtension } from './cookNoteExtension'
import { CookwareExtension } from './cookwareExtension'
import { setCookwareDisplayState } from './cookwareDisplayStore'
import { IngredientExtension } from './ingredientExtension'
import { setIngredientDisplayState } from './ingredientDisplayStore'
import { setSectionDisplayState } from './sectionDisplayStore'
import { SectionExtension } from './sectionExtension'
import { setTimerDisplayState } from './timerDisplayStore'
import { TimerExtension } from './timerExtension'

export interface RecipeBodyEditorHandle {
  deleteCookware: (pos: number) => void
  deleteIngredient: (pos: number) => void
  deleteTimer: (pos: number) => void
  focus: () => void
  insertCookware: (attrs: CookwareAttrs) => void
  insertIngredient: (attrs: IngredientAttrs) => void
  insertNote: () => void
  insertSection: (title: string) => void
  insertTimer: (attrs: TimerAttrs) => void
  updateCookware: (pos: number, attrs: CookwareAttrs) => void
  updateIngredient: (pos: number, attrs: IngredientAttrs) => void
  updateSection: (pos: number, title: string) => void
  updateTimer: (pos: number, attrs: TimerAttrs) => void
}

interface RecipeBodyEditorProps {
  catalog: CatalogIngredient[]
  onChange: (body: string) => void
  onEditCookware: (pos: number, attrs: CookwareAttrs) => void
  onEditIngredient: (pos: number, attrs: IngredientAttrs) => void
  onEditSection: (pos: number, title: string) => void
  onEditTimer: (pos: number, attrs: TimerAttrs) => void
  preferFluidVolume?: boolean
  unitSystem: UnitSystem
  value: string
}

export const RecipeBodyEditor = forwardRef<RecipeBodyEditorHandle, RecipeBodyEditorProps>(
  function RecipeBodyEditor(
    {
      catalog,
      onChange,
      onEditCookware,
      onEditIngredient,
      onEditSection,
      onEditTimer,
      preferFluidVolume = false,
      unitSystem,
      value,
    },
    ref
  ) {
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange
    const editorRef = useRef<ReturnType<typeof useEditor>>(null)

    const extensions = useMemo(
      () => [
        StarterKit.configure({
          blockquote: false,
          bold: false,
          bulletList: false,
          code: false,
          codeBlock: false,
          heading: false,
          horizontalRule: false,
          italic: false,
          link: false,
          listItem: false,
          listKeymap: false,
          orderedList: false,
          strike: false,
          trailingNode: false,
          underline: false,
        }),
        IngredientExtension,
        CookwareExtension,
        TimerExtension,
        SectionExtension,
        CookNoteExtension,
      ],
      []
    )

    const editor = useEditor({
      extensions,
      content: parseCooklangBody(value),
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class:
            'min-h-128 w-full rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm leading-7 text-stone-800 outline-none focus:ring-2 focus:ring-orange-500 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100 [&_p]:m-0 [&_[data-cooklang-note]]:m-0 [&_[data-cooklang-section]]:m-0',
        },
        handlePaste(_view, event) {
          const text = event.clipboardData?.getData('text/plain')
          if (!text) {
            return false
          }
          if (
            !text.includes('@') &&
            !text.includes('#') &&
            !text.includes('~') &&
            !text.includes('>') &&
            !/^=+\s*.+\s*=+\s*$/m.test(text)
          ) {
            return false
          }
          event.preventDefault()
          const doc = parseCooklangBody(text)
          editorRef.current?.commands.insertContent(doc.content ?? [])
          return true
        },
      },
      onUpdate: ({ editor: current }) => {
        onChangeRef.current(serializeCooklangBody(current.getJSON()))
      },
    })

    editorRef.current = editor

    useEffect(() => {
      setIngredientDisplayState({
        catalog,
        onEditIngredient,
        preferFluidVolume,
        unitSystem,
      })
    }, [catalog, onEditIngredient, preferFluidVolume, unitSystem])

    useEffect(() => {
      setCookwareDisplayState({ onEditCookware })
    }, [onEditCookware])

    useEffect(() => {
      setSectionDisplayState({ onEditSection })
    }, [onEditSection])

    useEffect(() => {
      setTimerDisplayState({ onEditTimer })
    }, [onEditTimer])

    useEffect(() => {
      if (!editor || editor.isDestroyed) {
        return
      }
      const current = serializeCooklangBody(editor.getJSON())
      if (current === value) {
        return
      }
      // TipTap ReactNodeViews call flushSync; defer so we are outside React's commit.
      queueMicrotask(() => {
        if (!editor || editor.isDestroyed) {
          return
        }
        if (serializeCooklangBody(editor.getJSON()) === value) {
          return
        }
        editor.commands.setContent(parseCooklangBody(value), { emitUpdate: false })
      })
    }, [editor, value])

    useImperativeHandle(
      ref,
      () => ({
        focus() {
          editor?.commands.focus()
        },
        deleteCookware(pos) {
          deleteInlineNode(editor, pos, 'cookware')
        },
        deleteIngredient(pos) {
          deleteInlineNode(editor, pos, 'ingredient')
        },
        deleteTimer(pos) {
          deleteInlineNode(editor, pos, 'timer')
        },
        insertCookware(attrs) {
          if (!editor) {
            return
          }
          editor
            .chain()
            .focus()
            .insertContent([
              { type: 'cookware', attrs },
              { type: 'text', text: ' ' },
            ])
            .run()
        },
        insertIngredient(attrs) {
          if (!editor) {
            return
          }
          editor
            .chain()
            .focus()
            .insertContent([
              { type: 'ingredient', attrs },
              { type: 'text', text: ' ' },
            ])
            .run()
        },
        insertNote() {
          if (!editor) {
            return
          }
          editor
            .chain()
            .focus()
            .insertContent({ type: 'cookNote', content: [{ type: 'text', text: '' }] })
            .run()
        },
        insertSection(title) {
          if (!editor) {
            return
          }
          editor.chain().focus().insertContent({ type: 'section', attrs: { title } }).run()
        },
        insertTimer(attrs) {
          if (!editor) {
            return
          }
          editor
            .chain()
            .focus()
            .insertContent([
              { type: 'timer', attrs },
              { type: 'text', text: ' ' },
            ])
            .run()
        },
        updateCookware(pos, attrs) {
          updateInlineNode(editor, pos, 'cookware', attrs)
        },
        updateIngredient(pos, attrs) {
          updateInlineNode(editor, pos, 'ingredient', attrs)
        },
        updateSection(pos, title) {
          if (!editor) {
            return
          }
          const node = editor.state.doc.nodeAt(pos)
          if (!node || node.type.name !== 'section') {
            return
          }
          editor
            .chain()
            .focus()
            .command(({ tr }) => {
              tr.setNodeMarkup(pos, undefined, { title })
              return true
            })
            .run()
        },
        updateTimer(pos, attrs) {
          updateInlineNode(editor, pos, 'timer', attrs)
        },
      }),
      [editor]
    )

    return <EditorContent editor={editor} />
  }
)

function deleteInlineNode(editor: Editor | null, pos: number, typeName: string) {
  if (!editor) {
    return
  }
  const node = editor.state.doc.nodeAt(pos)
  if (!node || node.type.name !== typeName) {
    return
  }
  editor
    .chain()
    .focus()
    .deleteRange({ from: pos, to: pos + node.nodeSize })
    .run()
}

function updateInlineNode(
  editor: Editor | null,
  pos: number,
  typeName: string,
  attrs: CookwareAttrs | IngredientAttrs | TimerAttrs
) {
  if (!editor) {
    return
  }
  const node = editor.state.doc.nodeAt(pos)
  if (!node || node.type.name !== typeName) {
    return
  }
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.setNodeMarkup(pos, undefined, attrs)
      return true
    })
    .run()
}
