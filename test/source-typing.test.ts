import { ctxOf, documentOf, historyOf } from './editor-access'
import { afterEach, expect, test, vi } from 'vitest'
import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { InkKitError, InkKitEditor, type EditorEvents } from '../src/index'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function run(
  callback: (
    editor: InkKitEditor,
    plain: HTMLTextAreaElement,
    ctx: Ctx,
    changes: string[],
  ) => void | Promise<void>,
  events: Partial<EditorEvents> = {},
) {
  const root = document.createElement('div')
  document.body.append(root)
  const changes: string[] = []
  const editor = await InkKitEditor.mount(
    root,
    {
      changed: ({ text }) => changes.push(text),
      copy() {},
      openLink() {},
      ...events,
    },
    {},
  )
  const ctx = ctxOf(editor)
  try {
    await callback(editor, root.querySelector('textarea')!, ctx, changes)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

const paragraphs = (count: number) =>
  Array.from({ length: count }, (_, index) => `Paragraph ${index} text.`).join(
    '\n\n',
  ) + '\n'
const document1 = {
  documentId: 'typing',
  generation: 3,
  format: 'md' as const,
}

// What the browser does for a typed character: the textarea changes first,
// then reports it.
function type(plain: HTMLTextAreaElement, character: string) {
  const at = plain.selectionStart
  plain.dispatchEvent(
    new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText' }),
  )
  plain.value = plain.value.slice(0, at) + character + plain.value.slice(at)
  plain.setSelectionRange(at + character.length, at + character.length)
  plain.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText' }),
  )
}

function startSource(
  editor: InkKitEditor,
  plain: HTMLTextAreaElement,
  text: string,
  at = text.length,
) {
  editor.loadDocument({ ...document1, text })
  editor.setEditingMode('source', 3)
  plain.setSelectionRange(at, at)
}

test('a source keystroke leaves the formatted document, history and body alone', () =>
  run((editor, plain, ctx, changes) => {
    const text = paragraphs(200)
    startSource(editor, plain, text, 20)
    const view = ctx.get(editorViewCtx)
    const doc = view.state.doc
    const append = vi.spyOn(document.body, 'append')
    const before = editor.snapshot().revision
    type(plain, 'x')
    type(plain, 'y')
    expect(view.state.doc).toBe(doc)
    expect(append).not.toHaveBeenCalled()
    expect(plain.value).toBe(text.slice(0, 20) + 'xy' + text.slice(20))
    expect(editor.snapshot()).toMatchObject({
      text: text.slice(0, 20) + 'xy' + text.slice(20),
      revision: before + 2,
      dirty: true,
    })
    expect(changes).toEqual([
      text.slice(0, 20) + 'x' + text.slice(20),
      text.slice(0, 20) + 'xy' + text.slice(20),
    ])
  }))

test('leaving source mode, exports and the formatted view use the latest typed source', () =>
  run(async (editor, plain, ctx) => {
    const text = paragraphs(5)
    startSource(editor, plain, text, 9)
    type(plain, 'Z')
    expect((await editor.clipboardSnapshot()).text).toContain('ParagraphZ 0')
    type(plain, 'Q')
    expect((await editor.printableSnapshot()).html).toContain('ParagraphZQ 0')
    type(plain, 'R')
    const revision = editor.snapshot().revision
    expect(editor.setEditingMode('formatted', 3)).toBe(true)
    expect(ctx.get(editorViewCtx).dom.textContent).toContain('ParagraphZQR 0')
    expect(editor.snapshot()).toMatchObject({ revision, dirty: true })
    expect(editor.snapshot().text).toBe(
      text.slice(0, 9) + 'ZQR' + text.slice(9),
    )
  }))

test('undo and redo take typed source as one step and restore the caret', () =>
  run((editor, plain) => {
    const text = paragraphs(5)
    startSource(editor, plain, text, 9)
    expect(editor.commandState().commands.undo).toBe(false)
    type(plain, 'a')
    type(plain, 'b')
    type(plain, 'c')
    expect(editor.commandState().commands).toMatchObject({
      undo: true,
      redo: false,
    })
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot().text).toBe(text)
    expect(plain.value).toBe(text)
    expect([plain.selectionStart, plain.selectionEnd]).toEqual([9, 9])
    expect(editor.commandState().commands).toMatchObject({
      undo: false,
      redo: true,
    })
    expect(editor.redo()).toBe(true)
    expect(plain.value).toBe(text.slice(0, 9) + 'abc' + text.slice(9))
    expect(editor.snapshot().text).toBe(plain.value)
  }))

