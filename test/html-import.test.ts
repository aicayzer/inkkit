import { expect, test } from 'vitest'
import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { DOMSerializer, type Node } from '@milkdown/kit/prose/model'
import { AllSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Nodes } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFootnoteFromMarkdown } from 'mdast-util-gfm-footnote'
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table'
import { gfmAutolinkLiteralFromMarkdown } from 'mdast-util-gfm-autolink-literal'
import { gfmFootnote } from 'micromark-extension-gfm-footnote'
import { gfmTable } from 'micromark-extension-gfm-table'
import { gfmAutolinkLiteral } from 'micromark-extension-gfm-autolink-literal'
import { InkKitEditor } from '../src/editor'
import { isSafeLinkTarget, isScriptAddress } from '../src/link-safety'
import { semanticSignature } from '../src/preserve'

// HTML pasted or dropped into the editor must save as Markdown that reads back
// as the structure that was inserted, both in InkKit and in the GitHub
// Flavored Markdown reading that other apps use, which must hold no address
// that HTML import refuses.

interface Session {
  editor: InkKitEditor
  view: EditorView
  ctx: Ctx
  errors: string[]
}

async function withEditor<T>(
  run: (session: Session) => Promise<T>,
  options: Parameters<typeof InkKitEditor.mount>[2] = {},
) {
  const errors: string[] = []
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    {
      changed() {},
      stateChanged() {},
      copy() {},
      openLink() {},
      error: (error) => errors.push(error.message),
    },
    options,
  )
  try {
    const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
    return await run({ editor, ctx, view: ctx.get(editorViewCtx), errors })
  } finally {
    await editor.destroy()
    root.remove()
  }
}

let generation = 0
function load(session: Session, text = ''): void {
  session.errors.length = 0
  session.editor.loadDocument({
    documentId: 'note',
    generation: ++generation,
    format: 'md',
    text,
  })
}

// An image the test host cannot import is reported, but the paste proceeds.
const refusals = (session: Session) =>
  session.errors.filter((error) => !/image is unavailable/.test(error))

const structure = (doc: Node) =>
  semanticSignature(doc.type.create(null, doc.content))

/** Addresses that HTML import refuses, in a GitHub Flavored Markdown or
 *  strict CommonMark reading of the Markdown, or one with raw HTML off. */
function unsafeAddresses(markdown: string): string[] {
  const found: string[] = []
  const visit = (node: Nodes) => {
    if (
      (node.type === 'link' || node.type === 'definition') &&
      !isSafeLinkTarget(node.url)
    )
      found.push(node.url)
    if (node.type === 'image' && isScriptAddress(node.url)) found.push(node.url)
    if ('children' in node) node.children.forEach(visit)
  }
  visit(
    fromMarkdown(markdown, {
      extensions: [gfmAutolinkLiteral(), gfmFootnote(), gfmTable()],
      mdastExtensions: [
        gfmAutolinkLiteralFromMarkdown(),
        gfmFootnoteFromMarkdown(),
        gfmTableFromMarkdown(),
      ],
    }),
  )
  visit(fromMarkdown(markdown))
  visit(
    fromMarkdown(markdown, {
      extensions: [{ disable: { null: ['htmlFlow', 'htmlText'] } }],
    }),
  )
  return found
}

async function insert(
  session: Session,
  html: string,
  via: 'paste' | 'drop',
  initial = '',
): Promise<{ text: string; doc: Node }> {
  load(session, initial)
  if (initial)
    // Between two paragraphs, at the end of the first.
    session.view.dispatch(
      session.view.state.tr.setSelection(
        TextSelection.create(
          session.view.state.doc,
          session.view.state.doc.firstChild!.nodeSize - 1,
        ),
      ),
    )
  if (via === 'paste') await session.editor.paste({ text: 'text', html })
  else session.view.pasteHTML(html, new Event('paste') as ClipboardEvent)
  return { text: session.editor.snapshot().text, doc: session.view.state.doc }
}

async function expectReadsBack(
  session: Session,
  html: string,
  via: 'paste' | 'drop',
): Promise<{ text: string; doc: Node }> {
  const result = await insert(session, html, via)
  const label = `${via}: ${html}\n${result.text}`
  expect(refusals(session), label).toEqual([])
  expect(structure(session.ctx.get(parserCtx)(result.text)), label).toBe(
    structure(result.doc),
  )
  expect(unsafeAddresses(result.text), label).toEqual([])
  result.doc.descendants((node) => {
    for (const mark of node.marks)
      if (mark.type.name === 'link')
        expect(isSafeLinkTarget(String(mark.attrs.href)), label).toBe(true)
  })
  return result
}

