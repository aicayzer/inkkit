import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorOptions } from '../src/core'
import { lineNumberDecorations } from '../src/code-line-numbers'
import { ctxOf } from './editor-access'
import { input, withEditor, type Mounted } from './formats/harness'

const numbered: EditorOptions = { display: { codeLineNumbers: true } }

const numbers = (mounted: Mounted) =>
  [...mounted.root.querySelectorAll<HTMLElement>('.inkkit-line-number')].map(
    (element) => element.getAttribute('data-inkkit-line'),
  )
const load = (mounted: Mounted, text: string) =>
  mounted.editor.loadDocument(input('md', text))
const view = (mounted: Mounted) => ctxOf(mounted.editor).get(editorViewCtx)

test('each line of a code block has a number, including a trailing empty line', () =>
  withEditor(numbered, (mounted) => {
    load(mounted, '```js\nfirst\n\nthird\n\n```\n')
    // The text is `first`, an empty line, `third` and a trailing newline: four lines.
    expect(numbers(mounted)).toEqual(['1', '2', '3', '4'])
    expect(
      view(mounted).dom.getAttribute('data-inkkit-code-line-numbers'),
    ).toBe('true')
  }))

test('a CRLF document is numbered by its lines and saved unchanged', () =>
  withEditor(numbered, (mounted) => {
    const source =
      'Before\r\n\r\n```ts\r\nlet a = 1\r\nlet b = 2\r\n```\r\n\r\nAfter\r\n'
    load(mounted, source)
    expect(numbers(mounted)).toEqual(['1', '2'])
    expect(mounted.editor.snapshot().text).toBe(source)
  }))

test('an empty code block has one number', () =>
  withEditor(numbered, (mounted) => {
    load(mounted, '```\n```\n\n~~~js\n~~~\n')
    expect(numbers(mounted)).toEqual(['1', '1'])
  }))

test('a diagram code block is numbered like any other', () =>
  withEditor(numbered, (mounted) => {
    load(mounted, '```mermaid\ngraph TD\n  A --> B\n```\n')
    expect(numbers(mounted)).toEqual(['1', '2'])
  }))

test('code in a list, a quote and a callout is numbered, and inline code is not', () =>
  withEditor(numbered, (mounted) => {
    load(
      mounted,
      '- item\n\n  ```\n  a\n  b\n  ```\n\n> ```\n> q\n> ```\n\nUse `inline`.\n',
    )
    expect(numbers(mounted)).toEqual(['1', '2', '1'])
  }))

test('the numbers carry no text, no selectable content and no accessible name', () =>
  withEditor(numbered, (mounted) => {
    load(mounted, '```\na\nb\n```\n')
    const gutter = mounted.root.querySelector('.inkkit-code-gutter')!
    expect(gutter.getAttribute('aria-hidden')).toBe('true')
    expect(gutter.getAttribute('contenteditable')).toBe('false')
    // The entries hold a hidden copy of each line for layout, and the digits come from attributes.
    expect(
      [...gutter.querySelectorAll('.inkkit-line-number')].map(
        (element) => element.textContent,
      ),
    ).toEqual(['a', 'b'])
    expect(mounted.root.querySelector('pre')!.textContent).not.toMatch(/[12]/)
  }))

test('numbers leave the snapshot, copy and print output unchanged', () =>
  withEditor(undefined, (mounted) => {
    const source = '# Title\n\n```js\na\nb\n```\n'
    load(mounted, source)
    const plain = {
      snapshot: mounted.editor.snapshot(),
      printable: mounted.editor.printableSnapshot(),
      clipboard: mounted.editor.clipboardSnapshot(),
    }
    return Promise.all([plain.printable, plain.clipboard]).then(
      async ([printable, clipboard]) => {
        mounted.editor.setDisplayPreferences({ codeLineNumbers: true })
        expect(numbers(mounted)).toEqual(['1', '2'])
        expect(mounted.editor.snapshot()).toEqual(plain.snapshot)
        expect(await mounted.editor.printableSnapshot()).toEqual(printable)
        expect(await mounted.editor.clipboardSnapshot()).toEqual(clipboard)
        expect(mounted.changes).toEqual([])
        const html = JSON.stringify(await mounted.editor.printableSnapshot())
        expect(html).not.toContain('inkkit-line-number')
        expect(html).not.toContain('data-inkkit-line')
      },
    )
  }))

test('editing a code block rebuilds only that block', () =>
  withEditor(numbered, (mounted) => {
    load(
      mounted,
      '```\na\nb\n```\n\n```\nc\nd\n```\n\nText\n\n```\ne\nf\n```\n',
    )
    const v = view(mounted)
    const blocks: number[] = []
    v.state.doc.forEach((node, offset) => {
      if (node.type.name === 'code_block') blocks.push(offset)
    })
    const specsIn = (start: number) =>
      new Set(
        lineNumberDecorations(v.state)
          .find(start, start + v.state.doc.nodeAt(start)!.nodeSize)
          .filter((decoration) => decoration.from === start)
          .map((decoration) => decoration.spec),
      )
    const before = blocks.map(specsIn)
    expect(before.map((specs) => specs.size)).toEqual([1, 1, 1])
    // A new line in the middle block, which also moves the block after it.
    v.dispatch(v.state.tr.insertText('\nnew', blocks[1]! + 3))
    const after = blocks.map((start, index) =>
      specsIn(index === 2 ? start + 4 : start),
    )
    expect(after.map((specs) => specs.size)).toEqual([1, 1, 1])
    expect([...after[0]!].every((spec) => before[0]!.has(spec))).toBe(true)
    expect([...after[2]!].every((spec) => before[2]!.has(spec))).toBe(true)
    expect([...after[1]!].some((spec) => before[1]!.has(spec))).toBe(false)
    expect(numbers(mounted)).toEqual(['1', '2', '1', '2', '3', '1', '2'])
  }))