test('typing after undo discards the redo step', () =>
  run((editor, plain) => {
    const text = paragraphs(3)
    startSource(editor, plain, text, 4)
    type(plain, 'a')
    editor.undo()
    type(plain, 'b')
    expect(editor.commandState().commands.redo).toBe(false)
    expect(editor.redo()).toBe(false)
    expect(editor.snapshot().text).toBe(text.slice(0, 4) + 'b' + text.slice(4))
  }))

test('loading another document drops typed source that was not settled', () =>
  run((editor, plain) => {
    startSource(editor, plain, paragraphs(3), 9)
    type(plain, 'x')
    editor.loadDocument({ ...document1, generation: 4, text: 'Other\n' })
    expect(editor.snapshot()).toMatchObject({ text: 'Other\n', dirty: false })
    expect(plain.value).toBe('Other\n')
  }))

test('typing keeps CRLF endings across keystrokes before the document settles', () =>
  run((editor, plain) => {
    const text = 'One\r\n\r\nTwo\r\n'
    startSource(editor, plain, text, 3)
    type(plain, 'a')
    plain.setSelectionRange(plain.value.length, plain.value.length)
    type(plain, '\n')
    expect(editor.snapshot().text).toBe('Onea\r\n\r\nTwo\r\n\r\n')
    editor.setEditingMode('formatted')
    expect(editor.snapshot().text).toBe('Onea\r\n\r\nTwo\r\n\r\n')
  }))

test('a rejected parse during settling keeps the typed source', () =>
  run((editor, plain) => {
    const text = paragraphs(3)
    startSource(editor, plain, text, 4)
    type(plain, 'a')
    const typed = plain.value
    const settle = vi
      .spyOn(historyOf(editor), 'commitSource')
      .mockImplementationOnce(() => {
        throw new Error('parse failed')
      })
    expect(() => editor.setEditingMode('formatted')).toThrow('parse failed')
    expect(editor.snapshot().text).toBe(typed)
    expect(plain.value).toBe(typed)
    settle.mockRestore()
    expect(editor.setEditingMode('formatted')).toBe(true)
    expect(editor.snapshot().text).toBe(typed)
  }))

test('a read-only editor refuses typed source', () =>
  run((editor, plain) => {
    const text = paragraphs(3)
    startSource(editor, plain, text, 4)
    editor.setEditable(false)
    plain.value = 'changed'
    plain.dispatchEvent(new InputEvent('input', { bubbles: true }))
    expect(plain.value).toBe(text)
    expect(editor.snapshot().text).toBe(text)
  }))

// Typing separated by a pause is a separate undo step, as in the formatted
// editor.
const pause = () => vi.advanceTimersByTime(600)

test('typing separated by pauses undoes and redoes one step at a time', () =>
  run((editor, plain, ctx) => {
    vi.useFakeTimers()
    const text = paragraphs(5)
    startSource(editor, plain, text, 9)
    const view = ctx.get(editorViewCtx)
    const doc = view.state.doc
    type(plain, 'a')
    pause()
    plain.setSelectionRange(30, 30)
    type(plain, 'b')
    pause()
    type(plain, 'c')
    const first = text.slice(0, 9) + 'a' + text.slice(9)
    const second = first.slice(0, 30) + 'b' + first.slice(30)
    const third = second.slice(0, 31) + 'c' + second.slice(31)
    expect(plain.value).toBe(third)
    expect(editor.undo()).toBe(true)
    expect(plain.value).toBe(second)
    expect([plain.selectionStart, plain.selectionEnd]).toEqual([31, 31])
    expect(editor.undo()).toBe(true)
    expect(plain.value).toBe(first)
    expect([plain.selectionStart, plain.selectionEnd]).toEqual([30, 30])
    expect(editor.undo()).toBe(true)
    expect(plain.value).toBe(text)
    expect(editor.snapshot().text).toBe(text)
    expect([plain.selectionStart, plain.selectionEnd]).toEqual([9, 9])
    expect(editor.commandState().commands.undo).toBe(false)
    expect(editor.undo()).toBe(false)
    expect(view.state.doc).toBe(doc)
    expect(editor.commandState().commands.redo).toBe(true)
    expect(editor.redo()).toBe(true)
    expect(plain.value).toBe(first)
    expect(editor.redo()).toBe(true)
    expect(plain.value).toBe(second)
    pause()
    type(plain, 'd')
    expect(editor.commandState().commands.redo).toBe(false)
    expect(editor.redo()).toBe(false)
    expect(editor.snapshot().text).toBe(plain.value)
  }))

