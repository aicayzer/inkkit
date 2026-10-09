import { expect, test, vi } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import {
  InkKitEditor,
  InkKitError,
  type EditorEvents,
  type ImageAdapter,
} from '../src/index'

async function run(
  callback: (
    editor: InkKitEditor,
    plain: HTMLTextAreaElement,
    ctx: Ctx,
    root: HTMLElement,
  ) => void | Promise<void>,
  events: Partial<EditorEvents> = {},
  images?: ImageAdapter,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    { changed() {}, stateChanged() {}, copy() {}, openLink() {}, ...events },
    { images },
  )
  const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
  try {
    await callback(editor, root.querySelector('textarea')!, ctx, root)
  } finally {
    await editor.destroy()
    root.remove()
  }
}
const input = {
  documentId: 'source-fixture',
  generation: 12,
  format: 'md' as const,
  text: '__bold__\r\n\r\nText\r\n',
}
function sourceInput(
  plain: HTMLTextAreaElement,
  value: string,
  start = value.length,
  end = start,
) {
  plain.value = value
  plain.setSelectionRange(start, end)
  plain.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText' }),
  )
}

test('mode switches retain source, identity, revision, dirty state and history', () =>
  run((editor, plain, ctx) => {
    editor.loadDocument(input)
    const baseline = editor.snapshot()
    expect(editor.editingMode).toBe('formatted')
    expect(editor.setEditingMode('source', 12)).toBe(true)
    expect(plain.hidden).toBe(false)
    expect(ctx.get(editorViewCtx).dom.parentElement!.hidden).toBe(true)
    expect(plain.value).toBe(input.text.replaceAll('\r\n', '\n'))
    expect(editor.snapshot()).toEqual(baseline)
    expect(editor.setEditingMode('source')).toBe(false)
    expect(editor.setEditingMode('formatted')).toBe(true)
    expect(editor.snapshot()).toEqual(baseline)
    expect(editor.undo()).toBe(false)
  }))

test('source spelling changes have exact events, revision and undo despite equal formatted content', () =>
  run(
    (editor) => {
      editor.loadDocument(input)
      const canonical = '**bold**\r\n\r\nText\r\n'
      expect(editor.replaceSource(canonical, 12)).toBe(true)
      expect(editor.snapshot()).toEqual({
        ...input,
        text: canonical,
        dirty: true,
        revision: 1,
      })
      expect(editor.replaceSource(canonical)).toBe(false)
      expect(editor.undo(12)).toBe(true)
      expect(editor.snapshot()).toEqual({ ...input, dirty: false, revision: 2 })
      expect(editor.redo(12)).toBe(true)
      expect(editor.snapshot()).toMatchObject({
        text: canonical,
        dirty: true,
        revision: 3,
      })
    },
    {
      changed(text, generation) {
        expect(generation).toBe(12)
        expect([input.text, '**bold**\r\n\r\nText\r\n']).toContain(text)
      },
    },
  ))

test('source and formatted edits share isolated coherent history', () =>
  run((editor, plain, ctx) => {
    editor.loadDocument({ ...input, text: 'first\n' })
    editor.replaceSource('second\n')
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.insertText('!', view.state.doc.content.size - 1),
    )
    expect(editor.snapshot().text).toBe('second!\n')
    editor.setEditingMode('source')
    expect(plain.value).toBe('second!\n')
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot().text).toBe('second\n')
    expect(plain.value).toBe('second\n')
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot()).toMatchObject({ text: 'first\n', dirty: false })
    editor.setEditingMode('formatted')
    expect(editor.redo()).toBe(true)
    expect(editor.snapshot().text).toBe('second\n')
    expect(editor.redo()).toBe(true)
    expect(editor.snapshot().text).toBe('second!\n')
  }))

