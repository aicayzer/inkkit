import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import { undoDepth, redoDepth } from '@milkdown/kit/prose/history'
import type { EditorView } from '@milkdown/kit/prose/view'
import { InkKitEditor } from '../src/index'
import { semanticSignature } from '../src/preserve'
import { angleAutolinkCases } from './angle-autolink-cases'

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

// A bracket and a parenthesis before an address change how the parser reads
// it as authored, but typed text is saved with them escaped, and that decides
// whether the address links.
for (const typed of [
  '[a](http://x.com',
  '[a](www.example.com/p',
  '[a](https://example.com/a?b=1',
  'see [a](http://x.com',
  '(http://x.com',
  '[http://x.com',
])
  test(`typing ${typed} one character at a time saves`, () =>
    session('\n', async (s) => {
      place(s.view, 1)
      for (const character of typed) {
        type(s.view, character)
        expect(s.errors).toEqual([])
        const { same } = await s.save()
        expect(same).toBe(true)
      }
      await expectSaves(s)
      expect(s.view.state.doc.textContent).toBe(typed)
    }))

// Text in inline code is not read for addresses, whatever it holds.
test('typing next to an untouched code span with a link in it leaves the span', () =>
  session('Write `[text](https://example.com)`\n', async (s) => {
    place(s.view, s.view.state.doc.content.size - 1)
    type(s.view, '.')
    await expectSaves(s, 'Write `[text](https://example.com)`.\n')
  }))

test('typing before and inside code spans that hold addresses leaves them as code', () =>
  session('Go `https://example.com/a` and `www.example.com`\n', async (s) => {
    place(s.view, at(s.view, 'Go ', false))
    type(s.view, 'x')
    place(s.view, at(s.view, 'example.com/'))
    type(s.view, 's')
    place(s.view, at(s.view, 'www.example'))
    type(s.view, 'y')
    await expectSaves(
      s,
      'xGo `https://example.com/sa` and `www.exampley.com`\n',
    )
    expect(s.view.dom.querySelector('a')).toBeNull()
  }))

