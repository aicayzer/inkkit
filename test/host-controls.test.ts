import { expect, test, vi } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import {
  InkKitEditor,
  type EditorOptions,
  type EditorEvents,
  type CommandState,
} from '../src/index'

const input = {
  documentId: 'host',
  generation: 8,
  format: 'md' as const,
  text: '__bold__\r\n\r\nText\r\n',
}
async function run(
  fn: (
    editor: InkKitEditor,
    root: HTMLElement,
    ctx: Ctx,
  ) => void | Promise<void>,
  options: EditorOptions = {},
  events: Partial<EditorEvents> = {},
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    { changed() {}, stateChanged() {}, copy() {}, openLink() {}, ...events },
    options,
  )
  const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
  try {
    editor.loadDocument(input)
    await fn(editor, root, ctx)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

test('read-only blocks every facade mutation family while retaining navigation and explicit host loading', () =>
  run(async (editor, _root, ctx) => {
    editor.insertText('!', 8)
    const snapshot = editor.snapshot()
    editor.setEditable(false)
    const mutations = [
      () => editor.replaceSource('changed'),
      () => editor.undo(),
      () => editor.redo(),
      () => editor.insertText('x', 8),
      () => editor.pasteAsPlainText('x'),
      () => editor.table('insert'),
      () => editor.format('bold'),
      () => editor.insertFootnote(),
      () => editor.editReferenceDefinition('ref', 'new'),
      () => editor.replace('Text', 'new'),
      () => editor.replaceAll('Text', 'new'),
      () => editor.insertPaths(['new'], 0, 0),
      () => editor.insertImages([{ path: 'opaque', alt: 'x' }]),
    ]
    for (const mutate of mutations)
      expect(mutate).toThrow(expect.objectContaining({ code: 'read-only' }))
    await expect(editor.paste({ text: 'x' })).rejects.toMatchObject({
      code: 'read-only',
    })
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.insertText('internal mutation'))
    expect(editor.snapshot()).toEqual(snapshot)
    editor.find('Text')
    expect((await editor.clipboardSnapshot()).text).toContain('Text')
    editor.setEditingMode('source')
    editor.focus()
    expect(editor.snapshot()).toEqual(snapshot)
    editor.setEditable(true)
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot().text).toBe(input.text)
    editor.setEditable(false)
    editor.loadDocument({
      ...input,
      generation: 9,
      format: 'txt',
      text: '**literal**\r\n',
    })
    expect(editor.snapshot()).toMatchObject({
      generation: 9,
      text: '**literal**\r\n',
      revision: 0,
      dirty: false,
    })
  }))

test.each(['md', 'txt'] as const)(
  'source/TXT read-only rejects synthetic DOM input and preserves input-policy focus, selection, source and history (%s)',
  (format) =>
    run((editor, root) => {
      editor.loadDocument({ ...input, format })
      editor.setEditingMode('source')
      const plain = root.querySelector('textarea')!
      plain.focus()
      plain.setSelectionRange(2, 5)
      const snapshot = editor.snapshot()
      editor.setTextInputPreferences({
        spellcheck: false,
        autocorrect: false,
        autocapitalize: 'none',
      })
      editor.setEditable(false)
      expect(document.activeElement).toBe(plain)
      expect([plain.selectionStart, plain.selectionEnd]).toEqual([2, 5])
      expect(plain.readOnly).toBe(true)
      for (const surface of [plain, root.querySelector('.ProseMirror')!]) {
        expect(surface.getAttribute('spellcheck')).toBe('false')
        expect(surface.getAttribute('autocorrect')).toBe('off')
        expect(surface.getAttribute('autocapitalize')).toBe('none')
      }
      const before = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
      })
      plain.dispatchEvent(before)
      expect(before.defaultPrevented).toBe(true)
      plain.value = 'illegal'
      plain.dispatchEvent(new InputEvent('input', { bubbles: true }))
      expect(plain.value).toBe(snapshot.text.replaceAll('\r\n', '\n'))
      expect(editor.snapshot()).toEqual(snapshot)
      editor.setEditable(true)
      editor.setTextInputPreferences({})
      expect(plain.hasAttribute('spellcheck')).toBe(false)
      expect(editor.snapshot()).toEqual(snapshot)
    }),
)