test('unsupported and incomplete complete source remains exact across switching, exports and reopening', () =>
  run(async (editor) => {
    editor.loadDocument(input)
    const raw =
      '\uFEFF# Heading\r\n\r\n<div strange="x">raw</div>\r\n\r\n```mermaid\r\ngraph TD; A-->B\r\n\r\n[broken](\r\n%% unfinished'
    editor.replaceSource(raw)
    editor.setEditingMode('source')
    expect(editor.snapshot().text).toBe(raw)
    editor.setEditingMode('formatted')
    expect(editor.snapshot().text).toBe(raw)
    expect((await editor.clipboardSnapshot()).markdown).toBe(raw)
    editor.loadDocument({ ...input, generation: 13, text: raw })
    expect(editor.snapshot()).toMatchObject({
      text: raw,
      dirty: false,
      revision: 0,
    })
    expect(editor.undo()).toBe(false)
  }))

test('native source input preserves BOM and unchanged mixed line endings', () =>
  run((editor, plain) => {
    const raw = '\uFEFFone\r\ntwo\nthree\rfour'
    editor.loadDocument({ ...input, text: raw })
    editor.setEditingMode('source')
    sourceInput(plain, '\uFEFFone\ntwo!\nthree\nfour')
    expect(editor.snapshot().text).toBe('\uFEFFone\r\ntwo!\nthree\rfour')
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot().text).toBe(raw)
    expect(editor.redo()).toBe(true)
    expect(plain.value).toBe('\uFEFFone\ntwo!\nthree\nfour')
  }))

test('source paste uses explicit Markdown literally with exact pasted endings and one undo', () =>
  run(async (editor, plain) => {
    editor.loadDocument({ ...input, text: 'before\r\nafter' })
    editor.setEditingMode('source')
    plain.setSelectionRange(7, 12)
    await editor.paste({
      text: 'readable',
      markdown: '**raw**\r\n%%private%%',
      html: '<b>ignored</b>',
      images: [
        { source: 'ignored', bytes: new Uint8Array(), mimeType: 'image/png' },
      ],
    })
    expect(editor.snapshot().text).toBe('before\r\n**raw**\r\n%%private%%')
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot().text).toBe('before\r\nafter')
  }))

test('buffered source input and native undo keys use current literal selection', () =>
  run((editor, plain) => {
    editor.loadDocument({ ...input, text: 'A😀B' })
    editor.setEditingMode('source')
    plain.setSelectionRange(3, 3)
    expect(
      editor.keyDown('Backspace', 'Backspace', false, false, false, false, 12),
    ).toBe(true)
    expect(editor.snapshot().text).toBe('AB')
    expect(editor.keyDown('z', 'KeyZ', true, false, false, false, 12)).toBe(
      true,
    )
    expect(editor.snapshot().text).toBe('A😀B')
    plain.setSelectionRange(1, 3)
    expect(editor.insertText('**literal**', 12)).toBe(true)
    expect(editor.snapshot().text).toBe('A**literal**B')
    plain.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }),
    )
    expect(editor.snapshot().text).toBe('A😀B')
  }))

test('composition and stale generation block source commands without mutation', () =>
  run((editor, plain) => {
    editor.loadDocument(input)
    editor.setEditingMode('source')
    const before = editor.snapshot()
    plain.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    )
    for (const operation of [
      () => editor.snapshot(),
      () => editor.replaceSource('no'),
      () => editor.setEditingMode('formatted'),
      () => editor.undo(),
      () => editor.redo(),
      () => editor.replaceAll('Text', 'no'),
      () => editor.headings(),
    ])
      expect(operation).toThrow(/composition/i)
    expect(editor.insertText('no', 12)).toBe(false)
    plain.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true }),
    )
    expect(editor.snapshot()).toEqual(before)
    for (const operation of [
      () => editor.replaceSource('no', 11),
      () => editor.setEditingMode('formatted', 11),
      () => editor.undo(11),
      () => editor.redo(11),
      () => editor.find('Text', 11),
    ])
      expect(operation).toThrow('Document changed')
    expect(editor.snapshot()).toEqual(before)
  }))