test('typing an address into inline code does not link it', () =>
  session('Run `x ` now\n', async (s) => {
    place(s.view, at(s.view, 'x'))
    type(s.view, ' https://example.com/a')
    await expectSaves(s, 'Run `x https://example.com/a ` now\n')
    expect(s.view.dom.querySelector('a')).toBeNull()
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
    'example',
    'See <https://examplex.com> now.\n',
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

// 9. Loading changes nothing, and an edit changes nothing outside its range.
for (const source of [
  '# https://bücher.de/a\n',
  'See https://bücher.de/a and https://例え.jp/b now.\n',
  'See https://example.com/a.b* x\n',
  'Go _https://example.com/path_ now\n',
  'Contact user@host or &copy; 2024\n',
  'Link "https://example.com/a" and words here\n',
])
  test(`loading ${JSON.stringify(source)} saves it unchanged`, () =>
    session(source, async (s) => {
      const links = s.view.dom.querySelectorAll('a').length
      await expectSaves(s, source)
      s.view.dispatch(s.view.state.tr.insertText('z', 1))
      s.editor.undo()
      await expectSaves(s, source)
      expect(s.view.dom.querySelectorAll('a').length).toBe(links)
    }))

test('an edit and undo after an address followed by an asterisk keep its destination', () =>
  session('See https://example.com/a.b* x\n', async (s) => {
    place(s.view, at(s.view, ' x'))
    type(s.view, 'y')
    await expectSaves(s, 'See https://example.com/a.b* xy\n')
    s.editor.undo()
    await expectSaves(s, 'See https://example.com/a.b* x\n')
    expect(s.view.dom.querySelector('a')?.getAttribute('href')).toBe(
      'https://example.com/a.b',
    )
  }))

for (const [name, source] of [
  ['in double quotes', 'Link "https://example.com/a" and words here\n'],
  ['in single quotes', "Link 'https://example.com/a' and words here\n"],
  ['an email address in quotes', 'Mail "ada@example.com" and words here\n'],
  ['followed by an asterisk', 'Link https://example.com/a* and words here\n'],
  ['followed by an underscore', 'Link https://example.com/a_ and words here\n'],
  ['followed by a tilde', 'Link https://example.com/a~ and words here\n'],
  [
    'followed by an entity',
    'Link https://example.com/a&copy; and words here\n',
  ],
  ['followed by a break', 'Link https://example.com/a<br> and words here\n'],
  ['in square brackets', 'Link [https://example.com/a] and words here\n'],
  ['in a non-ASCII domain', 'Link https://bücher.de/a and words here\n'],
  ['in emphasis', 'Link _https://example.com/a_ and words here\n'],
  [
    'in a table cell',
    '| A | B |\n| --- | --- |\n| "https://example.com/a" | words here |\n',
  ],
  [
    'in square brackets in a table cell',
    '| A | B |\n| --- | --- |\n| [https://example.com/a] | words here |\n',
  ],
] as const)
  test(`typing far from an address ${name} leaves it as written`, () =>
    session(source, async (s) => {
      place(s.view, at(s.view, 'here'))
      type(s.view, '!')
      await expectSaves(s, source.replace('here', 'here!'))
    }))

for (const [source, anchor, typed, saved] of [
  [
    'See www.example.com&copy; 2026 notes\n',
    '2026',
    'x',
    'See www.example.com&copy; x2026 notes\n',
  ],
  [
    'Start https://a.com/x&amp; middle words\n',
    'middle',
    'Q',
    'Start https://a.com/x&amp; Qmiddle words\n',
  ],
  ['me@a.com&#x41; middle\n', 'middle', 'Q', 'me@a.com&#x41; Qmiddle\n'],
  ['me@a.com\\_ middle\n', 'middle', 'Q', 'me@a.com\\_ Qmiddle\n'],
] as const)
  test(`typing after a space beside ${JSON.stringify(source)} leaves the address before it as written`, () =>
    session(source, async (s) => {
      place(s.view, at(s.view, anchor, false))
      type(s.view, typed)
      await expectSaves(s, saved)
    }))

test('editing text after an entity keeps the entity and other text as written', () =>
  session('Contact user@host or &copy; 2024\n', async (s) => {
    place(s.view, at(s.view, '2024'))
    type(s.view, '5')
    await expectSaves(s, 'Contact user@host or &copy; 20245\n')
  }))

test('editing an address in underscore emphasis follows its text', () =>
  session('Go _https://example.com/path_ now\n', async (s) => {
    place(s.view, at(s.view, '/path'))
    type(s.view, 's')
    await expectSaves(s, 'Go _https://example.com/paths_ now\n')
    expect(s.view.dom.querySelector('a')?.getAttribute('href')).toBe(
      'https://example.com/paths',
    )
  }))

test('inline code over two lines saves', () =>
  session('line one\nline two\n', async (s) => {
    s.view.dispatch(
      s.view.state.tr.setSelection(
        TextSelection.create(s.view.state.doc, 3, 15),
      ),
    )
    s.editor.format('code')
    await expectSaves(s, 'li`ne one`\n`line `two\n')
  }))

test('deleting the space after a bold address saves', () =>
  session('**https://example.com/a** b\n', async (s) => {
    const pos = at(s.view, ' b', false)
    s.view.dispatch(s.view.state.tr.delete(pos, pos + 1))
    // Bold cannot close between an address and a letter, so the link takes
    // brackets with the bold inside.
    await expectSaves(
      s,
      '[**https://example.com/a**](https://example.com/a)b\n',
    )
  }))

for (const [name, html, saved] of [
  [
    'a pasted link whose text is its address',
    '<a href="https://example.com/a">https://example.com/a</a>',
    'https://example.com/a\n',
  ],
  [
    'a pasted link whose text is a relative address',
    '<a href="docs">docs</a>',
    '[docs](docs)\n',
  ],
] as const)
  test(`${name} saves as written`, () =>
    session('', async (s) => {
      place(s.view, 1)
      await s.editor.paste({ html, text: html.replace(/<[^>]+>/g, '') })
      await expectSaves(s, saved)
    }))

test('a written link copied and pasted keeps its brackets', () =>
  session('[https://example.com/a](https://example.com/a) x\n', async (s) => {
    s.view.dispatch(
      s.view.state.tr.setSelection(
        TextSelection.create(s.view.state.doc, 1, 22),
      ),
    )
    const copied = await s.editor.clipboardSnapshot()
    place(s.view, s.view.state.doc.content.size - 1)
    await s.editor.paste({ html: copied.html, text: copied.text })
    const { saved } = await s.save()
    expect(s.errors).toEqual([])
    expect(saved).toMatch(
      /^\[https:\/\/example\.com\/a\]\(https:\/\/example\.com\/a\) x\[https:\/\/example\.com\/a\]\(https:\/\/example\.com\/a\)/,
    )
  }))

// 8. Many edits in one block. Six times as many addresses must take well
// under 36 times as long, as they would if each edit read the whole block.
test('replacing text in thousands of addresses in one paragraph stays quick', async () => {
  const replace = async (count: number) => {
    const source = Array.from(
      { length: count },
      (_, i) => `https://example.com/p${i}`,
    ).join(' ')
    let elapsed = 0
    await session(`${source}\n`, async (s) => {
      const started = performance.now()
      expect(s.editor.replaceAll('example', 'sample')).toBe(count)
      elapsed = performance.now() - started
      expect(s.errors).toEqual([])
      expect(s.editor.snapshot().text).toBe(
        `${source.replaceAll('example', 'sample')}\n`,
      )
    })
    return elapsed
  }
  await replace(50)
  const few = await replace(500)
  const many = await replace(3000)
  expect(many / few).toBeLessThan(18)
}, 60000)

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
  '| A | B |\n| --- | --- |\n| https://e.com/x | "www.e.com" |\n',
  '**Bold** https://example.com/path\nline two\n',
  'Mail <ada@example.com> or *https://example.com* (www.example.com).\n',
  `Link "https://example.com/a" and 'www.example.com' and "ada@example.com" here.\n`,
  'See https://bücher.de/a and https://example.com/ü now.\n',
  'Go _https://example.com/path_ and [https://x.org] now.\n',
  'Contact user@host or &copy; 2024 https://example.com/a&amp;b and more.\n',
  'Far https://example.com/a* and https://example.com/b_ and words here.\n',
]

const alphabets = {
  'address characters': 'ax./:?=#_-@ ()',
  'Markdown punctuation': `ax./:?=#_*-@ '"()[]<>!~&;éü`,
}

// The text of each block as the person reads it.
const visible = (view: EditorView) => {
  const blocks: string[] = []
  view.state.doc.descendants((node) => {
    if (!node.isTextblock) return true
    blocks.push(node.textContent)
    return false
  })
  return blocks.join('\n')
}

// What changed between two texts: the removed and the inserted text.
function changed(before: string, after: string): [string, string] {
  let prefix = 0
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  )
    prefix++
  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++
  return [
    before.slice(prefix, before.length - suffix),
    after.slice(prefix, after.length - suffix),
  ]
}

// Runs of spaces, as table padding can grow by several at once.
const spaces = (text: string) => text.match(/\s+/g)?.length ?? 0

for (const [alphabet, characters] of Object.entries(alphabets))
  for (const [index, source] of documents.entries())
    test(
      `random edits with ${alphabet} around links in document ${index + 1} change only what they reach`,
      { timeout: 60000 },
      () =>
        session(source, async (s) => {
          // Loading changes nothing.
          expect(s.editor.snapshot().text).toBe(source)
          // Each edit is also made to the saved text, freshly opened, to see
          // what a single edit changes.
          const fresh = await mount()
          let generation = 1
          let seed = 7919 * (index + 1) + Number(process.env.INKKIT_SEED ?? 0)
          const random = (limit: number) => {
            seed = (seed * 1103515245 + 12345) % 2147483648
            return Math.floor((seed / 2147483648) * limit)
          }
          const log: string[] = []
          try {
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
              let edit: ((view: EditorView) => void) | undefined
              if (choice < 6) {
                const character = [...characters][
                  random([...characters].length)
                ]!
                log.push(`insert ${JSON.stringify(character)} at ${pos}`)
                edit = (view) =>
                  view.dispatch(view.state.tr.insertText(character, pos))
              } else if (choice < 9) {
                const $pos = s.view.state.doc.resolve(pos)
                const end = Math.min(pos + 1 + random(3), $pos.end())
                if (end <= pos) continue
                log.push(`delete ${pos}-${end}`)
                edit = (view) => view.dispatch(view.state.tr.delete(pos, end))
              } else log.push('undo')
              let reached: string | undefined
              if (edit) {
                fresh.editor.loadDocument({
                  ...input,
                  generation: ++generation,
                  text: before,
                })
                const freshErrors = fresh.errors.length
                if (
                  JSON.stringify(content(fresh.view)) ===
                  JSON.stringify(content(s.view))
                ) {
                  const read = visible(fresh.view)
                  edit(fresh.view)
                  const saved = fresh.editor.snapshot().text
                  // Text the edit did not reach keeps its source: the saved
                  // text changes across no more spaces than the text read.
                  const [removed, inserted] = changed(before, saved)
                  const [removedRead, insertedRead] = changed(
                    read,
                    visible(fresh.view),
                  )
                  if (
                    fresh.errors.length === freshErrors &&
                    (spaces(removed) > spaces(removedRead) + 1 ||
                      spaces(inserted) > spaces(insertedRead) + 1)
                  )
                    reached = `changed ${JSON.stringify(before)} to ${JSON.stringify(saved)}`
                }
                edit(s.view)
              } else s.editor.undo()
              const refused = s.errors.length > errors
              const { saved, same } = await s.save()
              const failure = !same
                ? 'reopened differently'
                : refused && saved !== before
                  ? 'a refused edit changed the saved text'
                  : reached
                    ? `an edit changed text it did not reach: ${reached}`
                    : undefined
              if ((failure || refused) && process.env.INKKIT_RANDOM_LOG)
                require('node:fs').appendFileSync(
                  process.env.INKKIT_RANDOM_LOG,
                  JSON.stringify({
                    failure: failure ?? 'refused',
                    alphabet,
                    source,
                    log,
                    before,
                    saved,
                  }) + '\n',
                )
              if (failure)
                throw new Error(
                  `${failure} after ${log.join(', ')}; saved ${JSON.stringify(saved)}`,
                )
            }
          } finally {
            await fresh.editor.destroy()
            fresh.root.remove()
          }
        }),
    )