test('undoing typed source back to the document continues into earlier history', () =>
  run((editor, plain) => {
    vi.useFakeTimers()
    const text = paragraphs(5)
    startSource(editor, plain, text, 9)
    type(plain, 'a')
    editor.setEditingMode('formatted', 3)
    editor.setEditingMode('source', 3)
    plain.setSelectionRange(9, 9)
    pause()
    type(plain, 'b')
    expect(editor.undo()).toBe(true)
    expect(plain.value).toBe(text.slice(0, 9) + 'a' + text.slice(9))
    expect(editor.undo()).toBe(true)
    expect(plain.value).toBe(text)
    expect(editor.undo()).toBe(false)
  }))

test('typed source that was settled is one step of the formatted history', () =>
  run((editor, plain) => {
    vi.useFakeTimers()
    const text = paragraphs(5)
    startSource(editor, plain, text, 9)
    type(plain, 'a')
    pause()
    type(plain, 'b')
    editor.setEditingMode('formatted', 3)
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot().text).toBe(text)
    expect(editor.redo()).toBe(true)
    expect(editor.snapshot().text).toBe(text.slice(0, 9) + 'ab' + text.slice(9))
  }))

test('older undo steps merge when more than the limit have been typed', () =>
  run((editor, plain) => {
    vi.useFakeTimers()
    const text = paragraphs(3)
    startSource(editor, plain, text, 9)
    for (let index = 0; index < 120; index++) {
      type(plain, 'x')
      pause()
    }
    let undone = 0
    while (editor.undo()) undone++
    expect(undone).toBeGreaterThan(90)
    expect(undone).toBeLessThanOrEqual(120)
    expect(plain.value).toBe(text)
    expect(editor.snapshot().text).toBe(text)
  }))

test('source typed before the editor became read-only still reaches the formatted view', () =>
  run((editor, plain, ctx) => {
    const text = paragraphs(3)
    startSource(editor, plain, text, 9)
    type(plain, 'x')
    editor.setEditable(false)
    expect(editor.setEditingMode('formatted', 3)).toBe(true)
    const typed = text.slice(0, 9) + 'x' + text.slice(9)
    expect(editor.snapshot().text).toBe(typed)
    expect(ctx.get(editorViewCtx).dom.textContent).toContain('Paragraphx 0')
    editor.setEditable(true)
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot().text).toBe(text)
  }))

test('a paste, a replacement and a cut after typing are undo steps of their own', () =>
  run(async (editor, plain, ctx) => {
    vi.useFakeTimers()
    const text = paragraphs(5)
    startSource(editor, plain, text, 9)
    const view = ctx.get(editorViewCtx)
    const doc = view.state.doc
    for (const character of ['a', 'b', 'c']) type(plain, character)
    pause()
    for (const character of ['d', 'e', 'f']) type(plain, character)
    pause()
    for (const character of ['g', 'h', 'i']) type(plain, character)
    const typed = plain.value
    expect(typed).toBe(text.slice(0, 9) + 'abcdefghi' + text.slice(9))
    await editor.paste({ text: 'PASTED' })
    const pasted = typed.slice(0, 18) + 'PASTED' + typed.slice(18)
    expect(plain.value).toBe(pasted)
    expect(editor.snapshot().text).toBe(pasted)
    // Taking in the text would merge the typing into one undo step.
    expect(view.state.doc).toBe(doc)
    expect(editor.undo()).toBe(true)
    expect(plain.value).toBe(typed)
    expect(editor.undo()).toBe(true)
    expect(plain.value).toBe(text.slice(0, 9) + 'abcdef' + text.slice(9))
    expect(editor.redo()).toBe(true)
    expect(editor.redo()).toBe(true)
    expect(plain.value).toBe(pasted)
    expect(view.state.doc).toBe(doc)
  }))