test('source mode keeps formatted commands inert and rejects image insertion', () =>
  run(async (editor, _plain, ctx) => {
    editor.loadDocument({
      ...input,
      text: '# Heading\n\nText[^n]\n\n[^n]: note\n',
    })
    editor.setEditingMode('source')
    const before = editor.snapshot()
    editor.format('bold')
    expect(editor.table('insert')).toBe(false)
    editor.navigateFootnote('definition')
    expect(() =>
      editor.insertImages([{ path: 'opaque', alt: 'image' }]),
    ).toThrow(InkKitError)
    expect(editor.snapshot()).toEqual(before)
    expect(ctx.get(editorViewCtx).state.doc.firstChild!.type.name).toBe(
      'heading',
    )
  }))

test('source selection Markdown maps CRLF exactly and ordinary copy omits partial private comments', () =>
  run(async (editor, plain) => {
    const raw = 'A\r\n**bold** %%PRIVATE%% end\r\n'
    editor.loadDocument({ ...input, text: raw })
    editor.setEditingMode('source')
    plain.setSelectionRange(0, plain.value.length)
    const all = await editor.clipboardSnapshot(false)
    expect(all.markdown).toBe(raw)
    expect(all.text).toContain('bold')
    expect(all.text).not.toContain('PRIVATE')
    const start = plain.value.indexOf('PRIVATE') + 2
    plain.setSelectionRange(start, start + 4)
    const privateSlice = await editor.clipboardSnapshot(false)
    expect(privateSlice.markdown).toBe('IVAT')
    expect(privateSlice.text).toBe('')
    expect(privateSlice.html).not.toContain('IVAT')
  }))

test('source fragment copying leaves code literal and does not import unselected reference definitions', () =>
  run(async (editor, plain) => {
    editor.loadDocument({
      ...input,
      text: '`%%CODE%%`\n\n[link][target]\n\n[target]: https://example.com/private\n',
    })
    editor.setEditingMode('source')
    plain.setSelectionRange(0, 10)
    expect((await editor.clipboardSnapshot(false)).text).toContain('%%CODE%%')
    const from = plain.value.indexOf('[link]')
    plain.setSelectionRange(from, from + '[link][target]'.length)
    const clip = await editor.clipboardSnapshot(false)
    expect(clip.markdown).toBe('[link][target]')
    expect(clip.html).not.toContain('example.com/private')
  }))

test('TXT uses literal source with unified undo and never parses Markdown', () =>
  run(async (editor, plain) => {
    const text = '\uFEFF**literal**\r\n%%PRIVATE%%'
    editor.loadDocument({ ...input, format: 'txt', text })
    expect(editor.editingMode).toBe('source')
    expect(editor.setEditingMode('formatted')).toBe(false)
    editor.replaceSource('# still literal\r\n%%PRIVATE%%')
    expect((await editor.clipboardSnapshot()).text).toBe(
      '# still literal\r\n%%PRIVATE%%',
    )
    expect(editor.headings()).toEqual([])
    editor.undo()
    expect(editor.snapshot()).toMatchObject({ text, dirty: false })
    sourceInput(plain, plain.value + '!')
    expect(editor.snapshot().text).toBe(text + '!')
    editor.undo()
    expect(editor.snapshot().text).toBe(text)
  }))

test('source edits invalidate headings and switching presentation invalidates navigation tokens', () =>
  run((editor) => {
    editor.loadDocument({ ...input, text: '# One\n\n## Two\n' })
    const formatted = editor.headings()
    editor.setEditingMode('source')
    const source = editor.headings()
    expect(source.map((item) => item.text)).toEqual(['One', 'Two'])
    expect(() => editor.navigateHeading(formatted[0]!)).toThrow(
      'no longer current',
    )
    editor.navigateHeading(source[1]!)
    editor.replaceSource('# Changed\n')
    expect(() => editor.navigateHeading(source[0]!)).toThrow(
      'no longer current',
    )
    editor.setEditingMode('formatted')
    editor.setEditingMode('source')
    expect(() => editor.navigateHeading(source[1]!)).toThrow(
      'no longer current',
    )
  }))

