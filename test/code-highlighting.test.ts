import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
} from '@milkdown/kit/core'
import { history } from '@milkdown/kit/plugin/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { redo, undo } from '@milkdown/kit/prose/history'
import type { DecorationSet, EditorView } from '@milkdown/kit/prose/view'
import { common } from 'lowlight'
import type { RootContent } from 'hast'
import { dialect, stringifyOptions } from '../src/dialect'
import {
  autoHighlightLimit,
  highlightLimit,
  highlightPlugin,
} from '../src/highlight'

const calls = vi.hoisted(() => ({ count: 0 }))

vi.mock('lowlight', async (importOriginal) => {
  const original = await importOriginal<typeof import('lowlight')>()
  return {
    ...original,
    createLowlight: (...args: Parameters<typeof original.createLowlight>) => {
      const instance = original.createLowlight(...args)
      const highlight = instance.highlight.bind(instance)
      instance.highlight = (...rest: Parameters<typeof highlight>) => {
        calls.count++
        return highlight(...rest)
      }
      return instance
    },
  }
})

// The mocked module counts calls; the reference must not.
const { createLowlight } =
  await vi.importActual<typeof import('lowlight')>('lowlight')
const reference = createLowlight(common)

type Span = [from: number, to: number, className: string]

// Independent of src/highlight.ts: what a full recompute over the document gives.
function expected(doc: ProseNode): Span[] {
  const found: Span[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'code_block') return true
    const language = String(node.attrs.language ?? '').toLowerCase()
    if (language && !reference.registered(language)) return false
    if (!language && node.textContent.length > autoHighlightLimit) return false
    if (node.textContent.length > highlightLimit) return false
    let offset = pos + 1
    const walk = (children: RootContent[], classes: string[]) => {
      for (const child of children) {
        if (child.type === 'text') {
          const end = offset + child.value.length
          if (classes.length > 0) found.push([offset, end, classes.join(' ')])
          offset = end
        } else if (child.type === 'element') {
          walk(child.children, [
            ...classes,
            ...(
              (child.properties?.className as string[] | undefined) ?? []
            ).map((name) => `inkkit-${name}`),
          ])
        }
      }
    }
    walk(
      (language
        ? reference.highlight(language, node.textContent)
        : reference.highlightAuto(node.textContent)
      ).children,
      [],
    )
    return false
  })
  return found
}

// ProseMirror keeps a plugin's key and a decoration's attributes out of its types.
function actual(view: EditorView): Span[] {
  const plugin = view.state.plugins.find((candidate) =>
    (candidate as unknown as { key: string }).key.startsWith('highlight'),
  )!
  const set: DecorationSet = plugin.getState(view.state)
  return set
    .find()
    .map((decoration): Span => {
      const { type } = decoration as unknown as {
        type: { attrs: { class: string } }
      }
      return [decoration.from, decoration.to, type.attrs.class]
    })
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

const source = [
  'Intro paragraph.',
  '```ts\nconst a = 1\nreturn a\n```',
  'Between paragraph.',
  '```js\nfunction f() { return "x" }\n```',
  '> ```json\n> {"k": [1, true]}\n> ```',
  '```\nplain text, no language\n```',
  '```ts\nconst a = 1\nreturn a\n```',
  'Last paragraph.',
].join('\n\n')

let root: HTMLElement
let editor: Editor
let view: EditorView

beforeEach(async () => {
  root = document.createElement('div')
  document.body.append(root)
  editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, source)
      ctx.set(remarkStringifyOptionsCtx, stringifyOptions)
    })
    .use(dialect)
    .use(history)
    .use(highlightPlugin)
    .create()
  view = editor.ctx.get(editorViewCtx)
  calls.count = 0
})

afterEach(async () => {
  await editor.destroy()
  root.remove()
})

function find(text: string): number {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isTextblock && node.textContent.startsWith(text))
      found = pos
    return found < 0
  })
  expect(found).toBeGreaterThanOrEqual(0)
  return found
}

function insertAt(pos: number, text: string) {
  view.dispatch(view.state.tr.insertText(text, pos))
}