for (const [name, source, typed, expected] of angleAutolinkCases)
  test(`typing angle brackets around ${name} preserves the authored source`, () =>
    session(source, async (s) => {
      await expectSaves(s, source)
      const start = at(s.view, 'x', false)
      s.view.dispatch(
        s.view.state.tr.setSelection(
          TextSelection.create(s.view.state.doc, start, start + 1),
        ),
      )
      for (const character of typed) {
        type(s.view, character)
        await expectSaves(s)
      }
      const result = await s.save()
      expect(result.saved).toBe(expected)
    }))

for (const typed of ['<https://x.com>', '<a@b.co>', '<ftp://x.com/a>'])
  test(`typing ${typed} into code keeps every character and adds no link`, () =>
    session('Code `xy` now\n', async (s) => {
      place(s.view, at(s.view, 'x'))
      type(s.view, typed)
      await expectSaves(s, `Code \`x${typed}y\` now\n`)
      expect(s.view.dom.querySelector('a')).toBeNull()
    }))

for (const source of [
  '<https://x.com>\n',
  '<a@b.co>\n',
  '\\<https://x.com>\n',
  'Keep ` <https://x.com> `\n',
])
  test(`loading ${JSON.stringify(source)} and editing another block keep its bytes`, () =>
    session(`${source}\nOther\n`, async (s) => {
      await expectSaves(s, `${source}\nOther\n`)
      place(s.view, at(s.view, 'Other'))
      type(s.view, '>')
      await expectSaves(s, `${source}\nOther\\>\n`)
    }))