test('same-generation document switching clears source history and rejects old outline identity', () =>
  run((editor) => {
    editor.loadDocument(input)
    editor.setEditingMode('source')
    editor.replaceSource('# Old\n')
    const old = editor.headings()[0]!
    editor.loadDocument({ ...input, documentId: 'other', text: '# New\n' })
    expect(editor.editingMode).toBe('formatted')
    expect(editor.snapshot()).toMatchObject({
      documentId: 'other',
      revision: 0,
      dirty: false,
    })
    expect(editor.undo()).toBe(false)
    expect(() => editor.navigateHeading(old)).toThrow('no longer current')
  }))

test('source reload retains presentation, normalized selected range and scroll', () =>
  run((editor, plain, ctx, root) => {
    editor.loadDocument(input)
    editor.setEditingMode('source')
    plain.setSelectionRange(2, 7)
    root.scrollTop = 23
    plain.scrollTop = 123
    plain.scrollLeft = 45
    editor.reloadDocument({ ...input, generation: 13, text: '__changed__\r\n' })
    expect(editor.editingMode).toBe('source')
    expect(plain.hidden).toBe(false)
    expect(ctx.get(editorViewCtx).dom.parentElement!.hidden).toBe(true)
    expect([plain.selectionStart, plain.selectionEnd]).toEqual([2, 7])
    expect(root.scrollTop).toBe(23)
    expect(plain.scrollTop).toBe(123)
    expect(plain.scrollLeft).toBe(45)
    expect(editor.snapshot()).toMatchObject({
      generation: 13,
      text: '__changed__\r\n',
      dirty: false,
      revision: 0,
    })
    expect(editor.undo()).toBe(false)
  }))

test('source replacement restores the prior source selection through undo', () =>
  run((editor, plain) => {
    editor.loadDocument({ ...input, text: 'before after' })
    editor.setEditingMode('source')
    plain.setSelectionRange(7, 12)
    editor.pasteAsPlainText('replacement')
    expect([plain.selectionStart, plain.selectionEnd]).toEqual([18, 18])
    editor.undo()
    expect(editor.snapshot().text).toBe('before after')
    expect([plain.selectionStart, plain.selectionEnd]).toEqual([7, 12])
    editor.redo()
    expect([plain.selectionStart, plain.selectionEnd]).toEqual([18, 18])
  }))

test('literal replacement matches raw endings and preserves replacement bytes', () =>
  run((editor, plain) => {
    editor.loadDocument({ ...input, text: 'one\r\ntwo\nthree' })
    editor.setEditingMode('source')
    plain.setSelectionRange(0, 0)
    editor.find('one\ntwo')
    expect([plain.selectionStart, plain.selectionEnd]).toEqual([0, 0])
    editor.find('one\r\ntwo')
    expect([plain.selectionStart, plain.selectionEnd]).toEqual([0, 7])
    expect(editor.replace('one\r\ntwo', 'first\rsecond')).toBe(true)
    expect(editor.snapshot().text).toBe('first\rsecond\nthree')
    expect([plain.selectionStart, plain.selectionEnd]).toEqual([0, 12])
    editor.undo()
    expect(editor.snapshot().text).toBe('one\r\ntwo\nthree')
  }))

test('each document load displays only its active editing surface', () =>
  run((editor, plain, ctx) => {
    for (const format of ['txt', 'md', 'txt', 'md'] as const) {
      editor.loadDocument({ ...input, format, text: '**literal**' })
      expect(plain.hidden).toBe(format === 'md')
      expect(ctx.get(editorViewCtx).dom.parentElement!.hidden).toBe(
        format === 'txt',
      )
    }
  }))

test('TXT selection clipboard retains exact mixed endings without filtering comments', () =>
  run(async (editor, plain) => {
    const text = '**literal**\r\n%%PRIVATE%%\nlast\r'
    editor.loadDocument({ ...input, format: 'txt', text })
    plain.setSelectionRange(0, plain.value.length)
    const clip = await editor.clipboardSnapshot(false)
    expect(clip.text).toBe(text)
    expect(clip.markdown).toBe(text)
  }))