test('the initial decorations equal a full recompute', () => {
  expect(actual(view).length).toBeGreaterThan(10)
  expect(actual(view)).toEqual(expected(view.state.doc))
})

test('editing text outside code blocks does not highlight', () => {
  insertAt(find('Intro') + 1, 'x')
  insertAt(find('Between') + 1, 'y')
  insertAt(find('Last') + 1, 'z')
  expect(calls.count).toBe(0)
  expect(actual(view)).toEqual(expected(view.state.doc))
})

test('selection and metadata transactions do not highlight', () => {
  view.dispatch(view.state.tr.setMeta('anything', true))
  expect(calls.count).toBe(0)
})

test('editing inside a code block highlights only that block', () => {
  insertAt(find('function') + 1, 'var q = 2\n')
  expect(calls.count).toBe(1)
  expect(actual(view)).toEqual(expected(view.state.doc))
  calls.count = 0
  insertAt(find('const a = 1') + 7, 'let ')
  expect(calls.count).toBe(1)
  expect(actual(view)).toEqual(expected(view.state.doc))
})

test('an edit in one of two identical blocks leaves the other correct', () => {
  insertAt(find('const a = 1') + 1, '// note\n')
  expect(actual(view)).toEqual(expected(view.state.doc))
  expect(calls.count).toBe(1)
})

test('text typed in a block without a language does not highlight', () => {
  insertAt(find('plain text') + 1, 'more ')
  expect(calls.count).toBe(0)
  expect(actual(view)).toEqual(expected(view.state.doc))
})

test('edits before, between and after blocks keep every decoration at its new position', () => {
  insertAt(find('Last') + 1, 'tail ')
  insertAt(find('Between') + 1, 'a longer insertion between blocks ')
  insertAt(find('Intro') + 1, 'head ')
  expect(calls.count).toBe(0)
  expect(actual(view)).toEqual(expected(view.state.doc))
})

test('a new block is highlighted and others are reused', () => {
  const type = view.state.schema.nodes.code_block!
  const block = type.create(
    { language: 'ts' },
    view.state.schema.text('let n: number = 1'),
  )
  view.dispatch(view.state.tr.insert(find('Between'), block))
  expect(calls.count).toBe(1)
  expect(actual(view)).toEqual(expected(view.state.doc))
})

test('deleting a block, undo and redo stay equal to a full recompute', () => {
  const start = find('function')
  const node = view.state.doc.nodeAt(start)!
  view.dispatch(view.state.tr.delete(start, start + node.nodeSize))
  expect(actual(view)).toEqual(expected(view.state.doc))
  expect(calls.count).toBe(0)
  expect(undo(view.state, view.dispatch)).toBe(true)
  expect(actual(view)).toEqual(expected(view.state.doc))
  expect(redo(view.state, view.dispatch)).toBe(true)
  expect(actual(view)).toEqual(expected(view.state.doc))
  undo(view.state, view.dispatch)
  expect(actual(view)).toEqual(expected(view.state.doc))
})

test('undoing an edit inside a block restores its colors', () => {
  const before = actual(view)
  insertAt(find('const a = 1') + 7, 'let ')
  expect(undo(view.state, view.dispatch)).toBe(true)
  expect(actual(view)).toEqual(before)
})

test('changing the language re-highlights the block, including to none', () => {
  const pos = find('function')
  const node = view.state.doc.nodeAt(pos)!
  view.dispatch(
    view.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      language: 'python',
    }),
  )
  expect(calls.count).toBe(1)
  expect(actual(view)).toEqual(expected(view.state.doc))
  view.dispatch(
    view.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      language: 'no-such-language',
    }),
  )
  expect(actual(view)).toEqual(expected(view.state.doc))
  expect(
    actual(view).every(([from]) => from < pos || from > pos + node.nodeSize),
  ).toBe(true)
  view.dispatch(
    view.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      language: '',
    }),
  )
  view.dispatch(
    view.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      language: 'JS',
    }),
  )
  expect(actual(view)).toEqual(expected(view.state.doc))
  expect(actual(view).length).toBeGreaterThan(0)
})

