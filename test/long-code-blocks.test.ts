import { afterEach, beforeEach, expect, test } from 'vitest'
import { InkKitEditor } from '../src/index'
import { highlightBudget, highlightLimit } from '../src/highlight'

let root: HTMLElement
let editor: InkKitEditor
let generation = 0

beforeEach(async () => {
  root = document.createElement('div')
  document.body.append(root)
  editor = await InkKitEditor.mount(root, {
    changed() {},
    stateChanged() {},
    copy() {},
    openLink() {},
    error(error) {
      throw error
    },
  })
})

afterEach(async () => {
  await editor.destroy()
  root.remove()
})

const fill = (unit: string, length: number) =>
  unit.repeat(Math.ceil(length / unit.length)).slice(0, length)

// The caret opens at the end of the note, so typing lands at the end of the
// last code block.
const note = (language: string, code: string) =>
  'Notes.\n\n```js\nconst ordinary = 1\n```\n\n```' +
  language +
  '\n' +
  code +
  '\n```\n'
const typed = (source: string) => source.replace(/\n```\n$/, 'x\n```\n')

const colors = (block: number) =>
  root.querySelectorAll('pre')[block]!.querySelectorAll('[class*="hljs-"]')
    .length

function open(source: string): number {
  const start = performance.now()
  editor.loadDocument({
    documentId: 'long-code',
    generation: ++generation,
    format: 'md',
    text: source,
  })
  return performance.now() - start
}

function type(): number {
  const start = performance.now()
  expect(editor.insertText('x', generation)).toBe(true)
  return performance.now() - start
}

// Text that takes highlight.js time growing with the square of its length
// when highlighted as a whole block in these languages.
const slow: [language: string, code: string][] = [
  ['ini', '[server]\nport = 8080\n' + fill('a', 20_000)],
  ['typescript', 'const port = 8080\n' + fill('a', 20_000)],
  [
    'c',
    'int main(void) { return 0; }\n' +
      fill('the quick brown fox jumps over\n', 20_000),
  ],
]

for (const [language, code] of slow)
  test(`a ${code.length}-character code block in ${language} opens and takes typing as fast as the same text without a language`, () => {
    const plain = note('', code)
    const plainTime = open(plain) + type()
    expect(editor.snapshot().text).toBe(typed(plain))

    const source = note(language, code)
    const openTime = open(source)
    expect(editor.snapshot().text).toBe(source)
    expect(colors(0)).toBeGreaterThan(0)
    expect(colors(1)).toBe(0)
    const typeTime = type()
    expect(editor.snapshot().text).toBe(typed(source))
    expect(colors(0)).toBeGreaterThan(0)
    expect(colors(1)).toBe(0)
    // Highlighting this block as a whole takes seconds; without it, opening
    // and typing cost about what they cost for the plain block.
    expect(openTime + typeTime).toBeLessThan(plainTime * 3 + 300)
  })

test('a block is highlighted up to the length limit and plain past it, and edits move it across', () => {
  const line = 'const value = compute(1, "two") // three\n'
  const source = note('typescript', fill(line, highlightLimit))
  open(source)
  expect(colors(1)).toBeGreaterThan(100)
  type()
  expect(editor.snapshot().text).toBe(typed(source))
  expect(colors(1)).toBe(0)
  expect(editor.undo(generation)).toBe(true)
  expect(editor.snapshot().text).toBe(source)
  expect(colors(1)).toBeGreaterThan(100)
  expect(editor.redo(generation)).toBe(true)
  expect(editor.snapshot().text).toBe(typed(source))
  expect(colors(1)).toBe(0)
})

test('a note of many long blocks opens in bounded time and colors a block once it is edited', () => {
  const block =
    '```ini\n[s]\nk = 1\n' + fill('a', highlightLimit - 20) + '\n```\n'
  const blocks = (count: number) => Array(count).fill(block).join('\n')
  const oneTime = open(blocks(1))
  const source = blocks(20)
  const manyTime = open(source)
  expect(editor.snapshot().text).toBe(source)
  // Each block takes about as long as the whole note with one block; the
  // budget stops highlighting well before all twenty.
  expect(manyTime).toBeLessThan(oneTime * 4 + highlightBudget * 2)
  type()
  expect(editor.snapshot().text).toBe(typed(source))
  expect(colors(19)).toBeGreaterThan(0)
})