const names = (doc: Node) => {
  const found: string[] = []
  doc.descendants((node) => {
    found.push(node.type.name)
  })
  return found
}

const script = '[l](javascript:alert(1))'

for (const via of ['paste', 'drop'] as const) {
  test(`preserved Markdown from HTML is kept only when it reads back as itself (${via})`, async () => {
    await withEditor(async (session) => {
      for (const source of [
        `&lt;b&gt;x&lt;/b&gt; ${script}`,
        `# H\n\n${script}`,
        `&lt;div&gt;\n\n${script}\n&lt;/div&gt;`,
        '---\ntitle: x\n---',
        '&lt;!--x',
        '&lt;javascript:alert(1)&gt; &lt;b&gt;x&lt;/b&gt;',
      ]) {
        const { doc, text } = await expectReadsBack(
          session,
          `<p>a</p><pre class="literal-markdown">${source}</pre><p>b</p>`,
          via,
        )
        expect(names(doc), text).not.toContain('literal_markdown')
        expect(names(doc), text).toContain('code_block')
      }
      const { doc, text } = await expectReadsBack(
        session,
        '<p>a</p><pre class="literal-markdown">&lt;div&gt;\nhello\n&lt;/div&gt;</pre><p>b</p>',
        via,
      )
      expect(names(doc)).toContain('literal_markdown')
      expect(text).toBe('a\n\n<div>\nhello\n</div>\n\nb\n')
    })
  })

  test(`a callout title from visible text saves as the same plain title (${via})`, async () => {
    await withEditor(async (session) => {
      for (const title of [
        `T\n\n# H ${script}`,
        `Use *this* &lt;b&gt;now&lt;/b&gt;`,
        '+ - [!TIP]',
      ]) {
        const { doc, text } = await expectReadsBack(
          session,
          `<blockquote data-inkkit-callout="NOTE"><strong class="inkkit-callout-title">${title}</strong><div class="inkkit-callout-body"><p>body</p></div></blockquote>`,
          via,
        )
        expect(names(doc), text).toContain('inkkit_callout')
        expect(text.split('\n')[0], text).toMatch(/^> \[!NOTE\] /)
      }
    })
  })

  test(`comment text from HTML saves as a comment that ends where it was written (${via})`, async () => {
    await withEditor(async (session) => {
      for (const html of [
        `<p>a<span data-inkkit-comment="obsidian">x\n\n# H ${script}</span>b</p>`,
        `<p>a<span data-inkkit-comment="html">x\n\n# H</span>b</p>`,
        `<p>a<span data-inkkit-comment="obsidian">${script}</span>b</p>`,
        `<div data-inkkit-comment="obsidian">line\n\n# H\n${script}</div>`,
        `<p>a<span data-inkkit-comment="html">x --!&gt; ${script}</span>b</p>`,
        `<p>a<span data-inkkit-comment="html">&gt;${script}</span>b</p>`,
        `<p>a<span data-inkkit-comment="html">-&gt;${script}</span>b</p>`,
        `<div data-inkkit-comment="html">-&gt; ${script}</div>`,
        `<p>a<span data-inkkit-comment="obsidian">x %% ${script}</span>b</p>`,
        `<div data-inkkit-comment="obsidian">x\n%%\n${script}</div>`,
      ])
        await expectReadsBack(session, html, via)
      const kept = await expectReadsBack(
        session,
        '<p>a<span data-inkkit-comment="obsidian">plain note</span>b</p>',
        via,
      )
      expect(kept.text).toBe('a%%plain note%%b\n')
      const hidden = await expectReadsBack(
        session,
        '<p>a<span data-inkkit-comment="obsidian">see [l](https://example.test/)</span>b</p>',
        via,
      )
      expect(hidden.text).toBe('a<!--see [l](https://example.test/)-->b\n')
      const text = await expectReadsBack(
        session,
        `<p>a<span data-inkkit-comment="obsidian">see ${script}</span>b</p>`,
        via,
      )
      expect(text.text).toBe('asee \\[l]\\(javascript:alert(1))b\n')
    })
  })

  test(`HTML with InkKit's metadata from earlier cases reads back as inserted (${via})`, async () => {
    const hostile = '&#10;&#10;[l](https://example.test/q) &lt;b&gt;h&lt;/b&gt;'
    const label = 'x]&#10;&#10;# H'
    const fence = (value: object) =>
      `<pre data-language="js" data-inkkit-fence='${JSON.stringify(value)}'><code>a</code></pre><p>after</p>`
    const base = { marker: '```', info: 'js', close: '```', trailing: '' }
    await withEditor(async (session) => {
      for (const html of [
        `<p><a href="javascript:alert(1)">t</a></p>`,
        `<p><a href="JaVaScRiPt&#58;alert(1)">t</a></p>`,
        `<div data-inkkit-reference-definition="x" data-inkkit-label="x" data-inkkit-url="javascript:alert(1)">d</div>`,
        `<div data-inkkit-reference-definition="x" data-inkkit-label="x" data-inkkit-url="https://example.test/" data-inkkit-title="a${hostile}">d</div>`,
        `<div data-inkkit-reference-definition="x" data-inkkit-label="${label}" data-inkkit-url="https://example.test/">d</div>`,
        `<p>a<sup data-inkkit-footnote-reference="x" data-inkkit-label="${label}">1</sup></p>`,
        `<p>a</p><div data-inkkit-footnote-definition="x" data-inkkit-label="${label}"><p>body</p></div>`,
        `<p><a href="https://example.test/" data-inkkit-reference="x" data-inkkit-label="${label}" data-inkkit-reference-type="full">t</a></p>`,
        `<p><a href="https://example.test/" title="a&#10;&#10;# H">t</a></p>`,
        fence({ ...base, ending: '\n' }),
        fence({ ...base, info: 'js `x', ending: '\n' }),
        fence({ ...base, close: '', ending: '\n' }),
        `<p><img src="javascript:alert(1)" alt="a${hostile}"></p>`,
        `<span data-type="html">&lt;b&gt;x&lt;/b&gt;</span>`,
        `<p>a<!--c--&gt; ${script} --></p>`,
        '<!--[if !supportLists]--><p>Word</p><!--[endif]-->',
      ])
        await expectReadsBack(session, html, via)
    })
  })
}