test('replacements, replaceSource and cut take no part in the formatted document', () =>
  run((editor, plain, ctx) => {
    vi.useFakeTimers()
    const text = paragraphs(4)
    startSource(editor, plain, text, 9)
    const view = ctx.get(editorViewCtx)
    const doc = view.state.doc
    type(plain, 'q')
    const typed = plain.value
    expect(editor.replaceAll('Paragraph 2', 'Changed')).toBe(1)
    const replaced = typed.replace('Paragraph 2', 'Changed')
    expect(editor.snapshot().text).toBe(replaced)
    expect(editor.replaceSource('Whole new text\n')).toBe(true)
    expect(editor.snapshot().text).toBe('Whole new text\n')
    plain.setSelectionRange(0, 5)
    const cut = Object.assign(
      new Event('cut', { bubbles: true, cancelable: true }),
      { clipboardData: { setData() {} } },
    )
    plain.dispatchEvent(cut)
    expect(view.state.doc).toBe(doc)
    expect(editor.undo()).toBe(true)
    expect(plain.value).toBe('Whole new text\n')
    expect(editor.undo()).toBe(true)
    expect(plain.value).toBe(replaced)
    expect(editor.undo()).toBe(true)
    expect(plain.value).toBe(typed)
    expect(editor.undo()).toBe(true)
    expect(plain.value).toBe(text)
    expect(editor.undo()).toBe(false)
    expect(view.state.doc).toBe(doc)
  }))

test('typing after an edit that is not typing starts a new undo step', () =>
  run(async (editor, plain) => {
    vi.useFakeTimers()
    const text = paragraphs(3)
    startSource(editor, plain, text, 9)
    await editor.paste({ text: 'P' })
    const pasted = plain.value
    type(plain, 'x')
    expect(editor.undo()).toBe(true)
    expect(plain.value).toBe(pasted)
    expect(editor.undo()).toBe(true)
    expect(plain.value).toBe(text)
  }))

test('exports in source mode show the typed text and leave the history and document alone', () =>
  run(async (editor, plain, ctx) => {
    vi.useFakeTimers()
    const text = paragraphs(4)
    startSource(editor, plain, text, 9)
    const view = ctx.get(editorViewCtx)
    const doc = view.state.doc
    type(plain, 'a')
    pause()
    type(plain, 'b')
    pause()
    expect((await editor.clipboardSnapshot()).text).toContain('Paragraphab 0')
    expect((await editor.printableSnapshot()).html).toContain('Paragraphab 0')
    plain.setSelectionRange(0, 14)
    const partial = await editor.clipboardSnapshot('selection')
    expect(partial.markdown).toBe(plain.value.slice(0, 14))
    expect(view.state.doc).toBe(doc)
    expect(editor.undo()).toBe(true)
    expect(plain.value).toBe(text.slice(0, 9) + 'a' + text.slice(9))
    expect(editor.undo()).toBe(true)
    expect(plain.value).toBe(text)
  }))

test('source taken into the formatted document stays apart from the next formatted edit', () =>
  run((editor, plain, ctx) => {
    const text = paragraphs(3)
    startSource(editor, plain, text, 9)
    type(plain, 'x')
    const typed = plain.value
    editor.setEditingMode('formatted', 3)
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.insertText('Edited', 1, 1))
    expect(editor.snapshot().text).toContain('EditedParagraph')
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot().text).toBe(typed)
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot().text).toBe(text)
  }))

function typeFormatted(ctx: Ctx, character: string) {
  const view = ctx.get(editorViewCtx)
  view.dispatch(view.state.tr.insertText(character, 1, 1))
}

test('redo does not carry source steps into the formatted view', () =>
  run((editor, plain, ctx, changes) => {
    vi.useFakeTimers()
    const text = paragraphs(3)
    startSource(editor, plain, text, 9)
    type(plain, 'a')
    type(plain, '1')
    expect(editor.undo()).toBe(true)
    expect(plain.value).toBe(text)
    editor.setEditingMode('formatted', 3)
    expect(editor.commandState().commands.redo).toBe(false)
    expect(editor.redo()).toBe(false)
    typeFormatted(ctx, 'Q')
    const edited = editor.snapshot().text
    expect(edited).toContain('QParagraph 0')
    expect(edited).not.toContain('a1')
    expect(changes.at(-1)).toBe(edited)
    editor.setEditingMode('source', 3)
    expect(plain.value).toBe(edited.replaceAll('\r\n', '\n'))
  }))

