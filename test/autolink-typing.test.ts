import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { InkKitEditor } from '../src/index'
import { semanticSignature } from '../src/preserve'

const input = { documentId: 'typing', format: 'md' as const }

interface Session {
  editor: InkKitEditor
  view: EditorView
  errors: Error[]
  // The document as it reads, without how its links were written.
  content: () => unknown
  // Saves, then reopens the saved text in another editor and returns both.
  save: () => Promise<{ saved: string; same: boolean }>
}

// What the preservation check compares: how a link was written, the label
// text a reference link keeps beside its own, and spaces at the edges of
// formatting, which Markdown writes outside it, are not content.
const content = (view: EditorView) => semanticSignature(view.state.doc)

async function mount() {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: Error[] = []
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    stateChanged() {},
    copy() {},
    openLink() {},
    error: (error) => errors.push(error),
  })
  const view = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx.get(
    editorViewCtx,
  )
  return { root, editor, view, errors }
}

async function session(
  source: string,
  run: (session: Session) => unknown,
): Promise<void> {
  const main = await mount()
  const other = await mount()
  let generation = 1
  try {
    main.editor.loadDocument({ ...input, generation: 1, text: source })
    await run({
      editor: main.editor,
      view: main.view,
      errors: main.errors,
      content: () => content(main.view),
      async save() {
        const saved = main.editor.snapshot().text
        other.editor.loadDocument({
          ...input,
          generation: ++generation,
          text: saved,
        })
        return {
          saved,
          same:
            JSON.stringify(content(other.view)) ===
            JSON.stringify(content(main.view)),
        }
      },
    })
  } finally {
    for (const { editor, root } of [main, other]) {
      await editor.destroy()
      root.remove()
    }
  }
}

// The position just after the first match of `text`, or at its start.
function at(view: EditorView, text: string, after = true): number {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return found < 0
    const index = node.text!.indexOf(text)
    if (index >= 0) found = pos + index + (after ? text.length : 0)
    return false
  })
  if (found < 0) throw new Error(`No ${text}`)
  return found
}

// Types one character at a time at the selection, as keystrokes do.
function type(view: EditorView, text: string) {
  for (const character of text) {
    const { from, to } = view.state.selection
    const tr = view.state.tr.insertText(character, from, to)
    view.dispatch(
      tr.setSelection(TextSelection.create(tr.doc, from + character.length)),
    )
  }
}

function place(view: EditorView, pos: number) {
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
  )
}

async function expectSaves(s: Session, expected?: string) {
  expect(s.errors).toEqual([])
  const { saved, same } = await s.save()
  if (expected !== undefined) expect(saved).toBe(expected)
  expect(same).toBe(true)
}

// 1. A link written with brackets keeps its form and destination.
for (const [name, source, anchor, edited] of [
  [
    'a relative link',
    'See [docs](docs) now.\n',
    'docs',
    'See [docsx](docs) now.\n',
  ],
  [
    'a file link',
    'See [README.md](README.md) now.\n',
    'README.md',
    'See [README.mdx](README.md) now.\n',
  ],
  [
    'a fragment link',
    'See [#top](#top) now.\n',
    '#top',
    'See [#topx](#top) now.\n',
  ],
  [
    'an address written as a link',
    'See [https://example.com](https://example.com) now.\n',
    'example.com',
    'See [https://example.comx](https://example.com) now.\n',
  ],
  [
    'a reference link',
    'See [https://example.com][site] now.\n\n[site]: https://example.com\n',
    'example.com',
    'See [https://example.comx][site] now.\n\n[site]: https://example.com\n',
  ],
] as const)
  test(`editing the label of ${name} keeps its form and destination`, () =>
    session(source, async (s) => {
      place(s.view, at(s.view, anchor))
      type(s.view, 'x')
      await expectSaves(s, edited)
    }))