test.each(['formatted', 'source'] as const)(
  'composition rejects policy transitions atomically while availability remains readable (%s)',
  (mode) =>
    run((editor, root, ctx) => {
      editor.setEditingMode(mode)
      const surface =
        mode === 'source'
          ? root.querySelector('textarea')!
          : ctx.get(editorViewCtx).dom
      surface.dispatchEvent(
        new CompositionEvent('compositionstart', { bubbles: true }),
      )
      expect(editor.commandState()).toMatchObject({
        composing: true,
        editable: true,
        commands: { undo: false, insertText: false },
      })
      expect(() => editor.setEditable(false)).toThrow(
        expect.objectContaining({ code: 'composition' }),
      )
      expect(() =>
        editor.setTextInputPreferences({ spellcheck: false }),
      ).toThrow(expect.objectContaining({ code: 'composition' }))
      expect(editor.editable).toBe(true)
      expect(surface.hasAttribute('spellcheck')).toBe(false)
      surface.dispatchEvent(
        new CompositionEvent('compositionend', { bubbles: true }),
      )
      expect(editor.commandState().composing).toBe(false)
    }),
)

test('pending image imports are observable and stay cancelled across read-only cycles', () => {
  let release!: (value: { reference: string }) => void
  return run(
    async (editor) => {
      const baseline = editor.snapshot()
      const pending = editor.paste({
        text: '',
        images: [{ bytes: new Uint8Array([1]), mimeType: 'image/png' }],
      })
      const rejection = expect(pending).rejects.toMatchObject({
        code: 'stale-document',
      })
      expect(editor.commandState()).toMatchObject({
        pending: true,
        commands: { paste: false, undo: false },
      })
      editor.setEditable(false)
      editor.setEditable(true)
      expect(editor.commandState().pending).toBe(false)
      release({ reference: 'opaque' })
      await rejection
      expect(editor.snapshot()).toEqual(baseline)
    },
    {
      images: {
        presentation: () => undefined,
        importImage: () =>
          new Promise((resolve) => {
            release = resolve
          }),
        exportImage: async () => ({
          bytes: new Uint8Array(),
          mimeType: 'image/png',
        }),
      },
    },
  )
})

test('availability observes actual shared history, selections, table context and final document identity without dispatch', () => {
  const observed: CommandState[] = []
  return run(
    (editor, _root, ctx) => {
      const view = ctx.get(editorViewCtx)
      const dispatch = vi.spyOn(view, 'dispatch')
      const baseline = editor.snapshot()
      expect(editor.commandState().commands.undo).toBe(false)
      for (let i = 0; i < 3; i++) editor.commandState()
      expect(dispatch).not.toHaveBeenCalled()
      expect(editor.snapshot()).toEqual(baseline)
      editor.insertText('!', 8)
      expect(observed.at(-1)).toMatchObject({
        revision: 1,
        commands: { undo: true },
      })
      editor.undo()
      expect(editor.commandState().commands.redo).toBe(true)
      editor.setEditingMode('source')
      expect(
        Object.values(editor.commandState().commands.format).every(
          (value) => !value,
        ),
      ).toBe(true)
      editor.setEditingMode('formatted')
      editor.table('insert')
      let cell = 0
      view.state.doc.descendants((node, pos) => {
        if (!cell && node.type.name === 'table_cell') cell = pos + 2
      })
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, cell)),
      )
      const before = editor.snapshot()
      dispatch.mockClear()
      expect(editor.commandState().table).toMatchObject({ rows: 3, columns: 2 })
      expect(editor.commandState().commands.table.moveRowUp).toBe(false)
      expect(dispatch).not.toHaveBeenCalled()
      expect(editor.snapshot()).toEqual(before)
      observed.length = 0
      editor.loadDocument({
        ...input,
        documentId: 'next',
        generation: 9,
        format: 'txt',
        text: 'literal',
      })
      expect(observed).toHaveLength(1)
      expect(observed[0]).toMatchObject({
        documentId: 'next',
        generation: 9,
        revision: 0,
        format: 'txt',
        mode: 'source',
      })
      expect(() => editor.commandState(8)).toThrow(
        expect.objectContaining({ code: 'stale-document' }),
      )
    },
    {},
    { commandStateChanged: (state) => observed.push(state) },
  )
})

