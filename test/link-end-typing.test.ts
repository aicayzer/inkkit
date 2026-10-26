import { afterEach, beforeEach, expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { InkKitEditor } from '../src/index'
import { semanticSignature } from '../src/preserve'

let root: HTMLElement
let editor: InkKitEditor
let reader: InkKitEditor
let readerRoot: HTMLElement
let view: EditorView
let generation = 0

const viewOf = (target: InkKitEditor) =>
  (target as unknown as { editor: { ctx: Ctx } }).editor.ctx.get(editorViewCtx)

beforeEach(async () => {
  const host = { changed() {}, copy() {}, openLink() {} }
  root = document.createElement('div')
  readerRoot = document.createElement('div')
  document.body.append(root, readerRoot)
  editor = await InkKitEditor.mount(root, host)
  reader = await InkKitEditor.mount(readerRoot, host)
  view = viewOf(editor)
})

afterEach(async () => {
  await editor.destroy()
  await reader.destroy()
  root.remove()
  readerRoot.remove()
})

function load(text: string): number {
  editor.loadDocument({
    documentId: 'note',
    generation: ++generation,
    format: 'md',
    text,
  })
  return generation
}

// Selects `length` characters from `offset` characters into the first text
// node holding `text`.
function select(text: string, offset: number, length = 0) {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return found < 0
    const index = node.text!.indexOf(text)
    if (index >= 0) found = pos + index + offset
    return false
  })
  if (found < 0) throw new Error(`No ${text}`)
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(view.state.doc, found, found + length),
    ),
  )
}

const after = (text: string) => select(text, text.length)

// Types one character at a time, as keystrokes arrive.
function type(text: string, at: number) {
  for (const character of text)
    expect(editor.insertText(character, at)).toBe(true)
}

const links = () => [...root.querySelectorAll('a')].map((a) => a.textContent)

// The saved text, which must reopen as the document the editor shows.
function saved(): string {
  const text = editor.snapshot().text
  reader.loadDocument({
    documentId: 'reader',
    generation: ++generation,
    format: 'md',
    text,
  })
  expect(semanticSignature(viewOf(reader).state.doc)).toEqual(
    semanticSignature(view.state.doc),
  )
  expect(
    [...readerRoot.querySelectorAll('a')].map((a) => a.textContent),
  ).toEqual(links())
  return text
}

// [what, source, caret after, typed, saved, link text shown]
const ends: [string, string, string, string, string, string][] = [
  [
    'an inline link',
    'See [docs](docs) now\n',
    'docs',
    's and more',
    'See [docs](docs)s and more now\n',
    'docs',
  ],
  [
    'a full reference link',
    'See [docs][d] now\n\n[d]: https://example.com\n',
    'docs',
    's',
    'See [docs][d]s now\n\n[d]: https://example.com\n',
    'docs',
  ],
  [
    'a collapsed reference link',
    'See [docs][] now\n\n[docs]: https://example.com\n',
    'docs',
    's',
    'See [docs][]s now\n\n[docs]: https://example.com\n',
    'docs',
  ],
  [
    'a shortcut reference link',
    'See [docs] now\n\n[docs]: https://example.com\n',
    'docs',
    'x',
    'See [docs]x now\n\n[docs]: https://example.com\n',
    'docs',
  ],
  [
    'a link at the end of a block',
    'See [docs](docs)\n',
    'docs',
    ' next',
    'See [docs](docs) next\n',
    'docs',
  ],
  [
    'an angle autolink',
    'See <https://example.com> now\n',
    'example.com',
    'x',
    'See <https://example.com>x now\n',
    'https://example.com',
  ],
]

for (const [name, source, anchor, typed, expected, shown] of ends)
  test(`text typed at the end of ${name} stays outside it`, () => {
    const at = load(source)
    after(anchor)
    type(typed, at)
    expect(links()).toEqual([shown])
    expect(saved()).toBe(expected)
    while (editor.snapshot().text !== source) expect(editor.undo(at)).toBe(true)
    expect(links()).toEqual([shown])
    while (editor.snapshot().text !== expected)
      expect(editor.redo(at)).toBe(true)
    expect(saved()).toBe(expected)
  })