test('a replacement that spans blocks and paragraphs matches a full recompute', () => {
  view.dispatch(
    view.state.tr.delete(find('const a = 1') + 8, find('function') + 12),
  )
  expect(actual(view)).toEqual(expected(view.state.doc))
})

test('replacing the whole document with itself matches a full recompute', () => {
  const doc = view.state.doc
  view.dispatch(view.state.tr.replaceWith(0, doc.content.size, doc.content))
  expect(actual(view)).toEqual(expected(view.state.doc))
})

test('a block inside a quote is reused when the quote is edited elsewhere', () => {
  const quote = find('{"k"')
  insertAt(quote + 1, ' ')
  expect(calls.count).toBe(1)
  calls.count = 0
  insertAt(find('Intro') + 1, 'x')
  expect(calls.count).toBe(0)
  expect(actual(view)).toEqual(expected(view.state.doc))
})

test('a node attribute step without any size change updates the block', () => {
  const pos = find('function')
  view.dispatch(view.state.tr.setNodeAttribute(pos, 'language', 'python'))
  expect(calls.count).toBe(1)
  expect(actual(view)).toEqual(expected(view.state.doc))
  view.dispatch(view.state.tr.setNodeAttribute(pos, 'language', ''))
  expect(actual(view)).toEqual(expected(view.state.doc))
})

test('turning a block into a paragraph and back keeps colors only on the block', () => {
  const { paragraph, code_block: code } = view.state.schema.nodes
  const pos = find('function')
  const end = pos + view.state.doc.nodeAt(pos)!.nodeSize
  view.dispatch(view.state.tr.setBlockType(pos, end, paragraph!))
  expect(actual(view)).toEqual(expected(view.state.doc))
  view.dispatch(view.state.tr.setBlockType(pos, end, code!, { language: 'js' }))
  expect(actual(view)).toEqual(expected(view.state.doc))
  expect(actual(view).some(([from]) => from > pos && from < end)).toBe(true)
})

test('a block removed and put back in one transaction is highlighted again', () => {
  const pos = find('function')
  const node = view.state.doc.nodeAt(pos)!
  view.dispatch(
    view.state.tr.delete(pos, pos + node.nodeSize).insert(pos, node),
  )
  expect(actual(view)).toEqual(expected(view.state.doc))
})

test('the same node inserted at a second position is highlighted there too', () => {
  const pos = find('function')
  const node = view.state.doc.nodeAt(pos)!
  view.dispatch(view.state.tr.insert(find('Intro'), node))
  expect(actual(view)).toEqual(expected(view.state.doc))
  expect(calls.count).toBe(1)
})

test('many edits in one transaction match a full recompute', () => {
  const tr = view.state.tr
  for (const text of ['Last', 'function', 'Between', 'const a = 1'])
    tr.insertText('++', tr.mapping.map(find(text)) + 1)
  view.dispatch(tr)
  expect(actual(view)).toEqual(expected(view.state.doc))
})

test('random edits, language changes, conversions and history always match a full recompute', () => {
  let seed = 0x2f6e2b1
  const random = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return (seed >>> 8) % n
  }
  const { paragraph, code_block: code } = view.state.schema.nodes
  const languages = ['ts', 'js', 'json', 'python', '', 'unknown', 'JS']
  const snippets = ['x', 'const y = 1\n', '"s"', '{', '\n', '1 + 2', ' // c']
  const textblocks = () => {
    const found: [number, ProseNode][] = []
    view.state.doc.descendants((node, pos) => {
      if (node.isTextblock) found.push([pos, node])
      return !node.isTextblock
    })
    return found
  }
  for (let step = 0; step < 400; step++) {
    const blocks = textblocks()
    const [pos, node] = blocks[random(blocks.length)]!
    const inside = pos + 1 + random(node.content.size + 1)
    const tr = view.state.tr
    switch (random(9)) {
      case 0:
      case 1:
        tr.insertText(snippets[random(snippets.length)]!, inside)
        break
      case 2: {
        const other = Math.min(view.state.doc.content.size, inside + random(40))
        tr.delete(inside, other)
        break
      }
      case 3:
        tr.delete(pos, pos + node.nodeSize)
        break
      case 4:
        if (node.type === code)
          tr.setNodeAttribute(pos, 'language', languages[random(7)]!)
        break
      case 5:
        tr.setBlockType(
          pos,
          pos + node.nodeSize,
          node.type === code ? paragraph! : code!,
          node.type === code ? null : { language: languages[random(7)]! },
        )
        break
      case 6:
        tr.insert(
          pos,
          code!.create(
            { language: languages[random(7)]! },
            view.state.schema.text(snippets[random(snippets.length)]!),
          ),
        )
        break
      case 7:
        undo(view.state, view.dispatch)
        break
      default:
        redo(view.state, view.dispatch)
    }
    if (tr.steps.length > 0) {
      try {
        view.dispatch(tr)
      } catch {
        continue
      }
    }
    expect(actual(view), `step ${step}`).toEqual(expected(view.state.doc))
  }
})

