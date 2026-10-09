import { expect, test, vi } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import {
  InkKitEditor,
  type DocumentInput,
  type TextRange,
  type EditorOptions,
} from '../src/index'

const input: DocumentInput = {
  documentId: 'search',
  generation: 9,
  format: 'md',
  text: '# Title\r\n\r\nA **😀 café** and İ.\r\n',
}
async function run(
  fn: (
    editor: InkKitEditor,
    root: HTMLElement,
    ctx: Ctx,
  ) => void | Promise<void>,
  options: EditorOptions = {},
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    {
      changed() {},
      stateChanged() {},
      copy() {},
      openLink() {},
    },
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
const range = (editor: InkKitEditor, text: string): TextRange => {
  const snapshot = editor.textSnapshot()
  const from = snapshot.text.indexOf(text)
  expect(from).toBeGreaterThanOrEqual(0)
  return { snapshotId: snapshot.snapshotId, from, to: from + text.length }
}

test('readable offsets preserve UTF-16 length across marks, without leaking source syntax', () =>
  run((editor) => {
    expect(editor.textSnapshot().text).toBe('Title\nA 😀 café and İ.')
    const selected = range(editor, '😀 café')
    editor.selectTextRange(selected)
    expect(editor.textSnapshot().selection).toEqual(selected)
    expect(editor.textSnapshot().snapshotId).toBe(selected.snapshotId)
    expect(editor.replaceTextRange(selected, '中\nnew')).toBe(true)
    expect(editor.textSnapshot().text).toContain('A 中\nnew and İ.')
    expect(() => editor.selectTextRange(selected)).toThrow(
      expect.objectContaining({ code: 'stale-document' }),
    )
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot().text).toBe(input.text)
  }))

test.each(['md', 'txt'] as const)(
  'source/TXT offsets normalise line endings and replacement preserves untouched source (%s)',
  (format) =>
    run((editor) => {
      const text = 'A😀\r\n**B**\r\n%%private%%\r\n'
      editor.loadDocument({ ...input, format, text })
      if (format === 'md') editor.setEditingMode('source')
      expect(editor.textSnapshot().text).toBe('A😀\n**B**\n%%private%%\n')
      expect(editor.replaceTextRange(range(editor, 'B'), 'Z\nQ')).toBe(true)
      expect(editor.snapshot().text).toBe(
        'A😀\r\n**Z\r\nQ**\r\n%%private%%\r\n',
      )
      expect(editor.undo()).toBe(true)
      expect(editor.snapshot().text).toBe(text)
    }),
)

test('range failures cannot split surrogates, remove structure or erase a hidden comment', () =>
  run(
    (editor) => {
      const before = editor.snapshot()
      const emoji = range(editor, '😀')
      expect(() =>
        editor.replaceTextRange({ ...emoji, from: emoji.from + 1 }, 'X'),
      ).toThrow(expect.objectContaining({ code: 'invalid-range' }))
      expect(() => editor.selectTextRange({ ...emoji, from: -1 })).toThrow(
        expect.objectContaining({ code: 'invalid-range' }),
      )
      expect(() =>
        editor.replaceTextRange(range(editor, 'Title\nA'), 'X'),
      ).toThrow(expect.objectContaining({ code: 'invalid-range' }))
      expect(editor.snapshot()).toEqual(before)
      editor.loadDocument({
        ...input,
        text: 'before%%secret%%after\n\n![photo|120](opaque)\n',
      })
      expect(editor.textSnapshot().text).toBe('beforeafter\nphoto')
      const preserved = editor.snapshot()
      expect(() =>
        editor.replaceTextRange(range(editor, 'beforeafter'), 'X'),
      ).toThrow(expect.objectContaining({ code: 'invalid-range' }))
      const photo = range(editor, 'photo')
      expect(() => editor.replaceTextRange(photo, 'X')).toThrow(
        expect.objectContaining({ code: 'invalid-range' }),
      )
      expect(() =>
        editor.selectTextRange({ ...photo, from: photo.from + 1 }),
      ).toThrow(expect.objectContaining({ code: 'invalid-range' }))
      expect(editor.snapshot()).toEqual(preserved)
    },
    {
      images: {
        presentation: () => undefined,
        importImage: async () => ({ reference: 'opaque' }),
        exportImage: async () => ({
          bytes: new Uint8Array(),
          mimeType: 'image/png',
        }),
      },
    },
  ))

