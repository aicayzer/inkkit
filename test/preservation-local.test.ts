import { expect, test } from 'vitest'
import { parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  Fragment,
  Slice,
  type Node as ProseNode,
} from '@milkdown/kit/prose/model'
import { Transform } from '@milkdown/kit/prose/transform'
import { Preservation, PreservationError } from '../src/preserve'
import { withEditor } from './harness'

// Saves `doc` twice: as typing does, and with local validation disabled, which
// serializes and reopens the whole document.
function compare(local: Preservation, full: Preservation, doc: ProseNode) {
  const fast = (
    local as unknown as { localEdits(doc: ProseNode): string | undefined }
  ).localEdits(doc)
  let whole: string | Error
  try {
    whole = full.serialize(doc)
  } catch (error) {
    whole = error as Error
  }
  return { fast, whole }
}

// What a reopened document must keep: structure, text, marks and targets.
const reopen = (doc: ProseNode) =>
  JSON.stringify(doc.toJSON(), (key, value) =>
    [
      'id',
      'label',
      'spread',
      'listPlaceholder',
      'marker',
      'authoredFence',
      'referenceContent',
      'referenceType',
    ].includes(key)
      ? undefined
      : value,
  )

function wholeOnly(ctx: Ctx, source: string): Preservation {
  const full = new Preservation(ctx, source)
  ;(full as unknown as { localEdits(): undefined }).localEdits = () => undefined
  return full
}

const blocks: Array<(i: number) => string> = [
  (i) => `Plain words ${i} with *emphasis* and __bold__ text.`,
  (i) => `See [link ${i}](/t/${i} "Title") and \`code ${i}\` here.`,
  (i) => `A [full ${i}][ref] and [ref][] and [ref] reference.`,
  (i) =>
    `Wrapped line ${i} one\nand line two  \nhard break, \\[escaped\\] &amp; done.`,
  (i) => `Footnote ${i}[^note] mention.`,
  (i) => `Comment ${i} %%hidden%% and <b>html</b> and <https://x.example>.`,
  (i) => `Unresolved ${i} [missing][nowhere] stays literal.`,
  (i) => `# Heading ${i} with [a link](/h/${i})`,
  (i) => `Setext ${i} [l](/s)\n===`,
  (i) => `- item ${i} [l](/l)\n- second ${i}\n  lazy continuation\n- third`,
  (i) => `* [ ] task ${i} [l](/t)\n* [x] done ${i}`,
  (i) => `+ plus ${i}\n\n+ loose ${i}`,
  (i) => `1) first ${i}\n2) second [r][ref]\n3) third`,
  (i) => `  3. indented ${i}\n  4. next`,
  (i) => `- outer ${i}\n    - nested [l](/n)\n    - nested two`,
  (i) => '```ts\nconst a' + i + ' = "<x>";\n```',
  (i) => `~~~\ncode ${i} [x]\n~~~`,
  (i) => `    indented code ${i}`,
  (i) => `| A | B |\n| - | :-: |\n| [cell ${i}](/c) | two \\| pipe |`,
  (i) => `> quoted ${i} [l](/q)`,
  () => '* * *',
  (i) => `Trailing spaces ${i}   \nnext b - c line\t`,
  (i) => `-\ttab item ${i}\n\tmore b - c text`,
  (i) => `1.  wide item ${i}\n    b - c continuation\n\n    second paragraph`,
  (i) => `* [ ] task ${i}\n  b # c\n* [x] done`,
  (i) => `Heading ${i} line\n---`,
  (i) => `Para ${i} [l](/p)\n- interrupting [l](/i)\n- list`,
  (i) => `Para ${i}\n\`\`\`\ncode right after\n\`\`\``,
  (i) => `- loose ${i} [l](/l)\n\n  second paragraph\n- next`,
  (i) => `<div>\nhtml ${i} [l](/l)\n\n</div>`,
  (i) => `[^n${i}]: Note with\n    - a list [l](/l)`,
  () => '> [ref]: /quoted',
  (i) => `| Code | x |\n| - | - |\n| \`a\\|b\` ${i} | [r][ref] |`,
  (i) => `-   wide ${i} [l](/l) word\n\n    second ${i} para`,
  (i) => `1.  wide ${i} [r][ref] word\n    continued line\n2.  next`,
  (i) => `  indented para ${i} [l](/l)`,
  (i) => `   three spaces ${i}`,
  (i) => `-   item ${i} word\n  - sibling ${i}`,
  (i) =>
    Array.from({ length: 11 }, (_, k) => `${k + 1}. it${k} ${i} [l](/l)`).join(
      '\n',
    ),
  (i) => `1.   five col ${i} word`,
  (i) => `-\ttab ${i} [l](/l)\n\n  two space`,
  (i) => `1. First ${i}\n\n2. Second [l](/l)\n\n   More detail\n3. Third`,
  (i) => `See [STRASSE] and [Straße] and [ẞ] ${i} [l](/l).`,
  (i) => `Case [FOO  bar] and [foo bar][] ${i}.`,
  (i) => `[^f${i}]: Foot [l](/l)\n\n    [inner${i}]: /in`,
]
const definitions = [
  '[Strasse]: /s',
  '[foo bar]: /fb',
  '[ref]: /target "Ref"',
  '[^note]: The note text.',
  '[other]: <angle target>',
]
const snippets = [
  'x',
  ' ',
  'typed',
  '[',
  ']',
  '*',
  '_',
  '`',
  '|',
  '#',
  '- ',
  '1. ',
  '<',
  '%%',
  '&',
  '\\',
  '!',
  '[ref]',
  '---',
  '```',
  '  ',
]