test.each(['formatted', 'source'] as const)(
  'configured history bindings replace defaults and work on both surfaces (%s)',
  (mode) =>
    run((editor) => {
      editor.setEditingMode(mode)
      editor.insertText('!', 8)
      const edited = editor.snapshot()
      const key = (key: string) =>
        editor.keyDown(key, '', key === 'z', key !== 'z', false, false, 8)
      editor.setKeymap({ undo: [], redo: [] })
      expect(key('z')).toBe(true)
      expect(editor.snapshot()).toEqual(edited)
      editor.setKeymap({ undo: ['Ctrl-u'], redo: ['Ctrl-r'] })
      expect(key('u')).toBe(true)
      expect(editor.snapshot().text).toBe(input.text)
      expect(key('r')).toBe(true)
      expect(editor.snapshot().text).toBe(edited.text)
    }),
)

test('headings 4–6 and table commands are configurable and initial read-only is enforced', () =>
  run(
    (editor) => {
      expect(editor.editable).toBe(false)
      editor.setEditable(true)
      for (const level of [4, 5, 6]) {
        editor.setKeymap({ ['heading' + level]: ['Ctrl-h'] })
        editor.keyDown('h', '', false, true, false, false, 8)
        expect(editor.commandState().caret.block).toEqual({
          type: 'heading',
          level,
        })
      }
      editor.setKeymap({ tableInsert: ['Ctrl-t'] })
      expect(editor.keyDown('t', '', false, true, false, false, 8)).toBe(true)
      expect(editor.snapshot().text).toContain('|')
    },
    { editable: false },
  ))

test.each(['formatted', 'source'] as const)(
  'deferred portable cuts cannot delete after a read-only cycle (%s)',
  (mode) => {
    let copied!: () => void
    let entered!: () => void
    const copying = new Promise<void>((resolve) => {
      entered = resolve
    })
    const errors: Error[] = []
    return run(
      async (editor, root, ctx) => {
        editor.loadDocument({ ...input, text: '![photo](opaque)\r\n' })
        editor.setEditingMode(mode)
        if (mode === 'source') {
          const plain = root.querySelector('textarea')!
          plain.setSelectionRange(0, plain.value.length)
        } else {
          const view = ctx.get(editorViewCtx)
          view.dispatch(
            view.state.tr.setSelection(
              TextSelection.create(
                view.state.doc,
                1,
                view.state.doc.content.size - 1,
              ),
            ),
          )
        }
        const before = editor.snapshot()
        const event = new Event('cut', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'clipboardData', {
          value: { setData() {} },
        })
        ;(mode === 'source'
          ? root.querySelector('textarea')!
          : ctx.get(editorViewCtx).dom
        ).dispatchEvent(event)
        await copying
        editor.setEditable(false)
        editor.setEditable(true)
        copied()
        await vi.waitFor(() => expect(errors).toHaveLength(1))
        expect(errors[0]).toMatchObject({ code: 'stale-document' })
        expect(editor.snapshot()).toEqual(before)
      },
      {
        images: {
          presentation: () => undefined,
          importImage: async () => ({ reference: 'opaque' }),
          exportImage: async () => ({
            bytes: new Uint8Array([1]),
            mimeType: 'image/png',
          }),
        },
      },
      {
        error: (error) => errors.push(error),
        clipboard: () => {
          entered()
          return new Promise<void>((resolve) => {
            copied = resolve
          })
        },
      },
    )
  },
)