test('source copy rejects asynchronous image output after a spelling-only revision', () => {
  let resolve!: (value: { bytes: Uint8Array; mimeType: string }) => void
  const images: ImageAdapter = {
    presentation() {
      return undefined
    },
    async importImage() {
      return { reference: 'opaque' }
    },
    exportImage() {
      return new Promise((done) => {
        resolve = done
      })
    },
  }
  return run(
    async (editor) => {
      editor.loadDocument({ ...input, text: '![alt](opaque)\n\n__bold__\n' })
      editor.setEditingMode('source')
      const copying = editor.clipboardSnapshot()
      editor.replaceSource('![alt](opaque)\n\n**bold**\n')
      resolve({ bytes: new Uint8Array([1]), mimeType: 'image/png' })
      await expect(copying).rejects.toThrow('Document changed')
    },
    {},
    images,
  )
})

test('pending image import blocks source switching and replacement until it finishes', () => {
  let resolve!: (value: { reference: string }) => void
  const images: ImageAdapter = {
    presentation() {
      return undefined
    },
    importImage() {
      return new Promise((done) => {
        resolve = done
      })
    },
    async exportImage() {
      return { bytes: new Uint8Array([1]), mimeType: 'image/png' }
    },
  }
  return run(
    async (editor) => {
      editor.loadDocument({ ...input, text: 'baseline' })
      const pending = editor.paste({
        text: '',
        images: [
          {
            source: 'clipboard.png',
            bytes: new Uint8Array([1]),
            mimeType: 'image/png',
          },
        ],
      })
      expect(() => editor.setEditingMode('source')).toThrow('image import')
      expect(() => editor.replaceSource('no')).toThrow('image import')
      expect(() => editor.undo()).toThrow('image import')
      resolve({ reference: 'opaque' })
      await pending
      expect(editor.setEditingMode('source')).toBe(true)
      expect(editor.snapshot().text).toContain('opaque')
    },
    {},
    images,
  )
})

test('destroyed editors reject source mode, replacement and history calls', async () => {
  const root = document.createElement('div')
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    stateChanged() {},
    copy() {},
    openLink() {},
  })
  editor.loadDocument(input)
  await editor.destroy()
  for (const operation of [
    () => editor.editingMode,
    () => editor.setEditingMode('source'),
    () => editor.replaceSource('no'),
    () => editor.undo(),
    () => editor.redo(),
  ])
    expect(operation).toThrow('destroyed')
})

test('native input undo restores the first source caret using beforeinput', () =>
  run((editor, plain) => {
    editor.loadDocument({ ...input, text: 'first last' })
    editor.setEditingMode('source')
    plain.setSelectionRange(6, 6)
    plain.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        inputType: 'insertText',
        data: 'new ',
      }),
    )
    sourceInput(plain, 'first new last', 10)
    expect(editor.snapshot().text).toBe('first new last')
    editor.undo()
    expect(editor.snapshot()).toMatchObject({
      text: 'first last',
      dirty: false,
    })
    expect([plain.selectionStart, plain.selectionEnd]).toEqual([6, 6])
    editor.redo()
    expect([plain.selectionStart, plain.selectionEnd]).toEqual([10, 10])
  }))

test('BOM source selection preserves adjacent text while excluding complete comment spans', () =>
  run(async (editor, plain) => {
    editor.loadDocument({ ...input, text: '\uFEFFbefore %%PRIVATE%% after' })
    editor.setEditingMode('source')
    plain.setSelectionRange(0, plain.value.length)
    const clip = await editor.clipboardSnapshot(false)
    expect(clip.text).toBe('before  after')
    expect(clip.markdown).toBe('\uFEFFbefore %%PRIVATE%% after')
  }))