test('a bare web address in pasted text imports as the link it reads back as', async () => {
  await withEditor(async (session) => {
    for (const via of ['paste', 'drop'] as const) {
      const { text } = await expectReadsBack(
        session,
        '<p>Visit https://example.com/a <b>today</b> or www.example.com</p><p>[https://example.test/: x]</p>',
        via,
      )
      expect(text).toBe(
        'Visit https://example.com/a **today** or www.example.com\n\n\\[https://example.test/: x]\n',
      )
    }
  })
})

test('HTML comments in pasted web pages import as author comments', async () => {
  await withEditor(async (session) => {
    const block = await expectReadsBack(
      session,
      '<p>Before</p><!--author--><p>After</p>',
      'paste',
    )
    expect(block.text).toBe('Before\n\n<!--author-->\n\nAfter\n')
    expect(names(block.doc)).toContain('comment_block')
    const inline = await expectReadsBack(
      session,
      '<p>a <!--note--> b</p>',
      'paste',
    )
    expect(inline.text).toBe('a <!--note-->b\n')
    // A browser ends this comment at once, so the rest is text.
    const ended = await expectReadsBack(
      session,
      `<p>a<!-->${script}--></p>`,
      'paste',
    )
    expect(ended.doc.textContent).toBe(`a${script}-->`)
  })
})

// A small deterministic generator, so a failure names a reproducible seed.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const tokens = [
  '\n',
  '\n\n',
  ' ',
  'x',
  'word',
  '#',
  '>',
  '-',
  '[',
  ']',
  '(',
  ')',
  '`',
  '```',
  '%%',
  '<!--',
  '-->',
  '--!>',
  '<',
  '*',
  '|',
  '\\',
  '!',
  ':',
  '[^1]',
  '[!NOTE]',
  'javascript:alert(1)',
  '[l](javascript:alert(1))',
  '&',
]