test('read-only task clicks and resize previews cannot mutate, including late pointer completion', () =>
  run(
    (editor, root, ctx) => {
      editor.loadDocument({
        ...input,
        text: '- [ ] task\n\n![photo|120](opaque)\n',
      })
      const view = ctx.get(editorViewCtx)
      const image = root.querySelector<HTMLImageElement>('.image img')!
      const handle = root.querySelector('.image-handle')!
      Object.defineProperty(view.dom, 'clientWidth', {
        value: 500,
        configurable: true,
      })
      vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({
        width: 120,
      } as DOMRect)
      const pointer = (type: string, clientX: number) => {
        const event = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX,
        })
        Object.defineProperty(event, 'pointerId', { value: 1 })
        handle.dispatchEvent(event)
      }
      pointer('pointerdown', 0)
      pointer('pointermove', 80)
      expect(image.style.width).toBe('200px')
      const before = editor.snapshot()
      editor.setEditable(false)
      expect(
        root.querySelector<HTMLImageElement>('.image img')!.style.width,
      ).toBe('120px')
      const task = root.querySelector('li')!
      let taskPos = 0
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'list_item') taskPos = pos
      })
      view.someProp('handleClickOn', (handler) =>
        handler(
          view,
          taskPos,
          view.state.doc.nodeAt(taskPos)!,
          taskPos,
          new MouseEvent('click'),
          true,
        ),
      )
      task.click()
      expect(editor.snapshot()).toEqual(before)
      editor.setEditable(true)
      pointer('pointerup', 80)
      expect(editor.snapshot()).toEqual(before)
    },
    {
      images: {
        presentation: () => ({ url: 'data:image/png;base64,AA==' }),
        importImage: async () => ({ reference: 'opaque' }),
        exportImage: async () => ({
          bytes: new Uint8Array(),
          mimeType: 'image/png',
        }),
      },
    },
  ))

test('document reload reports only its restored final source mode and selection', () => {
  const states: CommandState[] = []
  return run(
    (editor, root) => {
      editor.setEditingMode('source')
      root.querySelector('textarea')!.setSelectionRange(2, 4)
      states.length = 0
      editor.reloadDocument({
        ...input,
        generation: 9,
        text: input.text + 'next',
      })
      expect(states).toHaveLength(1)
      expect(states[0]).toMatchObject({
        generation: 9,
        revision: 0,
        mode: 'source',
      })
      expect([
        root.querySelector('textarea')!.selectionStart,
        root.querySelector('textarea')!.selectionEnd,
      ]).toEqual([2, 4])
    },
    {},
    { commandStateChanged: (state) => states.push(state) },
  )
})

test('formatted input preferences retain focus, selection, history and exact source', () =>
  run((editor, _root, ctx) => {
    editor.insertText('!', 8)
    const view = ctx.get(editorViewCtx)
    const selection = view.state.selection
    editor.focus()
    const snapshot = editor.snapshot()
    editor.setEditable(false)
    editor.setTextInputPreferences({
      spellcheck: true,
      autocorrect: true,
      autocapitalize: 'sentences',
    })
    expect(view.hasFocus()).toBe(true)
    expect(view.state.selection.eq(selection)).toBe(true)
    expect(editor.snapshot()).toEqual(snapshot)
    editor.setEditable(true)
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot().text).toBe(input.text)
  }))