test('an angle address typed into an explicit link label keeps its destination', () =>
  session('[x](docs)\n', async (s) => {
    place(s.view, at(s.view, 'x'))
    type(s.view, '<https://x.com>')
    await expectSaves(s)
    expect(s.view.state.doc.textContent).toBe('x<https://x.com>')
    expect(s.view.dom.querySelector('a')?.getAttribute('href')).toBe('docs')
  }))

test('completion leaves the caret after the autolink and undo restores the note', () =>
  session('x\n', async (s) => {
    place(s.view, at(s.view, 'x'))
    type(s.view, '<https://x.com> and <a@b.co> end')
    await expectSaves(s, 'x<https://x.com> and <a@b.co> end\n')
    s.editor.undo()
    await expectSaves(s, 'x\n')
    s.editor.redo()
    await expectSaves(s, 'x<https://x.com> and <a@b.co> end\n')
  }))

test('an unrepresentable literal paste is refused without changing the document or history', () =>
  session('x\n', async (s) => {
    place(s.view, at(s.view, 'x'))
    const state = s.view.state
    const snapshot = s.editor.snapshot()
    const undo = undoDepth(state)
    const redo = redoDepth(state)
    expect(() => s.editor.pasteAsPlainText('<https://x.com>')).toThrowError(
      expect.objectContaining({ code: 'preservation' }),
    )
    expect(s.view.state).toBe(state)
    expect(s.editor.snapshot()).toEqual(snapshot)
    expect(undoDepth(s.view.state)).toBe(undo)
    expect(redoDepth(s.view.state)).toBe(redo)
    await expectSaves(s, 'x\n')
  }))

