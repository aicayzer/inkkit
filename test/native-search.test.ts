import { ctxOf } from './editor-access'
import { expect, test, vi } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection, NodeSelection } from '@milkdown/kit/prose/state'
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
      copy() {},
      openLink() {},
    },
    options,
  )
  const ctx = ctxOf(editor)
  try {
    // An earlier generation, so that a test can load `input` again.
    editor.loadDocument({ ...input, generation: 1 })
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

test('scopes reject reloads of the same text, mode round trips and different editors', () =>
  run(async (editor) => {
    const held = range(editor, 'Title')
    editor.reloadDocument(input)
    expect(() => editor.selectTextRange(held)).toThrow(
      expect.objectContaining({ code: 'stale-document' }),
    )
    const mode = range(editor, 'Title')
    editor.setEditingMode('source')
    editor.setEditingMode('formatted')
    expect(() => editor.textRangesRects([mode])).toThrow(
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

test.each(['md', 'txt'] as const)(
  'loading a document releases only its own %s editing focus',
  (format) =>
    run((editor, root) => {
      const document = { ...input, format }
      editor.loadDocument(document)
      editor.focus()
      expect(root.contains(globalThis.document.activeElement)).toBe(true)
      editor.reloadDocument({ ...document, generation: 10 })
      expect(root.contains(globalThis.document.activeElement)).toBe(true)
      editor.loadDocument({ ...document, documentId: 'next', generation: 11 })
      expect(root.contains(globalThis.document.activeElement)).toBe(false)
      const host = globalThis.document.createElement('input')
      globalThis.document.body.append(host)
      try {
        host.focus()
        editor.loadDocument({ ...document, generation: 12 })
        expect(globalThis.document.activeElement).toBe(host)
        editor.focus()
        expect(root.contains(globalThis.document.activeElement)).toBe(true)
      } finally {
        host.remove()
      }
    }),
)

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
    for (const options of [
      { scrollContainer: unrelated },
      { insets: { top: Number.NaN } },
      { insets: { left: -1 } },
    ])
      expect(() => editor.setViewport(options)).toThrow(
        expect.objectContaining({ code: 'invalid-argument' }),
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
      expect(editor.textRangesRects([label])).toEqual([
        [{ left: 10, top: 20, right: 130, bottom: 38, width: 120, height: 18 }],
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

test.each([
  {
    text: 'Before\n\n> [!NOTE]- Protected title\n> Hidden body\n\nAfter\n',
    label: 'Protected title',
    type: 'inkkit_callout',
  },
  {
    text: 'Before\n\n![photo](opaque)\n\nAfter\n',
    label: 'photo',
    type: 'image_block',
  },
])(
  'reload retains valid $type node selections and safely falls back when the selected node disappears',
  ({ text, label, type }) =>
    run(
      (editor, _root, ctx) => {
        const document = { ...input, text }
        editor.loadDocument(document)
        editor.selectTextRange(range(editor, label))
        const selected = editor.textSnapshot().selection
        const view = ctx.get(editorViewCtx)
        expect(view.state.selection).toBeInstanceOf(NodeSelection)
        expect((view.state.selection as NodeSelection).node.type.name).toBe(
          type,
        )
        editor.reloadDocument({ ...document, generation: 10 })
        expect(view.state.selection).toBeInstanceOf(NodeSelection)
        expect(editor.textSnapshot().selection).toMatchObject({
          from: selected.from,
          to: selected.to,
        })
        expect(editor.snapshot().text).toBe(text)
        editor.reloadDocument({
          ...document,
          generation: 11,
          text: 'Before\n\nReplacement\n\nAfter\n',
        })
        expect(view.state.selection).toBeInstanceOf(TextSelection)
        expect(editor.snapshot().text).toBe('Before\n\nReplacement\n\nAfter\n')
        expect(editor.textSnapshot().selection.to).toBeLessThanOrEqual(
          editor.textSnapshot().text.length,
        )
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
    ),
)

test('reveal fits a complete wrapped range and uses a stable leading anchor for oversized content', () =>
  run((editor, root) => {
    Object.defineProperties(root, {
      clientWidth: { configurable: true, value: 220 },
      clientHeight: { configurable: true, value: 150 },
    })
    const bounds = vi
      .spyOn(root, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(10, 10, 220, 150))
    let measured = [
      new DOMRect(100, 152, 50, 18),
      new DOMRect(120, 170, 100, 18),
      new DOMRect(200, 188, 80, 18),
    ]
    const rects = vi
      .spyOn(editor, 'textRangesRects')
      .mockImplementation((ranges) =>
        ranges.map(() =>
          measured.map((rect) => ({
            left: rect.left - root.scrollLeft,
            right: rect.right - root.scrollLeft,
            top: rect.top - root.scrollTop,
            bottom: rect.bottom - root.scrollTop,
            width: rect.width,
            height: rect.height,
          })),
        ),
      )
    try {
      const target = range(editor, 'Title')
      editor.revealTextRange(target)
      expect([root.scrollTop, root.scrollLeft]).toEqual([46, 50])
      const viewport = editor.viewport().rect
      expect(
        editor
          .textRangesRects([target])[0]!
          .every(
            (rect) =>
              rect.top >= viewport.top &&
              rect.bottom <= viewport.bottom &&
              rect.left >= viewport.left &&
              rect.right <= viewport.right,
          ),
      ).toBe(true)
      editor.revealTextRange(target)
      expect([root.scrollTop, root.scrollLeft]).toEqual([46, 50])
      root.scrollTop = 0
      root.scrollLeft = 0
      measured = [
        new DOMRect(50, 152, 300, 200),
        new DOMRect(50, 352, 300, 200),
      ]
      editor.revealTextRange(target)
      expect([root.scrollTop, root.scrollLeft]).toEqual([142, 40])
      editor.revealTextRange(target)
      expect([root.scrollTop, root.scrollLeft]).toEqual([142, 40])
    } finally {
      rects.mockRestore()
      bounds.mockRestore()
    }
  }))

test('ordinary formatted find reveals its complete effective selection', () =>
  run((editor) => {
    const reveal = vi.spyOn(editor, 'revealTextRange')
    try {
      editor.find('😀 café')
      expect(reveal).toHaveBeenCalledTimes(1)
      expect(reveal.mock.calls[0]![0]).toEqual(editor.textSnapshot().selection)
      const selected = editor.textSnapshot().selection
      expect(editor.textSnapshot().text.slice(selected.from, selected.to)).toBe(
        '😀 café',
      )
    } finally {
      reveal.mockRestore()
    }
  }))

test('batch geometry validates every range before creating a source layout', () =>
  run((editor) => {
    editor.setEditingMode('source')
    const emoji = range(editor, '😀')
    const append = vi.spyOn(document.body, 'append')
    try {
      expect(() =>
        editor.textRangesRects([emoji, { ...emoji, from: emoji.from + 1 }]),
      ).toThrow(expect.objectContaining({ code: 'invalid-range' }))
      expect(append).not.toHaveBeenCalled()
      expect(() =>
        editor.textRangesRects([emoji, { ...emoji, snapshotId: 'stale' }]),
      ).toThrow(expect.objectContaining({ code: 'stale-document' }))
      expect(editor.textRangesRects([])).toEqual([])
    } finally {
      append.mockRestore()
    }
  }))

test('batch source geometry uses one temporary layout and freezes ordered results', () =>
  run((editor, root) => {
    editor.setEditingMode('source')
    const plain = root.querySelector('textarea')!
    Object.defineProperties(plain, {
      clientWidth: { value: 600 },
      clientHeight: { value: 400 },
    })
    const selected = [range(editor, '😀'), range(editor, 'Title')]
    const append = vi.spyOn(document.body, 'append')
    const children = document.body.childElementCount
    try {
      const result = editor.textRangesRects(selected)
      expect(append).toHaveBeenCalledTimes(1)
      expect(document.body.childElementCount).toBe(children)
      expect(result).toEqual(
        selected.map((value) => editor.textRangesRects([value])[0]),
      )
      expect(Object.isFrozen(result)).toBe(true)
      expect(result.every(Object.isFrozen)).toBe(true)
      expect(result.flat().every(Object.isFrozen)).toBe(true)
    } finally {
      append.mockRestore()
    }
  }))

test('failed batch measurement releases its temporary source layout', () =>
  run((editor, root) => {
    editor.setEditingMode('source')
    const plain = root.querySelector('textarea')!
    Object.defineProperties(plain, {
      clientWidth: { value: 600 },
      clientHeight: { value: 400 },
    })
    const before = document.body.childElementCount
    const rects = vi
      .spyOn(Range.prototype, 'getClientRects')
      .mockImplementation(() => {
        throw new Error('Measurement failed')
      })
    try {
      expect(() => editor.textRangesRects([range(editor, 'Title')])).toThrow(
        'Measurement failed',
      )
      expect(document.body.childElementCount).toBe(before)
    } finally {
      rects.mockRestore()
    }
  }))

test('search results share formatted match semantics without changing query, selection or source', () =>
  run(
    (editor, root) => {
      const text =
        '+ **Garden** and garden 😀\r\n\r\n[Garden](https://garden.test) %%garden%%\r\n\r\n![garden](opaque)\r\n'
      editor.loadDocument({ ...input, text })
      editor.find('😀')
      const before = editor.snapshot()
      const selection = editor.textSnapshot().selection
      const highlights = [
        ...root.querySelectorAll(
          '.ProseMirror-search-match, .ProseMirror-active-search-match',
        ),
      ].map((node) => node.textContent)
      const results = editor.searchMatches('garden', input.generation)
      expect(results).toHaveLength(3)
      expect(Object.isFrozen(results)).toBe(true)
      expect(results.every(Object.isFrozen)).toBe(true)
      const readable = editor.textSnapshot()
      expect(
        results.map((match) => readable.text.slice(match.from, match.to)),
      ).toEqual(['Garden', 'garden', 'Garden'])
      expect(editor.textSnapshot().selection).toEqual(selection)
      expect(editor.snapshot()).toEqual(before)
      expect(
        [
          ...root.querySelectorAll(
            '.ProseMirror-search-match, .ProseMirror-active-search-match',
          ),
        ].map((node) => node.textContent),
      ).toEqual(highlights)
      expect(editor.searchMatches('garden.test')).toEqual([])
      expect(editor.searchMatches('hidden')).toEqual([])
      expect(editor.searchMatches('')).toEqual([])
      expect(editor.searchMatches('missing')).toEqual([])
      expect(editor.replaceAll('garden', 'park')).toBe(results.length)
      expect(editor.undo()).toBe(true)
      expect(editor.snapshot().text).toBe(text)
      editor.reloadDocument({
        ...input,
        generation: 10,
        text: editor.snapshot().text,
      })
      expect(editor.snapshot().text).toBe(text)
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

test('search results do not join text across hidden comments or block boundaries', () =>
  run((editor) => {
    editor.loadDocument({ ...input, text: 'be%%hidden%%fore\n\nafter\n' })
    expect(editor.searchMatches('before')).toEqual([])
    expect(editor.searchMatches('fore\nafter')).toEqual([])
    expect(editor.searchMatches('fore')).toHaveLength(1)
    expect(editor.find('hidden')).toBe(false)
    expect(editor.replaceAll('hidden', 'removed')).toBe(0)
    expect(editor.snapshot().text).toBe('be%%hidden%%fore\n\nafter\n')
  }))

test.each(['md', 'txt'] as const)(
  'source search results use displayed UTF-16 offsets and literal Unicode matching (%s)',
  (format) =>
    run((editor) => {
      const text = 'İ 😀 $&\r\ni 😀 $&\r\n'
      editor.loadDocument({ ...input, format, text })
      if (format === 'md') editor.setEditingMode('source')
      const before = editor.snapshot()
      const readable = editor.textSnapshot()
      expect(editor.searchMatches('i')).toEqual([
        { snapshotId: readable.snapshotId, from: 8, to: 9 },
      ])
      const emoji = editor.searchMatches('😀')
      expect(emoji.map(({ from, to }) => [from, to])).toEqual([
        [2, 4],
        [10, 12],
      ])
      expect(editor.searchMatches('$&')).toHaveLength(2)
      expect(
        editor.searchMatches('\r\n').map(({ from, to }) => [from, to]),
      ).toEqual([
        [7, 8],
        [15, 16],
      ])
      expect(
        editor.searchMatches('\n').map(({ from, to }) => [from, to]),
      ).toEqual([
        [7, 8],
        [15, 16],
      ])
      expect(editor.snapshot()).toEqual(before)
      editor.selectTextRange(emoji[1]!)
      expect(editor.textSnapshot().selection).toEqual(emoji[1])
      expect(editor.replace('😀', '$1')).toBe(true)
      expect(editor.snapshot().text).toBe('İ 😀 $&\r\ni $1 $&\r\n')
      expect(editor.undo()).toBe(true)
      expect(editor.snapshot().text).toBe(text)
    }),
)

test('search results support read-only and reject stale, invalid and composing calls', () =>
  run((editor, root) => {
    editor.setEditingMode('source')
    editor.setEditable(false)
    const results = editor.searchMatches('Title')
    expect(results).toHaveLength(1)
    const before = editor.snapshot()
    expect(() => editor.searchMatches('Title', 99)).toThrow(
      expect.objectContaining({ code: 'stale-document' }),
    )
    expect(() => editor.searchMatches(null as unknown as string)).toThrow(
      expect.objectContaining({ code: 'invalid-argument' }),
    )
    expect(editor.snapshot()).toEqual(before)
    editor.setEditable(true)
    const plain = root.querySelector('textarea')!
    plain.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    )
    expect(() => editor.searchMatches('Title')).toThrow(
      expect.objectContaining({ code: 'composition' }),
    )
    plain.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true }),
    )
    editor.reloadDocument(input)
    expect(() => editor.selectTextRange(results[0]!)).toThrow(
      expect.objectContaining({ code: 'stale-document' }),
    )
  }))