test('text arriving in one piece at the end of a link stays outside it', () => {
  const at = load('See [docs](docs) now\n')
  after('docs')
  expect(editor.insertText('s and more', at)).toBe(true)
  expect(links()).toEqual(['docs'])
  expect(saved()).toBe('See [docs](docs)s and more now\n')
})

test('text typed before a link stays outside it', () => {
  let at = load('[docs](docs) now\n')
  select('docs', 0)
  type('X', at)
  expect(saved()).toBe('X[docs](docs) now\n')
  at = load('See [docs](docs) now\n')
  select('docs', 0)
  type('X', at)
  expect(saved()).toBe('See X[docs](docs) now\n')
})

test('text typed inside a link joins it', () => {
  const at = load('See [docs](docs) now\n')
  select('docs', 2)
  type('X y', at)
  expect(links()).toEqual(['doX ycs'])
  expect(saved()).toBe('See [doX ycs](docs) now\n')
})

test('a bare address grows with the address typed after it', () => {
  const at = load('See https://example.com now\n')
  after('example.com')
  type('/path', at)
  expect(links()).toEqual(['https://example.com/path'])
  expect(saved()).toBe('See https://example.com/path now\n')
})

test('CRLF and Unicode text typed at a link end stays outside it', () => {
  const source = 'Před [café](u) po\r\n\r\nNext\r\n'
  const at = load(source)
  after('café')
  type('🎉文', at)
  expect(links()).toEqual(['café'])
  expect(saved()).toBe('Před [café](u)🎉文 po\r\n\r\nNext\r\n')
})

test('a link started at the caret continues until whitespace', () => {
  let at = load('ab\n')
  after('ab')
  expect(editor.format('link', { destination: 'u' }, at)).toBe(true)
  type('hello world', at)
  expect(links()).toEqual(['hello'])
  expect(saved()).toBe('ab[hello](u) world\n')
  expect(editor.undo(at)).toBe(true)
  expect(editor.redo(at)).toBe(true)
  expect(saved()).toBe('ab[hello](u) world\n')

  at = load('ab\n')
  after('ab')
  expect(editor.format('link', { destination: 'u' }, at)).toBe(true)
  expect(editor.insertText('hello world', at)).toBe(true)
  expect(saved()).toBe('ab[hello](u) world\n')
})

test('a link started at the caret ends when the caret moves', () => {
  const at = load('ab cd\n')
  after('ab')
  expect(editor.format('link', { destination: 'u' }, at)).toBe(true)
  type('xy', at)
  select('cd', 0)
  select('xy', 2)
  type('z', at)
  expect(saved()).toBe('ab[xy](u)z cd\n')
})

for (const [kind, run] of [
  ['typed one character at a time', (at: number) => type('user guide', at)],
  [
    'inserted in one piece',
    (at: number) => expect(editor.insertText('user guide', at)).toBe(true),
  ],
  [
    'pasted as plain text',
    (at: number) =>
      expect(editor.pasteAsPlainText('user guide', at)).toBe(true),
  ],
] as const)
  test(`text ${kind} over the whole of a link's text stays in the link`, () => {
    const source = 'See [docs](docs) now\n'
    const at = load(source)
    expect(editor.find('docs', at)).toBe(true)
    run(at)
    expect(links()).toEqual(['user guide'])
    expect(saved()).toBe('See [user guide](docs) now\n')
    while (editor.snapshot().text !== source) expect(editor.undo(at)).toBe(true)
    expect(links()).toEqual(['docs'])
  })

test('text typed over the end of a link stays in the link', () => {
  const at = load('See [docs](docs) now\n')
  select('docs', 2, 2)
  type('XY', at)
  expect(saved()).toBe('See [doXY](docs) now\n')
  // Moving the caret away and back ends the link at its edge again.
  select('now', 0)
  after('doXY')
  type('z', at)
  expect(saved()).toBe('See [doXY](docs)z now\n')
})

test('a reference label replaced by typing keeps its definition', () => {
  const at = load('See [docs][d] now\n\n[d]: https://example.com\n')
  expect(editor.find('docs', at)).toBe(true)
  type('guide', at)
  expect(saved()).toBe('See [guide][d] now\n\n[d]: https://example.com\n')
})