test('undo and redo run through formatted history and source steps in order', () =>
  run((editor, plain, ctx) => {
    vi.useFakeTimers()
    const text = paragraphs(3)
    editor.loadDocument({ ...document1, text })
    typeFormatted(ctx, 'X')
    const withX = editor.snapshot().text
    pause()
    editor.setEditingMode('source', 3)
    plain.setSelectionRange(plain.value.length, plain.value.length)
    type(plain, 'Y')
    const withY = plain.value
    expect(editor.undo()).toBe(true)
    expect(plain.value).toBe(withX)
    expect(editor.undo()).toBe(true)
    expect(plain.value).toBe(text)
    expect(editor.redo()).toBe(true)
    expect(plain.value).toBe(withX)
    expect(editor.redo()).toBe(true)
    expect(plain.value).toBe(withY)
    expect(editor.redo()).toBe(false)
    expect(editor.snapshot().text).toBe(withY)
  }))

// A small deterministic generator, so a failure names its seed.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

// Deterministic seeds make a failure reproducible on a shared runner.
const seeds = Number(process.env.SOURCE_TYPING_SEEDS) || 60

test('random typing, undo, redo and mode switches keep every view of the text in agreement', async () => {
  for (let seed = 1; seed <= seeds; seed++) {
    const next = random(seed)
    const log: string[] = [`seed ${seed}:`]
    await run((editor, plain, ctx, changes) => {
      vi.useFakeTimers()
      const text =
        'First **bold** and _italic_ text.\n\nSecond `code` text.\n\n- A list item\n- Another item\n'
      editor.loadDocument({ ...document1, text })
      const view = ctx.get(editorViewCtx)
      const agree = () => {
        const saved = editor.snapshot().text.replaceAll('\r\n', '\n')
        if (editor.editingMode === 'source') {
          expect(plain.value, log.join(' ')).toBe(saved)
        } else {
          expect(view.state.doc.content.toJSON(), log.join(' ')).toEqual(
            ctx.get(parserCtx)(saved).content.toJSON(),
          )
        }
        expect(changes.at(-1) ?? text, log.join(' ')).toBe(
          editor.snapshot().text,
        )
      }
      for (let step = 0; step < 40; step++) {
        const choice = next()
        const source = editor.editingMode === 'source'
        if (choice < 0.3) {
          const character = String.fromCharCode(97 + Math.floor(next() * 26))
          log.push(`type:${character}`)
          if (source) {
            plain.setSelectionRange(3, 3)
            type(plain, character)
          } else typeFormatted(ctx, character)
        } else if (choice < 0.4) {
          log.push('pause')
          pause()
        } else if (choice < 0.55) {
          log.push('undo')
          const available = editor.commandState().commands.undo
          expect(editor.undo(), log.join(' ')).toBe(available)
        } else if (choice < 0.7) {
          log.push('redo')
          const available = editor.commandState().commands.redo
          expect(editor.redo(), log.join(' ')).toBe(available)
        } else if (choice < 0.8) {
          log.push('switch')
          editor.setEditingMode(source ? 'formatted' : 'source')
        } else if (choice < 0.9 && source) {
          log.push('paste')
          editor.pasteAsPlainText('P')
        } else {
          // Undo as far as it goes, then redo the same number of times.
          log.push('roundtrip')
          const before = editor.snapshot().text
          let undone = 0
          while (editor.undo()) undone++
          for (let count = 0; count < undone; count++)
            expect(editor.redo(), log.join(' ')).toBe(true)
          expect(editor.snapshot().text, log.join(' ')).toBe(before)
        }
        agree()
      }
    })
    vi.useRealTimers()
  }
}, 15_000)