// 2. Punctuation typed before an address.
for (const address of [
  'www.example.com',
  'https://example.com',
  'ada@example.com',
])
  for (const mark of [
    "'",
    '"',
    ')',
    '+',
    '!',
    '?',
    ':',
    '@',
    '=',
    '-',
    '.',
    '[',
  ])
    test(`typing ${mark} before ${address} saves`, () =>
      session(`Go ${address} now.\n`, async (s) => {
        place(s.view, at(s.view, address, false))
        type(s.view, mark)
        await expectSaves(s)
        expect(s.editor.snapshot().text).toContain(`${mark}`)
      }))

// 3. Line breaks keep their kind.
test('undo next to a soft line break keeps it soft', () =>
  session('Go https://example.com\nline two\n', async (s) => {
    place(s.view, at(s.view, 'example.com'))
    type(s.view, 'x')
    await expectSaves(s, 'Go https://example.comx\nline two\n')
    s.editor.undo()
    await expectSaves(s, 'Go https://example.com\nline two\n')
  }))

test('bold over two lines keeps the soft line break', () =>
  session('line one\nline two\n', async (s) => {
    s.view.dispatch(
      s.view.state.tr.setSelection(
        TextSelection.create(
          s.view.state.doc,
          1,
          s.view.state.doc.content.size - 1,
        ),
      ),
    )
    s.editor.format('bold')
    await expectSaves(s, '**line one\nline two**\n')
  }))

// 4. Typing after an address, one character at a time.
for (const suffix of ['.html', '?q=1', ':8080', '/more', '#part'])
  test(`typing ${suffix} after an address saves at every character`, () =>
    session('See https://example.com/path now.\n', async (s) => {
      place(s.view, at(s.view, '/path'))
      for (const character of suffix) {
        type(s.view, character)
        await expectSaves(s)
      }
      const { saved } = await s.save()
      expect(saved).toBe(`See https://example.com/path${suffix} now.\n`)
    }))

// 5. Each kind of address keeps its form.
for (const [name, source, anchor, saved] of [
  [
    'a www address',
    'Go www.example.com now.\n',
    'example',
    'Go www.examplex.com now.\n',
  ],
  [
    'an email address',
    'Mail ada@example.com now.\n',
    'ada',
    'Mail adax@example.com now.\n',
  ],
  [
    'an emphasised address',
    'See *https://example.com* now.\n',
    'example.com',
    'See *https://example.comx* now.\n',
  ],
  [
    'an address in angle brackets',
    'See <https://example.com> now.\n',
    'example.com',
    'See <https://example.comx> now.\n',
  ],
  [
    'an email address in angle brackets',
    'Mail <ada@example.com> now.\n',
    'ada',
    'Mail <adax@example.com> now.\n',
  ],
] as const)
  test(`editing ${name} keeps its form`, () =>
    session(source, async (s) => {
      place(s.view, at(s.view, anchor))
      type(s.view, 'x')
      await expectSaves(s, saved)
    }))

// 6. Text written against an address in the middle of a sentence.
for (const mark of ['_', '*', '<', ']', '~', '='])
  test(`typing ${mark} after an address in a sentence saves`, () =>
    session('See https://example.com/path today.\n', async (s) => {
      place(s.view, at(s.view, '/path'))
      type(s.view, mark)
      await expectSaves(s)
      expect(s.editor.snapshot().text).toContain(mark)
    }))

test('deleting the words after an address to a trailing space saves at each step', () =>
  session('See https://example.com/path today\n', async (s) => {
    for (let count = 0; count < 'today'.length; count++) {
      const end = s.view.state.doc.content.size - 1
      s.view.dispatch(s.view.state.tr.delete(end - 1, end))
      await expectSaves(s)
    }
    expect(s.editor.snapshot().text).toBe(
      'See <https://example.com/path>&#x20;\n',
    )
  }))

// 7. Addresses typed into plain text.
for (const [typed, link] of [
  [' https://example.com/x y', 'https://example.com/x'],
  [' www.example.com y', 'http://www.example.com'],
  [' ada@example.com y', 'mailto:ada@example.com'],
] as const)
  test(`typing "${typed}" into plain text saves at every character and links it`, () =>
    session('Go foo\n', async (s) => {
      place(s.view, at(s.view, 'foo'))
      for (const character of typed) {
        type(s.view, character)
        await expectSaves(s)
      }
      expect(s.editor.snapshot().text).toBe(`Go foo${typed}\n`)
      expect(s.view.dom.querySelector('a')?.getAttribute('href')).toBe(link)
    }))