test(
  'local validation saves exactly what whole-document preservation saves',
  () =>
    withEditor('x\n', (editor) => {
      const ctx = editor.ctx
      const parse = ctx.get(parserCtx)
      let localSaves = 0
      const kinds = new Map<string, number>()
      for (let seed = 1; seed <= Number(process.env.SEEDS ?? 600); seed++) {
        let state = seed
        const random = () =>
          (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32
        const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)]!
        const ending = random() < 0.3 ? '\r\n' : '\n'
        const parts = Array.from(
          { length: 3 + Math.floor(random() * 10) },
          (_, i) => pick(blocks)(i),
        )
        if (random() < 0.8)
          parts.splice(
            Math.floor(random() * parts.length),
            0,
            pick(definitions),
          )
        if (random() < 0.3) parts.push(...definitions)
        if (random() < 0.1) parts.unshift('---\ntitle: front\n---')
        const source =
          (random() < 0.1 ? '\uFEFF' : '') +
          parts.join('\n\n').replaceAll('\n', ending) +
          (random() < 0.8 ? ending : '')
        const local = new Preservation(ctx, source)
        const full = wholeOnly(ctx, source)
        let doc = parse(source)
        for (let step = 0; step < 4; step++) {
          const textblocks: Array<{
            node: ProseNode
            pos: number
            top: number
          }> = []
          doc.forEach((top, offset, index) => {
            if (top.isTextblock)
              textblocks.push({ node: top, pos: offset, top: index })
            top.descendants((node, pos) => {
              if (node.isTextblock)
                textblocks.push({ node, pos: offset + 1 + pos, top: index })
              return true
            })
          })
          if (!textblocks.length) break
          const target = pick(textblocks)
          const tr = new Transform(doc)
          const from =
            target.pos +
            1 +
            Math.floor(random() * (target.node.content.size + 1))
          const to = Math.min(
            target.pos + 1 + target.node.content.size,
            from + Math.floor(random() * 6),
          )
          const action = random()
          const schema = doc.type.schema
          const $target = doc.resolve(target.pos)
          try {
            if (action < 0.45) {
              const marks = doc.resolve(from).marks()
              tr.insert(from, schema.text(pick(snippets), marks))
            } else if (action < 0.65) tr.delete(from, to)
            else if (action < 0.72) tr.split(from)
            else if (action < 0.79) {
              if (
                $target.index() > 0 &&
                $target.parent.child($target.index() - 1).isTextblock
              )
                tr.join(target.pos)
              else tr.delete(from, to)
            } else if (action < 0.83)
              tr.replace(
                from,
                to,
                new Slice(
                  Fragment.from([
                    schema.nodes.paragraph!.create(null, schema.text('pasted')),
                    schema.nodes.paragraph!.create(
                      null,
                      schema.text('second [x]'),
                    ),
                  ]),
                  1,
                  1,
                ),
              )
            else if (action < 0.88 && to > from)
              tr.addMark(
                from,
                to,
                pick(
                  ['strong', 'emphasis', 'inlineCode'].map((name) =>
                    schema.marks[name]!.create(),
                  ),
                ),
              )
            else if (action < 0.93 && to > from)
              tr.removeMark(from, to, schema.marks.link!)
            else {
              const item = $target.node(-1)
              if (item?.type.name === 'list_item')
                tr.setNodeAttribute(
                  $target.before(-1),
                  'checked',
                  item.attrs.checked === null ? null : !item.attrs.checked,
                )
              else tr.insert(from, schema.text('y'))
            }
          } catch {
            continue
          }
          const before = doc
          doc = tr.doc
          const { fast, whole } = compare(local, full, doc)
          if (fast === undefined) continue
          localSaves++
          const kind = doc.child(target.top).type.name
          if (!doc.child(target.top).eq(before.child(target.top)))
            kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
          expect(reopen(parse(fast)), `seed ${seed} step ${step}`).toBe(
            reopen(doc),
          )
          expect(
            whole,
            `seed ${seed} step ${step}: ${JSON.stringify(source)}`,
          ).toBe(fast)
        }
      }
      expect(localSaves).toBeGreaterThan(500)
      for (const kind of [
        'paragraph',
        'heading',
        'bullet_list',
        'ordered_list',
        'code_block',
        'table',
      ])
        expect(kinds.get(kind), kind).toBeGreaterThan(10)
    }),
  120_000,
)