test('inline code is available at a caret and configured shortcuts retain stored-mark typing', () =>
  run((editor) => {
    editor.setKeymap({ code: ['Ctrl-e'] })
    expect(editor.commandState().commands.format.code).toBe(true)
    expect(editor.keyDown('e', '', false, true, false, false, 8)).toBe(true)
    editor.insertText('code', 8)
    expect(editor.snapshot().text).toContain('`code`')
  }))

test('read-only buffered footnote navigation remains available', () =>
  run((editor, _root, ctx) => {
    editor.loadDocument({ ...input, text: 'Text[^note]\n\n[^note]: body\n' })
    const view = ctx.get(editorViewCtx)
    let reference = 0
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'footnote_reference') reference = pos
    })
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, reference),
      ),
    )
    editor.setEditable(false)
    const before = editor.snapshot()
    expect(editor.keyDown('Enter', '', false, false, true, false, 8)).toBe(true)
    expect(editor.snapshot()).toEqual(before)
    expect(view.state.selection.$from.parent.textContent).toBe('body')
  }))

test('table exit defaults can be disabled without blocking ordinary formatted Enter', () =>
  run((editor, _root, ctx) => {
    editor.setKeymap({ tableExit: [] })
    editor.table('insert')
    const view = ctx.get(editorViewCtx)
    let cell = 0
    view.state.doc.descendants((node, pos) => {
      if (!cell && node.type.name === 'table_cell') cell = pos + 2
    })
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, cell)),
    )
    const before = editor.snapshot()
    expect(editor.keyDown('Enter', '', true, false, false, false, 8)).toBe(
      false,
    )
    expect(editor.snapshot()).toEqual(before)
    editor.setKeymap({})
    expect(editor.keyDown('Enter', '', true, false, false, false, 8)).toBe(true)
    expect(editor.snapshot().text).not.toBe(before.text)
  }))

test('policy events publish only after both DOM surfaces receive the completed presentation change', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  const observations: {
    editable: boolean
    readOnly: boolean
    contentEditable: string | null
    spelling: (string | null)[]
  }[] = []
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    stateChanged() {},
    openLink() {},
    copy() {},
    commandStateChanged: (state) => {
      observations.push({
        editable: state.editable,
        readOnly: root.querySelector('textarea')!.readOnly,
        contentEditable: root
          .querySelector('.ProseMirror')!
          .getAttribute('contenteditable'),
        spelling: [
          root.querySelector('textarea')!.getAttribute('spellcheck'),
          root.querySelector('.ProseMirror')!.getAttribute('spellcheck'),
        ],
      })
    },
  })
  try {
    editor.loadDocument(input)
    observations.length = 0
    editor.setEditable(false)
    expect(observations).toEqual([
      {
        editable: false,
        readOnly: true,
        contentEditable: 'false',
        spelling: [null, null],
      },
    ])
    observations.length = 0
    editor.setTextInputPreferences({ spellcheck: false })
    expect(observations).toEqual([
      {
        editable: false,
        readOnly: true,
        contentEditable: 'false',
        spelling: ['false', 'false'],
      },
    ])
  } finally {
    await editor.destroy()
    root.remove()
  }
})

test('read-only buffered table Tab permits navigation without editing or adding rows', () =>
  run((editor, _root, ctx) => {
    editor.loadDocument({
      ...input,
      text: '| A | B |\n| --- | --- |\n| C | D |\n',
    })
    const view = ctx.get(editorViewCtx)
    const cells: number[] = []
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table_header' || node.type.name === 'table_cell')
        cells.push(pos + 2)
    })
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, cells[0]!),
      ),
    )
    editor.setEditable(false)
    const before = editor.snapshot()
    expect(editor.keyDown('Tab', '', false, false, false, false, 8)).toBe(true)
    expect(view.state.selection.from).toBe(cells[1])
    expect(editor.snapshot()).toEqual(before)
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, cells.at(-1)!),
      ),
    )
    expect(editor.keyDown('Tab', '', false, false, false, false, 8)).toBe(false)
    expect(editor.snapshot()).toEqual(before)
  }))