test('text replacing a link and the text after it does not take the link', () => {
  const at = load('See [docs](docs) now\n')
  expect(editor.find('docs now', at)).toBe(true)
  type('x', at)
  expect(links()).toEqual([])
  expect(saved()).toBe('See x\n')
})

test('find and replace over a whole link label keeps the link', () => {
  const at = load('See [docs](docs) and [docs](docs)\n')
  expect(editor.replaceAll('docs', 'guide', at)).toBe(2)
  expect(saved()).toBe('See [guide](docs) and [guide](docs)\n')
})

for (const [kind, input, expected] of [
  ['Markdown', { text: 'other', markdown: 'other' }, 'See other now\n'],
  [
    'HTML',
    { text: 'other', html: '<strong>other</strong>' },
    'See **other** now\n',
  ],
] as const)
  test(`a parsed ${kind} paste over a link label does not inherit the link`, async () => {
    const at = load('See [docs](docs) now\n')
    expect(editor.find('docs', at)).toBe(true)
    await editor.paste(input, at)
    expect(links()).toEqual([])
    expect(saved()).toBe(expected)
  })

test('typing with a stale generation changes nothing', () => {
  const source = 'See [docs](docs) now\n'
  const at = load(source)
  after('docs')
  expect(() => editor.insertText('s', at - 1)).toThrow()
  expect(editor.snapshot().text).toBe(source)
})

test('format link at a caret at the end of a link acts on that link', () => {
  const at = load('See [docs](u) now\n')
  after('docs')
  expect(editor.format('link', { destination: 'v' }, at)).toBe(true)
  expect(saved()).toBe('See [docs](v) now\n')
  expect(editor.format('link', undefined, at)).toBe(true)
  expect(saved()).toBe('See docs now\n')
})

test('a link being typed can take another destination and continue', () => {
  const at = load('ab\n')
  after('ab')
  expect(editor.format('link', { destination: 'u' }, at)).toBe(true)
  type('xy', at)
  expect(editor.format('link', { destination: 'w' }, at)).toBe(true)
  type('z', at)
  expect(links()).toEqual(['xyz'])
  expect(saved()).toBe('ab[xyz](w)\n')
})

// ProseMirror reads composed text from the DOM; these stand in for that read.
async function compose(text: string) {
  view.dom.dispatchEvent(
    new CompositionEvent('compositionstart', { bubbles: true }),
  )
  const { from, to } = view.state.selection
  view.dispatch(
    view.state.tr.insertText(text, from, to).setMeta('composition', 7),
  )
  view.dom.dispatchEvent(
    new CompositionEvent('compositionend', { bubbles: true }),
  )
  await new Promise((resolve) => setTimeout(resolve, 30))
}

test('text composed over a whole link label stays in the link', async () => {
  const source = 'See [docs](docs) now\n'
  const at = load(source)
  expect(editor.find('docs', at)).toBe(true)
  await compose('寿司')
  expect(links()).toEqual(['寿司'])
  expect(saved()).toBe('See [寿司](docs) now\n')
  type('x', at)
  expect(saved()).toBe('See [寿司x](docs) now\n')
  while (editor.snapshot().text !== source) expect(editor.undo(at)).toBe(true)
})

test('text composed at the end of a link stays outside it', async () => {
  const at = load('See [docs](docs) now\n')
  after('docs')
  await compose('寿司')
  type('x', at)
  expect(saved()).toBe('See [docs](docs)寿司x now\n')
})

test('text composed after starting a link joins it', async () => {
  const at = load('ab\n')
  after('ab')
  expect(editor.format('link', { destination: 'u' }, at)).toBe(true)
  await compose('寿司')
  type('x y', at)
  expect(saved()).toBe('ab[寿司x](u) y\n')
})

test('insertText during a composition is refused and changes nothing', () => {
  const source = 'See [docs](docs) now\n'
  const at = load(source)
  after('docs')
  view.dom.dispatchEvent(
    new CompositionEvent('compositionstart', { bubbles: true }),
  )
  expect(editor.insertText('s', at)).toBe(false)
  view.dom.dispatchEvent(
    new CompositionEvent('compositionend', { bubbles: true }),
  )
  expect(editor.snapshot().text).toBe(source)
})