test('numbers follow edits: a new line, a deleted block, a changed language and undo', () =>
  withEditor(numbered, (mounted) => {
    const source = '```\na\n```\n\nText\n'
    load(mounted, source)
    mounted.editor.find('a')
    mounted.editor.insertText('1\n2\n3', mounted.editor.snapshot().generation)
    expect(numbers(mounted)).toEqual(['1', '2', '3'])
    expect(mounted.editor.undo()).toBe(true)
    expect(numbers(mounted)).toEqual(['1'])
    expect(mounted.editor.snapshot().text).toBe(source)
    const v = view(mounted)
    v.dispatch(v.state.tr.delete(0, v.state.doc.firstChild!.nodeSize))
    expect(numbers(mounted)).toEqual([])
  }))

test('turning the option off removes the numbers and the load keeps it', () =>
  withEditor(numbered, (mounted) => {
    load(mounted, '```\na\nb\n```\n')
    mounted.editor.setDisplayPreferences({})
    expect(numbers(mounted)).toEqual([])
    expect(
      view(mounted).dom.hasAttribute('data-inkkit-code-line-numbers'),
    ).toBe(false)
    mounted.editor.setDisplayPreferences({ codeLineNumbers: true })
    load(mounted, '```\nx\ny\nz\n```\n')
    expect(numbers(mounted)).toEqual(['1', '2', '3'])
  }))

test('a surrogate pair and a combining mark do not shift the numbers', () =>
  withEditor(numbered, (mounted) => {
    load(mounted, '```\n\u{1F600}\n\u0065\u0301\nz\n```\n')
    expect(numbers(mounted)).toEqual(['1', '2', '3'])
  }))

test('no node of the gutter is inside the code text', () =>
  withEditor(numbered, (mounted) => {
    load(mounted, '```js\none\ntwo\nthree\n```\n')
    const pre = mounted.root.querySelector('pre')!
    const code = pre.querySelector(':scope > code')!
    expect(code.querySelector('.inkkit-line-number')).toBeNull()
    expect(code.querySelector('.inkkit-code-gutter')).toBeNull()
    // The gutter is the block's own, beside the text, and the text is the only thing the code holds.
    expect(pre.querySelector(':scope > .inkkit-code-gutter')).not.toBeNull()
    const visible = [...code.childNodes].filter(
      (node) =>
        !(
          node instanceof Element &&
          node.classList.contains('ProseMirror-widget')
        ),
    )
    expect(visible.map((node) => node.textContent).join('')).toBe(
      'one\ntwo\nthree',
    )
    expect(pre.getAttribute('data-inkkit-line-numbers')).toBe('')
  }))

test('turning numbers on and off swaps the block view and keeps the bytes', () =>
  withEditor(undefined, (mounted) => {
    const source = '```js\none\ntwo\n```\n\nText\n'
    load(mounted, source)
    expect(mounted.root.querySelector('.inkkit-code-gutter')).toBeNull()
    mounted.editor.setDisplayPreferences({ codeLineNumbers: true })
    expect(numbers(mounted)).toEqual(['1', '2'])
    mounted.editor.setDisplayPreferences({})
    expect(mounted.root.querySelector('.inkkit-code-gutter')).toBeNull()
    expect(
      mounted.root
        .querySelector('pre')!
        .hasAttribute('data-inkkit-line-numbers'),
    ).toBe(false)
    expect(mounted.editor.snapshot().text).toBe(source)
    expect(mounted.changes).toEqual([])
  }))

test('replaceAll rebuilds only the blocks a replacement touched', () =>
  withEditor(numbered, (mounted) => {
    load(mounted, 'needle\n\n```\na\nb\n```\n\nneedle\n')
    const v = view(mounted)
    let fence = -1
    v.state.doc.forEach((node, offset) => {
      if (node.type.name === 'code_block') fence = offset
    })
    const specs = (start: number) =>
      lineNumberDecorations(v.state)
        .find(start, start + v.state.doc.nodeAt(start)!.nodeSize)
        .filter((decoration) => decoration.from === start)
        .map((decoration) => decoration.spec)
    const before = specs(fence)
    expect(before).toHaveLength(1)
    expect(
      mounted.editor.replaceAll('needle', 'a much longer replacement'),
    ).toBe(2)
    let after = -1
    v.state.doc.forEach((node, offset) => {
      if (node.type.name === 'code_block') after = offset
    })
    expect(after).toBeGreaterThan(fence)
    // The fence is the same block with the same decoration, moved by the first replacement.
    expect(specs(after)).toEqual(before)
    expect(specs(after)[0]).toBe(before[0])
    expect(numbers(mounted)).toEqual(['1', '2'])
  }))
