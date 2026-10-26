import { describe, expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import { InkKitEditor, type KeyInput } from '../src/index'

// `indent` and `outdent` are keymap names that default to Tab and Shift-Tab. They act only on a
// list item in formatted mode that can be edited, and they run after the table keys.

interface Session {
  editor: InkKitEditor
  errors: Error[]
  /** Puts the caret `offset` characters into the first text block that holds `text`. */
  caret(text: string, offset?: number): void
  /** A key through the facade, under generation 1. */
  key(key: string, init?: Omit<KeyInput, 'key'>): boolean
  /** A real DOM key event on the editor, as the platform sends it. */
  dom(key: string, init?: KeyboardEventInit): boolean
  text(): string
}

async function withNote(
  source: string,
  run: (session: Session) => void | Promise<void>,
  options: {
    keymap?: InkKitEditor['setKeymap'] extends (k: infer K) => void ? K : never
  } = {},
) {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: Error[] = []
  const editor = await InkKitEditor.mount(
    root,
    { changed() {}, copy() {}, openLink() {}, error: (e) => errors.push(e) },
    options,
  )
  try {
    editor.loadDocument({
      documentId: 'indent',
      generation: 1,
      format: 'md',
      text: source,
    })
    const view = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx.get(
      editorViewCtx,
    )
    await run({
      editor,
      errors,
      caret(text, offset = text.length) {
        let found = -1
        view.state.doc.descendants((node, pos) => {
          if (found < 0 && node.isText && node.text!.includes(text))
            found = pos + node.text!.indexOf(text) + offset
        })
        expect(found).toBeGreaterThanOrEqual(0)
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, found),
          ),
        )
      },
      key: (key, init = {}) => editor.keyDown({ ...init, key }, 1),
      dom(key, init = {}) {
        const event = new KeyboardEvent('keydown', {
          key,
          bubbles: true,
          cancelable: true,
          ...init,
        })
        view.dom.dispatchEvent(event)
        return event.defaultPrevented
      },
      text: () => editor.snapshot().text,
    })
  } finally {
    await editor.destroy()
    root.remove()
  }
}

describe('the default keys', () => {
  test('Tab indents a list item and Shift-Tab outdents it, by keyDown and by a DOM event', () =>
    withNote('- one\n- two\n', ({ caret, key, dom, text, errors }) => {
      caret('two')
      expect(key('Tab')).toBe(true)
      expect(text()).toBe('- one\n  - two\n')
      expect(key('Tab', { shiftKey: true })).toBe(true)
      expect(text()).toBe('- one\n- two\n')
      expect(dom('Tab')).toBe(true)
      expect(text()).toBe('- one\n  - two\n')
      expect(dom('Tab', { shiftKey: true })).toBe(true)
      expect(text()).toBe('- one\n- two\n')
      expect(errors).toEqual([])
    }))

  test.each([
    ['an ordered list', '1. one\n2. two\n', '1. one\n   1. two\n'],
    ['a task list', '- [ ] one\n- [x] two\n', '- [ ] one\n  - [x] two\n'],
    ['a list with CRLF', '* one\r\n* two\r\n', '* one\r\n  - two\r\n'],
    ['a list in a quote', '> - one\n> - two\n', '> - one\n>   - two\n'],
    [
      'Unicode text',
      '- café\n- \u{1F600} two\n',
      '- café\n  - \u{1F600} two\n',
    ],
  ])('Tab and Shift-Tab work in %s', (_name, source, indented) =>
    withNote(source, ({ caret, key, text }) => {
      caret('two', 3)
      expect(key('Tab')).toBe(true)
      expect(text()).toBe(indented)
      expect(key('Tab', { shiftKey: true })).toBe(true)
      expect(text()).toBe(source)
    }),
  )

  test('the first item cannot be indented and Tab outside a list is not consumed', () =>
    withNote('- one\n- two\n\nPlain\n', ({ caret, key, dom, text }) => {
      caret('one')
      expect(key('Tab')).toBe(false)
      expect(dom('Tab')).toBe(false)
      caret('Plain')
      expect(key('Tab')).toBe(false)
      expect(key('Tab', { shiftKey: true })).toBe(false)
      expect(text()).toBe('- one\n- two\n\nPlain\n')
    }))

  test('Mod-[ and Mod-] are left alone', () =>
    withNote('- one\n- two\n', ({ caret, key, dom, text }) => {
      caret('two')
      for (const mark of ['[', ']'])
        for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
          expect(key(mark, mod)).toBe(false)
          expect(dom(mark, mod)).toBe(false)
        }
      expect(text()).toBe('- one\n- two\n')
    }))
})