test('scopes reject same-generation reloads, mode round trips and different editors', () =>
  run(async (editor) => {
    const held = range(editor, 'Title')
    editor.reloadDocument(input)
    expect(() => editor.selectTextRange(held)).toThrow(
      expect.objectContaining({ code: 'stale-document' }),
    )
    const mode = range(editor, 'Title')
    editor.setEditingMode('source')
    editor.setEditingMode('formatted')
    expect(() => editor.textRangeRects(mode)).toThrow(
      expect.objectContaining({ code: 'stale-document' }),
    )
    const current = range(editor, 'Title')
    await run((second) => {
      expect(() => second.replaceTextRange(current, 'Other')).toThrow(
        expect.objectContaining({ code: 'stale-document' }),
      )
      expect(second.snapshot().text).toBe(input.text)
    })
  }))

test('read-only retains search navigation while composition blocks snapshot operations', () =>
  run((editor, root) => {
    editor.setEditingMode('source')
    const selected = range(editor, 'Title')
    editor.setEditable(false)
    editor.selectTextRange(selected)
    expect(editor.textSnapshot().selection).toEqual(selected)
    expect(() => editor.replaceTextRange(selected, 'X')).toThrow(
      expect.objectContaining({ code: 'read-only' }),
    )
    editor.setEditable(true)
    const plain = root.querySelector('textarea')!
    plain.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    )
    expect(() => editor.textSnapshot()).toThrow(
      expect.objectContaining({ code: 'composition' }),
    )
    expect(() => editor.selectTextRange(selected)).toThrow(
      expect.objectContaining({ code: 'composition' }),
    )
    expect(() => editor.replaceTextRange(selected, 'X')).toThrow(
      expect.objectContaining({ code: 'composition' }),
    )
    expect(() => editor.visibleTextRanges(selected.snapshotId)).toThrow(
      expect.objectContaining({ code: 'composition' }),
    )
    plain.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true }),
    )
    expect(editor.textSnapshot().snapshotId).toBe(selected.snapshotId)
  }))

test('formatted code replacement remains literal and has one coherent undo', () =>
  run((editor) => {
    const text = '```ts\nconst a = "😀"\n```\n\nUnknown ![[path]]\n'
    editor.loadDocument({ ...input, text })
    editor.replaceTextRange(range(editor, 'const a'), '**literal**\nnext')
    expect(editor.snapshot().text).toContain('**literal**\nnext = "😀"')
    expect(editor.snapshot().text).toContain('![[path]]')
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot().text).toBe(text)
  }))

test('reload retains backward formatted/source selections and browsing host focus', () =>
  run((editor, root, ctx) => {
    const host = document.createElement('input')
    document.body.append(host)
    try {
      const view = ctx.get(editorViewCtx)
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 6, 2)),
      )
      host.focus()
      root.scrollTop = 31
      root.scrollLeft = 5
      editor.reloadDocument({ ...input, generation: 10 })
      expect(document.activeElement).toBe(host)
      expect([view.state.selection.anchor, view.state.selection.head]).toEqual([
        6, 2,
      ])
      expect([root.scrollTop, root.scrollLeft]).toEqual([31, 5])
      editor.setEditingMode('source')
      const plain = root.querySelector('textarea')!
      plain.setSelectionRange(2, 6, 'backward')
      editor.reloadDocument({ ...input, generation: 11 })
      expect(document.activeElement).toBe(host)
      expect([
        plain.selectionStart,
        plain.selectionEnd,
        plain.selectionDirection,
      ]).toEqual([2, 6, 'backward'])
    } finally {
      host.remove()
    }
  }))

