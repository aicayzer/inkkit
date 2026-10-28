import { expect, test, vi } from 'vitest'
import { InkKitEditor } from '../src/core'
import { literalCommentSpans } from '../src/comments'
import { sourceSelection } from '../src/source'

const input = {
  documentId: 'bom-comment-copy',
  generation: 1,
  format: 'md' as const,
}
const comments = [
  { syntax: 'obsidian', text: '%%PRIVATE%%' },
  { syntax: 'html', text: '<!--PRIVATE-->' },
] as const

async function run(
  text: string,
  callback: (
    editor: InkKitEditor,
    area: HTMLTextAreaElement,
    changed: ReturnType<typeof vi.fn>,
  ) => Promise<void>,
  format: 'md' | 'txt' = 'md',
) {
  const root = document.createElement('div')
  document.body.append(root)
  const changed = vi.fn()
  const editor = await InkKitEditor.mount(root, {
    changed,
    copy() {},
    openLink() {},
  })
  try {
    editor.loadDocument({ ...input, text, format })
    if (format === 'md') editor.setEditingMode('source')
    await callback(editor, root.querySelector('textarea')!, changed)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

async function copy(
  editor: InkKitEditor,
  area: HTMLTextAreaElement,
  changed: ReturnType<typeof vi.fn>,
  range: readonly [number, number],
  markdown: string,
  readable: string,
) {
  area.setSelectionRange(...range, 'backward')
  const before = editor.snapshot()
  const commands = editor.commandState().commands
  const changeCount = changed.mock.calls.length
  const selection = [
    area.selectionStart,
    area.selectionEnd,
    area.selectionDirection,
  ]
  const result = await editor.clipboardSnapshot('selection')
  expect.soft(result.markdown).toBe(markdown)
  expect.soft(result.text).toBe(readable)
  if (before.format === 'md') expect.soft(result.html).not.toContain('PRIVATE')
  expect(editor.snapshot()).toEqual(before)
  expect(editor.commandState().commands.undo).toBe(commands.undo)
  expect(editor.commandState().commands.redo).toBe(commands.redo)
  expect(changed).toHaveBeenCalledTimes(changeCount)
  expect([
    area.selectionStart,
    area.selectionEnd,
    area.selectionDirection,
  ]).toEqual(selection)
  return result
}

function reopen(
  editor: InkKitEditor,
  text: string,
  format: 'md' | 'txt' = 'md',
) {
  expect(editor.snapshot().text).toBe(text)
  editor.loadDocument({
    ...input,
    generation: 2,
    text: editor.snapshot().text,
    format,
  })
  expect(editor.snapshot()).toEqual({
    ...input,
    generation: 2,
    text,
    format,
    revision: 0,
    dirty: false,
  })
}

for (const count of [0, 1, 2, 3]) {
  for (const comment of comments) {
    const text =
      '\uFEFF'.repeat(count) + `before ${comment.text} after\uFEFFend\r\n`
    test(`${count} leading BOMs: ${comment.syntax} spans address the original input`, () => {
      const spans = literalCommentSpans(text)
      expect(spans).toHaveLength(1)
      expect(spans[0]).toMatchObject({
        start: count + 7,
        end: count + 7 + comment.text.length,
        syntax: comment.syntax,
        value: 'PRIVATE',
      })
      expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe(comment.text)
    })

    test(`${count} leading BOMs: full source copy omits ${comment.syntax} comments without changing bytes`, () =>
      run(text, async (editor, area, changed) => {
        const readable =
          '\uFEFF'.repeat(Math.max(0, count - 1)) + 'before  after\uFEFFend'
        const result = await copy(
          editor,
          area,
          changed,
          [0, area.value.length],
          text,
          readable,
        )
        const html = new DOMParser().parseFromString(result.html, 'text/html')
        expect.soft(html.body.textContent).toBe(readable)
        reopen(editor, text)
      }))
  }
}

for (const comment of comments) {
  const text = `\uFEFF\uFEFFpre\r\nL ${comment.text} R\r\nkeep\uFEFFend`
  const start = 8
  const end = start + comment.text.length
  const body = start + comment.text.indexOf('PRIVATE')
  const selections = [
    {
      name: 'exact comment',
      range: [start, end],
      markdown: comment.text,
      shareable: '',
      readable: '',
    },
    {
      name: 'private body without delimiters',
      range: [body, body + 7],
      markdown: 'PRIVATE',
      shareable: '',
      readable: '',
    },
    {
      name: 'cross opening',
      range: [6, start + 2],
      markdown: 'L ' + comment.text.slice(0, 2),
      shareable: 'L ',
      readable: 'L',
    },
    {
      name: 'cross closing',
      range: [end - 2, end + 2],
      markdown: comment.text.slice(-2) + ' R',
      shareable: ' R',
      readable: 'R',
    },
    {
      name: 'end at opening',
      range: [6, start],
      markdown: 'L ',
      shareable: 'L ',
      readable: 'L',
    },
    {
      name: 'start after closing',
      range: [end, end + 2],
      markdown: ' R',
      shareable: ' R',
      readable: 'R',
    },
    {
      name: 'surround comment',
      range: [6, end + 2],
      markdown: 'L ' + comment.text + ' R',
      shareable: 'L  R',
      readable: 'L  R',
    },
  ] as const
  for (const selected of selections)
    test(`${comment.syntax} source copy clips ${selected.name} after a raw CRLF`, () =>
      run(text, async (editor, area, changed) => {
        expect
          .soft(sourceSelection(text, selected.range[0], selected.range[1]))
          .toEqual({
            markdown: selected.markdown,
            shareable: selected.shareable,
          })
        await copy(
          editor,
          area,
          changed,
          selected.range,
          selected.markdown,
          selected.readable,
        )
        reopen(editor, text)
      }))
}

test('mixed endings and internal BOMs do not accumulate comment offset corrections', () => {
  const text =
    '\uFEFF\uFEFFa %%ONE%% x\r\nb <!--TWO--> y\nc\uFEFF %%THREE%% z\rend'
  const expected = [
    { start: 4, end: 11, syntax: 'obsidian', value: 'ONE' },
    { start: 17, end: 27, syntax: 'html', value: 'TWO' },
    { start: 33, end: 42, syntax: 'obsidian', value: 'THREE' },
  ]
  expect.soft(literalCommentSpans(text)).toMatchObject(expected)
  expect
    .soft(
      literalCommentSpans(text).map((span) => text.slice(span.start, span.end)),
    )
    .toEqual(['%%ONE%%', '<!--TWO-->', '%%THREE%%'])
  return run(text, async (editor, area, changed) => {
    const result = await copy(
      editor,
      area,
      changed,
      [0, area.value.length],
      text,
      '\uFEFFa  x\nb  y\nc\uFEFF  z\nend',
    )
    expect.soft(result.html).not.toMatch(/ONE|TWO|THREE/)
    reopen(editor, text)
  })
})

for (const comment of ['%%\r\nPRIVATE\r\n%%', '<!--\r\nPRIVATE\r\n-->']) {
  test(`block source copy hides full and partial ${comment.startsWith('%%') ? 'percent' : 'HTML'} comments`, () => {
    const text = `\uFEFF\uFEFFvisible\r\n\r\n${comment}\r\n\r\ntail`
    return run(text, async (editor, area, changed) => {
      await copy(
        editor,
        area,
        changed,
        [0, area.value.length],
        text,
        '\uFEFFvisible\n\ntail',
      )
      const body = area.value.indexOf('PRIVATE')
      await copy(editor, area, changed, [body, body + 7], 'PRIVATE', '')
      reopen(editor, text)
    })
  })
}

for (const count of [1, 2])
  test(`${count} leading BOMs preserve code, escape, attribute and incomplete-syntax exclusions`, () => {
    const text =
      '\uFEFF'.repeat(count) +
      'Visible %%secret%% <!--html--> `%%code%% <!--code-->` \\%%escaped%%\n\n```md\n%%fenced%% <!--fenced-->\n```\n\n<div title="<!--attribute-->">Visible <!--inside--></div>\n\n%%unfinished\n\n<!--unfinished'
    const spans = literalCommentSpans(text)
    expect
      .soft(spans.map((span) => span.value))
      .toEqual(['secret', 'html', 'inside'])
    expect
      .soft(spans.map((span) => text.slice(span.start, span.end)))
      .toEqual(['%%secret%%', '<!--html-->', '<!--inside-->'])
  })

test('two HTML comments in one node rebase each relative span into the original input', () => {
  const text = '\uFEFF\uFEFFlead\n\n<div><!--one--> x <!--two--></div>'
  expect(literalCommentSpans(text)).toMatchObject([
    { start: 13, end: 23, syntax: 'html', value: 'one' },
    { start: 26, end: 36, syntax: 'html', value: 'two' },
  ])
})

test('TXT copy keeps BOMs, comment-looking text and original line endings literal', () => {
  const text = '\uFEFF\uFEFFa %%PRIVATE%%\r\nb <!--PRIVATE-->\rc\uFEFFend\n'
  return run(
    text,
    async (editor, area, changed) => {
      await copy(editor, area, changed, [0, area.value.length], text, text)
      reopen(editor, text, 'txt')
    },
    'txt',
  )
})

test('copying a partial private comment retains an existing undo and redo tail', () => {
  const text = '\uFEFF\uFEFFbefore <!--PRIVATE--> after\r\n'
  const original = text.replace('before', 'initial')
  return run(original, async (editor, area, changed) => {
    editor.replaceSource(text)
    editor.replaceSource(text + '!')
    expect(editor.undo()).toBe(true)
    expect(editor.commandState().commands).toMatchObject({
      undo: true,
      redo: true,
    })
    const body = area.value.indexOf('PRIVATE')
    await copy(editor, area, changed, [body, body + 7], 'PRIVATE', '')
    expect(editor.redo()).toBe(true)
    expect(editor.snapshot().text).toBe(text + '!')
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot().text).toBe(text)
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot().text).toBe(original)
    expect(editor.redo()).toBe(true)
    expect(editor.snapshot().text).toBe(text)
    reopen(editor, text)
  })
})