function generate(next: () => number): string {
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(next() * items.length)]!
  const raw = () =>
    Array.from({ length: 1 + Math.floor(next() * 6) }, () => pick(tokens)).join(
      '',
    )
  const escape = (value: string) =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
  const t = () => escape(raw())
  const a = () => escape(next() < 0.3 ? 'https://example.test/' : raw())
  const templates = [
    () => `<pre class="literal-markdown">${t()}</pre>`,
    () =>
      `<blockquote data-inkkit-callout="${pick(['NOTE', 'TIP', 'X'])}"${next() < 0.5 ? ` data-inkkit-title="${a()}"` : ''}><strong class="inkkit-callout-title">${t()}</strong><div class="inkkit-callout-body"><p>${t()}</p></div></blockquote>`,
    () =>
      `<p>${t()}<span data-inkkit-comment="${pick(['html', 'obsidian'])}">${t()}</span>${t()}</p>`,
    () =>
      `<div data-inkkit-comment="${pick(['html', 'obsidian'])}">${t()}</div>`,
    () =>
      `<div data-inkkit-reference-definition="${a()}" data-inkkit-label="${a()}" data-inkkit-url="${a()}" data-inkkit-title="${a()}">d</div>`,
    () =>
      `<p><a href="${a()}" title="${a()}" data-inkkit-reference="${a()}" data-inkkit-label="${a()}" data-inkkit-reference-type="${pick(['full', 'collapsed', 'shortcut'])}">${t()}</a></p>`,
    () =>
      `<p>${t()}<sup data-inkkit-footnote-reference="${a()}" data-inkkit-label="${a()}">1</sup></p><div data-inkkit-footnote-definition="${a()}" data-inkkit-label="${a()}"><p>${t()}</p></div>`,
    () =>
      `<pre data-language="${a()}" data-inkkit-fence="${escape(JSON.stringify({ marker: pick(['```', '~~~', '````']), info: raw(), close: pick(['```', '~~~', '']), trailing: '', ending: '\n' }))}"><code>${t()}</code></pre>`,
    () => `<h2>${t()}</h2><ul><li>${t()}</li></ul>`,
    () => `<blockquote><p>${t()}</p></blockquote>`,
    () => `<table><tr><th>${t()}</th></tr><tr><td>${t()}</td></tr></table>`,
    () => `<p><img src="${a()}" alt="${a()}" title="${a()}"></p>`,
    () => `<p>${t()}<!--${raw().replaceAll('-->', '')}-->${t()}</p>`,
    () => `<x-widget title="${a()}">${t()}</x-widget>`,
    () =>
      `<p>${t()}<span data-inkkit-wiki="${a()}" data-inkkit-wiki-raw="${escape(pick(['[[', '![[', '']) + raw() + pick([']]', '|' + raw() + ']]', '']))}">${t()}</span></p>`,
  ]
  return Array.from({ length: 1 + Math.floor(next() * 3) }, () =>
    pick(templates)(),
  ).join('')
}

test('generated HTML with InkKit metadata and untidy text reads back as inserted', async () => {
  await withEditor(
    async (session) => {
      for (let seed = 1; seed <= 300; seed++) {
        const html = generate(random(seed))
        for (const via of ['paste', 'drop'] as const) {
          const initial = seed % 2 ? '' : 'Before\n\nAfter\n'
          const result = await insert(session, html, via, initial)
          const label = `seed ${seed} ${via}: ${html}\n${result.text}`
          // Into an empty document the content always lands. Beside other
          // text, where its first and last blocks merge with what is there,
          // the editor may instead refuse the edit and keep the document.
          if (initial && refusals(session).length) {
            expect(result.text, label).toBe(initial)
            continue
          }
          expect(refusals(session), label).toEqual([])
          expect(
            structure(session.ctx.get(parserCtx)(result.text)),
            label,
          ).toBe(structure(result.doc))
          expect(unsafeAddresses(result.text), label).toEqual([])
        }
      }
    },
    { wikiLinks: { open() {} } },
  )
}, 60000)

test('Markdown typed or pasted as Markdown source keeps its text', async () => {
  const source = `a %%${script}%% <!--x -- y-->\n\n<b>x</b> ${script}\n\n> [!NOTE] T *e*\n> body\n\n<div>\n[y](javascript:alert(1))\n</div>\n\nc<!--[y](javascript:alert(1))-->d\n\n[^1]: javascript:alert(1)\n`
  await withEditor(async (session) => {
    load(session)
    await session.editor.paste({ text: source, markdown: source })
    expect(session.errors).toEqual([])
    expect(session.editor.snapshot().text).toBe(source)
    load(session)
    session.editor.pasteAsPlainText(source)
    expect(session.editor.snapshot().text).not.toMatch(/^<b>/m)
    load(session, source)
    expect(session.editor.snapshot().text).toBe(source)
    session.editor.insertText(' more', generation)
    expect(session.editor.snapshot().text).toContain(script)
  })
})

test('Markdown pasted as source that would end a new comment early is refused', async () => {
  await withEditor(async (session) => {
    load(session)
    await session.editor.paste({
      text: 'a <!--x--!>-->',
      markdown: 'a <!--x--!>-->\n',
    })
    expect(session.errors).toHaveLength(1)
    expect(session.editor.snapshot().text).toBe('')
  })
})