test('consecutive native source input remains one coherent typing history event', () =>
  run((editor, plain) => {
    editor.loadDocument({ ...input, text: 'before after' })
    editor.setEditingMode('source')
    plain.setSelectionRange(7, 7)
    plain.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        inputType: 'insertText',
        data: 'x',
      }),
    )
    sourceInput(plain, 'before xafter', 8)
    plain.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        inputType: 'insertText',
        data: 'y',
      }),
    )
    sourceInput(plain, 'before xyafter', 9)
    editor.undo()
    expect(editor.snapshot().text).toBe('before after')
    expect([plain.selectionStart, plain.selectionEnd]).toEqual([7, 7])
  }))

test('malformed bridge heading tokens reject without changing document or selection', () =>
  run((editor, plain) => {
    editor.loadDocument({ ...input, text: '# Heading' })
    editor.setEditingMode('source')
    const before = editor.snapshot()
    plain.setSelectionRange(2, 4)
    for (const token of [null, undefined, 'heading', 1, {}])
      expect(() => editor.navigateHeading(token as never)).toThrow(InkKitError)
    expect(editor.snapshot()).toEqual(before)
    expect([plain.selectionStart, plain.selectionEnd]).toEqual([2, 4])
  }))

test.each(['\r', '\n'])(
  'raw CRLF find match %j visibly selects a newline and replaces the found half',
  (search) =>
    run((editor, plain) => {
      const raw = 'first\r\nsecond\r\nthird'
      editor.loadDocument({ ...input, text: raw })
      editor.setEditingMode('source')
      plain.setSelectionRange(0, 0)
      editor.find(search)
      expect(plain.value.slice(plain.selectionStart, plain.selectionEnd)).toBe(
        '\n',
      )
      expect(editor.replace(search, 'X')).toBe(true)
      expect(editor.snapshot().text).toBe(raw.replace(search, 'X'))
      editor.undo()
      expect(editor.snapshot().text).toBe(raw)
    }),
)

test('raw CRLF remembered find match cannot override changed user selection or document revision', () =>
  run((editor, plain) => {
    editor.loadDocument({ ...input, text: 'first\r\nsecond\r\nthird' })
    editor.setEditingMode('source')
    plain.setSelectionRange(0, 0)
    editor.find('\n')
    plain.setSelectionRange(
      plain.value.indexOf('second'),
      plain.value.indexOf('second'),
    )
    editor.replace('\n', 'X')
    expect(editor.snapshot().text).toBe('first\r\nsecond\rXthird')
    editor.undo()
    plain.setSelectionRange(0, 0)
    editor.find('\n')
    editor.replaceSource('changed\r\nlast')
    plain.setSelectionRange(0, 0)
    editor.replace('\n', 'X')
    expect(editor.snapshot().text).toBe('changed\rXlast')
  }))

test('no-op replacement keeps an exact half-CRLF found selection usable', () =>
  run((editor, plain) => {
    editor.loadDocument({ ...input, text: 'first\r\nsecond\r\nthird' })
    editor.setEditingMode('source')
    plain.setSelectionRange(0, 0)
    editor.find('\r')
    expect(editor.replace('\r', '\r')).toBe(false)
    expect(editor.replace('\r', 'X')).toBe(true)
    expect(editor.snapshot().text).toBe('firstX\nsecond\r\nthird')
  }))

function sourceGeometry(
  editor: InkKitEditor,
  plain: HTMLTextAreaElement,
  root: HTMLElement,
  caretTop: () => number,
  inspect?: (range: Range) => void,
) {
  for (const element of [plain, root])
    Object.defineProperties(element, {
      clientWidth: { configurable: true, value: 300 },
      clientHeight: { configurable: true, value: 200 },
    })
  editor.setViewport({ insets: { top: 10, bottom: 48 } })
  const bounds = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(0, 0, 300, 200))
  const rectangles = vi
    .spyOn(Range.prototype, 'getClientRects')
    .mockImplementation(function (this: Range) {
      inspect?.(this)
      return [
        new DOMRect(16, caretTop() - plain.scrollTop, 0, 24),
      ] as unknown as DOMRectList
    })
  return () => {
    rectangles.mockRestore()
    bounds.mockRestore()
  }
}