for (const text of ['', 'Prior\r\n\r\n* untouched 🦊\r\n']) {
  test(
    'source branching permanently discards formatted redo: ' +
      (text || 'empty'),
    () =>
      run((editor, plain) => {
        editor.loadDocument({ ...document1, text })
        editor.replaceSource(text + 'A')
        editor.replaceSource(text + 'AB')
        editor.setEditingMode('source')
        expect(editor.undo()).toBe(true)
        type(plain, 'n')
        expect(editor.undo()).toBe(true)
        expect(editor.snapshot().text).toBe(text + 'A')
        expect(editor.commandState().commands.redo).toBe(true)
        editor.setEditingMode('formatted')
        expect(editor.commandState().commands.redo).toBe(false)
        expect(editor.redo()).toBe(false)
        for (let iteration = 0; iteration < 2; iteration++) {
          expect(editor.undo()).toBe(true)
          expect(editor.snapshot().text).toBe(text)
          editor.setEditingMode('source')
          expect(editor.commandState().commands.redo).toBe(true)
          expect(editor.redo()).toBe(true)
          expect(editor.snapshot().text).toBe(text + 'A')
          expect(editor.redo()).toBe(false)
          editor.setEditingMode('formatted')
          expect(editor.redo()).toBe(false)
        }
        const saved = editor.snapshot().text
        editor.loadDocument({ ...document1, generation: 4, text: saved })
        expect(editor.snapshot().text).toBe(text + 'A')
        expect(editor.commandState().commands).toMatchObject({
          undo: false,
          redo: false,
        })
      }),
  )
}

test('source branching orders earlier formatted undos before literal redo', () =>
  run((editor, plain) => {
    const text = 'Baseline\r\n'
    editor.loadDocument({ ...document1, text })
    for (const suffix of ['A', 'AB', 'ABC']) editor.replaceSource(text + suffix)
    editor.setEditingMode('source')
    editor.undo()
    type(plain, 'n')
    const typed = editor.snapshot().text
    editor.undo()
    expect(editor.undo()).toBe(true)
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot().text).toBe(text)
    for (const suffix of ['A', 'AB']) {
      expect(editor.redo()).toBe(true)
      expect(editor.snapshot().text).toBe(text + suffix)
    }
    expect(editor.redo()).toBe(true)
    expect(editor.snapshot().text).toBe(typed)
    editor.undo()
    editor.setEditingMode('formatted')
    expect(editor.snapshot().text).toBe(text + 'AB')
    expect(editor.redo()).toBe(false)
  }))

for (const settle of ['changed', 'baseline'] as const) {
  test(
    'settling source at ' + settle + ' never revives discarded formatted redo',
    () =>
      run((editor) => {
        const text = 'Base\r\n'
        editor.loadDocument({ ...document1, text })
        editor.replaceSource(text + 'A')
        editor.replaceSource(text + 'AB')
        editor.undo()
        editor.setEditingMode('source')
        editor.replaceSource(text + 'n')
        if (settle === 'baseline') editor.replaceSource(text + 'A')
        const saved = editor.snapshot().text
        editor.setEditingMode('formatted')
        expect(editor.redo()).toBe(false)
        expect(editor.undo()).toBe(true)
        expect(editor.redo()).toBe(true)
        expect(editor.snapshot().text).toBe(saved)
        expect(editor.redo()).toBe(false)
      }),
  )
}

test('identical and refused source edits retain available formatted redo', () =>
  run((editor, plain) => {
    editor.loadDocument({ ...document1, text: 'Base' })
    editor.replaceSource('BaseA')
    editor.undo()
    editor.setEditingMode('source')
    expect(editor.replaceSource('Base')).toBe(false)
    expect(() => editor.replaceSource('changed', 2)).toThrow()
    editor.setEditable(false)
    expect(() => editor.replaceSource('changed')).toThrow()
    editor.setEditable(true)
    plain.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    )
    expect(() => editor.replaceSource('changed')).toThrow()
    plain.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true }),
    )
    editor.setEditingMode('formatted')
    expect(editor.commandState().commands.redo).toBe(true)
    expect(editor.redo()).toBe(true)
    expect(editor.snapshot().text).toBe('BaseA')
  }))