// 8. Many edits in one block.
test('replacing text in thousands of addresses in one paragraph stays quick', () => {
  const source =
    Array.from({ length: 3000 }, (_, i) => `https://example.com/p${i}`).join(
      ' ',
    ) + '\n'
  return session(source, async (s) => {
    const started = performance.now()
    expect(s.editor.replaceAll('example', 'sample')).toBe(3000)
    const elapsed = performance.now() - started
    expect(s.errors).toEqual([])
    expect(s.editor.snapshot().text).toBe(
      source.replaceAll('example', 'sample'),
    )
    expect(elapsed).toBeLessThan(10000)
  })
}, 30000)

// Random typing, deleting and undo around each kind of link. Every edit that
// applies must save and reopen as the document the person sees. After many
// random edits, some text cannot be written to read back as itself, on main
// as well; such an edit is refused and must leave the document and its saved
// text as they were.
const documents = [
  'Visit https://example.com/path today.\n',
  'Go www.example.com and ada@example.com now.\n',
  'See [docs](docs) and <https://example.com> here.\n',
  '- https://example.com/a\n- [x](https://x.org)\n',
  '| A | B |\n| --- | --- |\n| https://e.com/x | www.e.com |\n',
  '**Bold** https://example.com/path\nline two\n',
  'Mail <ada@example.com> or *https://example.com* (www.example.com).\n',
]

const alphabets = {
  'address characters': 'ax./:?=#_-@ ()',
  'Markdown punctuation': "ax./:?=#_*-@ '()[]<>!~&;",
}

for (const [alphabet, characters] of Object.entries(alphabets))
  for (const [index, source] of documents.entries())
    test(
      `random edits with ${alphabet} around links in document ${index + 1} save and reopen`,
      { timeout: 60000 },
      () =>
        session(source, async (s) => {
          let seed = 7919 * (index + 1) + Number(process.env.INKKIT_SEED ?? 0)
          const random = (limit: number) => {
            seed = (seed * 1103515245 + 12345) % 2147483648
            return Math.floor((seed / 2147483648) * limit)
          }
          const log: string[] = []
          for (let step = 0; step < 150; step++) {
            const positions: number[] = []
            s.view.state.doc.descendants((node, pos) => {
              if (node.isTextblock && !node.content.size)
                positions.push(pos + 1)
              if (node.isText)
                for (let at = 0; at <= node.text!.length; at++)
                  positions.push(pos + at)
              return true
            })
            const pos = positions[random(positions.length)]!
            const choice = random(10)
            const before = s.editor.snapshot().text
            const errors = s.errors.length
            if (choice < 6) {
              const character = characters[random(characters.length)]!
              log.push(`insert ${JSON.stringify(character)} at ${pos}`)
              s.view.dispatch(s.view.state.tr.insertText(character, pos))
            } else if (choice < 9) {
              const $pos = s.view.state.doc.resolve(pos)
              const end = Math.min(pos + 1 + random(3), $pos.end())
              if (end <= pos) continue
              log.push(`delete ${pos}-${end}`)
              s.view.dispatch(s.view.state.tr.delete(pos, end))
            } else {
              log.push('undo')
              s.editor.undo()
            }
            const refused = s.errors.length > errors
            const { saved, same } = await s.save()
            const failure = !same
              ? 'reopened differently'
              : refused && saved !== before
                ? 'a refused edit changed the saved text'
                : undefined
            if (failure && process.env.INKKIT_RANDOM_LOG)
              require('node:fs').appendFileSync(
                process.env.INKKIT_RANDOM_LOG,
                JSON.stringify({ failure, alphabet, source, log, saved }) +
                  '\n',
              )
            if (failure)
              throw new Error(
                `${failure} after ${log.join(', ')}; saved ${JSON.stringify(saved)}`,
              )
          }
        }),
    )