test('source heading navigation reveals wrapped caret geometry in both scroll directions without edits', () =>
  run((editor, plain, _ctx, root) => {
    const raw =
      '\uFEFF# Start\r\n\r\n' +
      'long wrapped source line '.repeat(100) +
      '\r\n\r\n## Distant\r\n'
    editor.loadDocument({ ...input, text: raw })
    editor.setEditingMode('source')
    plain.style.font = '16px / 24px monospace'
    plain.style.padding = '10px 16px 48px'
    plain.style.letterSpacing = '1px'
    plain.style.tabSize = '4'
    const before = editor.snapshot(),
      headings = editor.headings()
    let caretTop = 1500
    const restore = sourceGeometry(
      editor,
      plain,
      root,
      () => caretTop,
      (range) => {
        const mirror = range.startContainer.parentElement!
        expect(mirror.style.width).toBe('300px')
        expect(mirror.style.whiteSpace).toBe('pre-wrap')
        expect(mirror.style.overflowWrap).toBe('break-word')
        expect(mirror.style.padding).toBe('10px 16px 48px')
        expect(mirror.style.tabSize).toBe('4')
      },
    )
    try {
      editor.navigateHeading(headings[1]!)
      expect(plain.scrollTop).toBe(1372)
      expect(plain.selectionStart).toBe(plain.value.indexOf('## Distant'))
      expect(document.body.querySelector('[aria-hidden="true"]')).toBeNull()
      caretTop = 10
      editor.navigateHeading(headings[0]!)
      expect(plain.scrollTop).toBe(0)
      expect(plain.selectionStart).toBe(1)
      expect(editor.snapshot()).toEqual(before)
      expect(editor.undo()).toBe(false)
    } finally {
      restore()
    }
  }))

test('literal find, replacement and history reveal selections without taking focus', () =>
  run((editor, plain, _ctx, root) => {
    const raw = 'top\r\n\r\n' + 'wrapped '.repeat(100) + 'needle'
    editor.loadDocument({ ...input, text: raw })
    editor.setEditingMode('source')
    plain.style.font = '16px / 24px monospace'
    const focused = document.activeElement
    let caretTop = 900
    const restore = sourceGeometry(editor, plain, root, () => caretTop)
    try {
      plain.setSelectionRange(0, 0)
      editor.find('needle')
      expect(plain.scrollTop).toBe(772)
      expect(document.activeElement).toBe(focused)
      plain.scrollTop = 0
      editor.replace('needle', 'replacement')
      expect(plain.scrollTop).toBe(772)
      expect(document.activeElement).toBe(focused)
      plain.scrollTop = 0
      editor.undo()
      expect(plain.scrollTop).toBe(772)
      expect(document.activeElement).toBe(focused)
      caretTop = 10
      editor.find('top')
      expect(plain.scrollTop).toBe(0)
    } finally {
      restore()
    }
  }))

test('source selection measurement bounds the selected text rather than remaining text height', () =>
  run((editor, plain, _ctx, root) => {
    editor.loadDocument({
      ...input,
      text: 'a word-that-wraps with remaining lines\n'.repeat(50),
    })
    editor.setEditingMode('source')
    plain.style.fontFamily = 'monospace'
    plain.style.fontSize = '16px'
    plain.style.lineHeight = '24px'
    const restore = sourceGeometry(
      editor,
      plain,
      root,
      () => 900,
      (range) => {
        expect(range.startOffset).toBe(plain.selectionStart)
        expect(range.endOffset).toBe(plain.selectionEnd)
        expect(range.startContainer.parentElement!.style.fontFamily).toBe(
          'monospace',
        )
        expect(range.startContainer.parentElement!.style.lineHeight).toBe(
          '24px',
        )
      },
    )
    try {
      plain.setSelectionRange(0, 0)
      editor.find('word-that-wraps')
      expect(plain.scrollTop).toBe(772)
      expect(document.body.querySelector('[aria-hidden="true"]')).toBeNull()
    } finally {
      restore()
    }
  }))