describe('with the table keys', () => {
  test('Tab in a list item that holds a typed table row still makes the table', () =>
    withNote('- | a | b |\n', ({ caret, key, text }) => {
      caret('b |')
      expect(key('Tab')).toBe(true)
      expect(text()).toBe('- | a | b |\n  | - | - |\n  |   |   |\n')
    }))

  test('Tab in a table cell inside a list item moves to the next cell', () =>
    withNote(
      '- item\n\n  | a | b |\n  | - | - |\n  | c | d |\n',
      ({ caret, key, text, editor }) => {
        const before = text()
        caret('a', 1)
        expect(key('Tab')).toBe(true)
        expect(editor.commandState().table).toMatchObject({ row: 0, column: 1 })
        expect(text()).toBe(before)
      },
    ))
})

describe('a changed keymap', () => {
  test('a host key indents and outdents, and the new key replaces Tab', () =>
    withNote('- one\n- two\n', ({ editor, caret, key, text }) => {
      caret('two')
      editor.setKeymap({ indent: ['Mod-]'], outdent: ['Mod-['] })
      expect(key('Tab')).toBe(false)
      expect(key(']', { metaKey: true })).toBe(true)
      expect(text()).toBe('- one\n  - two\n')
      expect(key('[', { metaKey: true })).toBe(true)
      expect(text()).toBe('- one\n- two\n')
    }))

  test('an empty list disables a key and leaves the other', () =>
    withNote('- one\n- two\n', ({ editor, caret, key, text }) => {
      caret('two')
      editor.setKeymap({ indent: [] })
      expect(key('Tab')).toBe(false)
      expect(text()).toBe('- one\n- two\n')
      editor.setKeymap({ outdent: [], indent: ['Tab'] })
      expect(key('Tab')).toBe(true)
      expect(key('Tab', { shiftKey: true })).toBe(false)
      expect(text()).toBe('- one\n  - two\n')
    }))

  test('a keymap given at mount applies, and a null entry keeps the default', () =>
    withNote(
      '- one\n- two\n',
      ({ caret, key, text }) => {
        caret('two')
        expect(key('Tab')).toBe(false)
        expect(key(']', { metaKey: true })).toBe(true)
        expect(text()).toBe('- one\n  - two\n')
        expect(key('Tab', { shiftKey: true })).toBe(true)
        expect(text()).toBe('- one\n- two\n')
      },
      { keymap: { indent: ['Mod-]'], outdent: null as never } },
    ))

  test('a key that another name already binds goes to that name', () =>
    withNote('- one\n- two\n', ({ editor, caret, key, text }) => {
      caret('two')
      editor.setKeymap({ bold: ['Tab'] })
      expect(key('Tab')).toBe(true)
      expect(text()).toBe('- one\n- two\n')
    }))

  test('names and keys are checked', () =>
    withNote('- one\n', ({ editor }) => {
      expect(() => editor.setKeymap({ indent: 'Tab' } as never)).toThrow(
        expect.objectContaining({ code: 'invalid-argument' }),
      )
      expect(() => editor.setKeymap({ indent: [3] } as never)).toThrow(
        expect.objectContaining({ code: 'invalid-argument' }),
      )
      expect(() => editor.setKeymap({ outdent: undefined })).not.toThrow()
    }))
})

describe('where nothing can be indented', () => {
  test('a read-only editor leaves the list alone and keyDown does not throw for the bound key', () =>
    withNote('- one\n- two\n', ({ editor, caret, key, dom, text }) => {
      caret('two')
      editor.setEditable(false)
      expect(dom('Tab')).toBe(false)
      expect(dom('Tab', { shiftKey: true })).toBe(false)
      expect(text()).toBe('- one\n- two\n')
      editor.setKeymap({ indent: ['Mod-]'] })
      expect(key(']', { metaKey: true })).toBe(false)
      expect(text()).toBe('- one\n- two\n')
      editor.setEditable(true)
      expect(key(']', { metaKey: true })).toBe(true)
      expect(text()).toBe('- one\n  - two\n')
    }))

  test('source mode types a tab and does not indent the list', () =>
    withNote('- one\n- two\n', ({ editor, key, text }) => {
      editor.setEditingMode('source')
      editor.setKeymap({ indent: ['Mod-]'] })
      const before = text()
      expect(key(']', { metaKey: true })).toBe(false)
      expect(text()).toBe(before)
      expect(key('Tab')).toBe(true)
      expect(text()).toContain('\t')
      expect(text().replace('\t', '')).toBe(before)
    }))

  test('nothing indents before a document is loaded or during a refused edit', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const editor = await InkKitEditor.mount(
      root,
      { changed() {}, copy() {}, openLink() {} },
      {},
    )
    try {
      expect(() => editor.setKeymap({ indent: ['Tab'] })).not.toThrow()
      expect(() => editor.keyDown({ key: 'Tab' }, 1)).toThrow(
        expect.objectContaining({ code: 'not-ready' }),
      )
    } finally {
      await editor.destroy()
      root.remove()
    }
  })
})