test('a wiki link from HTML saves no address that other readers would follow', async () => {
  await withEditor(
    async (session) => {
      for (const via of ['paste', 'drop'] as const)
        for (const raw of [
          '[[x|&lt;javascript:alert(1)&gt;]]',
          '[[&lt;javascript:alert(1)&gt;]]',
          '[[x]]',
        ])
          await expectReadsBack(
            session,
            `<p>a <span data-inkkit-wiki="x" data-inkkit-wiki-raw="${raw}">x</span> b</p>`,
            via,
          )
    },
    { wikiLinks: { open() {} } },
  )
})

test('Markdown kept inside HTML saves no address that a reader without raw HTML would follow', async () => {
  await withEditor(async (session) => {
    for (const via of ['paste', 'drop'] as const)
      for (const html of [
        '<p>a<span data-inkkit-comment="html">[y](javascript:alert(1))</span>b</p>',
        '<p>a<span data-inkkit-comment="obsidian">&lt;javascript:alert(1)&gt;</span>b</p>',
        '<p>a</p><pre class="literal-markdown">&lt;div&gt;\n[y](javascript:alert(1))\n&lt;/div&gt;</pre><p>b</p>',
        '<p>a</p><pre class="literal-markdown">&lt;x-a&gt;\n[y](javascript:alert(1))\n&lt;/x-a&gt;</pre><p>b</p>',
      ]) {
        const { doc } = await expectReadsBack(session, html, via)
        expect(names(doc), html).not.toContain('literal_markdown')
        expect(names(doc), html).not.toContain('comment_inline')
      }
  })
})

test('a footnote from HTML saves no address that strict CommonMark would follow', async () => {
  await withEditor(async (session) => {
    for (const via of ['paste', 'drop'] as const) {
      const { text } = await expectReadsBack(
        session,
        '<p>a<sup data-inkkit-footnote-reference="1" data-inkkit-label="1">1</sup></p><div data-inkkit-footnote-definition="1" data-inkkit-label="1"><p>javascript:alert(1)</p></div>',
        via,
      )
      expect(text).not.toMatch(/^\[\^1\]: javascript/m)
    }
  })
})

function copied(session: Session): Record<string, string> {
  const data: Record<string, string> = {}
  const event = new Event('copy', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      setData: (type: string, value: string) => (data[type] = value),
      getData: (type: string) => data[type] ?? '',
    },
  })
  session.view.dispatch(
    session.view.state.tr.setSelection(
      new AllSelection(session.view.state.doc),
    ),
  )
  session.view.dom.dispatchEvent(event)
  return data
}

test("InkKit's own copied and dragged HTML imports as the same structure", async () => {
  const source = [
    '<div>\nhello\n</div>',
    'a <b>b</b> c',
    '> [!TIP] Plain title\n> body',
    'See [the site][site] and a note[^1] %%secret%% <!--hidden-->.',
    '%%\nblock note\n%%',
    '```js\nlet x = 1\n```',
    '[site]: https://example.test/ "Site"',
    '[^1]: The note.',
  ].join('\n\n')
  await withEditor(async (session) => {
    load(session, `${source}\n`)
    const expected = session.view.state.doc
    const data = copied(session)
    expect(data['text/html']).toContain('literal-markdown')
    load(session)
    await session.editor.paste({
      text: data['text/plain'] ?? '',
      html: data['text/html'],
    })
    expect(session.errors).toEqual([])
    const pasted = session.editor.snapshot().text
    expect(structure(session.ctx.get(parserCtx)(pasted))).toBe(
      structure(session.view.state.doc),
    )
    for (const part of [
      '<div>\nhello\n</div>\n\na <b>b</b> c\n\n> [!TIP] Plain title\n> body',
      'See [the site][site] and a note[^1]',
      '```js\nlet x = 1\n```',
      '[site]: https://example.test/ "Site"',
      '[^1]: The note.',
    ])
      expect(pasted).toContain(part)
    // Ordinary copy leaves comments out.
    expect(names(session.view.state.doc)).not.toContain('comment_inline')

    const container = document.createElement('div')
    container.append(
      DOMSerializer.fromSchema(expected.type.schema).serializeFragment(
        expected.content,
      ),
    )
    load(session)
    session.view.pasteHTML(
      container.innerHTML,
      new Event('paste') as ClipboardEvent,
    )
    expect(session.errors).toEqual([])
    expect(structure(session.view.state.doc)).toBe(structure(expected))
  })
})