// Applies `edit` to the loaded document and saves it both ways.
function edited(
  ctx: Ctx,
  source: string,
  edit: (doc: ProseNode, tr: Transform) => void,
) {
  const doc = ctx.get(parserCtx)(source)
  const tr = new Transform(doc)
  edit(doc, tr)
  const { fast, whole } = compare(
    new Preservation(ctx, source),
    wholeOnly(ctx, source),
    tr.doc,
  )
  return {
    fast,
    whole,
    saved: () => new Preservation(ctx, source).serialize(tr.doc),
  }
}

// Position just after the first occurrence of `text` in the document.
function after(doc: ProseNode, text: string): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(text))
      found = pos + node.text!.indexOf(text) + text.length
    return found < 0
  })
  if (found < 0) throw Error(`No ${text}`)
  return found
}

const typing =
  (anchor: string, text: string) => (doc: ProseNode, tr: Transform) =>
    tr.insert(
      after(doc, anchor),
      doc.type.schema.text(text, doc.resolve(after(doc, anchor)).marks()),
    )

test.each([
  [
    'an inline link',
    'Intro\n\nSee [link](/t "T") for details.\n\nEnd\n',
    'details',
    'See [link](/t "T") for details!.',
  ],
  [
    'full, collapsed and shortcut references to a later definition',
    'A [full][ref] and [ref][] and [Ref] here.\r\n\r\n[ref]: /target\r\n',
    'here',
    'A [full][ref] and [ref][] and [Ref] here!.',
  ],
  [
    'a footnote definition elsewhere',
    'Text [link](/l) words.\n\n[^1]: Note [ref].\n\n[ref]: /r\n',
    'words',
    'Text [link](/l) words!.',
  ],
  [
    'a heading with a link',
    '# Title [l](/l) end\n\nBody\n',
    'end',
    '# Title [l](/l) end!',
  ],
  [
    'a typed bracket',
    'Words [l](/l) here.\n\n[x]: /x\n',
    'Words',
    'Words\\[x\\]! [l](/l) here.',
  ],
  [
    'a table cell',
    '| A | B |\n| - | - |\n| [c](/c) | d |\n\nEnd\n',
    'd',
    '| A | B |\n| - | - |\n| [c](/c) | d\\|! |',
  ],
  [
    'code that now contains its fence',
    'Intro\n\n```ts\nconst a = "<b>";\n```\n\nEnd\n',
    '"<b>";',
    '````ts\nconst a = "<b>";\n```\n````',
  ],
])('typing beside %s validates the block alone', (_, source, anchor, block) =>
  withEditor('x\n', (editor) => {
    const text =
      _ === 'a typed bracket'
        ? '[x]!'
        : _ === 'a table cell'
          ? '|!'
          : _ === 'code that now contains its fence'
            ? '\n```'
            : '!'
    const { fast, whole } = edited(editor.ctx, source, typing(anchor, text))
    expect(fast).toBeDefined()
    expect(fast).toBe(whole)
    const ending = source.includes('\r\n') ? '\r\n' : '\n'
    expect(fast).toContain(block.replaceAll('\n', ending))
  }),
)