test('refused formatted history does not consume the permitted redo', () =>
  run((editor) => {
    editor.loadDocument({ ...document1, text: 'Base' })
    editor.replaceSource('BaseA')
    editor.replaceSource('BaseAB')
    editor.undo()
    editor.setEditingMode('source')
    editor.replaceSource('BaseAn')
    editor.undo()
    editor.setEditingMode('formatted')
    const internals = documentOf(editor)
    const refuse = () => {
      throw new InkKitError('preservation', 'Refused for regression test')
    }
    let spy = vi.spyOn(internals, 'assertPreserved').mockImplementation(refuse)
    expect(() => editor.undo()).toThrow()
    spy.mockRestore()
    expect(editor.commandState().commands.redo).toBe(false)
    expect(editor.undo()).toBe(true)
    const before = editor.snapshot()
    spy = vi.spyOn(internals, 'assertPreserved').mockImplementation(refuse)
    expect(() => editor.redo()).toThrow()
    spy.mockRestore()
    expect(editor.snapshot()).toEqual(before)
    expect(editor.commandState().commands.redo).toBe(true)
    expect(editor.redo()).toBe(true)
    expect(editor.snapshot().text).toBe('BaseA')
    expect(editor.redo()).toBe(false)
  }))

test('refused formatted redo in source mode keeps its place before literal redo', () =>
  run((editor, plain) => {
    editor.loadDocument({ ...document1, text: 'Base' })
    editor.replaceSource('BaseA')
    editor.replaceSource('BaseAB')
    editor.undo()
    editor.setEditingMode('source')
    type(plain, 'n')
    const typed = editor.snapshot().text
    editor.undo()
    editor.undo()
    const before = editor.snapshot()
    const internals = documentOf(editor)
    const spy = vi
      .spyOn(internals, 'assertPreserved')
      .mockImplementation(() => {
        throw new InkKitError('preservation', 'Refused for regression test')
      })
    expect(() => editor.redo()).toThrow()
    spy.mockRestore()
    expect(editor.snapshot()).toEqual(before)
    expect(editor.redo()).toBe(true)
    expect(editor.snapshot().text).toBe('BaseA')
    expect(editor.redo()).toBe(true)
    expect(editor.snapshot().text).toBe(typed)
    editor.undo()
    editor.setEditingMode('formatted')
    expect(editor.redo()).toBe(false)
  }))

test('trimmed formatted history never exposes the discarded redo tail', () =>
  run((editor, plain) => {
    editor.loadDocument({ ...document1, text: 'Base\r\n' })
    for (let index = 0; index < 130; index++)
      editor.replaceSource('Base\r\n' + index)
    editor.undo()
    editor.setEditingMode('source')
    type(plain, 'n')
    editor.undo()
    editor.setEditingMode('formatted')
    const states = [editor.snapshot().text]
    while (editor.undo()) states.push(editor.snapshot().text)
    expect(states.length).toBeGreaterThan(90)
    for (const text of states.slice(0, -1).reverse()) {
      expect(editor.redo()).toBe(true)
      expect(editor.snapshot().text).toBe(text)
    }
    expect(editor.commandState().commands.redo).toBe(false)
    expect(editor.redo()).toBe(false)
  }))

for (const earlierUndo of [false, true]) {
  test(
    'a later refusal restores the discarded redo boundary: ' + earlierUndo,
    () =>
      run((editor) => {
        editor.loadDocument({ ...document1, text: 'Base' })
        editor.replaceSource('BaseA')
        editor.replaceSource('BaseAB')
        editor.undo()
        editor.setEditingMode('source')
        editor.replaceSource('BaseAn')
        editor.undo()
        editor.setEditingMode('formatted')
        if (earlierUndo) editor.undo()
        const before = editor.snapshot()
        const internals = documentOf(editor)
        const original = internals.assertPreserved
        let checks = 0
        const spy = vi
          .spyOn(internals, 'assertPreserved')
          .mockImplementation(function (...args) {
            if (++checks === 2)
              throw new InkKitError(
                'preservation',
                'Refused after the accepted replacement',
              )
            return original.apply(internals, args)
          })
        expect(() => editor.replaceSource('New source')).toThrow()
        spy.mockRestore()
        expect(checks).toBe(2)
        expect(editor.snapshot()).toEqual(before)
        expect(editor.commandState().commands.redo).toBe(earlierUndo)
        if (earlierUndo) {
          expect(editor.redo()).toBe(true)
          expect(editor.snapshot().text).toBe('BaseA')
        }
        expect(editor.redo()).toBe(false)
      }),
  )
}