test('a preservation refusal during angle completion keeps the document, revision and history', () =>
  session('x\n', async (s) => {
    place(s.view, at(s.view, 'x'))
    type(s.view, '<https://x.com')
    const state = s.view.state
    const snapshot = s.editor.snapshot()
    const undo = undoDepth(state)
    const redo = redoDepth(state)
    const internal = s.editor as unknown as {
      assertPreserved: (...args: unknown[]) => void
    }
    const original = internal.assertPreserved
    // Refuse the final normalized document, as an unrepresentable edit is refused.
    internal.assertPreserved = () => {
      throw new Error('Refused for the test')
    }
    try {
      type(s.view, '>')
      expect(s.errors).toMatchObject([{ code: 'preservation' }])
      expect(s.view.state).toBe(state)
      expect(s.editor.snapshot()).toEqual(snapshot)
      expect(undoDepth(s.view.state)).toBe(undo)
      expect(redoDepth(s.view.state)).toBe(redo)
    } finally {
      internal.assertPreserved = original
    }
    s.errors.length = 0
    type(s.view, '>')
    await expectSaves(s, 'x<https://x.com>\n')
  }))

for (const source of ['\\<https://x.com\\>\n', '&lt;https://x.com&gt;\n'])
  test(`undo restores literal delimiters in ${JSON.stringify(source)} without completing an autolink`, () =>
    session(source, async (s) => {
      await expectSaves(s, source)
      const end = at(s.view, '>', false)
      s.view.dispatch(s.view.state.tr.delete(end, end + 1))
      await expectSaves(s)
      const deleted = s.editor.snapshot().text
      s.editor.undo()
      await expectSaves(s, source)
      s.editor.redo()
      await expectSaves(s, deleted)
    }))

for (const [name, source, expected] of [
  ['a loaded angle link', '<https://x.com>\n', '<https://x.com>)\n'],
  ['a loaded email link', '<a@b.co>\n', '<a@b.co>)\n'],
] as const)
  test(`text typed after ${name} stays outside its address`, () =>
    session(source, async (s) => {
      place(s.view, s.view.state.doc.content.size - 1)
      type(s.view, ')')
      await expectSaves(s, expected)
    }))

test('completion recomputes the bare suffix beyond the closing bracket', () =>
  session('\\<https://x.comfoo\n', async (s) => {
    place(s.view, at(s.view, 'https://x.com'))
    type(s.view, '>')
    await expectSaves(s, '<https://x.com>foo\n')
  }))