test.each([
  [
    'a definition inside a quote',
    'Text [l](/l) words.\n\n> [q]: /q\n',
    'words',
  ],
  ['inline HTML', 'Text <b>bold</b> [l](/l) words.\n', 'words'],
  ['an HTML comment', 'Text <!-- note --> words.\n', 'words'],
  ['an Obsidian comment', 'Text %%note%% words.\n', 'words'],
  ['an autolink', 'Text <https://example.com> words.\n', 'words'],
])('typing beside %s keeps the whole-document path', (_, source, anchor) =>
  withEditor('x\n', (editor) => {
    const { fast, whole } = edited(editor.ctx, source, typing(anchor, '!'))
    expect(fast).toBeUndefined()
    expect(typeof whole).toBe('string')
  }),
)

test('typing in one item of a long CRLF task list validates that item alone', () =>
  withEditor('x\n', (editor) => {
    const items = Array.from(
      { length: 2000 },
      (_, i) => `* [ ] Task ${i} [link](/t/${i})  `,
    )
    const source = items.join('\r\n') + '\r\n'
    const { fast, whole } = edited(
      editor.ctx,
      source,
      typing('Task 1000', ' typed'),
    )
    expect(fast).toBe(source.replace('Task 1000 ', 'Task 1000 typed '))
    expect(whole).toBe(fast)
  }))

test.each([
  [
    'an ordered item',
    '1) one\n2) two\n3) three [l](/l)\n',
    'three',
    '3) three! [l](/l)',
  ],
  [
    'an indented item with a lazy line',
    'Intro\n\n  - one\n  - two [l](/l)\nlazy line\n  - three\n',
    'lazy',
    '  - two [l](/l)\nlazy! line',
  ],
  [
    'a nested item',
    '- one\n    + nested [l](/l)\n    + more\n- two\n',
    'nested',
    '    + nested! [l](/l)',
  ],
  [
    'a wide item with a second paragraph',
    '1.  wide [l](/l)\n    more text\n\n    second\n2.  next\n',
    'second',
    '    second!',
  ],
])('typing in %s validates it alone', (_, source, anchor, block) =>
  withEditor('x\n', (editor) => {
    const { fast, whole } = edited(editor.ctx, source, typing(anchor, '!'))
    expect(fast).toBeDefined()
    expect(fast).toBe(whole)
    expect(fast).toContain(block)
  }),
)