test('an edit in a block of many colors at the length limit matches a full recompute', () => {
  const line = 'const a = 1; // c\n'
  const text = line.repeat(highlightLimit / line.length + 1)
  const block = view.state.schema.nodes.code_block!.create(
    { language: 'ts' },
    view.state.schema.text(text.slice(0, highlightLimit - 1)),
  )
  view.dispatch(view.state.tr.insert(find('Between'), block))
  expect(actual(view).length).toBeGreaterThan(256)
  insertAt(find('const a = 1; //') + 1, 'x')
  expect(actual(view)).toEqual(expected(view.state.doc))
  insertAt(find('xconst a = 1; //') + 1, 'y')
  expect(actual(view)).toEqual(expected(view.state.doc))
  expect(
    actual(view).some(
      ([from]) => from > find('yxconst') && from < find('Between'),
    ),
  ).toBe(false)
  const typed = find('yxconst') + 1
  view.dispatch(view.state.tr.delete(typed, typed + 1))
  expect(actual(view)).toEqual(expected(view.state.doc))
  expect(actual(view).length).toBeGreaterThan(256)
})

// Every number and comma in `1,1,1` has its own color, so a block within the
// length limit still holds thousands of decorations.
async function colorfulBlock(characters: number) {
  const host = document.createElement('div')
  document.body.append(host)
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, host)
      ctx.set(
        defaultValueCtx,
        '```json\n' + '1,'.repeat(characters / 2) + '\n```\n',
      )
      ctx.set(remarkStringifyOptionsCtx, stringifyOptions)
    })
    .use(dialect)
    .use(highlightPlugin)
    .create()
  const view = editor.ctx.get(editorViewCtx)
  expect(actual(view).length).toBe(characters)
  return {
    // Milliseconds for one edit in the block; a second edit puts it back.
    edit(): number {
      const start = performance.now()
      view.dispatch(view.state.tr.insertText('2', 3))
      const elapsed = performance.now() - start
      view.dispatch(view.state.tr.delete(3, 4))
      return elapsed
    },
    async destroy() {
      await editor.destroy()
      host.remove()
    },
  }
}

// A busy machine slows a sample but never speeds one up, so the fastest of
// many samples is the least disturbed. The sizes are sampled in turn, so a
// stall slows both. One edit takes about 10 times as long in the large block
// as in the small one when time grows linearly (4800 / 400 is 12) and about
// 100 times when it grows quadratically; the bound lies between.
test('one edit in a block of many colors takes time linear in its size', async () => {
  const smallSize = 400
  const largeSize = 4800
  expect(largeSize).toBeLessThanOrEqual(highlightLimit)
  const small = await colorfulBlock(smallSize)
  const large = await colorfulBlock(largeSize)
  try {
    for (let i = 0; i < 3; i++) {
      small.edit()
      large.edit()
    }
    let fastestSmall = Infinity
    let fastestLarge = Infinity
    for (let i = 0; i < 15; i++) {
      fastestSmall = Math.min(fastestSmall, small.edit())
      fastestLarge = Math.min(fastestLarge, large.edit())
    }
    expect(fastestLarge).toBeLessThan(Math.max(fastestSmall, 0.1) * 40)
  } finally {
    await small.destroy()
    await large.destroy()
  }
}, 120_000)
