import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'

import { parseCooklangBody, serializeCooklangBody } from '../cooklangEditor'
import type { IngredientAttrs } from '../cooklangTokens'
import type { TimerAttrs } from '../cooklangTimers'
import type { CatalogIngredient, UnitSystem } from '../types'
import { CookNoteExtension } from './cookNoteExtension'
import { IngredientExtension } from './ingredientExtension'
import { setIngredientDisplayState } from './ingredientDisplayStore'
import { setSectionDisplayState } from './sectionDisplayStore'
import { SectionExtension } from './sectionExtension'
import { setTimerDisplayState } from './timerDisplayStore'
import { TimerExtension } from './timerExtension'

export interface RecipeBodyEditorHandle {
  deleteIngredient: (pos: number) => void
  deleteTimer: (pos: number) => void
  focus: () => void
  insertIngredient: (attrs: IngredientAttrs) => void
  insertNote: () => void
  insertSection: (title: string) => void
  insertTimer: (attrs: TimerAttrs) => void
  updateIngredient: (pos: number, attrs: IngredientAttrs) => void
  updateSection: (pos: number, title: string) => void
  updateTimer: (pos: number, attrs: TimerAttrs) => void
}

interface RecipeBodyEditorProps {
  catalog: CatalogIngredient[]
  onChange: (body: string) => void
  onEditIngredient: (pos: number, attrs: IngredientAttrs) => void
  onEditSection: (pos: number, title: string) => void
  onEditTimer: (pos: number, attrs: TimerAttrs) => void
  unitSystem: UnitSystem
  value: string
}

export const RecipeBodyEditor = forwardRef<RecipeBodyEditorHandle, RecipeBodyEditorProps>(
  function RecipeBodyEditor(
    { catalog, onChange, onEditIngredient, onEditSection, onEditTimer, unitSystem, value },
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
        unitSystem,
      })
    }, [catalog, onEditIngredient, unitSystem])

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
      if (current !== value) {
        editor.commands.setContent(parseCooklangBody(value), { emitUpdate: false })
      }
    }, [editor, value])

    useImperativeHandle(
      ref,
      () => ({
        focus() {
          editor?.commands.focus()
        },
        deleteIngredient(pos) {
          deleteInlineNode(editor, pos, 'ingredient')
        },
        deleteTimer(pos) {
          deleteInlineNode(editor, pos, 'timer')
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
  attrs: IngredientAttrs | TimerAttrs
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