test('a deletion that would start a nested list in an item is refused', () =>
  withEditor('x\n', (editor) => {
    const source = '1.  wide [l](/l)\n    b - c\n2.  next\n'
    const { fast, saved } = edited(editor.ctx, source, (doc, tr) =>
      tr.delete(after(doc, 'b - c') - 5, after(doc, 'b - c') - 3),
    )
    expect(fast).toBeUndefined()
    expect(saved).toThrow(PreservationError)
  }))

// The position at the start of the textblock that holds `text`.
function blockStart(doc: ProseNode, text: string): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (found < 0 && node.isTextblock && node.textContent.startsWith(text))
      found = pos
    return found < 0
  })
  if (found < 0) throw Error(`No ${text}`)
  return found
}

test.each([
  [
    'two paragraphs of a wide item joined',
    '-   First para [l](/l)\n\n    Second para\n\n  Not in list\n',
    'Second para',
  ],
  [
    'two paragraphs of a tab item joined',
    '-\tFirst [l](/l)\n\n\tSecond\n  - Sibling\n',
    'Second',
  ],
  [
    'two paragraphs of a numbered item joined',
    '1. First [l](/l)\n\n2. Second step\n\n   More detail\n3. Third\n',
    'More detail',
  ],
])('%s keeps the whole-document path', (_, source, second) =>
  withEditor('x\n', (editor) => {
    const { fast, saved } = edited(editor.ctx, source, (doc, tr) =>
      tr.join(blockStart(doc, second)),
    )
    expect(fast).toBeUndefined()
    let text: string | undefined
    try {
      text = saved()
    } catch (error) {
      expect(error).toBeInstanceOf(PreservationError)
    }
    if (text !== undefined) expect(text).toContain(source.slice(0, 4))
  }),
)

test('a paragraph split inside an item keeps the whole-document path', () =>
  withEditor('x\n', (editor) => {
    const source = '-   One [l](/l) two\n\n  Not in list\n'
    const { fast } = edited(editor.ctx, source, (doc, tr) =>
      tr.split(after(doc, 'One')),
    )
    expect(fast).toBeUndefined()
  }))

test('emptying the first line of an item keeps the whole-document path', () =>
  withEditor('x\n', (editor) => {
    const source = '- one [l](/l)\n- two\n\n  Indented\n'
    const { fast } = edited(editor.ctx, source, (doc, tr) =>
      tr.delete(after(doc, 'two') - 3, after(doc, 'two')),
    )
    expect(fast).toBeUndefined()
  }))

test('code that supplies a closing front matter line is not validated alone', () =>
  withEditor('x\n', (editor) => {
    const source = '---\n\nIntro\n\n```\ncode\n```\n'
    const { fast, whole } = edited(editor.ctx, source, typing('code', '\n---'))
    expect(fast).toBeUndefined()
    expect(whole).toBe('***\n\nIntro\n\n```\ncode\n---\n```\n')
  }))

test('adjacent edits that resemble each other’s originals keep whole-document pairing', () =>
  withEditor('x\n', (editor) => {
    const source = 'x [l](/l)\n\nhello world, [l](/l) again\n\nEnd\n'
    const { fast, whole } = edited(editor.ctx, source, (doc, tr) => {
      const second = doc.child(0).nodeSize
      tr.replaceWith(
        second + 1,
        second + doc.child(1).nodeSize - 1,
        doc.type.schema.text('y'),
      )
      tr.replaceWith(1, doc.child(0).nodeSize - 1, doc.child(1).content)
    })
    expect(fast).toBeUndefined()
    expect(typeof whole).toBe('string')
  }))

test('an edit in a CRLF list keeps the continuation lines of other items', () =>
  withEditor('x\n', (editor) => {
    const source =
      '- one [l](/l)\r\n- two\r\n  continued\r\n- three\r\n\r\nEnd\r\n'
    const { whole } = edited(editor.ctx, source, (doc, tr) => {
      typing('one', '!')(doc, tr)
      tr.insert(tr.doc.content.size - 1, doc.type.schema.text('!'))
    })
    expect(whole).toBe(source.replace('one', 'one!').replace('End', 'End!'))
  }))