test('long source visibility builds only one layout mirror per demand and preserves scope', () =>
  run((editor, root) => {
    editor.loadDocument({
      ...input,
      format: 'txt',
      text: 'Long 😀 line\r\n'.repeat(2000),
    })
    const plain = root.querySelector('textarea')!
    Object.defineProperties(plain, {
      clientWidth: { value: 400 },
      clientHeight: { value: 300 },
    })
    const append = vi.spyOn(document.body, 'append')
    const snapshot = editor.textSnapshot()
    expect(editor.visibleTextRanges(snapshot.snapshotId)).toEqual([])
    expect(append).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[aria-hidden="true"]')).toBeNull()
    expect(editor.textSnapshot().snapshotId).toBe(snapshot.snapshotId)
    append.mockRestore()
  }))

test('viewport validates its target and insets without mutating text or selection', () =>
  run((editor, root) => {
    const snapshot = editor.textSnapshot()
    const unrelated = document.createElement('div')
    expect(() => editor.setViewport({ scrollContainer: unrelated })).toThrow(
      RangeError,
    )
    expect(() => editor.setViewport({ insets: { top: Number.NaN } })).toThrow(
      RangeError,
    )
    expect(() => editor.setViewport({ insets: { left: -1 } })).toThrow(
      RangeError,
    )
    editor.setViewport({
      scrollContainer: root,
      insets: { top: 42, bottom: 24 },
    })
    expect(editor.viewport().insets).toEqual({
      top: 42,
      right: 0,
      bottom: 24,
      left: 0,
    })
    expect(editor.textSnapshot()).toEqual(snapshot)
  }))

test('callout label geometry measures the title and full labels select their container safely', () =>
  run((editor, root) => {
    editor.loadDocument({
      ...input,
      text: '> [!NOTE]- Protected title\n> Hidden body\n',
    })
    const title = root.querySelector<HTMLElement>('.inkkit-callout-title')!
    const spy = vi
      .spyOn(title, 'getClientRects')
      .mockReturnValue([new DOMRect(10, 20, 120, 18)] as unknown as DOMRectList)
    try {
      const label = range(editor, 'Protected title')
      expect(editor.textRangeRects(label)).toEqual([
        { left: 10, top: 20, right: 130, bottom: 38, width: 120, height: 18 },
      ])
      expect(() =>
        editor.replaceTextRange(
          { ...label, from: label.from + 1, to: label.from + 1 },
          'X',
        ),
      ).toThrow(expect.objectContaining({ code: 'invalid-range' }))
      editor.selectTextRange(label)
      expect(editor.textSnapshot().selection.to).toBe(
        editor.textSnapshot().text.length,
      )
      const before = editor.snapshot()
      editor.revealTextRange(range(editor, 'Hidden body'))
      expect(
        root
          .querySelector('.inkkit-callout')!
          .getAttribute('data-inkkit-folded'),
      ).toBe('false')
      expect(editor.snapshot()).toEqual(before)
    } finally {
      spy.mockRestore()
    }
  }))

test('internal formatted scrolling remains safe during composition while public operations are guarded', () =>
  run((editor, _root, ctx) => {
    const view = ctx.get(editorViewCtx)
    Object.defineProperty(view, 'composing', {
      configurable: true,
      value: true,
    })
    try {
      expect(() => view.dispatch(view.state.tr.scrollIntoView())).not.toThrow()
      expect(() => editor.textSnapshot()).toThrow(
        expect.objectContaining({ code: 'composition' }),
      )
    } finally {
      delete (view as unknown as { composing?: boolean }).composing
    }
    expect(editor.textSnapshot().text).toContain('😀')
  }))

test('insets remain measured from the visible edges when the editor is clipped above and left of the window', () =>
  run((editor, root) => {
    Object.defineProperties(root, {
      clientWidth: { configurable: true, value: 300 },
      clientHeight: { configurable: true, value: 400 },
    })
    const bounds = vi
      .spyOn(root, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(-30, -80, 300, 400))
    try {
      const snapshot = editor.textSnapshot()
      editor.setViewport({
        insets: { top: 42, right: 11, bottom: 24, left: 7 },
      })
      expect(editor.viewport().rect).toEqual({
        left: 7,
        top: 42,
        right: 259,
        bottom: 296,
        width: 252,
        height: 254,
      })
      expect(editor.textSnapshot()).toEqual(snapshot)
    } finally {
      bounds.mockRestore()
    }
  }))
